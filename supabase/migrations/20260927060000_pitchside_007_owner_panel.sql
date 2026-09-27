-- =====================================================================================
-- Pitchside 3D — migration 007 (run AFTER 001-006). Idempotent: safe to run more than once.
-- Owner control panel + admin commands:
--   * Admin commands: set any player's username, "revoke ALL admin" (every mod/owner role except the
--     reserved owner account and the caller; admin tokens issued before it stop working).
--   * Feature restrictions per player (codes, admin, market, packs, messages), timed or permanent, enforced
--     here (actor resolution, list/buy, messages) and reported by presence so the client enforces packs too.
--   * Coins: owner grants up to 9 000 000 000 000 000 (safe integer range), balances clamped, never NaN.
--   * Moderation search: optional page, empty query = everyone (the client already sends p_page).
--   * Full player list with all in-game info; player detail with their cloud-saved club.
--   * Owner edits to a player's club go through an "owner patch" queue: the client applies each patch to
--     its UT save and acknowledges it (a stale client cannot overwrite an edit: the patch stays pending
--     until applied). Guests (device profiles) may keep a cloud save too, so the owner sees every club.
--   * Owner direct messages; owners/admins may list on the market at any price.
-- Same security model as 001-006: RLS on, no table grants, SECURITY DEFINER RPCs with a fixed
-- search_path; owner powers = full/super code (or token) or an owner account; every action audited.
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array[
       'pitchside_list_card', 'pitchside_mod_search', 'pitchside__restricted', 'pitchside__restrictions_json',
       'pitchside_admin_set_username', 'pitchside_admin_revoke_all', 'pitchside_admin_restrict', 'pitchside_admin_message',
       'pitchside_admin_player_detail', 'pitchside_admin_patch_player', 'pitchside_patches_pending', 'pitchside_patches_ack'])
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

-- ------------------------------------------------------------------ schema
alter table public.pitchside_profiles add column if not exists restrictions jsonb not null default '{}'::jsonb;
alter table public.pitchside_profiles drop constraint if exists pitchside_profiles_restrictions_obj;
alter table public.pitchside_profiles add constraint pitchside_profiles_restrictions_obj
  check (jsonb_typeof(restrictions) = 'object' and octet_length(restrictions::text) <= 1024);

-- staff may list at any price (1 .. 9e15) and admin cards up to 999 OVR (players stay within 150 .. 15 000 000 / 99 in list_card)
alter table public.pitchside_listings drop constraint if exists pitchside_listings_price_rng;
alter table public.pitchside_listings add constraint pitchside_listings_price_rng check (price between 1 and 9000000000000000);
alter table public.pitchside_listings drop constraint if exists pitchside_listings_ovr_rng;
alter table public.pitchside_listings add constraint pitchside_listings_ovr_rng check (ovr between 1 and 999);

-- Issued admin tokens (so "revoke ALL admin" can end every session precisely; the token itself is never stored,
-- only its HMAC part).
create table if not exists public.pitchside_admin_tokens (
  sig        text primary key,
  level      text not null,
  exp        bigint not null,
  created_at timestamptz not null default now(),
  revoked    boolean not null default false
);
alter table public.pitchside_admin_tokens enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_admin_tokens from %I', r);
    end if;
  end loop;
end $$;
revoke all on table public.pitchside_admin_tokens from public;

create table if not exists public.pitchside_owner_patches (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.pitchside_profiles(id) on delete cascade,
  ops        jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint pitchside_owner_patches_ops check (jsonb_typeof(ops) = 'array' and octet_length(ops::text) <= 262144)
);
create index if not exists pitchside_owner_patches_pending on public.pitchside_owner_patches (profile_id, id) where applied_at is null;
alter table public.pitchside_owner_patches enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_owner_patches from %I', r);
    end if;
  end loop;
end $$;
revoke all on table public.pitchside_owner_patches from public;

-- ------------------------------------------------------------------ restrictions
-- A restriction value is true (permanent) or an ISO timestamp (until). Unknown shapes count as inactive.
create or replace function public.pitchside__restricted(p_restr jsonb, p_key text)
returns boolean language plpgsql stable
set search_path = public, extensions, pg_temp
as $$
declare v jsonb := coalesce(p_restr, '{}'::jsonb) -> p_key;
begin
  if v is null then return false; end if;
  if jsonb_typeof(v) = 'boolean' then return v::text = 'true'; end if;
  if jsonb_typeof(v) = 'string' then
    begin return (v #>> '{}')::timestamptz > now(); exception when others then return false; end;
  end if;
  return false;
end $$;

-- Only the active ones: { key: true | until }.
create or replace function public.pitchside__restrictions_json(p_restr jsonb)
returns jsonb language sql stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(coalesce(p_restr, '{}'::jsonb)) e where public.pitchside__restricted(p_restr, e.key)
$$;

-- ------------------------------------------------------------------ admin levels: revocable tokens
-- 003's code/token check + revocation: a token must be recorded in pitchside_admin_tokens and not revoked
-- (tokens from before 007 are not recorded: they stay valid until the first "revoke ALL admin").
create or replace function public.pitchside__admin_level(p_code text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ws timestamptz := date_trunc('minute', now()); v_fail int; v_parts text[]; r record; v_hash text;
  v_ip text := public.pitchside__client_key(); v_revoke numeric;
begin
  if p_code is null or p_code = '' or char_length(p_code) > 160 then return null; end if;
  select hits into v_fail from public.pitchside_throttle where bucket = 'admin_fail' and window_start = v_ws;
  if coalesce(v_fail, 0) >= 20 or public.pitchside__throttle_hits('admin_fail_ip:' || v_ip, interval '1 hour') >= 60 then
    return null;
  end if;
  if p_code ~ '^adm\.(full|super)\.[0-9]{9,11}\.[0-9a-f]{64}$' then
    v_parts := string_to_array(p_code, '.');
    select case when jsonb_typeof(value -> 'adminRevokeAt') = 'number' then (value ->> 'adminRevokeAt')::numeric end
      into v_revoke from public.pitchside_config where key = 'features';
    if v_parts[3]::bigint > extract(epoch from now())
       and public.pitchside__sign('adm|' || v_parts[2] || '|' || v_parts[3]) = v_parts[4]
       and (exists (select 1 from public.pitchside_admin_tokens t where t.sig = v_parts[4] and not t.revoked)
            or (v_revoke is null and not exists (select 1 from public.pitchside_admin_tokens t where t.sig = v_parts[4]))) then
      return v_parts[2];
    end if;
  elsif char_length(p_code) <= 128 then
    for r in select level, code_hash from public.pitchside_admin_codes order by (level = 'super') desc loop
      if extensions.crypt(p_code, r.code_hash) = r.code_hash then return r.level; end if;
    end loop;
    if not exists (select 1 from public.pitchside_admin_codes where level = 'full') then
      select code_hash into v_hash from public.pitchside_admin where id = 1;
      if v_hash is not null and extensions.crypt(p_code, v_hash) = v_hash then return 'full'; end if;
    end if;
  end if;
  insert into public.pitchside_throttle as t (bucket, window_start, hits) values ('admin_fail', v_ws, 1)
  on conflict (bucket, window_start) do update set hits = t.hits + 1;
  perform public.pitchside__throttle('admin_fail_ip:' || v_ip, interval '1 hour', 1000000);
  return null;
end $$;

-- Exchange a code for a 12 h admin token (recorded, so it can be revoked). -> { ok, level, token, exp }
create or replace function public.pitchside_admin_login(p_code text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_level text; v_exp bigint; v_sig text;
begin
  v_level := public.pitchside__admin_level(p_code);
  if v_level is null then return public.pitchside__err('invalid'); end if;
  v_exp := extract(epoch from now() + interval '12 hours')::bigint;
  v_sig := public.pitchside__sign('adm|' || v_level || '|' || v_exp);
  insert into public.pitchside_admin_tokens (sig, level, exp) values (v_sig, v_level, v_exp) on conflict (sig) do nothing;
  if random() < 0.02 then delete from public.pitchside_admin_tokens where exp < extract(epoch from now()) - 86400; end if;
  return json_build_object('ok', true, 'level', v_level, 'exp', v_exp, 'token', 'adm.' || v_level || '.' || v_exp || '.' || v_sig);
end $$;

-- 003's actor + restrictions: 'admin' = no staff powers at all; 'codes' = admin codes ignored for this player.
create or replace function public.pitchside__actor(p_code text, p_id uuid, p_secret text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_role text; v_level text;
begin
  if p_id is not null and p_secret is not null then
    v := public.pitchside__auth(p_id, p_secret);
    if v.id is not null and public.pitchside__restricted(v.restrictions, 'admin') then return null; end if;
    if v.id is not null and v.role in ('owner', 'mod') then v_role := v.role; end if;
  end if;
  if p_code is not null and p_code <> '' and not (v.id is not null and public.pitchside__restricted(v.restrictions, 'codes')) then
    v_level := public.pitchside__admin_level(p_code);
  end if;
  return coalesce(v_level, v_role);
end $$;

-- 002's moderation actor + the same restrictions.
create or replace function public.pitchside__mod_actor(p_code text, p_id uuid, p_secret text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles;
begin
  if p_id is not null and p_secret is not null then
    v := public.pitchside__auth(p_id, p_secret);
    if v.id is not null and public.pitchside__restricted(v.restrictions, 'admin') then return null; end if;
    if v.id is not null and v.role in ('owner', 'mod') then return v.role; end if;
  end if;
  if p_code is not null and p_code <> '' and not (v.id is not null and public.pitchside__restricted(v.restrictions, 'codes'))
     and public.pitchside__admin_check(p_code) then return 'admin'; end if;
  return null;
end $$;

-- ------------------------------------------------------------------ coins: owner grants without the 1e9 cap
create or replace function public.pitchside_admin_coins(p_code text, p_player uuid, p_delta bigint, p_reason text default null,
  p_key text default null, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles; v_prev jsonb; v_res jsonb; v_before bigint;
begin
  if not public.pitchside__op_key_ok(p_key) then return public.pitchside__err('bad_key'); end if;
  if p_key is not null then
    select result into v_prev from public.pitchside_admin_ops where op_key = 'coins:' || p_key;
    if found then return (v_prev || jsonb_build_object('replay', true))::json; end if;
  end if;
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 9000000000000000 then return public.pitchside__err('bad_amount'); end if;
  select * into v from public.pitchside_profiles where id = coalesce(p_player, p_id) for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if not public.pitchside__may_act_on(v_actor, p_id, v) then return public.pitchside__err('not_allowed'); end if;
  v_before := v.coins;
  update public.pitchside_profiles set coins = greatest(0, least(coins + p_delta, 9000000000000000)) where id = v.id returning * into v;
  v_res := jsonb_build_object('ok', true, 'coins', v.coins, 'player', v.id);
  if p_key is not null then
    insert into public.pitchside_admin_ops (op_key, result) values ('coins:' || p_key, v_res) on conflict do nothing;
  end if;
  if random() < 0.01 then delete from public.pitchside_admin_ops where created_at < now() - interval '3 days'; end if;
  perform public.pitchside__audit(v.id, 'admin_coins', jsonb_build_object('delta', p_delta, 'before', v_before, 'balance', v.coins,
    'reason', left(coalesce(p_reason, ''), 120)) || public.pitchside__mod_by(v_actor, p_id));
  return v_res::json;
end $$;

create or replace function public.pitchside_mod_adjust_coins(p_code text, p_player uuid, p_delta bigint, p_reason text default null,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_old bigint; v_bal bigint; v_actor text;
begin
  v_actor := public.pitchside__mod_actor(p_code, p_id, p_secret);
  if v_actor is null then return public.pitchside__err('not_admin'); end if;
  if v_actor = 'mod' then return public.pitchside__err('not_allowed'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 9000000000000000 then return public.pitchside__err('bad_amount'); end if;
  select coins into v_old from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  update public.pitchside_profiles set coins = greatest(0, least(coins + p_delta, 9000000000000000)) where id = p_player returning coins into v_bal;
  perform public.pitchside__audit(p_player, 'admin_coins', jsonb_build_object('delta', p_delta, 'before', v_old, 'balance', v_bal,
    'reason', left(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), 120)) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'coins', v_bal);
end $$;

-- ------------------------------------------------------------------ player lists
-- 002's search + p_page (the client sends it) + empty query = everyone, newest first. -> { ok, items, more }
create or replace function public.pitchside_mod_search(p_code text, p_query text default null, p_page int default 0,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_q text; v_like text; v_key text; v_items json; v_page int := least(greatest(coalesce(p_page, 0), 0), 1000); v_n int;
begin
  if public.pitchside__mod_actor(p_code, p_id, p_secret) is null then return public.pitchside__err('not_admin'); end if;
  v_q := btrim(regexp_replace(coalesce(p_query, ''), '[[:cntrl:]]', '', 'g'));
  if char_length(v_q) > 40 then return public.pitchside__err('bad_query'); end if;
  v_like := replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  v_key := replace(replace(replace(public.pitchside__username_key(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  with m as (
    select q, row_number() over (order by (v_q <> '' and public.pitchside__username_key(q.username) = public.pitchside__username_key(v_q)) desc,
                                          (v_q <> '' and q.friend_code = upper(v_q)) desc, q.created_at desc) as rn
      from public.pitchside_profiles q
     where v_q = ''
        or (v_key <> '' and public.pitchside__username_key(q.username) like v_key || '%')
        or q.friend_code = upper(replace(v_q, '-', ''))
        or q.id::text = lower(v_q)
        or lower(q.name) like '%' || v_like || '%'
  )
  select coalesce((select json_agg(public.pitchside__mod_row(x.q) order by x.rn) from (select * from m order by rn limit 25 offset v_page * 25) x), '[]'::json),
         (select count(*) from m)
    into v_items, v_n;
  return json_build_object('ok', true, 'items', v_items, 'more', v_n > (v_page + 1) * 25, 'total', v_n);
end $$;

-- Every player (accounts AND device guests) with all in-game info. p_query null/'' = everyone.
create or replace function public.pitchside_admin_players(p_code text, p_query text default null, p_limit int default 50,
  p_offset int default 0, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_q text := btrim(regexp_replace(coalesce(p_query, ''), '[[:cntrl:]]', '', 'g')); v_like text; v_key text;
  v_items json; v_total int; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 1000); v_off int := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if v_actor is null then return public.pitchside__err('not_admin'); end if;
  if char_length(v_q) > 40 then return public.pitchside__err('bad_query'); end if;
  v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_key := replace(replace(replace(public.pitchside__username_key(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  with m as (
    select p.*, s.squad, sv.updated_at as save_at, sv.rev as save_rev, public.pitchside__is_banned(p) as banned_now
      from public.pitchside_profiles p
      left join public.pitchside_squads s on s.profile_id = p.id
      left join public.pitchside_saves sv on sv.profile_id = p.id
     where v_q = ''
        or lower(p.name) like v_like
        or (v_key <> '' and public.pitchside__username_key(p.username) like '%' || v_key || '%')
        or p.friend_code = upper(replace(v_q, '-', ''))
        or p.id::text = lower(v_q)
        or lower(coalesce(s.squad ->> 'name', '')) like v_like
  )
  select (select count(*) from m),
         coalesce((select json_agg(json_build_object('id', x.id, 'username', x.username, 'name', x.name,
            'clubName', left(x.squad ->> 'name', 32), 'coins', x.coins, 'infinite', x.infinite_coins, 'role', x.role, 'banned', x.banned_now,
            'banReason', case when x.banned_now then x.ban_reason end, 'bannedUntil', case when x.banned_now then x.banned_until end,
            'restrictions', public.pitchside__restrictions_json(x.restrictions),
            'friendCode', x.friend_code, 'createdAt', x.created_at, 'lastSeenAt', x.last_seen_at, 'lastLoginAt', x.last_login_at,
            'online', coalesce(x.last_seen_at > now() - interval '60 seconds', false), 'account', x.username is not null,
            'rating', x.rating, 'division', x.division, 'rivalsDivision', x.rivals_division, 'wins', x.wins, 'draws', x.draws, 'losses', x.losses,
            'hasSave', x.save_at is not null, 'saveAt', x.save_at, 'squadRating', case when jsonb_typeof(x.squad -> 'rating') = 'number' then x.squad -> 'rating' end)
            order by x.created_at desc)
           from (select * from m order by m.created_at desc limit v_lim offset v_off) x), '[]'::json)
    into v_total, v_items;
  return json_build_object('ok', true, 'total', v_total, 'items', v_items);
end $$;

-- Owner: one player in full — profile, restrictions, cloud-saved club, public squad, pending owner patches,
-- recent audit + listings. -> { ok, player, save:{ exists, rev, updatedAt, data }, squad, patches, audit, listings }
create or replace function public.pitchside_admin_player_detail(p_code text, p_player uuid, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles; s public.pitchside_saves; v_squad jsonb; v_patches json; v_audit json; v_listings json;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  select * into v from public.pitchside_profiles where id = p_player;
  if not found then return public.pitchside__err('not_found'); end if;
  select * into s from public.pitchside_saves where profile_id = v.id;
  select squad into v_squad from public.pitchside_squads where profile_id = v.id;
  select coalesce(json_agg(json_build_object('id', o.id, 'ops', o.ops, 'at', o.created_at, 'by', o.created_by) order by o.id), '[]'::json)
    into v_patches from public.pitchside_owner_patches o where o.profile_id = v.id and o.applied_at is null;
  select coalesce(json_agg(json_build_object('action', a.action, 'detail', a.detail, 'at', a.at) order by a.at desc), '[]'::json)
    into v_audit from (select * from public.pitchside_audit where profile_id = v.id order by at desc limit 60) a;
  select coalesce(json_agg(json_build_object('listingId', l.id, 'name', l.name, 'ovr', l.ovr, 'price', l.price,
           'status', l.status, 'listedAt', l.created_at, 'soldAt', l.sold_at) order by l.created_at desc), '[]'::json)
    into v_listings from (select * from public.pitchside_listings where seller_id = v.id order by created_at desc limit 40) l;
  return json_build_object('ok', true,
    'player', (public.pitchside__mod_row(v)::jsonb || jsonb_build_object('infinite', v.infinite_coins, 'account', v.username is not null,
      'restrictions', public.pitchside__restrictions_json(v.restrictions), 'online', coalesce(v.last_seen_at > now() - interval '60 seconds', false)))::json,
    'save', case when s.profile_id is null then json_build_object('exists', false) else
      json_build_object('exists', true, 'rev', s.rev, 'updatedAt', s.updated_at, 'data', s.data) end,
    'squad', v_squad, 'patches', v_patches, 'audit', v_audit, 'listings', v_listings);
end $$;

-- ------------------------------------------------------------------ admin commands
-- Change any player's username (display name follows). Accounts only; reserved names only for owners.
create or replace function public.pitchside_admin_set_username(p_code text, p_player uuid, p_username text,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles; v_user text := btrim(coalesce(p_username, '')); v_err text; v_old text;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  select * into v from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if v.username is null then return public.pitchside__err('no_account'); end if;
  if not public.pitchside__may_act_on(v_actor, p_id, v) then return public.pitchside__err('not_allowed'); end if;
  v_err := public.pitchside__username_error(v_user);
  if v_err is not null then return public.pitchside__err(v_err); end if;
  if public.pitchside__name_reserved(v_user) and v.role <> 'owner' then return public.pitchside__err('reserved_username'); end if;
  if exists (select 1 from public.pitchside_profiles where id <> v.id
              and public.pitchside__username_key(username) = public.pitchside__username_key(v_user)) then
    return public.pitchside__err('username_taken');
  end if;
  v_old := v.username;
  begin
    update public.pitchside_profiles set username = v_user, name = left(v_user, 16) where id = v.id returning * into v;
  exception when unique_violation then
    return public.pitchside__err('username_taken');
  end;
  perform public.pitchside__audit(v.id, 'admin_rename', jsonb_build_object('from', v_old, 'to', v_user) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(v));
end $$;

-- Revoke ALL admin: every mod/owner role -> player (except the reserved owner account and the caller), and
-- every admin token issued before now stops working. A code caller gets a fresh token back.
-- -> { ok, revoked, revokeAt, token?, level?, exp? }
create or replace function public.pitchside_admin_revoke_all(p_code text, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_n int; v_at bigint := floor(extract(epoch from now()))::bigint; v_feat jsonb; v_exp bigint; v_sig text;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if not public.pitchside__throttle('revoke_all', interval '1 hour', 20) then return public.pitchside__err('rate_limited'); end if;
  update public.pitchside_profiles set role = 'player'
   where role in ('mod', 'owner') and id is distinct from p_id and not public.pitchside__name_reserved(coalesce(username, ''));
  get diagnostics v_n = row_count;
  update public.pitchside_admin_tokens set revoked = true where not revoked;
  select value into v_feat from public.pitchside_config where key = 'features';
  v_feat := coalesce(v_feat, '{}'::jsonb) || jsonb_build_object('adminRevokeAt', v_at);
  insert into public.pitchside_config (key, value, updated_at, updated_by) values ('features', v_feat, now(), v_actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  perform public.pitchside__audit(p_id, 'admin_revoke_all', jsonb_build_object('revoked', v_n, 'at', v_at) || public.pitchside__mod_by(v_actor, p_id));
  if v_actor in ('full', 'super') then
    v_exp := extract(epoch from now() + interval '12 hours')::bigint;
    v_sig := public.pitchside__sign('adm|' || v_actor || '|' || v_exp);
    insert into public.pitchside_admin_tokens (sig, level, exp) values (v_sig, v_actor, v_exp)
    on conflict (sig) do update set revoked = false;
    return json_build_object('ok', true, 'revoked', v_n, 'revokeAt', v_at, 'level', v_actor, 'exp', v_exp,
      'token', 'adm.' || v_actor || '.' || v_exp || '.' || v_sig);
  end if;
  return json_build_object('ok', true, 'revoked', v_n, 'revokeAt', v_at);
end $$;

-- Restrict a player from a feature: p_key 'codes' | 'admin' | 'market' | 'packs' | 'messages';
-- p_on false lifts it; p_minutes null = permanent. -> { ok, restrictions }
create or replace function public.pitchside_admin_restrict(p_code text, p_player uuid, p_key text, p_on boolean default true,
  p_minutes int default null, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles; v_val jsonb;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if p_key is null or p_key not in ('codes', 'admin', 'market', 'packs', 'messages') then return public.pitchside__err('bad_key'); end if;
  if p_minutes is not null and p_minutes not between 1 and 5256000 then return public.pitchside__err('bad_value'); end if;
  select * into v from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if not public.pitchside__may_act_on(v_actor, p_id, v) or (v.id = p_id and coalesce(p_on, true)) then return public.pitchside__err('not_allowed'); end if;
  v_val := case when p_minutes is null then 'true'::jsonb else to_jsonb(now() + make_interval(mins => p_minutes)) end;
  update public.pitchside_profiles set restrictions = case when coalesce(p_on, true)
      then public.pitchside__restrictions_json(restrictions) || jsonb_build_object(p_key, v_val)
      else public.pitchside__restrictions_json(restrictions) - p_key end
   where id = v.id returning * into v;
  perform public.pitchside__audit(v.id, 'admin_restrict', jsonb_build_object('key', p_key, 'on', coalesce(p_on, true), 'minutes', p_minutes)
    || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'restrictions', public.pitchside__restrictions_json(v.restrictions));
end $$;

-- Owner direct message (from the caller's profile; works for owner guests too). -> { ok, id }
create or replace function public.pitchside_admin_message(p_code text, p_player uuid, p_body text, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles; o public.pitchside_profiles; v_body text := public.pitchside__clean_text(p_body, 300); v_mid bigint;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_player is null or p_player = v.id then return public.pitchside__err('not_found'); end if;
  select * into o from public.pitchside_profiles where id = p_player;
  if not found then return public.pitchside__err('not_found'); end if;
  if v_body = '' then return public.pitchside__err('empty'); end if;
  if not public.pitchside__throttle('admmsg:' || v.id, interval '1 hour', 300) then return public.pitchside__err('rate_limited'); end if;
  insert into public.pitchside_messages (from_id, to_id, body) values (v.id, o.id, v_body) returning id into v_mid;
  perform public.pitchside__audit(o.id, 'admin_message', jsonb_build_object('id', v_mid) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'id', v_mid);
end $$;

-- ------------------------------------------------------------------ owner patches (edits to a player's club)
-- ops: array (1..100) of objects { op: 'addCard'|'removeCard'|'editCard'|'setTradable'|'resetClub'|
-- 'resetObjectives'|'resetSbcs'|'setClubName', ... } applied by the player's client (meta/core/ownerpatch.js).
create or replace function public.pitchside_admin_patch_player(p_code text, p_player uuid, p_ops jsonb, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles; e jsonb; v_pid bigint; v_names jsonb := '[]'::jsonb;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  select * into v from public.pitchside_profiles where id = p_player;
  if not found then return public.pitchside__err('not_found'); end if;
  if not public.pitchside__may_act_on(v_actor, p_id, v) then return public.pitchside__err('not_allowed'); end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) not between 1 and 100 or octet_length(p_ops::text) > 262144 then
    return public.pitchside__err('bad_value');
  end if;
  for e in select * from jsonb_array_elements(p_ops) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'op') <> 'string' or (e ->> 'op') not in
       ('addCard', 'removeCard', 'editCard', 'setTradable', 'resetClub', 'resetObjectives', 'resetSbcs', 'setClubName') then
      return public.pitchside__err('bad_value');
    end if;
    v_names := v_names || to_jsonb(e ->> 'op');
  end loop;
  if not public.pitchside__throttle('patch:' || v.id, interval '1 hour', 600) then return public.pitchside__err('rate_limited'); end if;
  insert into public.pitchside_owner_patches (profile_id, ops, created_by) values (v.id, p_ops, v_actor) returning id into v_pid;
  perform public.pitchside__audit(v.id, 'admin_patch', jsonb_build_object('patch', v_pid, 'ops', v_names) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'patchId', v_pid);
end $$;

-- The player's client: pending owner patches (oldest first). -> { ok, items:[{ id, ops, at }] }
create or replace function public.pitchside_patches_pending(p_id uuid, p_secret text)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_items json;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select coalesce(json_agg(json_build_object('id', o.id, 'ops', o.ops, 'at', o.created_at) order by o.id), '[]'::json)
    into v_items from (select * from public.pitchside_owner_patches where profile_id = v.id and applied_at is null order by id limit 50) o;
  return json_build_object('ok', true, 'items', v_items);
end $$;

-- The player's client applied these patches to its UT save. -> { ok, acked }
create or replace function public.pitchside_patches_ack(p_id uuid, p_secret text, p_ids bigint[])
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_n int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_ids is null or cardinality(p_ids) > 100 then return public.pitchside__err('bad_value'); end if;
  update public.pitchside_owner_patches set applied_at = now() where profile_id = v.id and applied_at is null and id = any (p_ids);
  get diagnostics v_n = row_count;
  if random() < 0.01 then delete from public.pitchside_owner_patches where applied_at < now() - interval '30 days'; end if;
  return json_build_object('ok', true, 'acked', v_n);
end $$;

-- ------------------------------------------------------------------ enforcement in player RPCs
-- 001's list_card + market restriction + staff (owner/mod account or a valid code) list at ANY price (1 .. 9e15)
-- and cards up to 999 OVR.
create or replace function public.pitchside_list_card(p_id uuid, p_secret text, p_card jsonb, p_price bigint, p_code text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.pitchside_profiles; v_staff boolean;
  v_ovr numeric; v_pos text; v_name text; v_cid text; v_rarity text; v_special text; v_tier text;
  v_active int; v_lid uuid;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if public.pitchside__restricted(v.restrictions, 'market') then return public.pitchside__err('restricted'); end if;
  v_staff := public.pitchside__actor(p_code, p_id, p_secret) is not null;
  if p_price is null or (not v_staff and (p_price < 150 or p_price > 15000000)) or (v_staff and (p_price < 1 or p_price > 9000000000000000)) then
    return public.pitchside__err('bad_price');
  end if;
  if p_card is null or jsonb_typeof(p_card) <> 'object' then return public.pitchside__err('bad_card'); end if;
  if octet_length(p_card::text) > 4096 then return public.pitchside__err('card_too_large'); end if;
  if not (p_card ? 'id' and p_card ? 'name' and p_card ? 'pos' and p_card ? 'ovr') then return public.pitchside__err('bad_card'); end if;
  if jsonb_typeof(p_card->'id') <> 'string' or jsonb_typeof(p_card->'name') <> 'string'
     or jsonb_typeof(p_card->'pos') <> 'string' or jsonb_typeof(p_card->'ovr') <> 'number' then
    return public.pitchside__err('bad_card');
  end if;
  v_cid := p_card->>'id';
  if v_cid !~ '^[A-Za-z0-9_.:-]{1,40}$' then return public.pitchside__err('bad_card'); end if;
  v_ovr := (p_card->>'ovr')::numeric;
  if v_ovr <> trunc(v_ovr) or v_ovr < 1 or v_ovr > (case when v_staff then 999 else 99 end) then return public.pitchside__err('bad_card'); end if;
  v_pos := p_card->>'pos';
  if v_pos not in ('GK','CB','LB','RB','LWB','RWB','CDM','CM','CAM','LM','RM','LW','RW','ST','CF') then
    return public.pitchside__err('bad_card');
  end if;
  v_name := left(btrim(regexp_replace(p_card->>'name', '[[:cntrl:]]', '', 'g')), 32);
  if v_name = '' then return public.pitchside__err('bad_card'); end if;
  v_special := case when jsonb_typeof(p_card->'special') = 'string' then p_card->>'special' end;
  v_tier := case when jsonb_typeof(p_card->'tier') = 'string' then p_card->>'tier' end;
  v_rarity := case
    when v_special in ('legend', 'hero', 'inform', 'icon') then v_special
    when v_tier in ('gold', 'silver', 'bronze') then v_tier || case when (p_card->>'rare') = 'true' then '_rare' else '' end
    else 'common' end;
  if not public.pitchside__throttle('list:' || v.id, interval '1 hour', 60) then return public.pitchside__err('rate_limited'); end if;
  select count(*) into v_active from public.pitchside_listings where seller_id = v.id and status = 'active';
  if v_active >= 30 then return public.pitchside__err('too_many_listings'); end if;
  begin
    insert into public.pitchside_listings (seller_id, card, ovr, pos, rarity, name, price, seller_credit)
    values (v.id, p_card, v_ovr::int, v_pos, v_rarity, v_name, p_price, (p_price * 95) / 100)
    returning id into v_lid;
  exception when unique_violation then
    return public.pitchside__err('already_listed');
  end;
  if v_staff and (p_price < 150 or p_price > 15000000) then
    perform public.pitchside__audit(v.id, 'admin_list_price', jsonb_build_object('listing', v_lid, 'price', p_price));
  end if;
  return json_build_object('ok', true, 'listingId', v_lid);
end $$;

-- 003's buy + market restriction.
create or replace function public.pitchside_buy(p_id uuid, p_secret text, p_listing uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; l public.pitchside_listings; v_bal bigint; v_credit bigint; v_tax numeric; v_inf boolean;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if public.pitchside__restricted(v.restrictions, 'market') then return public.pitchside__err('restricted'); end if;
  if p_listing is null then return public.pitchside__err('not_found'); end if;
  if not public.pitchside__throttle('buy:' || v.id, interval '1 hour', 120) then return public.pitchside__err('rate_limited'); end if;
  select * into l from public.pitchside_listings where id = p_listing for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if l.status <> 'active' then return public.pitchside__err('unavailable'); end if;
  if l.created_at <= now() - interval '72 hours' then
    update public.pitchside_listings set status = 'expired' where id = l.id;
    return public.pitchside__err('expired');
  end if;
  if l.seller_id = v.id then return public.pitchside__err('own_listing'); end if;
  perform 1 from public.pitchside_profiles where id in (v.id, l.seller_id) order by id for update;
  select infinite_coins into v_inf from public.pitchside_profiles where id = v.id;
  if v_inf then
    select coins into v_bal from public.pitchside_profiles where id = v.id;
  else
    update public.pitchside_profiles set coins = coins - l.price
     where id = v.id and coins >= l.price
    returning coins into v_bal;
    if not found then return public.pitchside__err('insufficient_coins'); end if;
  end if;
  v_tax := greatest(0, least(0.5, public.pitchside__cfg_num('market', 'tax', 0.05)));
  v_credit := l.price - ceil(l.price * v_tax)::bigint;
  update public.pitchside_listings set status = 'sold', buyer_id = v.id, sold_at = now(), seller_credit = v_credit, claimed = true
   where id = l.id;
  update public.pitchside_profiles set coins = least(coins + v_credit, 9000000000000000) where id = l.seller_id;
  return json_build_object('ok', true, 'card', l.card, 'price', l.price, 'coins', v_bal);
end $$;

-- 003's send_message + messages restriction.
create or replace function public.pitchside_send_message(p_id uuid, p_secret text, p_to uuid, p_body text, p_image text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; o public.pitchside_profiles; v_body text := public.pitchside__clean_text(p_body, 300); v_mid bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.username is null then return public.pitchside__err('no_account'); end if;
  if public.pitchside__restricted(v.restrictions, 'messages') then return public.pitchside__err('restricted'); end if;
  if p_to is null or p_to = v.id then return public.pitchside__err('not_found'); end if;
  select * into o from public.pitchside_profiles where id = p_to;
  if not found or public.pitchside__blocked(v.id, o.id) then return public.pitchside__err('not_found'); end if;
  if v_body = '' and p_image is null then return public.pitchside__err('empty'); end if;
  if p_image is not null and (octet_length(p_image) > 204860 or p_image !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$') then
    return public.pitchside__err('bad_image');
  end if;
  if not public.pitchside__throttle('msg:' || v.id, interval '10 minutes', 20)
     or not public.pitchside__throttle('msgday:' || v.id, interval '1 day', 300)
     or (p_image is not null and not public.pitchside__throttle('msgimg:' || v.id, interval '1 day', 20)) then
    return public.pitchside__err('rate_limited');
  end if;
  insert into public.pitchside_messages (from_id, to_id, body, image) values (v.id, o.id, v_body, p_image) returning id into v_mid;
  if random() < 0.01 then delete from public.pitchside_messages where created_at < now() - interval '30 days'; end if;
  return json_build_object('ok', true, 'id', v_mid);
end $$;

-- 004's save_put, now also for device guests (so the owner can see / edit every club).
create or replace function public.pitchside_save_put(p_id uuid, p_secret text, p_data jsonb, p_rev int)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; s public.pitchside_saves; v_rev int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return public.pitchside__err('bad_value'); end if;
  if octet_length(p_data::text) > 1572864 then return public.pitchside__err('too_large'); end if;
  if not public.pitchside__throttle('save:' || v.id, interval '1 hour', 240) then return public.pitchside__err('rate_limited'); end if;
  select * into s from public.pitchside_saves where profile_id = v.id for update;
  if not found then
    if coalesce(p_rev, 0) <> 0 then return json_build_object('ok', false, 'error', 'conflict', 'rev', 0); end if;
    insert into public.pitchside_saves (profile_id, data, rev) values (v.id, p_data, 1) on conflict (profile_id) do nothing;
    if not found then return json_build_object('ok', false, 'error', 'conflict', 'rev', 1); end if;
    return json_build_object('ok', true, 'rev', 1);
  end if;
  if coalesce(p_rev, -1) <> s.rev then return json_build_object('ok', false, 'error', 'conflict', 'rev', s.rev); end if;
  update public.pitchside_saves set data = p_data, rev = rev + 1, updated_at = now() where profile_id = v.id returning rev into v_rev;
  return json_build_object('ok', true, 'rev', v_rev);
end $$;

-- 004's presence + restrictions (active only) + pending owner patches.
create or replace function public.pitchside_presence(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_gifts int; v_unread int; v_inv int; v_req int; v_epoch bigint; v_patches int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if not public.pitchside__throttle('pres:' || v.id, interval '1 hour', 600) then return public.pitchside__err('rate_limited'); end if;
  update public.pitchside_profiles set last_seen_at = now()
   where id = v.id and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  select count(*) into v_gifts from public.pitchside_gifts g
   where (g.to_id = v.id or g.to_id is null) and g.expires_at > now()
     and not exists (select 1 from public.pitchside_gift_claims c where c.gift_id = g.id and c.profile_id = v.id);
  select count(*) into v_unread from public.pitchside_messages where to_id = v.id and read_at is null;
  select count(*) into v_inv from public.pitchside_invites where to_id = v.id and status = 'pending' and created_at > now() - interval '60 seconds';
  select count(*) into v_req from public.pitchside_friends where v.id in (a, b) and status = 'pending' and requested_by <> v.id;
  select count(*) into v_patches from public.pitchside_owner_patches where profile_id = v.id and applied_at is null;
  v_epoch := public.pitchside__reset_epoch();
  return json_build_object('ok', true, 'online', public.pitchside_online_count(), 'coins', v.coins, 'infinite', v.infinite_coins,
    'broadcasts', public.pitchside__broadcasts_json(), 'gifts', v_gifts, 'unread', v_unread, 'invites', v_inv, 'requests', v_req,
    'resets', json_build_object('coins', v.reset_coins_epoch, 'progress', v.reset_progress_epoch, 'club', v.reset_club_epoch),
    'resetDue', case when v_epoch > v.reset_ack_epoch and v.created_at < public.pitchside__reset_at() then v_epoch end,
    'resetEpoch', v_epoch, 'createdAt', v.created_at,
    'configVersion', public.pitchside__config_version(), 'role', v.role,
    'restrictions', public.pitchside__restrictions_json(v.restrictions), 'patches', v_patches);
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001-006)
do $$
declare f record; r text;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'pitchside%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f.sig, r);
        if f.proname not like 'pitchside\_\_%' then
          execute format('grant execute on function %s to %I', f.sig, r);
        end if;
      end if;
    end loop;
  end loop;
end $$;

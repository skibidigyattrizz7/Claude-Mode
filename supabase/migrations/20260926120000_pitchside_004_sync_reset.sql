-- =====================================================================================
-- Pitchside 3D — migration 004 (run AFTER 001, 002, 003). Idempotent: safe to run more than once.
--   * "Reset everyone" is a real server action: pitchside_admin_reset_everyone stamps a new epoch
--     (config features.resetEpoch), resets coins of profiles that existed before it, and every profile
--     acknowledges each epoch at most once (reset_ack_epoch). Profiles created after the epoch are never
--     reset. pitchside_presence reports "resetDue" only when a reset still applies to this profile.
--   * Config: 'features' may hold booleans or numbers (e.g. packPriceMult, resetEpoch).
--   * Cloud save of the Ultimate Team club (one per account, optimistic revision check).
--   * Admin player list (paged, searchable) for the Admin panel.
-- Same security model: RLS on, no table grants, SECURITY DEFINER RPCs with fixed search_path.
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array[
       'pitchside_admin_reset_everyone', 'pitchside_ack_reset', 'pitchside_admin_players', 'pitchside_save_get',
       'pitchside_save_put', 'pitchside__reset_epoch'])
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

-- Existing profiles have already been through any earlier reset: acknowledge the current epoch once, when
-- the column is first added (so applying 004 never triggers a surprise reset).
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pitchside_profiles' and column_name = 'reset_ack_epoch') then
    alter table public.pitchside_profiles add column reset_ack_epoch bigint not null default 0;
    update public.pitchside_profiles set reset_ack_epoch = coalesce((
      select case when jsonb_typeof(value -> 'resetEpoch') = 'number' then trunc((value ->> 'resetEpoch')::numeric)::bigint end
        from public.pitchside_config where key = 'features'), 0);
  end if;
end $$;

create table if not exists public.pitchside_saves (
  profile_id uuid primary key references public.pitchside_profiles(id) on delete cascade,
  data       jsonb not null,
  rev        int not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.pitchside_saves add column if not exists rev int not null default 1;
alter table public.pitchside_saves add column if not exists updated_at timestamptz not null default now();
alter table public.pitchside_saves drop constraint if exists pitchside_saves_obj;
alter table public.pitchside_saves add constraint pitchside_saves_obj check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1572864);
alter table public.pitchside_saves enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_saves from %I', r);
    end if;
  end loop;
end $$;
revoke all on table public.pitchside_saves from public;

-- ------------------------------------------------------------------ config: features may be boolean or number
create or replace function public.pitchside__config_error(p_key text, p_value jsonb)
returns text language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare e record; f record; n int := 0;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then return 'bad_value'; end if;
  if octet_length(p_value::text) > 8192 then return 'too_large'; end if;
  if p_key = 'promos' then
    for e in select * from jsonb_each(p_value) loop
      n := n + 1;
      if e.key !~ '^[A-Za-z0-9_.-]{1,40}$' or jsonb_typeof(e.value) <> 'boolean' then return 'bad_value'; end if;
    end loop;
  elsif p_key = 'features' then
    for e in select * from jsonb_each(p_value) loop
      n := n + 1;
      if e.key !~ '^[A-Za-z0-9_.-]{1,40}$' then return 'bad_value'; end if;
      if jsonb_typeof(e.value) = 'number' then
        if (e.value)::numeric not between -1000000000000 and 1000000000000 then return 'bad_value'; end if;
      elsif jsonb_typeof(e.value) <> 'boolean' then return 'bad_value';
      end if;
    end loop;
  elsif p_key = 'packs' then
    for e in select * from jsonb_each(p_value) loop
      n := n + 1;
      if e.key !~ '^[A-Za-z0-9_.-]{1,40}$' or jsonb_typeof(e.value) <> 'object' then return 'bad_value'; end if;
      for f in select * from jsonb_each(e.value) loop
        if f.key = 'enabled' then
          if jsonb_typeof(f.value) <> 'boolean' then return 'bad_value'; end if;
        elsif f.key = 'price' then
          if jsonb_typeof(f.value) <> 'number' or (f.value)::numeric <> trunc((f.value)::numeric)
             or (f.value)::numeric not between 0 and 10000000 then return 'bad_value'; end if;
        else return 'bad_value';
        end if;
      end loop;
    end loop;
  elsif p_key = 'rewards' then
    for e in select * from jsonb_each(p_value) loop
      if e.key = 'multiplier' then
        if jsonb_typeof(e.value) <> 'number' or (e.value)::numeric not between 0 and 10 then return 'bad_value'; end if;
      elsif e.key = 'packChance' then
        if jsonb_typeof(e.value) <> 'number' or (e.value)::numeric not between 0 and 1 then return 'bad_value'; end if;
      else return 'bad_value';
      end if;
    end loop;
  elsif p_key = 'market' then
    for e in select * from jsonb_each(p_value) loop
      if e.key = 'tax' then
        if jsonb_typeof(e.value) <> 'number' or (e.value)::numeric not between 0 and 0.5 then return 'bad_value'; end if;
      else return 'bad_value';
      end if;
    end loop;
  else
    return 'bad_key';
  end if;
  if n > 200 then return 'too_large'; end if;
  return null;
end $$;

-- Current "reset everyone" epoch (unix seconds, 0 = never).
create or replace function public.pitchside__reset_epoch()
returns bigint language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce((select case when jsonb_typeof(value -> 'resetEpoch') = 'number' then trunc((value ->> 'resetEpoch')::numeric)::bigint end
                     from public.pitchside_config where key = 'features'), 0)
$$;

-- Owner "Reset everyone": new epoch; every profile that existed before it drops to 5 000 coins and loses
-- infinite coins (server side, at once). Profiles created later are untouched. -> { ok, epoch, affected }
create or replace function public.pitchside_admin_reset_everyone(p_code text, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_epoch bigint := floor(extract(epoch from now()))::bigint; v_n int; v_feat jsonb;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if not public.pitchside__throttle('reset_all', interval '1 hour', 10) then return public.pitchside__err('rate_limited'); end if;
  v_epoch := greatest(v_epoch, public.pitchside__reset_epoch() + 1);
  select value into v_feat from public.pitchside_config where key = 'features';
  v_feat := coalesce(v_feat, '{}'::jsonb) || jsonb_build_object('resetEpoch', v_epoch);
  insert into public.pitchside_config (key, value, updated_at, updated_by) values ('features', v_feat, now(), v_actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  update public.pitchside_profiles set coins = 5000, infinite_coins = false, earn_hour_coins = 0, earn_day_coins = 0
   where created_at < to_timestamp(v_epoch);
  get diagnostics v_n = row_count;
  perform public.pitchside__audit(p_id, 'admin_reset_all', jsonb_build_object('epoch', v_epoch, 'affected', v_n) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'epoch', v_epoch, 'affected', v_n);
end $$;

-- The client applied (or skipped) the local part of a reset for this profile. -> { ok, ack }
create or replace function public.pitchside_ack_reset(p_id uuid, p_secret text, p_epoch bigint)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_ack bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_epoch is null or p_epoch < 0 or p_epoch > public.pitchside__reset_epoch() then return public.pitchside__err('bad_value'); end if;
  update public.pitchside_profiles set reset_ack_epoch = greatest(reset_ack_epoch, p_epoch) where id = v.id returning reset_ack_epoch into v_ack;
  return json_build_object('ok', true, 'ack', v_ack);
end $$;

-- 003's presence + resetDue (epoch still to apply for this profile, else null) and createdAt.
create or replace function public.pitchside_presence(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_gifts int; v_unread int; v_inv int; v_req int; v_epoch bigint;
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
  v_epoch := public.pitchside__reset_epoch();
  return json_build_object('ok', true, 'online', public.pitchside_online_count(), 'coins', v.coins, 'infinite', v.infinite_coins,
    'broadcasts', public.pitchside__broadcasts_json(), 'gifts', v_gifts, 'unread', v_unread, 'invites', v_inv, 'requests', v_req,
    'resets', json_build_object('coins', v.reset_coins_epoch, 'progress', v.reset_progress_epoch, 'club', v.reset_club_epoch),
    'resetDue', case when v_epoch > v.reset_ack_epoch and v.created_at < to_timestamp(v_epoch) then v_epoch end,
    'resetEpoch', v_epoch, 'createdAt', v.created_at,
    'configVersion', public.pitchside__config_version(), 'role', v.role);
end $$;

-- ------------------------------------------------------------------ admin: all players (paged, searchable)
-- p_query null/'' = everyone (newest first). -> { ok, total, items:[{ id, username, name, clubName, coins, role,
-- banned, createdAt, lastSeenAt, online }] }
create or replace function public.pitchside_admin_players(p_code text, p_query text default null, p_limit int default 50,
  p_offset int default 0, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_q text := btrim(regexp_replace(coalesce(p_query, ''), '[[:cntrl:]]', '', 'g')); v_like text; v_key text;
  v_items json; v_total int; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200); v_off int := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if v_actor is null then return public.pitchside__err('not_admin'); end if;
  if char_length(v_q) > 40 then return public.pitchside__err('bad_query'); end if;
  v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_key := replace(replace(replace(public.pitchside__username_key(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  with m as (
    select p.*, s.squad, public.pitchside__is_banned(p) as banned_now from public.pitchside_profiles p left join public.pitchside_squads s on s.profile_id = p.id
     where v_q = ''
        or lower(p.name) like v_like
        or (v_key <> '' and public.pitchside__username_key(p.username) like '%' || v_key || '%')
        or p.friend_code = upper(replace(v_q, '-', ''))
        or p.id::text = lower(v_q)
        or lower(coalesce(s.squad ->> 'name', '')) like v_like
  )
  select (select count(*) from m),
         coalesce((select json_agg(json_build_object('id', x.id, 'username', x.username, 'name', x.name,
            'clubName', left(x.squad ->> 'name', 32), 'coins', x.coins, 'role', x.role, 'banned', x.banned_now,
            'friendCode', x.friend_code, 'createdAt', x.created_at, 'lastSeenAt', x.last_seen_at,
            'online', coalesce(x.last_seen_at > now() - interval '60 seconds', false)) order by x.created_at desc)
           from (select * from m order by m.created_at desc limit v_lim offset v_off) x), '[]'::json)
    into v_total, v_items;
  return json_build_object('ok', true, 'total', v_total, 'items', v_items);
end $$;

-- ------------------------------------------------------------------ cloud save (UT club, one per profile)
create or replace function public.pitchside_save_get(p_id uuid, p_secret text)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; s public.pitchside_saves;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select * into s from public.pitchside_saves where profile_id = v.id;
  if not found then return json_build_object('ok', true, 'exists', false, 'rev', 0); end if;
  return json_build_object('ok', true, 'exists', true, 'rev', s.rev, 'updatedAt', s.updated_at, 'data', s.data);
end $$;

-- Optimistic write: p_rev must equal the stored revision (0 = none yet). -> { ok, rev } | { ok:false, error:'conflict', rev }
create or replace function public.pitchside_save_put(p_id uuid, p_secret text, p_data jsonb, p_rev int)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; s public.pitchside_saves; v_rev int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.username is null then return public.pitchside__err('no_account'); end if;
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

-- ------------------------------------------------------------------ function privileges (same rule as 001-003)
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

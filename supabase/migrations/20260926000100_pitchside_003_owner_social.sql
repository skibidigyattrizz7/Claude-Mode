-- =====================================================================================
-- Pitchside 3D — owner powers, admin code levels, global config, coins, market payouts,
-- presence + broadcasts, gifts / giveaways, messages, public squads, match rewards.
-- Migration 003 (run AFTER 001 and 002). Idempotent: safe to run more than once.
--
-- Same security model as 001/002: RLS on every table, no insert/update/delete rights for
-- anon/authenticated, all writes through SECURITY DEFINER functions with a fixed search_path,
-- no dynamic SQL (the only EXECUTE is the privilege loop at the end, over catalog names).
--
--   * Admin codes: pitchside_admin_codes(level 'full' | 'super', bcrypt hash). The hashes are inserted
--     privately by the owner (see supabase/README.md); this file only copies 001's pitchside_admin row
--     as the 'full' code. A verified code can be exchanged for a 12 h HMAC-signed admin token
--     ("adm.<level>.<exp>.<hmac>") so the client never keeps the code itself; every function that takes
--     p_code accepts either. Same global failure throttle as 001 (20 wrong codes / minute).
--   * Owner powers need the full/super code (or token) or an 'owner' account session. Mods only moderate.
--   * pitchside_config: public, non-secret game settings (promos, packs, rewards, market tax, features).
--     Readable by anyone, writable only through pitchside_admin_set_config.
--   * Coins: every change is one atomic statement; earning is capped per hour/day; ops carry an
--     idempotency key so client retries never double-apply.
--   * Market: pitchside_buy now credits the seller instantly (tax from config); claiming is gone.
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- New functions of 003 (in case an earlier partial version exists).
-- Drop every overload of the functions this file (re)creates, so an earlier partial version with other
-- signatures / return types cannot block "create or replace" or leave ambiguous overloads (recreated below;
-- cascade only removes triggers / the username index, which are recreated below too).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array[
    'pitchside__actor',
    'pitchside__admin_level',
    'pitchside__blocked',
    'pitchside__broadcasts_json',
    'pitchside__cfg_num',
    'pitchside__clean_text',
    'pitchside__config_error',
    'pitchside__config_version',
    'pitchside__find_profile',
    'pitchside__gift_card',
    'pitchside__gift_json',
    'pitchside__may_act_on',
    'pitchside__op_key_ok',
    'pitchside__owner_power',
    'pitchside__public_row',
    'pitchside_admin_broadcast',
    'pitchside_admin_clear_broadcast',
    'pitchside_admin_coins',
    'pitchside_admin_gift',
    'pitchside_admin_login',
    'pitchside_admin_reset',
    'pitchside_admin_set_config',
    'pitchside_admin_set_infinite',
    'pitchside_change_password',
    'pitchside_change_username',
    'pitchside_claim_gift',
    'pitchside_coins_get',
    'pitchside_coins_op',
    'pitchside_find_player',
    'pitchside_get_broadcasts',
    'pitchside_get_config',
    'pitchside_get_messages',
    'pitchside_gifts_inbox',
    'pitchside_list_conversations',
    'pitchside_match_reward',
    'pitchside_online_count',
    'pitchside_presence',
    'pitchside_send_message',
    'pitchside_set_squad',
    'pitchside_view_squad'])
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

-- ------------------------------------------------------------------ profile columns
alter table public.pitchside_profiles add column if not exists infinite_coins       boolean not null default false;
alter table public.pitchside_profiles add column if not exists reset_coins_epoch    int not null default 0;
alter table public.pitchside_profiles add column if not exists reset_progress_epoch int not null default 0;
alter table public.pitchside_profiles add column if not exists reset_club_epoch     int not null default 0;
alter table public.pitchside_profiles add column if not exists earn_hour_start      timestamptz;
alter table public.pitchside_profiles add column if not exists earn_hour_coins      bigint not null default 0;
alter table public.pitchside_profiles add column if not exists earn_day_start       date;
alter table public.pitchside_profiles add column if not exists earn_day_coins       bigint not null default 0;
create index if not exists pitchside_profiles_last_seen on public.pitchside_profiles (last_seen_at);

-- ------------------------------------------------------------------ tables
create table if not exists public.pitchside_admin_codes (
  level      text primary key,
  code_hash  text not null,
  updated_at timestamptz not null default now(),
  constraint pitchside_admin_codes_level_chk check (level in ('full', 'super')),
  constraint pitchside_admin_codes_hash_fmt check (code_hash like '$2%' and char_length(code_hash) = 60)
);
-- the existing (001) code becomes the 'full' code
insert into public.pitchside_admin_codes (level, code_hash)
select 'full', a.code_hash from public.pitchside_admin a
 where a.id = 1 and a.code_hash like '$2%' and char_length(a.code_hash) = 60
on conflict (level) do nothing;

create table if not exists public.pitchside_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint pitchside_config_key_chk check (key in ('promos', 'packs', 'rewards', 'market', 'features')),
  constraint pitchside_config_size check (octet_length(value::text) <= 8192)
);

create table if not exists public.pitchside_coin_ops (
  profile_id uuid not null references public.pitchside_profiles(id) on delete cascade,
  op_key     text not null,
  result     jsonb not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, op_key)
);
create index if not exists pitchside_coin_ops_at on public.pitchside_coin_ops (created_at);

create table if not exists public.pitchside_admin_ops (
  op_key     text primary key,
  result     jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists pitchside_admin_ops_at on public.pitchside_admin_ops (created_at);

create table if not exists public.pitchside_broadcasts (
  id         bigint generated always as identity primary key,
  body       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_by text,
  cancelled  boolean not null default false,
  constraint pitchside_broadcasts_len check (char_length(body) between 1 and 200)
);
create index if not exists pitchside_broadcasts_active on public.pitchside_broadcasts (expires_at) where not cancelled;

create table if not exists public.pitchside_gifts (
  id         uuid primary key default gen_random_uuid(),
  to_id      uuid references public.pitchside_profiles(id) on delete cascade, -- null = everyone
  kind       text not null,
  coins      bigint not null default 0,
  payload    jsonb not null default '{}'::jsonb,
  message    text,
  created_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint pitchside_gifts_kind_chk check (kind in ('coins', 'pack', 'card')),
  constraint pitchside_gifts_coins_rng check (coins between 0 and 1000000000),
  constraint pitchside_gifts_payload_chk check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4096),
  constraint pitchside_gifts_msg_len check (message is null or char_length(message) <= 200)
);
create index if not exists pitchside_gifts_to on public.pitchside_gifts (to_id, created_at desc);
create index if not exists pitchside_gifts_all on public.pitchside_gifts (expires_at) where to_id is null;

create table if not exists public.pitchside_gift_claims (
  gift_id    uuid not null references public.pitchside_gifts(id) on delete cascade,
  profile_id uuid not null references public.pitchside_profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (gift_id, profile_id)
);
create index if not exists pitchside_gift_claims_profile on public.pitchside_gift_claims (profile_id);

create table if not exists public.pitchside_messages (
  id         bigint generated always as identity primary key,
  from_id    uuid not null references public.pitchside_profiles(id) on delete cascade,
  to_id      uuid not null references public.pitchside_profiles(id) on delete cascade,
  body       text not null default '',
  image      text,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  constraint pitchside_messages_body_len check (char_length(body) <= 300),
  constraint pitchside_messages_image_fmt check (image is null or (octet_length(image) <= 204860 and image ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')),
  constraint pitchside_messages_nonempty check (char_length(body) > 0 or image is not null),
  constraint pitchside_messages_not_self check (from_id <> to_id)
);
create index if not exists pitchside_messages_to   on public.pitchside_messages (to_id, created_at desc);
create index if not exists pitchside_messages_from on public.pitchside_messages (from_id, created_at desc);
create index if not exists pitchside_messages_unread on public.pitchside_messages (to_id) where read_at is null;
create index if not exists pitchside_messages_at on public.pitchside_messages (created_at);

create table if not exists public.pitchside_squads (
  profile_id uuid primary key references public.pitchside_profiles(id) on delete cascade,
  squad      jsonb not null,
  updated_at timestamptz not null default now(),
  constraint pitchside_squads_obj check (jsonb_typeof(squad) = 'object'),
  constraint pitchside_squads_size check (octet_length(squad::text) <= 20480)
);

-- ------------------------------------------------------------------ RLS + table privileges
alter table public.pitchside_admin_codes  enable row level security;
alter table public.pitchside_config       enable row level security;
alter table public.pitchside_coin_ops     enable row level security;
alter table public.pitchside_admin_ops    enable row level security;
alter table public.pitchside_broadcasts   enable row level security;
alter table public.pitchside_gifts        enable row level security;
alter table public.pitchside_gift_claims  enable row level security;
alter table public.pitchside_messages     enable row level security;
alter table public.pitchside_squads       enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_admin_codes, public.pitchside_config, public.pitchside_coin_ops, public.pitchside_admin_ops, public.pitchside_broadcasts, public.pitchside_gifts, public.pitchside_gift_claims, public.pitchside_messages, public.pitchside_squads from %I', r);
      -- config holds only public game settings: direct read allowed (no writes)
      execute format('grant select (key, value, updated_at) on public.pitchside_config to %I', r);
    end if;
  end loop;
end $$;
revoke all on table public.pitchside_admin_codes, public.pitchside_config, public.pitchside_coin_ops, public.pitchside_admin_ops, public.pitchside_broadcasts, public.pitchside_gifts, public.pitchside_gift_claims, public.pitchside_messages, public.pitchside_squads from public;
drop policy if exists pitchside_config_read on public.pitchside_config;
create policy pitchside_config_read on public.pitchside_config for select using (true);

-- ------------------------------------------------------------------ admin code levels + tokens
-- -> 'super' | 'full' | null. Accepts the plain code (bcrypt check) or an unexpired admin token.
-- Wrong codes / tokens count towards the global failure throttle (20 / minute) and a per-IP one (60 / hour).
create or replace function public.pitchside__admin_level(p_code text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ws timestamptz := date_trunc('minute', now()); v_fail int; v_parts text[]; r record; v_hash text;
  v_ip text := public.pitchside__client_key();
begin
  if p_code is null or p_code = '' or char_length(p_code) > 160 then return null; end if;
  select hits into v_fail from public.pitchside_throttle where bucket = 'admin_fail' and window_start = v_ws;
  if coalesce(v_fail, 0) >= 20 or public.pitchside__throttle_hits('admin_fail_ip:' || v_ip, interval '1 hour') >= 60 then
    return null;
  end if;
  if p_code ~ '^adm\.(full|super)\.[0-9]{9,11}\.[0-9a-f]{64}$' then
    v_parts := string_to_array(p_code, '.');
    if v_parts[3]::bigint > extract(epoch from now())
       and public.pitchside__sign('adm|' || v_parts[2] || '|' || v_parts[3]) = v_parts[4] then
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

-- 001/002 helpers keep their signature; now any level (full or super, code or token) passes.
create or replace function public.pitchside__admin_check(p_code text)
returns boolean language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$ begin return public.pitchside__admin_level(p_code) is not null; end $$;

-- Exchange a code for a 12 h admin token. -> { ok, level, token, exp } | { ok:false, error:'invalid' }
create or replace function public.pitchside_admin_login(p_code text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_level text; v_exp bigint;
begin
  v_level := public.pitchside__admin_level(p_code);
  if v_level is null then return public.pitchside__err('invalid'); end if;
  v_exp := extract(epoch from now() + interval '12 hours')::bigint;
  return json_build_object('ok', true, 'level', v_level, 'exp', v_exp,
    'token', 'adm.' || v_level || '.' || v_exp || '.' || public.pitchside__sign('adm|' || v_level || '|' || v_exp));
end $$;

-- Who is acting on owner functions: 'super' | 'full' (code/token) | 'owner' | 'mod' (account) | null.
create or replace function public.pitchside__actor(p_code text, p_id uuid, p_secret text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_role text; v_level text;
begin
  if p_id is not null and p_secret is not null then
    v := public.pitchside__auth(p_id, p_secret);
    if v.id is not null and v.role in ('owner', 'mod') then v_role := v.role; end if;
  end if;
  if p_code is not null and p_code <> '' then v_level := public.pitchside__admin_level(p_code); end if;
  return coalesce(v_level, v_role);
end $$;

create or replace function public.pitchside__owner_power(p_actor text)
returns boolean language sql immutable
set search_path = public, extensions, pg_temp
as $$ select coalesce(p_actor in ('super', 'full', 'owner'), false) $$;

-- Owner accounts may not act on other owners (codes may act on anyone).
create or replace function public.pitchside__may_act_on(p_actor text, p_id uuid, v public.pitchside_profiles)
returns boolean language sql immutable
set search_path = public, extensions, pg_temp
as $$ select p_actor in ('super', 'full') or (p_actor = 'owner' and (v.role <> 'owner' or v.id = p_id)) $$;

create or replace function public.pitchside__op_key_ok(p_key text)
returns boolean language sql immutable
set search_path = public, extensions, pg_temp
as $$ select p_key is null or p_key ~ '^[A-Za-z0-9_-]{8,64}$' $$;

create or replace function public.pitchside__clean_text(p_text text, p_max int)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $$ select btrim(left(regexp_replace(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), '[ ]{2,}', ' ', 'g'), p_max)) $$;

-- ------------------------------------------------------------------ global config
create or replace function public.pitchside__config_error(p_key text, p_value jsonb)
returns text language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare e record; f record; n int := 0;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then return 'bad_value'; end if;
  if octet_length(p_value::text) > 8192 then return 'too_large'; end if;
  if p_key in ('promos', 'features') then
    for e in select * from jsonb_each(p_value) loop
      n := n + 1;
      if e.key !~ '^[A-Za-z0-9_.-]{1,40}$' or jsonb_typeof(e.value) <> 'boolean' then return 'bad_value'; end if;
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

create or replace function public.pitchside__cfg_num(p_key text, p_field text, p_default numeric)
returns numeric language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce((select case when jsonb_typeof(value -> p_field) = 'number' then (value ->> p_field)::numeric end
                     from public.pitchside_config where key = p_key), p_default)
$$;

create or replace function public.pitchside__config_version()
returns bigint language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select coalesce((extract(epoch from max(updated_at)) * 1000)::bigint, 0) from public.pitchside_config $$;

-- Public read. -> { ok, version, config:{ promos, packs, rewards, market, features } }
create or replace function public.pitchside_get_config()
returns json language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select json_build_object('ok', true, 'version', public.pitchside__config_version(),
    'config', coalesce((select json_object_agg(key, value) from public.pitchside_config), '{}'::json))
$$;

create or replace function public.pitchside_admin_set_config(p_code text, p_key text, p_value jsonb,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_err text;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if p_key is null or p_key not in ('promos', 'packs', 'rewards', 'market', 'features') then return public.pitchside__err('bad_key'); end if;
  v_err := public.pitchside__config_error(p_key, p_value);
  if v_err is not null then return public.pitchside__err(v_err); end if;
  if not public.pitchside__throttle('cfg:' || coalesce(p_id::text, public.pitchside__client_key()), interval '1 hour', 300) then
    return public.pitchside__err('rate_limited');
  end if;
  insert into public.pitchside_config (key, value, updated_at, updated_by) values (p_key, p_value, now(), v_actor)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  perform public.pitchside__audit(p_id, 'admin_config', jsonb_build_object('key', p_key) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'version', public.pitchside__config_version());
end $$;

-- ------------------------------------------------------------------ coins (one model: the server balance)
create or replace function public.pitchside_coins_get(p_id uuid, p_secret text)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  return json_build_object('ok', true, 'coins', v.coins, 'infinite', v.infinite_coins);
end $$;

-- Spend (p_delta < 0; refused when the balance is too low, never deducted for infinite wallets) or earn
-- (p_delta > 0; whitelisted reasons; capped at 250 000 / hour and 1 000 000 / day — over the cap only the
-- remainder is granted). p_key = idempotency key: a retry with the same key returns the first result.
-- -> { ok, coins, applied, requested, infinite }
create or replace function public.pitchside_coins_op(p_id uuid, p_secret text, p_delta bigint, p_reason text, p_key text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.pitchside_profiles; v_prev jsonb; v_res jsonb; v_applied bigint; v_bal bigint;
  v_hs timestamptz := date_bin(interval '1 hour', now(), timestamptz '2000-01-01 00:00:00+00');
  v_day date := (now() at time zone 'utc')::date; v_hour bigint; v_dayc bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000000 then return public.pitchside__err('bad_amount'); end if;
  if not public.pitchside__op_key_ok(p_key) then return public.pitchside__err('bad_key'); end if;
  if p_key is not null then
    select result into v_prev from public.pitchside_coin_ops where profile_id = v.id and op_key = p_key;
    if found then return (v_prev || jsonb_build_object('replay', true))::json; end if;
  end if;
  if not public.pitchside__throttle('coinop:' || v.id, interval '1 hour', 900) then return public.pitchside__err('rate_limited'); end if;
  select * into v from public.pitchside_profiles where id = v.id for update;
  if p_delta < 0 then
    if v.infinite_coins then
      v_applied := 0; v_bal := v.coins;
    else
      update public.pitchside_profiles set coins = coins + p_delta where id = v.id and coins >= -p_delta returning coins into v_bal;
      if not found then return public.pitchside__err('insufficient_coins'); end if;
      v_applied := p_delta;
    end if;
  else
    if coalesce(p_reason, '') not in ('quicksell', 'objective', 'sbc', 'season', 'ut-earn', 'event', 'draft', 'reward') then
      return public.pitchside__err('bad_reason');
    end if;
    v_hour := case when v.earn_hour_start = v_hs then v.earn_hour_coins else 0 end;
    v_dayc := case when v.earn_day_start = v_day then v.earn_day_coins else 0 end;
    v_applied := greatest(0, least(p_delta, 250000 - v_hour, 1000000 - v_dayc));
    update public.pitchside_profiles set
      coins = coins + v_applied,
      earn_hour_start = v_hs, earn_hour_coins = v_hour + v_applied,
      earn_day_start = v_day, earn_day_coins = v_dayc + v_applied
    where id = v.id returning coins into v_bal;
  end if;
  v_res := jsonb_build_object('ok', true, 'coins', v_bal, 'applied', v_applied, 'requested', p_delta, 'infinite', v.infinite_coins);
  if p_key is not null then
    insert into public.pitchside_coin_ops (profile_id, op_key, result) values (v.id, p_key, v_res) on conflict do nothing;
  end if;
  if random() < 0.01 then delete from public.pitchside_coin_ops where created_at < now() - interval '3 days'; end if;
  if abs(p_delta) >= 20000 then
    perform public.pitchside__audit(v.id, case when p_delta < 0 then 'coins_spend' else 'coins_earn' end,
      jsonb_build_object('delta', v_applied, 'requested', p_delta, 'reason', left(coalesce(p_reason, ''), 24), 'balance', v_bal));
  end if;
  return v_res::json;
end $$;

-- Admin coins for one player (p_player null = the caller's own profile). Idempotent with p_key.
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
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000000 then return public.pitchside__err('bad_amount'); end if;
  select * into v from public.pitchside_profiles where id = coalesce(p_player, p_id) for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if not public.pitchside__may_act_on(v_actor, p_id, v) then return public.pitchside__err('not_allowed'); end if;
  v_before := v.coins;
  update public.pitchside_profiles set coins = greatest(0, least(coins + p_delta, 1000000000000)) where id = v.id returning * into v;
  v_res := jsonb_build_object('ok', true, 'coins', v.coins, 'player', v.id);
  if p_key is not null then
    insert into public.pitchside_admin_ops (op_key, result) values ('coins:' || p_key, v_res) on conflict do nothing;
  end if;
  if random() < 0.01 then delete from public.pitchside_admin_ops where created_at < now() - interval '3 days'; end if;
  perform public.pitchside__audit(v.id, 'admin_coins', jsonb_build_object('delta', p_delta, 'before', v_before, 'balance', v.coins,
    'reason', left(coalesce(p_reason, ''), 120)) || public.pitchside__mod_by(v_actor, p_id));
  return v_res::json;
end $$;

-- Infinite online wallet (p_player null = the caller's own profile; others need a code, not an account).
create or replace function public.pitchside_admin_set_infinite(p_code text, p_on boolean, p_player uuid default null,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if p_on is null then return public.pitchside__err('bad_value'); end if;
  if p_player is not null and p_player is distinct from p_id and v_actor not in ('super', 'full') then return public.pitchside__err('not_allowed'); end if;
  if p_player is null and (public.pitchside__auth(p_id, p_secret)).id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_profiles set infinite_coins = p_on where id = coalesce(p_player, p_id) returning * into v;
  if v.id is null then return public.pitchside__err('not_found'); end if;
  perform public.pitchside__audit(v.id, 'admin_infinite', jsonb_build_object('on', p_on) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'infinite', v.infinite_coins, 'coins', v.coins);
end $$;

-- Reset a player's coins / progress / club (club = client-side UT save: signalled through reset_club_epoch,
-- which the client sees in pitchside_presence; also removes their public squad and active listings).
create or replace function public.pitchside_admin_reset(p_code text, p_player uuid, p_what text,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles; v_all boolean := p_what = 'all';
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if p_what is null or p_what not in ('coins', 'progress', 'club', 'all') then return public.pitchside__err('bad_value'); end if;
  select * into v from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if not public.pitchside__may_act_on(v_actor, p_id, v) then return public.pitchside__err('not_allowed'); end if;
  if v_all or p_what = 'coins' then
    update public.pitchside_profiles set coins = 5000, infinite_coins = false, reset_coins_epoch = reset_coins_epoch + 1,
      earn_hour_coins = 0, earn_day_coins = 0 where id = v.id;
  end if;
  if v_all or p_what = 'progress' then
    update public.pitchside_profiles set rating = 1000, division = 8, wins = 0, draws = 0, losses = 0,
      rivals_division = 10, rivals_points = 0, rivals_week = null, rivals_week_wins = 0, rivals_week_matches = 0,
      rivals_peak = 10, rivals_prev_week = null, rivals_prev_peak = null, rivals_prev_wins = null,
      reset_progress_epoch = reset_progress_epoch + 1 where id = v.id;
  end if;
  if v_all or p_what = 'club' then
    update public.pitchside_profiles set reset_club_epoch = reset_club_epoch + 1 where id = v.id;
    delete from public.pitchside_squads where profile_id = v.id;
    update public.pitchside_listings set status = 'cancelled' where seller_id = v.id and status in ('active', 'expired');
  end if;
  select * into v from public.pitchside_profiles where id = v.id;
  perform public.pitchside__audit(v.id, 'admin_reset', jsonb_build_object('what', p_what) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(v),
    'resets', json_build_object('coins', v.reset_coins_epoch, 'progress', v.reset_progress_epoch, 'club', v.reset_club_epoch));
end $$;

-- ------------------------------------------------------------------ transfer market: instant seller credit
-- Replaces 001's buy: the seller is paid inside the same transaction (price minus the configured tax,
-- default 5 %), so there is nothing left to claim. Buyers with an infinite wallet pay nothing.
create or replace function public.pitchside_buy(p_id uuid, p_secret text, p_listing uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; l public.pitchside_listings; v_bal bigint; v_credit bigint; v_tax numeric; v_inf boolean;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_listing is null then return public.pitchside__err('not_found'); end if;
  if not public.pitchside__throttle('buy:' || v.id, interval '1 hour', 120) then return public.pitchside__err('rate_limited'); end if;
  -- lock order everywhere: listing row first, then both profile rows in id order
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
  update public.pitchside_profiles set coins = coins + v_credit where id = l.seller_id;
  return json_build_object('ok', true, 'card', l.card, 'price', l.price, 'coins', v_bal);
end $$;

-- Only listings that still hold a card: active (and expired ones, so the card can be taken back).
create or replace function public.pitchside_my_listings(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_items json;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_listings set status = 'expired'
   where seller_id = v.id and status = 'active' and created_at <= now() - interval '72 hours';
  select coalesce(json_agg(json_build_object('listingId', s.id, 'card', s.card, 'price', s.price, 'status', s.status,
           'listedAt', s.created_at, 'soldAt', s.sold_at, 'claimed', s.claimed, 'credit', s.seller_credit)
           order by s.created_at desc), '[]'::json)
    into v_items
  from (
    select * from public.pitchside_listings
     where seller_id = v.id and status in ('active', 'expired')
     order by created_at desc limit 100
  ) s;
  return json_build_object('ok', true, 'items', v_items);
end $$;

-- One-time payout of sales made before this migration (claimed flips exactly once, so re-running is a no-op).
with c as (
  update public.pitchside_listings set claimed = true
   where status = 'sold' and not claimed
  returning seller_id, seller_credit
), s as (select seller_id, sum(seller_credit) as total from c group by seller_id)
update public.pitchside_profiles p set coins = p.coins + s.total from s where p.id = s.seller_id;

-- ------------------------------------------------------------------ broadcasts + presence
create or replace function public.pitchside__broadcasts_json()
returns json language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(json_agg(json_build_object('id', b.id, 'text', b.body, 'at', b.created_at, 'until', b.expires_at) order by b.id desc), '[]'::json)
  from (select * from public.pitchside_broadcasts where not cancelled and expires_at > now() order by id desc limit 5) b
$$;

create or replace function public.pitchside_get_broadcasts()
returns json language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select json_build_object('ok', true, 'items', public.pitchside__broadcasts_json()) $$;

create or replace function public.pitchside_admin_broadcast(p_code text, p_text text, p_minutes int default 30,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_text text := public.pitchside__clean_text(p_text, 200); v_bid bigint;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if v_text = '' then return public.pitchside__err('bad_text'); end if;
  if p_minutes is null or p_minutes not between 1 and 1440 then return public.pitchside__err('bad_value'); end if;
  if not public.pitchside__throttle('bcast', interval '1 hour', 60) then return public.pitchside__err('rate_limited'); end if;
  insert into public.pitchside_broadcasts (body, expires_at, created_by) values (v_text, now() + make_interval(mins => p_minutes), v_actor)
  returning id into v_bid;
  delete from public.pitchside_broadcasts where expires_at < now() - interval '30 days';
  perform public.pitchside__audit(p_id, 'admin_broadcast', jsonb_build_object('id', v_bid, 'text', v_text) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'id', v_bid);
end $$;

create or replace function public.pitchside_admin_clear_broadcast(p_code text, p_bid bigint,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  update public.pitchside_broadcasts set cancelled = true where id = p_bid and not cancelled;
  if not found then return public.pitchside__err('not_found'); end if;
  return json_build_object('ok', true);
end $$;

-- Players online = profiles seen in the last 60 s (heartbeat every ~25 s). Anyone may call it.
create or replace function public.pitchside_online_count()
returns int language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select count(*)::int from public.pitchside_profiles where last_seen_at > now() - interval '60 seconds' $$;

-- Heartbeat + everything a client polls: counter, broadcasts, gifts, unread DMs, reset epochs, config version.
create or replace function public.pitchside_presence(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_gifts int; v_unread int; v_inv int; v_req int;
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
  return json_build_object('ok', true, 'online', public.pitchside_online_count(), 'coins', v.coins, 'infinite', v.infinite_coins,
    'broadcasts', public.pitchside__broadcasts_json(), 'gifts', v_gifts, 'unread', v_unread, 'invites', v_inv, 'requests', v_req,
    'resets', json_build_object('coins', v.reset_coins_epoch, 'progress', v.reset_progress_epoch, 'club', v.reset_club_epoch),
    'configVersion', public.pitchside__config_version(), 'role', v.role);
end $$;

-- ------------------------------------------------------------------ gifts / giveaways
-- Card gifts are always tradable. OVR above 99 (admin cards) needs the super code.
create or replace function public.pitchside__gift_card(p_card jsonb, p_super boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare v_ovr numeric;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' or octet_length(p_card::text) > 4000 then return null; end if;
  if jsonb_typeof(p_card -> 'id') <> 'string' or (p_card ->> 'id') !~ '^[A-Za-z0-9_.:-]{1,40}$' then return null; end if;
  if jsonb_typeof(p_card -> 'name') <> 'string' or char_length(p_card ->> 'name') not between 1 and 32 then return null; end if;
  if jsonb_typeof(p_card -> 'ovr') <> 'number' then return null; end if;
  v_ovr := (p_card ->> 'ovr')::numeric;
  if v_ovr <> trunc(v_ovr) or v_ovr < 1 or v_ovr > (case when p_super then 999 else 99 end) then return null; end if;
  if p_card ? 'pos' and (jsonb_typeof(p_card -> 'pos') <> 'string' or (p_card ->> 'pos') !~ '^[A-Z]{2,4}$') then return null; end if;
  return (p_card - 'untradable') || '{"tradable": true}'::jsonb;
end $$;

-- p_to = one player, or null with p_all = true for everyone (active 14 days).
-- kind 'coins' (p_coins), 'pack' (p_payload {packId, count}), 'card' (p_payload {card}). Idempotent with p_key.
create or replace function public.pitchside_admin_gift(p_code text, p_to uuid, p_all boolean, p_kind text, p_coins bigint,
  p_payload jsonb, p_message text default null, p_key text default null, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_prev jsonb; v_payload jsonb := '{}'::jsonb; v_card jsonb; v_gid uuid; v_res jsonb; v_count numeric; v public.pitchside_profiles;
begin
  if not public.pitchside__op_key_ok(p_key) then return public.pitchside__err('bad_key'); end if;
  if p_key is not null then
    select result into v_prev from public.pitchside_admin_ops where op_key = 'gift:' || p_key;
    if found then return (v_prev || jsonb_build_object('replay', true))::json; end if;
  end if;
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if coalesce(p_all, false) = (p_to is not null) then return public.pitchside__err('bad_target'); end if;
  if p_to is not null then
    select * into v from public.pitchside_profiles where id = p_to;
    if not found then return public.pitchside__err('not_found'); end if;
  end if;
  if p_kind = 'coins' then
    if p_coins is null or p_coins not between 1 and 1000000000 then return public.pitchside__err('bad_amount'); end if;
  elsif p_kind = 'pack' then
    if p_payload is null or jsonb_typeof(p_payload -> 'packId') <> 'string' or (p_payload ->> 'packId') !~ '^[A-Za-z0-9_-]{1,32}$' then
      return public.pitchside__err('bad_pack');
    end if;
    v_count := case when jsonb_typeof(p_payload -> 'count') = 'number' then (p_payload ->> 'count')::numeric else 1 end;
    if v_count <> trunc(v_count) or v_count not between 1 and 50 then return public.pitchside__err('bad_pack'); end if;
    v_payload := jsonb_build_object('packId', p_payload ->> 'packId', 'count', v_count::int);
  elsif p_kind = 'card' then
    v_card := public.pitchside__gift_card(p_payload -> 'card', v_actor = 'super');
    if v_card is null then return public.pitchside__err(case when v_actor <> 'super' and jsonb_typeof(p_payload -> 'card' -> 'ovr') = 'number'
      and (p_payload -> 'card' ->> 'ovr')::numeric > 99 then 'needs_super' else 'bad_card' end); end if;
    v_payload := jsonb_build_object('card', v_card);
  else
    return public.pitchside__err('bad_kind');
  end if;
  if not public.pitchside__throttle('gift:' || v_actor || ':' || coalesce(p_id::text, public.pitchside__client_key()), interval '1 hour', 300) then
    return public.pitchside__err('rate_limited');
  end if;
  insert into public.pitchside_gifts (to_id, kind, coins, payload, message, created_by, expires_at)
  values (p_to, p_kind, case when p_kind = 'coins' then p_coins else 0 end, v_payload,
          nullif(public.pitchside__clean_text(p_message, 200), ''), v_actor, now() + interval '14 days')
  returning id into v_gid;
  v_res := jsonb_build_object('ok', true, 'giftId', v_gid);
  if p_key is not null then
    insert into public.pitchside_admin_ops (op_key, result) values ('gift:' || p_key, v_res) on conflict do nothing;
  end if;
  if random() < 0.01 then delete from public.pitchside_gifts where expires_at < now() - interval '30 days'; end if;
  perform public.pitchside__audit(p_to, 'admin_gift', jsonb_build_object('gift', v_gid, 'kind', p_kind, 'all', p_to is null,
    'coins', p_coins, 'payload', v_payload) || public.pitchside__mod_by(v_actor, p_id));
  return v_res::json;
end $$;

create or replace function public.pitchside__gift_json(g public.pitchside_gifts)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$
  select json_build_object('id', g.id, 'kind', g.kind, 'coins', g.coins, 'packId', g.payload ->> 'packId',
    'count', (g.payload ->> 'count')::int, 'card', g.payload -> 'card', 'message', g.message, 'all', g.to_id is null,
    'at', g.created_at, 'until', g.expires_at)
$$;

create or replace function public.pitchside_gifts_inbox(p_id uuid, p_secret text)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_items json;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select coalesce(json_agg(public.pitchside__gift_json(g.q) order by g.created_at desc), '[]'::json) into v_items
  from (
    select q, q.created_at from public.pitchside_gifts q
     where (q.to_id = v.id or q.to_id is null) and q.expires_at > now()
       and not exists (select 1 from public.pitchside_gift_claims c where c.gift_id = q.id and c.profile_id = v.id)
     order by q.created_at desc limit 50
  ) g;
  return json_build_object('ok', true, 'items', v_items);
end $$;

-- Claim once. Coins are added here; packs / cards are returned for the client to add to the UT club.
create or replace function public.pitchside_claim_gift(p_id uuid, p_secret text, p_gift uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; g public.pitchside_gifts; v_bal bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select * into g from public.pitchside_gifts where id = p_gift;
  if not found or not (g.to_id = v.id or g.to_id is null) then return public.pitchside__err('not_found'); end if;
  if g.expires_at <= now() then return public.pitchside__err('expired'); end if;
  insert into public.pitchside_gift_claims (gift_id, profile_id) values (g.id, v.id) on conflict do nothing;
  if not found then return public.pitchside__err('already_claimed'); end if;
  if g.kind = 'coins' then
    update public.pitchside_profiles set coins = least(coins + g.coins, 1000000000000) where id = v.id returning coins into v_bal;
  else
    select coins into v_bal from public.pitchside_profiles where id = v.id;
  end if;
  perform public.pitchside__audit(v.id, 'gift_claim', jsonb_build_object('gift', g.id, 'kind', g.kind, 'coins', g.coins));
  return (public.pitchside__gift_json(g)::jsonb || jsonb_build_object('ok', true, 'balance', v_bal))::json;
end $$;

-- ------------------------------------------------------------------ players, messages, squads
create or replace function public.pitchside__find_profile(p_query text)
returns public.pitchside_profiles language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_q text := btrim(coalesce(p_query, ''));
begin
  if char_length(v_q) not between 3 and 40 then return v; end if;
  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v from public.pitchside_profiles where id = lower(v_q)::uuid;
    if found then return v; end if;
  end if;
  select * into v from public.pitchside_profiles where public.pitchside__username_key(username) = public.pitchside__username_key(v_q);
  if found then return v; end if;
  select * into v from public.pitchside_profiles where friend_code = upper(replace(v_q, '-', ''));
  if found then return v; end if;
  v := null;
  return v;
end $$;

create or replace function public.pitchside__public_row(q public.pitchside_profiles)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$
  select json_build_object('id', q.id, 'username', q.username, 'name', q.name, 'friendCode', q.friend_code,
    'online', coalesce(q.last_seen_at > now() - interval '60 seconds', false))
$$;

-- Username prefix / exact friend code search (accounts only, never banned players). Anyone may call it.
create or replace function public.pitchside_find_player(p_query text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_q text := btrim(regexp_replace(coalesce(p_query, ''), '[[:cntrl:]]', '', 'g')); v_key text; v_items json;
begin
  if char_length(v_q) not between 2 and 40 then return public.pitchside__err('bad_query'); end if;
  if not public.pitchside__throttle('find:' || public.pitchside__client_key(), interval '1 hour', 300) then return public.pitchside__err('rate_limited'); end if;
  v_key := replace(replace(replace(public.pitchside__username_key(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  select coalesce(json_agg(public.pitchside__public_row(p.q) order by p.rn), '[]'::json) into v_items
  from (
    select q, row_number() over (order by (public.pitchside__username_key(q.username) = public.pitchside__username_key(v_q)) desc nulls last,
                                          q.last_seen_at desc nulls last) as rn
      from public.pitchside_profiles q
     where not public.pitchside__is_banned(q)
       and ((q.username is not null and v_key <> '' and public.pitchside__username_key(q.username) like v_key || '%')
            or q.friend_code = upper(replace(v_q, '-', '')))
     order by rn limit 10
  ) p;
  return json_build_object('ok', true, 'items', v_items);
end $$;

create or replace function public.pitchside__blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select exists (select 1 from public.pitchside_friends where a = least(p_a, p_b) and b = greatest(p_a, p_b) and status = 'blocked') $$;

-- DM: text <= 300 chars and/or one JPEG data URL <= 150 KB. Accounts only. 20 / 10 min, 300 / day, 20 images / day.
create or replace function public.pitchside_send_message(p_id uuid, p_secret text, p_to uuid, p_body text, p_image text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; o public.pitchside_profiles; v_body text := public.pitchside__clean_text(p_body, 300); v_mid bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.username is null then return public.pitchside__err('no_account'); end if;
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

create or replace function public.pitchside_list_conversations(p_id uuid, p_secret text)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_items json;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  with m as (
    select case when from_id = v.id then to_id else from_id end as other, id, body, image is not null as has_image,
           created_at, from_id = v.id as mine
      from public.pitchside_messages where from_id = v.id or to_id = v.id
  ), last as (
    select distinct on (other) * from m order by other, id desc
  ), top as (
    select * from last order by id desc limit 30
  )
  select coalesce(json_agg(json_build_object('with', public.pitchside__public_row(p), 'lastText', t.body, 'lastImage', t.has_image,
           'lastMine', t.mine, 'at', t.created_at,
           'unread', (select count(*) from public.pitchside_messages u where u.to_id = v.id and u.from_id = t.other and u.read_at is null))
           order by t.id desc), '[]'::json)
    into v_items
  from top t join public.pitchside_profiles p on p.id = t.other;
  return json_build_object('ok', true, 'items', v_items);
end $$;

-- Last 30 messages with one player (older pages with p_before = oldest id seen). Marks them read.
create or replace function public.pitchside_get_messages(p_id uuid, p_secret text, p_with uuid, p_before bigint default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; o public.pitchside_profiles; v_items json;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select * into o from public.pitchside_profiles where id = p_with;
  if not found then return public.pitchside__err('not_found'); end if;
  update public.pitchside_messages set read_at = now() where to_id = v.id and from_id = o.id and read_at is null;
  select coalesce(json_agg(json_build_object('id', m.id, 'mine', m.from_id = v.id, 'text', m.body, 'image', m.image, 'at', m.created_at,
           'read', m.read_at is not null) order by m.id), '[]'::json)
    into v_items
  from (
    select * from public.pitchside_messages
     where ((from_id = v.id and to_id = o.id) or (from_id = o.id and to_id = v.id))
       and (p_before is null or id < p_before)
     order by id desc limit 30
  ) m;
  return json_build_object('ok', true, 'with', public.pitchside__public_row(o), 'items', v_items);
end $$;

create or replace function public.pitchside_set_squad(p_id uuid, p_secret text, p_squad jsonb)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_squad is null or jsonb_typeof(p_squad) <> 'object' then return public.pitchside__err('bad_squad'); end if;
  if octet_length(p_squad::text) > 20480 then return public.pitchside__err('too_large'); end if;
  if not public.pitchside__throttle('squad:' || v.id, interval '1 hour', 60) then return public.pitchside__err('rate_limited'); end if;
  insert into public.pitchside_squads (profile_id, squad, updated_at) values (v.id, p_squad, now())
  on conflict (profile_id) do update set squad = excluded.squad, updated_at = now();
  return json_build_object('ok', true);
end $$;

-- By username, friend code or player id. Anyone may call it.
create or replace function public.pitchside_view_squad(p_query text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare o public.pitchside_profiles; s public.pitchside_squads;
begin
  if not public.pitchside__throttle('vsq:' || public.pitchside__client_key(), interval '1 hour', 300) then return public.pitchside__err('rate_limited'); end if;
  o := public.pitchside__find_profile(p_query);
  if o.id is null or public.pitchside__is_banned(o) then return public.pitchside__err('not_found'); end if;
  select * into s from public.pitchside_squads where profile_id = o.id;
  if not found then return json_build_object('ok', false, 'error', 'no_squad', 'owner', public.pitchside__public_row(o)); end if;
  return json_build_object('ok', true, 'owner', public.pitchside__public_row(o), 'squad', s.squad, 'updatedAt', s.updated_at);
end $$;

-- ------------------------------------------------------------------ account changes
create or replace function public.pitchside_change_username(p_id uuid, p_secret text, p_username text, p_password text,
  p_admin_code text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_user text := btrim(coalesce(p_username, '')); v_err text; v_role text; v_old text;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.username is null or v.password_hash is null then return public.pitchside__err('no_account'); end if;
  if public.pitchside__throttle_hits('login_fail_u:' || public.pitchside__username_key(v.username), interval '15 minutes') >= 10 then
    return public.pitchside__err('too_many_attempts');
  end if;
  if p_password is null or char_length(p_password) > 72 or extensions.crypt(p_password, v.password_hash) <> v.password_hash then
    perform public.pitchside__throttle('login_fail_u:' || public.pitchside__username_key(v.username), interval '15 minutes', 1000000);
    return public.pitchside__err('bad_credentials');
  end if;
  v_err := public.pitchside__username_error(v_user);
  if v_err is not null then return public.pitchside__err(v_err); end if;
  v_role := v.role;
  if public.pitchside__name_reserved(v_user) and v.role <> 'owner' then
    if p_admin_code is null or p_admin_code = '' or not public.pitchside__admin_check(p_admin_code) then
      return public.pitchside__err('reserved_username');
    end if;
    v_role := 'owner';
  end if;
  if exists (select 1 from public.pitchside_profiles where id <> v.id
              and public.pitchside__username_key(username) = public.pitchside__username_key(v_user)) then
    return public.pitchside__err('username_taken');
  end if;
  if not public.pitchside__throttle('rename:' || v.id, interval '1 day', 5) then return public.pitchside__err('rate_limited'); end if;
  v_old := v.username;
  begin
    update public.pitchside_profiles set username = v_user, name = v_user, role = v_role where id = v.id returning * into v;
  exception when unique_violation then
    return public.pitchside__err('username_taken');
  end;
  perform public.pitchside__audit(v.id, 'rename', jsonb_build_object('from', v_old, 'to', v_user));
  return json_build_object('ok', true, 'username', v.username, 'name', v.name, 'role', v.role);
end $$;

create or replace function public.pitchside_change_password(p_id uuid, p_secret text, p_password text, p_new text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_err text;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.username is null or v.password_hash is null then return public.pitchside__err('no_account'); end if;
  if public.pitchside__throttle_hits('login_fail_u:' || public.pitchside__username_key(v.username), interval '15 minutes') >= 10 then
    return public.pitchside__err('too_many_attempts');
  end if;
  if p_password is null or char_length(p_password) > 72 or extensions.crypt(p_password, v.password_hash) <> v.password_hash then
    perform public.pitchside__throttle('login_fail_u:' || public.pitchside__username_key(v.username), interval '15 minutes', 1000000);
    return public.pitchside__err('bad_credentials');
  end if;
  v_err := public.pitchside__password_error(p_new, v.username);
  if v_err is not null then return public.pitchside__err(v_err); end if;
  update public.pitchside_profiles set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = v.id;
  delete from public.pitchside_sessions where profile_id = v.id and token_hash <> public.pitchside__hash(p_secret);
  perform public.pitchside__audit(v.id, 'password_change', '{}'::jsonb);
  return json_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------ post-match rewards
-- Wraps report_result (same caps: 12 rewarded games / hour, one per minute). Coins x config rewards.multiplier;
-- occasionally (server-random, config rewards.packChance, default 6 % for a win) a pack id for the client to open.
create or replace function public.pitchside_match_reward(p_id uuid, p_secret text, p_mode text,
  p_won boolean, p_drawn boolean, p_gf int, p_ga int)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare r jsonb; v_mult numeric; v_chance numeric; v_base bigint; v_extra bigint := 0; v_bal bigint; v_pack text; v_roll float8;
begin
  r := public.pitchside_report_result(p_id, p_secret, p_mode, p_won, p_drawn, p_gf, p_ga)::jsonb;
  v_mult := greatest(0, least(10, public.pitchside__cfg_num('rewards', 'multiplier', 1)));
  if coalesce((r ->> 'ok')::boolean, false) is not true or coalesce((r ->> 'capped')::boolean, false) then
    return (r || jsonb_build_object('pack', null, 'multiplier', v_mult))::json;
  end if;
  v_base := coalesce((r ->> 'coinsAwarded')::bigint, 0);
  v_extra := floor(v_base * v_mult)::bigint - v_base;
  if v_extra <> 0 then
    update public.pitchside_profiles set coins = greatest(0, coins + v_extra) where id = p_id returning coins into v_bal;
  else
    v_bal := (r ->> 'coins')::bigint;
  end if;
  v_chance := greatest(0, least(1, public.pitchside__cfg_num('rewards', 'packChance', 0.06)))
              * case when p_won then 1 when p_drawn then 0.6 else 0.35 end;
  if random() < v_chance then
    v_roll := random();
    v_pack := case when v_roll < 0.55 then 'gold' when v_roll < 0.85 then 'premium' when v_roll < 0.97 then 'rare' else 'stars' end;
    perform public.pitchside__audit(p_id, 'reward_pack', jsonb_build_object('pack', v_pack));
  end if;
  return (r || jsonb_build_object('coinsAwarded', v_base + v_extra, 'coins', v_bal, 'pack', v_pack, 'multiplier', v_mult))::json;
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001/002)
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

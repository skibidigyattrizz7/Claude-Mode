-- =====================================================================================
-- Pitchside 3D — player accounts, sessions, bans, moderation, audit trail
-- Migration 002 (run AFTER 20260925140338_pitchside_001.sql). Idempotent: safe to run more than once.
--
-- Same security model as 001: RLS on every table, no table privileges for anon/authenticated,
-- all access through SECURITY DEFINER functions with a fixed search_path, no dynamic SQL.
--
--   * Accounts: pitchside_profiles gains username (unique, case-insensitive) + bcrypt password.
--   * Sessions: login/signup return a random 32-byte session token (64 hex chars). The server
--     stores only sha256(token). Every existing authed RPC from 001 takes it in place of the old
--     device secret (pitchside__auth accepts either), so the client just swaps the secret.
--   * Bans: pitchside__auth raises 'banned' (detail = {"reason","until"}) for banned players, so
--     every authed RPC refuses them with one clear error. A timed ban lifts itself at banned_until.
--   * Moderation: pitchside_mod_* functions require the admin code (bcrypt hash in
--     pitchside_admin, same global failure throttle as 001).
--   * Audit: pitchside_audit records signups, logins, claims, market activity, reward claims and
--     admin actions (IP is stored only as a truncated sha256).
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ profile columns
alter table public.pitchside_profiles add column if not exists username      text;
alter table public.pitchside_profiles add column if not exists password_hash text;
alter table public.pitchside_profiles add column if not exists last_login_at timestamptz;
alter table public.pitchside_profiles add column if not exists banned        boolean not null default false;
alter table public.pitchside_profiles add column if not exists ban_reason    text;
alter table public.pitchside_profiles add column if not exists banned_until  timestamptz;
alter table public.pitchside_profiles add column if not exists banned_by     text;
alter table public.pitchside_profiles add column if not exists banned_at     timestamptz;
alter table public.pitchside_profiles add column if not exists role          text not null default 'player';
-- created_at already exists (001)
alter table public.pitchside_profiles drop constraint if exists pitchside_profiles_role_chk;
alter table public.pitchside_profiles add constraint pitchside_profiles_role_chk check (role in ('player', 'mod', 'owner'));
alter table public.pitchside_profiles drop constraint if exists pitchside_profiles_username_fmt;
alter table public.pitchside_profiles add constraint pitchside_profiles_username_fmt
  check (username is null or (char_length(username) between 3 and 16 and username ~ '^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$'));

-- Uniqueness key: lower-cased with spaces and underscores removed ('John Doe' = 'john_doe' = 'JOHNDOE').
create or replace function public.pitchside__username_key(p_username text)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $$ select translate(lower(p_username), ' _', '') $$;
create unique index if not exists pitchside_profiles_username_key2 on public.pitchside_profiles (public.pitchside__username_key(username));
alter table public.pitchside_profiles drop constraint if exists pitchside_profiles_pwhash_fmt;
alter table public.pitchside_profiles add constraint pitchside_profiles_pwhash_fmt
  check (password_hash is null or (password_hash like '$2%' and char_length(password_hash) = 60));
alter table public.pitchside_profiles drop constraint if exists pitchside_profiles_ban_reason_len;
alter table public.pitchside_profiles add constraint pitchside_profiles_ban_reason_len
  check (ban_reason is null or char_length(ban_reason) <= 200);

-- ------------------------------------------------------------------ sessions + audit
create table if not exists public.pitchside_sessions (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.pitchside_profiles(id) on delete cascade,
  token_hash      text not null,
  created_at      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  user_agent_hash text,
  constraint pitchside_sessions_token_fmt check (token_hash ~ '^[0-9a-f]{64}$')
);
create unique index if not exists pitchside_sessions_token_key on public.pitchside_sessions (token_hash);
create index if not exists pitchside_sessions_profile on public.pitchside_sessions (profile_id, last_seen desc);

create table if not exists public.pitchside_audit (
  id         bigint generated always as identity primary key,
  profile_id uuid references public.pitchside_profiles(id) on delete set null,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now(),
  constraint pitchside_audit_action_len check (char_length(action) between 1 and 32),
  constraint pitchside_audit_detail_size check (octet_length(detail::text) <= 2048)
);
create index if not exists pitchside_audit_profile on public.pitchside_audit (profile_id, at desc);
create index if not exists pitchside_audit_at on public.pitchside_audit (at);

alter table public.pitchside_sessions enable row level security;
alter table public.pitchside_audit    enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_sessions, public.pitchside_audit from %I', r);
    end if;
  end loop;
end $$;
revoke all on table public.pitchside_sessions, public.pitchside_audit from public;
-- (no policies: with RLS enabled and no grants, clients can neither read nor write these tables)

-- ------------------------------------------------------------------ internal helpers
-- Sessions stay valid for 60 days after they were last used (touched by pitchside_account_status).
create or replace function public.pitchside__auth_raw(p_id uuid, p_secret text)
returns public.pitchside_profiles
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_hash text;
begin
  if p_id is null or p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then return v; end if;
  v_hash := public.pitchside__hash(p_secret);
  select * into v from public.pitchside_profiles where id = p_id;
  if not found then v := null; return v; end if;
  if v.secret_hash = v_hash then return v; end if;
  if exists (select 1 from public.pitchside_sessions s
              where s.token_hash = v_hash and s.profile_id = p_id and s.last_seen > now() - interval '60 days') then
    return v;
  end if;
  v := null;
  return v;
end $$;

create or replace function public.pitchside__is_banned(v public.pitchside_profiles)
returns boolean language sql stable
set search_path = public, extensions, pg_temp
as $$ select coalesce(v.banned, false) and (v.banned_until is null or v.banned_until > now()) $$;

create or replace function public.pitchside__ban_json(v public.pitchside_profiles)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$ select json_build_object('reason', coalesce(v.ban_reason, ''), 'until', v.banned_until) $$;

-- Replaces 001's helper: device secret OR live session; banned players get a 'banned' exception
-- (PostgREST returns it as { message:'banned', details:'{"reason":..,"until":..}', hint:'pitchside_banned' }).
create or replace function public.pitchside__auth(p_id uuid, p_secret text)
returns public.pitchside_profiles
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles;
begin
  v := public.pitchside__auth_raw(p_id, p_secret);
  if v.id is not null and public.pitchside__is_banned(v) then
    raise exception 'banned' using errcode = 'P0001', detail = public.pitchside__ban_json(v)::text, hint = 'pitchside_banned';
  end if;
  return v;
end $$;

create or replace function public.pitchside__audit(p_profile uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.pitchside_audit (profile_id, action, detail)
  values (p_profile, left(p_action, 32),
          case when p_detail is null or octet_length(p_detail::text) > 2048 then '{}'::jsonb else p_detail end);
  if random() < 0.002 then
    delete from public.pitchside_audit where at < now() - interval '180 days';
  end if;
end $$;

-- Read-only view of a throttle bucket (for "count failures only" limits).
create or replace function public.pitchside__throttle_hits(p_bucket text, p_window interval)
returns int language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce((select hits from public.pitchside_throttle
                    where bucket = p_bucket and window_start = date_bin(p_window, now(), timestamptz '2000-01-01 00:00:00+00')), 0)
$$;

create or replace function public.pitchside__ua_key()
returns text language plpgsql stable
set search_path = public, extensions, pg_temp
as $$
declare h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null;
  end;
  if h is null or nullif(h->>'user-agent', '') is null then return null; end if;
  return left(public.pitchside__hash(left(h->>'user-agent', 512)), 32);
end $$;

-- Name normalisation for the word filter / reserved names (mirrored in 3d/js/net/accountcore.js):
-- lower-case, map 0134578 -> oieastb, drop everything that is not a-z.
create or replace function public.pitchside__name_norm(p_name text)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $$ select regexp_replace(translate(lower(coalesce(p_name, '')), '0134578', 'oieastb'), '[^a-z]', '', 'g') $$;

-- Reserved for the game owner ('Shawky Fc' and lookalikes): needs the admin code at signup.
create or replace function public.pitchside__name_reserved(p_name text)
returns boolean language sql immutable
set search_path = public, extensions, pg_temp
as $$ select position('shawkyfc' in public.pitchside__name_norm(p_name)) > 0 $$;

-- Username rules (mirrored in 3d/js/net/accountcore.js): 3-16 chars (already trimmed) of letters, digits,
-- '_' and single spaces; the normalised form must not contain a blocked word.
-- Returns null when OK, else an error code. (Reserved names are checked separately.)
create or replace function public.pitchside__username_error(p_username text)
returns text language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare v text;
begin
  if p_username is null or char_length(p_username) not between 3 and 16
     or p_username !~ '^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$' then return 'bad_username'; end if;
  v := public.pitchside__name_norm(p_username);
  -- BLOCKLIST-BEGIN
  if v ~ '(fuck|shit|cunt|bitch|nigg|fagg|whore|slut|pussy|wank|twat|retard|nazi|hitler|porn|penis|vagina|dildo|jizz|asshole|bastard|admin|moderator|pitchside|official)' then
  -- BLOCKLIST-END
    return 'username_not_allowed';
  end if;
  return null;
end $$;

create or replace function public.pitchside__password_error(p_password text, p_username text)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $$
  select case
    when p_password is null or char_length(p_password) < 8 then 'weak_password'
    when char_length(p_password) > 72 or octet_length(p_password) > 72 then 'bad_password'
    when p_password ~ '[[:cntrl:]]' then 'bad_password'
    when lower(p_password) = lower(coalesce(p_username, '')) then 'weak_password'
    else null end
$$;

-- New session for a profile; keeps at most 10 per profile. Returns the plaintext token (shown once).
create or replace function public.pitchside__new_session(p_profile uuid)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.pitchside_sessions (profile_id, token_hash, user_agent_hash)
  values (p_profile, public.pitchside__hash(v_token), public.pitchside__ua_key());
  delete from public.pitchside_sessions
   where profile_id = p_profile
     and id not in (select id from public.pitchside_sessions where profile_id = p_profile order by last_seen desc, created_at desc limit 10);
  if random() < 0.01 then
    delete from public.pitchside_sessions where last_seen < now() - interval '60 days';
  end if;
  return v_token;
end $$;

create or replace function public.pitchside__account_json(v public.pitchside_profiles, p_token text)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$
  select json_build_object('ok', true, 'id', v.id, 'session_token', p_token, 'username', v.username, 'name', v.name,
    'friendCode', v.friend_code, 'role', v.role)
$$;

-- ------------------------------------------------------------------ audit triggers
create or replace function public.pitchside__audit_listing_trg()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare d jsonb;
begin
  d := jsonb_build_object('listing', new.id, 'card', new.name, 'ovr', new.ovr, 'price', new.price);
  if tg_op = 'INSERT' then
    perform public.pitchside__audit(new.seller_id, 'market_list', d);
  else
    if old.status = 'active' and new.status = 'sold' then
      perform public.pitchside__audit(new.buyer_id, 'market_buy', d || jsonb_build_object('seller', new.seller_id));
      perform public.pitchside__audit(new.seller_id, 'market_sold', d || jsonb_build_object('buyer', new.buyer_id, 'credit', new.seller_credit));
    elsif old.status in ('active', 'expired') and new.status = 'cancelled' then
      perform public.pitchside__audit(new.seller_id, 'market_cancel', d);
    end if;
    if not old.claimed and new.claimed then
      perform public.pitchside__audit(new.seller_id, 'market_claim', d || jsonb_build_object('credit', new.seller_credit));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists pitchside_listings_audit_ins on public.pitchside_listings;
create trigger pitchside_listings_audit_ins after insert on public.pitchside_listings
  for each row execute function public.pitchside__audit_listing_trg();
drop trigger if exists pitchside_listings_audit_upd on public.pitchside_listings;
create trigger pitchside_listings_audit_upd after update on public.pitchside_listings
  for each row when (old.status is distinct from new.status or old.claimed is distinct from new.claimed)
  execute function public.pitchside__audit_listing_trg();

create or replace function public.pitchside__audit_profile_trg()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if old.last_reward_at is distinct from new.last_reward_at then
    perform public.pitchside__audit(new.id, 'match_reward',
      jsonb_build_object('coins', new.coins - old.coins, 'rating', new.rating, 'ratingDelta', new.rating - old.rating));
  end if;
  if old.rivals_claimed_week is distinct from new.rivals_claimed_week then
    perform public.pitchside__audit(new.id, 'rivals_claim',
      jsonb_build_object('week', new.rivals_claimed_week, 'coins', new.coins - old.coins));
  end if;
  return null;
end $$;
drop trigger if exists pitchside_profiles_audit on public.pitchside_profiles;
create trigger pitchside_profiles_audit after update on public.pitchside_profiles
  for each row when (old.last_reward_at is distinct from new.last_reward_at
                     or old.rivals_claimed_week is distinct from new.rivals_claimed_week)
  execute function public.pitchside__audit_profile_trg();

-- ------------------------------------------------------------------ account RPCs
-- Create an account (new profile). Usernames containing the reserved owner name need the admin code
-- (p_admin_code, verified against pitchside_admin with the usual throttle) and become role 'owner'.
-- -> { ok, id, session_token, username, name, friendCode, role } | { ok:false, error }
create or replace function public.pitchside_signup(p_username text, p_password text, p_admin_code text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user text := btrim(coalesce(p_username, '')); v_err text; v public.pitchside_profiles;
  v_ip text := public.pitchside__client_key(); v_token text; v_role text := 'player';
begin
  v_err := coalesce(public.pitchside__username_error(v_user), public.pitchside__password_error(p_password, v_user));
  if v_err is not null then return public.pitchside__err(v_err); end if;
  if not public.pitchside__throttle('signup_ip:' || v_ip, interval '1 hour', 10)
     or not public.pitchside__throttle('reg_all', interval '1 hour', 300) then
    return public.pitchside__err('rate_limited');
  end if;
  if public.pitchside__name_reserved(v_user) then
    if p_admin_code is null or p_admin_code = '' or not public.pitchside__admin_check(p_admin_code) then
      return public.pitchside__err('reserved_username');
    end if;
    v_role := 'owner';
  end if;
  if exists (select 1 from public.pitchside_profiles where public.pitchside__username_key(username) = public.pitchside__username_key(v_user)) then
    return public.pitchside__err('username_taken');
  end if;
  begin
    insert into public.pitchside_profiles (secret_hash, name, username, password_hash, last_login_at, role)
    values (public.pitchside__hash(encode(extensions.gen_random_bytes(32), 'hex')), v_user, v_user,
            extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(), v_role)
    returning * into v;
  exception when unique_violation then
    return public.pitchside__err('username_taken');
  end;
  v_token := public.pitchside__new_session(v.id);
  perform public.pitchside__audit(v.id, 'signup', jsonb_build_object('username', v.username, 'role', v_role, 'ip', v_ip, 'ua', public.pitchside__ua_key()));
  return public.pitchside__account_json(v, v_token);
end $$;

-- Log in (username match ignores case, spaces and underscores). Failed attempts are limited per
-- username (10 / 15 min) and per IP (30 / 15 min). A banned player with the right password gets
-- { ok:false, error:'banned', ban:{reason, until} } and no session.
create or replace function public.pitchside_login(p_username text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.pitchside_profiles; v_ip text := public.pitchside__client_key(); v_key text; v_ok boolean; v_token text;
  v_user text := btrim(coalesce(p_username, ''));
begin
  if char_length(v_user) not between 3 and 16 or v_user !~ '^[A-Za-z0-9_ ]+$' or p_password is null
     or char_length(p_password) not between 1 and 72 then
    return public.pitchside__err('bad_credentials');
  end if;
  v_key := public.pitchside__username_key(v_user);
  if public.pitchside__throttle_hits('login_fail_u:' || v_key, interval '15 minutes') >= 10
     or public.pitchside__throttle_hits('login_fail_ip:' || v_ip, interval '15 minutes') >= 30 then
    return public.pitchside__err('too_many_attempts');
  end if;
  select * into v from public.pitchside_profiles where public.pitchside__username_key(username) = v_key;
  if found and v.password_hash is not null then
    v_ok := extensions.crypt(p_password, v.password_hash) = v.password_hash;
  else
    perform extensions.crypt(p_password, extensions.gen_salt('bf', 10)); -- same cost for unknown users
    v_ok := false;
  end if;
  if not v_ok then
    perform public.pitchside__throttle('login_fail_u:' || v_key, interval '15 minutes', 1000000);
    perform public.pitchside__throttle('login_fail_ip:' || v_ip, interval '15 minutes', 1000000);
    if v.id is not null then
      perform public.pitchside__audit(v.id, 'login_failed', jsonb_build_object('ip', v_ip));
    end if;
    return public.pitchside__err('bad_credentials');
  end if;
  if public.pitchside__is_banned(v) then
    perform public.pitchside__audit(v.id, 'login_banned', jsonb_build_object('ip', v_ip));
    return json_build_object('ok', false, 'error', 'banned', 'ban', public.pitchside__ban_json(v));
  end if;
  update public.pitchside_profiles set last_login_at = now(), last_seen_at = now() where id = v.id returning * into v;
  v_token := public.pitchside__new_session(v.id);
  perform public.pitchside__audit(v.id, 'login', jsonb_build_object('ip', v_ip, 'ua', public.pitchside__ua_key()));
  return public.pitchside__account_json(v, v_token);
end $$;

-- Ends one session (p_all = every session of this account).
create or replace function public.pitchside_logout(p_id uuid, p_token text, p_all boolean default false)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_hash text; v_n int;
begin
  if p_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then return public.pitchside__err('auth'); end if;
  v_hash := public.pitchside__hash(p_token);
  if not exists (select 1 from public.pitchside_sessions where profile_id = p_id and token_hash = v_hash) then
    return json_build_object('ok', true, 'ended', 0);
  end if;
  if coalesce(p_all, false) then
    delete from public.pitchside_sessions where profile_id = p_id;
  else
    delete from public.pitchside_sessions where profile_id = p_id and token_hash = v_hash;
  end if;
  get diagnostics v_n = row_count;
  perform public.pitchside__audit(p_id, 'logout', jsonb_build_object('all', coalesce(p_all, false)));
  return json_build_object('ok', true, 'ended', v_n);
end $$;

-- Attach a username/password to an existing anonymous device profile (keeps coins, rating, friends,
-- listings, friend code). The old device secret stops working afterwards: only sessions log in.
create or replace function public.pitchside_claim_profile(p_id uuid, p_secret text, p_username text, p_password text,
  p_admin_code text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.pitchside_profiles; v_err text; v_token text; v_ip text := public.pitchside__client_key();
  v_user text := btrim(coalesce(p_username, '')); v_role text;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.username is not null then return public.pitchside__err('already_has_account'); end if;
  v_err := coalesce(public.pitchside__username_error(v_user), public.pitchside__password_error(p_password, v_user));
  if v_err is not null then return public.pitchside__err(v_err); end if;
  if not public.pitchside__throttle('claim:' || v.id, interval '1 hour', 10)
     or not public.pitchside__throttle('signup_ip:' || v_ip, interval '1 hour', 10) then
    return public.pitchside__err('rate_limited');
  end if;
  v_role := v.role;
  if public.pitchside__name_reserved(v_user) then
    if p_admin_code is null or p_admin_code = '' or not public.pitchside__admin_check(p_admin_code) then
      return public.pitchside__err('reserved_username');
    end if;
    v_role := 'owner';
  end if;
  if exists (select 1 from public.pitchside_profiles where public.pitchside__username_key(username) = public.pitchside__username_key(v_user)) then
    return public.pitchside__err('username_taken');
  end if;
  begin
    update public.pitchside_profiles set
      username = v_user, name = v_user, role = v_role,
      password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
      secret_hash = public.pitchside__hash(encode(extensions.gen_random_bytes(32), 'hex')),
      last_login_at = now()
    where id = v.id and username is null
    returning * into v;
  exception when unique_violation then
    return public.pitchside__err('username_taken');
  end;
  if v.id is null then return public.pitchside__err('already_has_account'); end if;
  v_token := public.pitchside__new_session(v.id);
  perform public.pitchside__audit(v.id, 'claim', jsonb_build_object('username', v.username, 'role', v_role, 'ip', v_ip));
  return public.pitchside__account_json(v, v_token);
end $$;

-- Launch check: is this session (or device secret) valid, and is the player banned?
-- Never raises for bans: -> { ok, id, username, name, role, claimed, banned, ban:{reason, until}|null }
create or replace function public.pitchside_account_status(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_banned boolean;
begin
  v := public.pitchside__auth_raw(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_sessions set last_seen = now()
   where profile_id = v.id and token_hash = public.pitchside__hash(p_secret) and last_seen < now() - interval '1 minute';
  update public.pitchside_profiles set last_seen_at = now()
   where id = v.id and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  v_banned := public.pitchside__is_banned(v);
  return json_build_object('ok', true, 'id', v.id, 'username', v.username, 'name', v.name, 'role', v.role,
    'claimed', v.username is not null, 'banned', v_banned,
    'ban', case when v_banned then public.pitchside__ban_json(v) end, 'friendCode', v.friend_code);
end $$;

-- ------------------------------------------------------------------ 001 functions re-declared (sessions, audit, roles, name filter)
-- Anonymous device profiles (legacy clients): blocked / reserved display names fall back to 'Player'.
create or replace function public.pitchside__safe_name(p_name text, p_role text default 'player')
returns text language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare v text := public.pitchside__clean_name(p_name);
begin
  if coalesce(p_role, 'player') <> 'owner' and public.pitchside__name_reserved(v) then return null; end if;
  if public.pitchside__username_error(regexp_replace(left(regexp_replace(v, '[^A-Za-z0-9_ ]', '', 'g'), 16), '\s+', ' ', 'g')) = 'username_not_allowed' then
    return null;
  end if;
  return v;
end $$;

create or replace function public.pitchside_register(p_secret text, p_name text)
returns uuid language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_id uuid; v_hash text;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid secret' using errcode = '22023';
  end if;
  v_hash := public.pitchside__hash(p_secret);
  select id into v_id from public.pitchside_profiles where secret_hash = v_hash;
  if found then return v_id; end if;
  if not public.pitchside__throttle('reg_ip:' || public.pitchside__client_key(), interval '1 hour', 20)
     or not public.pitchside__throttle('reg_all', interval '1 hour', 300) then
    raise exception 'rate limited' using errcode = 'P0001';
  end if;
  insert into public.pitchside_profiles (secret_hash, name)
  values (v_hash, coalesce(public.pitchside__safe_name(p_name), 'Player'))
  on conflict (secret_hash) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.pitchside_profiles where secret_hash = v_hash;
  end if;
  return v_id;
end $$;

create or replace function public.pitchside_set_name(p_id uuid, p_secret text, p_name text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_name text;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  v_name := public.pitchside__safe_name(p_name, v.role);
  if v_name is null then return public.pitchside__err('name_not_allowed'); end if;
  if not public.pitchside__throttle('name:' || v.id, interval '1 hour', 20) then return public.pitchside__err('rate_limited'); end if;
  update public.pitchside_profiles set name = v_name where id = v.id;
  return json_build_object('ok', true, 'name', v_name);
end $$;

create or replace function public.pitchside_get_profile(p_id uuid, p_secret text)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_unclaimed bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select coalesce(sum(seller_credit), 0) into v_unclaimed from public.pitchside_listings
   where seller_id = v.id and status = 'sold' and not claimed;
  return json_build_object('ok', true, 'id', v.id, 'name', v.name, 'coins', v.coins, 'rating', v.rating,
    'division', v.division, 'wins', v.wins, 'draws', v.draws, 'losses', v.losses, 'unclaimed', v_unclaimed,
    'friendCode', v.friend_code, 'rivalsDivision', v.rivals_division, 'username', v.username, 'role', v.role);
end $$;

create or replace function public.pitchside__mm_result(r public.pitchside_queue)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$
  select case when r.matched_with is null then
    json_build_object('ok', true, 'matched', false, 'queueId', r.id,
      'waitedMs', (extract(epoch from now() - r.created_at) * 1000)::bigint)
  else
    json_build_object('ok', true, 'matched', true, 'queueId', r.id,
      'role', case when r.host then 'host' else 'guest' end,
      'opponentPeerId', r.opp_peer_id, 'token', r.match_token,
      'opponent', json_build_object('name', r.opp_name, 'rating', r.opp_rating,
        'role', (select p.role from public.pitchside_profiles p where p.id = r.opp_player_id)))
  end
$$;

create or replace function public.pitchside_list_friends(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_items json;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_profiles set last_seen_at = now()
   where id = v.id and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'name', p.name, 'role', p.role,
           'status', case when f.status = 'accepted' then 'friend' when f.status = 'blocked' then 'blocked'
                          when f.requested_by = v.id then 'outgoing' else 'incoming' end,
           'online', f.status = 'accepted' and p.last_seen_at > now() - interval '60 seconds',
           'rating', case when f.status = 'accepted' then p.rating end,
           'division', case when f.status = 'accepted' then p.division end,
           'rivalsDivision', case when f.status = 'accepted' then p.rivals_division end)
         order by (f.status = 'accepted' and p.last_seen_at > now() - interval '60 seconds') desc, p.name), '[]'::json)
    into v_items
  from public.pitchside_friends f
  join public.pitchside_profiles p on p.id = case when f.a = v.id then f.b else f.a end
  where v.id in (f.a, f.b) and not (f.status = 'blocked' and f.blocked_by <> v.id);
  return json_build_object('ok', true, 'code', v.friend_code, 'items', v_items);
end $$;

create or replace function public.pitchside_poll_invites(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_in json; v_out json; v_req int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_profiles set last_seen_at = now()
   where id = v.id and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  select coalesce(json_agg(json_build_object('inviteId', i.id, 'mode', i.mode, 'createdAt', i.created_at,
           'from', json_build_object('id', p.id, 'name', p.name, 'rating', p.rating, 'role', p.role)) order by i.created_at desc), '[]'::json)
    into v_in
  from public.pitchside_invites i
  join public.pitchside_profiles p on p.id = i.from_id
  join public.pitchside_friends f on f.a = least(i.from_id, i.to_id) and f.b = greatest(i.from_id, i.to_id) and f.status = 'accepted'
  where i.to_id = v.id and i.status = 'pending' and i.created_at > now() - interval '60 seconds';
  select coalesce(json_agg(json_build_object('inviteId', i.id, 'mode', i.mode, 'toId', i.to_id,
           'status', case when i.status = 'pending' and i.created_at <= now() - interval '60 seconds' then 'expired' else i.status end)
           order by i.created_at desc), '[]'::json)
    into v_out
  from public.pitchside_invites i
  where i.from_id = v.id and i.created_at > now() - interval '2 minutes';
  select count(*) into v_req from public.pitchside_friends where v.id in (a, b) and status = 'pending' and requested_by <> v.id;
  return json_build_object('ok', true, 'incoming', v_in, 'outgoing', v_out, 'requests', v_req);
end $$;

create or replace function public.pitchside_respond_invite(p_id uuid, p_secret text, p_invite uuid, p_accept boolean)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; i public.pitchside_invites; o public.pitchside_profiles;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select * into i from public.pitchside_invites where id = p_invite and to_id = v.id for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if i.status <> 'pending' then return public.pitchside__err('unavailable'); end if;
  if i.created_at <= now() - interval '60 seconds' then
    update public.pitchside_invites set status = 'expired' where id = i.id;
    return public.pitchside__err('expired');
  end if;
  if not coalesce(p_accept, false) then
    update public.pitchside_invites set status = 'declined', responded_at = now() where id = i.id;
    return json_build_object('ok', true, 'accepted', false);
  end if;
  if not exists (select 1 from public.pitchside_friends where a = least(i.from_id, i.to_id) and b = greatest(i.from_id, i.to_id) and status = 'accepted') then
    update public.pitchside_invites set status = 'cancelled' where id = i.id;
    return public.pitchside__err('unavailable');
  end if;
  update public.pitchside_invites set status = 'accepted', responded_at = now() where id = i.id;
  select * into o from public.pitchside_profiles where id = i.from_id;
  return json_build_object('ok', true, 'accepted', true, 'mode', i.mode, 'peerId', i.peer_id, 'token', i.token,
    'from', json_build_object('id', o.id, 'name', o.name, 'rating', o.rating, 'role', o.role));
end $$;

-- report_result did its own (device-secret-only) check in 001; same body, now via pitchside__auth.
create or replace function public.pitchside_report_result(p_id uuid, p_secret text, p_mode text,
  p_won boolean, p_drawn boolean, p_gf int, p_ga int)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.pitchside_profiles;
  q public.pitchside_queue;
  v_ws timestamptz := date_bin(interval '1 hour', now(), timestamptz '2000-01-01 00:00:00+00');
  v_count int; v_coins bigint; v_opp int; v_k numeric; v_exp numeric; v_score numeric; v_delta int; v_rating int; v_old int;
  v_matched boolean := false; v_rivals json := null; v_div int; v_pts int; v_thr int; v_promoted boolean := false;
begin
  if p_mode is null or p_mode not in ('friendly', 'ut', 'rivals', 'offline') then return public.pitchside__err('bad_mode'); end if;
  if coalesce(p_won, false) and coalesce(p_drawn, false) then return public.pitchside__err('bad_result'); end if;
  if p_gf is null or p_ga is null or p_gf not between 0 and 50 or p_ga not between 0 and 50 then return public.pitchside__err('bad_score'); end if;
  if v_ws is null then return public.pitchside__err('clock'); end if;
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  -- lock the profile row: serialises concurrent reports by the same player
  select * into v from public.pitchside_profiles where id = v.id for update;
  v_count := case when v.reward_window_start = v_ws then v.reward_window_count else 0 end;
  if v_count >= 12 or (v.last_reward_at is not null and v.last_reward_at > now() - interval '60 seconds') then
    return json_build_object('ok', true, 'capped', true, 'coinsAwarded', 0, 'coins', v.coins, 'rating', v.rating,
      'ratingDelta', 0, 'division', v.division);
  end if;
  v_old := v.rating;
  v_coins := case when p_won then 800 when p_drawn then 400 else 200 end;
  v_score := case when p_won then 1 when p_drawn then 0.5 else 0 end;
  v_opp := v.rating; v_k := 16;
  if p_mode in ('friendly', 'ut', 'rivals') then
    select * into q from public.pitchside_queue
     where player_id = v.id and matched_with is not null and not reported and mode = p_mode
       and matched_at > now() - interval '3 hours'
     order by matched_at desc limit 1 for update;
    if found then
      update public.pitchside_queue set reported = true where id = q.id;
      v_opp := coalesce(q.opp_rating, v.rating); v_k := 32; v_matched := true;
    end if;
  end if;
  if p_mode = 'offline' then v_k := 0; end if;
  v_exp := 1.0 / (1.0 + power(10.0, (v_opp - v.rating) / 400.0));
  v_delta := round(v_k * (v_score - v_exp));
  v_rating := greatest(100, least(3000, v.rating + v_delta));
  update public.pitchside_profiles set
    coins = coins + v_coins,
    rating = v_rating,
    division = public.pitchside__division(v_rating),
    wins = wins + case when p_won then 1 else 0 end,
    draws = draws + case when p_drawn then 1 else 0 end,
    losses = losses + case when not coalesce(p_won, false) and not coalesce(p_drawn, false) then 1 else 0 end,
    last_reward_at = now(),
    reward_window_start = v_ws,
    reward_window_count = v_count + 1,
    reward_window_coins = case when v.reward_window_start = v_ws then reward_window_coins else 0 end + v_coins
  where id = v.id
  returning * into v;
  if p_mode = 'rivals' and v_matched then
    perform public.pitchside__rivals_rollover(v.id);
    select * into v from public.pitchside_profiles where id = v.id;
    v_div := v.rivals_division;
    v_pts := v.rivals_points + case when p_won then 3 when p_drawn then 1 else 0 end;
    loop
      v_thr := public.pitchside__rivals_threshold(v_div);
      exit when v_thr is null or v_pts < v_thr;
      v_pts := v_pts - v_thr; v_div := v_div - 1; v_promoted := true;
    end loop;
    update public.pitchside_profiles set
      rivals_division = v_div, rivals_points = v_pts, rivals_peak = least(rivals_peak, v_div),
      rivals_week_wins = rivals_week_wins + case when p_won then 1 else 0 end,
      rivals_week_matches = rivals_week_matches + 1
    where id = v.id returning * into v;
    v_rivals := json_build_object('division', v.rivals_division, 'points', v.rivals_points,
      'threshold', public.pitchside__rivals_threshold(v.rivals_division), 'promoted', v_promoted, 'weekWins', v.rivals_week_wins);
  end if;
  return json_build_object('ok', true, 'capped', false, 'coinsAwarded', v_coins, 'coins', v.coins,
    'rating', v.rating, 'ratingDelta', v.rating - v_old, 'division', v.division, 'rivals', v_rivals);
end $$;

create or replace function public.pitchside_admin_add_coins(p_id uuid, p_secret text, p_code text, p_delta bigint)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_bal bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000000 then return public.pitchside__err('bad_amount'); end if;
  if not public.pitchside__admin_check(p_code) then return public.pitchside__err('not_admin'); end if;
  update public.pitchside_profiles set coins = greatest(0, coins + p_delta) where id = v.id returning coins into v_bal;
  perform public.pitchside__audit(v.id, 'admin_self_coins', jsonb_build_object('delta', p_delta, 'balance', v_bal, 'by', public.pitchside__client_key()));
  return json_build_object('ok', true, 'coins', v_bal);
end $$;

-- ------------------------------------------------------------------ moderation
-- Who is acting: an owner/mod session (p_id + p_secret) or the full admin code.
-- -> 'owner' | 'mod' | 'admin' | null. The admin code is only checked when no staff session matched,
-- so staff calls never count towards the admin failure throttle.
create or replace function public.pitchside__mod_actor(p_code text, p_id uuid, p_secret text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles;
begin
  if p_id is not null and p_secret is not null then
    v := public.pitchside__auth(p_id, p_secret);
    if v.id is not null and v.role in ('owner', 'mod') then return v.role; end if;
  end if;
  if p_code is not null and p_code <> '' and public.pitchside__admin_check(p_code) then return 'admin'; end if;
  return null;
end $$;

-- rank: admin code 3, owner 2, mod 1. Staff may only act on players ranked below them
-- (the admin code may act on anyone; owners on mods and players; mods on players).
create or replace function public.pitchside__mod_rank(p_role text)
returns int language sql immutable
set search_path = public, extensions, pg_temp
as $$ select case p_role when 'admin' then 3 when 'owner' then 2 when 'mod' then 1 else 0 end $$;

create or replace function public.pitchside__mod_by(p_actor text, p_id uuid)
returns jsonb language sql stable
set search_path = public, extensions, pg_temp
as $$ select jsonb_build_object('by', p_actor, 'byId', case when p_actor <> 'admin' then p_id end, 'ip', public.pitchside__client_key()) $$;

create or replace function public.pitchside__mod_row(v public.pitchside_profiles)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$
  select json_build_object('id', v.id, 'username', v.username, 'name', v.name, 'role', v.role, 'friendCode', v.friend_code,
    'coins', v.coins, 'rating', v.rating, 'rivalsDivision', v.rivals_division,
    'wins', v.wins, 'draws', v.draws, 'losses', v.losses,
    'banned', public.pitchside__is_banned(v), 'banReason', v.ban_reason, 'bannedUntil', v.banned_until, 'bannedAt', v.banned_at,
    'createdAt', v.created_at, 'lastLoginAt', v.last_login_at, 'lastSeenAt', v.last_seen_at)
$$;

create or replace function public.pitchside_mod_search(p_code text, p_query text, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_q text; v_like text; v_key text; v_items json;
begin
  if public.pitchside__mod_actor(p_code, p_id, p_secret) is null then return public.pitchside__err('not_admin'); end if;
  v_q := btrim(regexp_replace(coalesce(p_query, ''), '[[:cntrl:]]', '', 'g'));
  if char_length(v_q) not between 1 and 40 then return public.pitchside__err('bad_query'); end if;
  v_like := replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  v_key := replace(replace(replace(public.pitchside__username_key(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  select coalesce(json_agg(public.pitchside__mod_row(p.q) order by p.rn), '[]'::json)
    into v_items
  from (
    select q, row_number() over (order by (public.pitchside__username_key(q.username) = public.pitchside__username_key(v_q)) desc nulls last,
                                            (q.friend_code = upper(v_q)) desc, q.last_seen_at desc nulls last) as rn
      from public.pitchside_profiles q
     where (v_key <> '' and public.pitchside__username_key(q.username) like v_key || '%')
        or q.friend_code = upper(replace(v_q, '-', ''))
        or q.id::text = lower(v_q)
        or lower(q.name) like '%' || v_like || '%'
     order by rn
     limit 25
  ) p;
  return json_build_object('ok', true, 'items', v_items);
end $$;

create or replace function public.pitchside_mod_player(p_code text, p_player uuid, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_audit json; v_listings json; v_sessions int;
begin
  if public.pitchside__mod_actor(p_code, p_id, p_secret) is null then return public.pitchside__err('not_admin'); end if;
  select * into v from public.pitchside_profiles where id = p_player;
  if not found then return public.pitchside__err('not_found'); end if;
  select coalesce(json_agg(json_build_object('action', a.action, 'detail', a.detail, 'at', a.at) order by a.at desc), '[]'::json)
    into v_audit
  from (select * from public.pitchside_audit where profile_id = v.id order by at desc limit 60) a;
  select coalesce(json_agg(json_build_object('listingId', l.id, 'name', l.name, 'ovr', l.ovr, 'price', l.price,
           'status', l.status, 'listedAt', l.created_at, 'soldAt', l.sold_at) order by l.created_at desc), '[]'::json)
    into v_listings
  from (select * from public.pitchside_listings where seller_id = v.id order by created_at desc limit 40) l;
  select count(*) into v_sessions from public.pitchside_sessions where profile_id = v.id and last_seen > now() - interval '60 days';
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(v), 'audit', v_audit, 'listings', v_listings,
    'sessions', v_sessions);
end $$;

-- p_until null = permanent. Cancels active listings, leaves queues, cancels pending invites.
create or replace function public.pitchside_mod_ban(p_code text, p_player uuid, p_reason text, p_until timestamptz default null,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_reason text; v_n int; v_actor text;
begin
  v_actor := public.pitchside__mod_actor(p_code, p_id, p_secret);
  if v_actor is null then return public.pitchside__err('not_admin'); end if;
  v_reason := btrim(regexp_replace(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
  if char_length(v_reason) not between 1 and 200 then return public.pitchside__err('bad_reason'); end if;
  if p_until is not null and (p_until <= now() or p_until > now() + interval '10 years') then
    return public.pitchside__err('bad_until');
  end if;
  select * into v from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if v_actor <> 'admin' and v.id = p_id then return public.pitchside__err('not_allowed'); end if;
  if public.pitchside__mod_rank(v.role) >= public.pitchside__mod_rank(v_actor) then return public.pitchside__err('not_allowed'); end if;
  update public.pitchside_profiles set banned = true, ban_reason = v_reason, banned_until = p_until,
    banned_by = left(v_actor || ':' || coalesce(case when v_actor <> 'admin' then p_id::text end, public.pitchside__client_key()), 64),
    banned_at = now()
   where id = p_player returning * into v;
  update public.pitchside_listings set status = 'cancelled' where seller_id = v.id and status = 'active';
  get diagnostics v_n = row_count;
  delete from public.pitchside_queue where player_id = v.id and matched_with is null;
  update public.pitchside_invites set status = 'cancelled' where (from_id = v.id or to_id = v.id) and status = 'pending';
  perform public.pitchside__audit(v.id, 'admin_ban', jsonb_build_object('reason', v_reason, 'until', p_until,
    'listingsCancelled', v_n) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(v), 'listingsCancelled', v_n);
end $$;

create or replace function public.pitchside_mod_unban(p_code text, p_player uuid, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_actor text;
begin
  v_actor := public.pitchside__mod_actor(p_code, p_id, p_secret);
  if v_actor is null then return public.pitchside__err('not_admin'); end if;
  select * into v from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if public.pitchside__mod_rank(v.role) >= public.pitchside__mod_rank(v_actor) then return public.pitchside__err('not_allowed'); end if;
  update public.pitchside_profiles set banned = false, ban_reason = null, banned_until = null, banned_by = null, banned_at = null
   where id = p_player returning * into v;
  perform public.pitchside__audit(v.id, 'admin_unban', public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(v));
end $$;

-- Coins: owner session or admin code only (mods cannot change balances).
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
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000000 then return public.pitchside__err('bad_amount'); end if;
  select coins into v_old from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  update public.pitchside_profiles set coins = greatest(0, coins + p_delta) where id = p_player returning coins into v_bal;
  perform public.pitchside__audit(p_player, 'admin_coins', jsonb_build_object('delta', p_delta, 'before', v_old, 'balance', v_bal,
    'reason', left(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), 120)) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'coins', v_bal);
end $$;

-- Roles: owner session or admin code only. Owners cannot change their own role or another owner's
-- (only the admin code can promote/demote owners).
create or replace function public.pitchside_mod_set_role(p_code text, p_player uuid, p_role text, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_actor text; v_old text;
begin
  v_actor := public.pitchside__mod_actor(p_code, p_id, p_secret);
  if v_actor is null then return public.pitchside__err('not_admin'); end if;
  if v_actor = 'mod' then return public.pitchside__err('not_allowed'); end if;
  if p_role is null or p_role not in ('player', 'mod', 'owner') then return public.pitchside__err('bad_role'); end if;
  select * into v from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if v.username is null then return public.pitchside__err('no_account'); end if;
  if v_actor <> 'admin' and (v.id = p_id or v.role = 'owner' or p_role = 'owner') then return public.pitchside__err('not_allowed'); end if;
  v_old := v.role;
  update public.pitchside_profiles set role = p_role where id = v.id returning * into v;
  perform public.pitchside__audit(v.id, 'admin_role', jsonb_build_object('from', v_old, 'to', p_role) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(v));
end $$;

-- ------------------------------------------------------------------ staff match tokens (in-match admin effects)
-- Server-only HMAC key (one row, generated here, never readable by clients).
create table if not exists public.pitchside_server_secret (
  id     int primary key default 1,
  secret bytea not null,
  constraint pitchside_server_secret_single check (id = 1),
  constraint pitchside_server_secret_len check (octet_length(secret) >= 32)
);
alter table public.pitchside_server_secret enable row level security;
revoke all on table public.pitchside_server_secret from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_server_secret from %I', r);
    end if;
  end loop;
end $$;
insert into public.pitchside_server_secret (id, secret) values (1, extensions.gen_random_bytes(32)) on conflict (id) do nothing;

create or replace function public.pitchside__sign(p_payload text)
returns text language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select encode(extensions.hmac(convert_to(p_payload, 'UTF8'), (select secret from public.pitchside_server_secret where id = 1), 'sha256'), 'hex') $$;

-- Token "<profile uuid>.<role>.<exp unix s>.<hmac hex>" valid 15 min, only for owner/mod accounts.
-- p_bind (optional) = the host's room code / peer id, so a token cannot be replayed in another match.
create or replace function public.pitchside_admin_match_token(p_id uuid, p_secret text, p_bind text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_exp bigint; v_payload text;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.role not in ('owner', 'mod') then return public.pitchside__err('not_allowed'); end if;
  if p_bind is not null and p_bind !~ '^[A-Za-z0-9_-]{1,64}$' then return public.pitchside__err('bad_bind'); end if;
  if not public.pitchside__throttle('mtok:' || v.id, interval '1 hour', 120) then return public.pitchside__err('rate_limited'); end if;
  v_exp := extract(epoch from now() + interval '15 minutes')::bigint;
  v_payload := v.id::text || '.' || v.role || '.' || v_exp::text;
  return json_build_object('ok', true, 'role', v.role, 'exp', v_exp,
    'token', v_payload || '.' || public.pitchside__sign(v_payload || '|' || coalesce(p_bind, '')));
end $$;

-- -> { ok:true, profile_id, role, exp } only for a genuine, unexpired token whose account is still
-- owner/mod and not banned; otherwise { ok:false, error:'invalid' }.
create or replace function public.pitchside_verify_admin_token(p_token text, p_bind text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_parts text[]; v_pid uuid; v_exp bigint; v public.pitchside_profiles;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(owner|mod)\.[0-9]{9,11}\.[0-9a-f]{64}$' then
    return public.pitchside__err('invalid');
  end if;
  if p_bind is not null and p_bind !~ '^[A-Za-z0-9_-]{1,64}$' then return public.pitchside__err('invalid'); end if;
  if not public.pitchside__throttle('mtokv:' || public.pitchside__client_key(), interval '1 hour', 600) then
    return public.pitchside__err('rate_limited');
  end if;
  v_parts := string_to_array(p_token, '.');
  if public.pitchside__sign(v_parts[1] || '.' || v_parts[2] || '.' || v_parts[3] || '|' || coalesce(p_bind, '')) <> v_parts[4] then
    return public.pitchside__err('invalid');
  end if;
  v_pid := v_parts[1]::uuid; v_exp := v_parts[3]::bigint;
  if v_exp < extract(epoch from now()) then return public.pitchside__err('invalid'); end if;
  select * into v from public.pitchside_profiles where id = v_pid;
  if not found or v.role not in ('owner', 'mod') or v.role <> v_parts[2] or public.pitchside__is_banned(v) then
    return public.pitchside__err('invalid');
  end if;
  return json_build_object('ok', true, 'profile_id', v.id, 'role', v.role, 'exp', v_exp);
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001)
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

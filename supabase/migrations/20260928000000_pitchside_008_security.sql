-- =====================================================================================
-- Pitchside 3D — migration 008 (run AFTER 001-007). Idempotent: safe to run more than once.
-- Security hardening, additive only: same RPC names, arguments and return shapes as before.
--   * pitchside_attempts: failed-attempt log (sliding windows) + helpers. Old rows are pruned now and then.
--   * Login: 5 failures per username or 20 per IP in 15 minutes -> 'too_many_attempts' (the existing code);
--     a correct password clears that username's counters. (002's fixed-window limits stay in place too.)
--   * Admin codes (admin_login, admin_verify, owner/mod RPCs, owner-name signup / claim / rename): 5 wrong
--     codes from one IP in 15 minutes -> codes from that IP are refused until the window passes. Signed admin
--     tokens are not affected, so a logged-in owner panel keeps working. admin_login and the owner-name
--     paths answer 'rate_limited' while locked; admin_verify answers false.
--   * verify_admin_token: 5 bad signatures from one IP in 15 minutes -> 'rate_limited' for a while.
--   * Passwords (signup, claim_profile, change_password): besides 8+ chars and "not the username", now also
--     not one repeated character, not only digits, not one of the most common passwords -> 'weak_password'.
--     Login never checks strength, so older accounts with short passwords can still log in.
-- Same security model as 001-007: RLS on, no table grants, SECURITY DEFINER functions with a fixed
-- search_path, no dynamic SQL except the privileges block at the end.
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ failed-attempt log
create table if not exists public.pitchside_attempts (
  id     bigint generated always as identity primary key,
  bucket text not null,
  at     timestamptz not null default now(),
  constraint pitchside_attempts_bucket_len check (char_length(bucket) between 1 and 96)
);
create index if not exists pitchside_attempts_bucket_at on public.pitchside_attempts (bucket, at desc);
create index if not exists pitchside_attempts_at on public.pitchside_attempts (at);
alter table public.pitchside_attempts enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_attempts from %I', r);
    end if;
  end loop;
end $$;
revoke all on table public.pitchside_attempts from public;
-- (no policies: with RLS enabled and no grants, clients can neither read nor write this table)

-- Failures in `bucket` during the last `window`.
create or replace function public.pitchside__attempts(p_bucket text, p_window interval)
returns int language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select count(*)::int from public.pitchside_attempts where bucket = p_bucket and at > now() - p_window $$;

-- Record one failure (and now and then drop rows older than a day).
create or replace function public.pitchside__attempt_fail(p_bucket text)
returns void language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.pitchside_attempts (bucket) values (left(p_bucket, 96));
  if random() < 0.02 then
    delete from public.pitchside_attempts where at < now() - interval '1 day';
  end if;
end $$;

create or replace function public.pitchside__attempt_clear(p_bucket text)
returns void language sql volatile security definer
set search_path = public, extensions, pg_temp
as $$ delete from public.pitchside_attempts where bucket = p_bucket $$;

-- 5 wrong admin codes from this IP in the last 15 minutes.
create or replace function public.pitchside__admin_code_locked()
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select public.pitchside__attempts('admin_code_ip:' || public.pitchside__client_key(), interval '15 minutes') >= 5 $$;

-- ------------------------------------------------------------------ password strength (002 rules + more)
-- Mirrored in 3d/js/net/accountcore.js (passwordError / COMMON_PASSWORDS) — keep them in sync.
create or replace function public.pitchside__password_error(p_password text, p_username text)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $$
  select case
    when p_password is null or char_length(p_password) < 8 then 'weak_password'
    when char_length(p_password) > 72 or octet_length(p_password) > 72 then 'bad_password'
    when p_password ~ '[[:cntrl:]]' then 'bad_password'
    when lower(p_password) = lower(coalesce(p_username, '')) then 'weak_password'
    when p_password ~ '^(.)\1*$' then 'weak_password'
    when p_password ~ '^[0-9]+$' then 'weak_password'
    when lower(p_password) = any (array[
      -- COMMON-PASSWORDS-BEGIN
      'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword',
      'qwertyuiop', 'qwerty12', 'qwerty123', 'qwerty1234', 'qwertyui', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4',
      '1qaz2wsx', 'zaq12wsx', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'abc12345', 'abcd1234', 'abcdefgh',
      'iloveyou', 'iloveyou1', 'sunshine', 'princess', 'superman', 'starwars', 'trustno1', 'letmein1',
      'welcome1', 'welcome123', 'whatever', 'football', 'football1', 'baseball', 'basketball', 'soccer123',
      'liverpool', 'chelsea1', 'arsenal1', 'barcelona', 'realmadrid', 'manchester', 'ronaldo7', 'cristiano',
      'messi123', 'pitchside'
      -- COMMON-PASSWORDS-END
    ]) then 'weak_password'
    else null end
$$;

-- ------------------------------------------------------------------ admin codes: per-IP lock (007 definitions + lock)
create or replace function public.pitchside__admin_level(p_code text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ws timestamptz := date_trunc('minute', now()); v_fail int; v_parts text[]; r record; v_hash text;
  v_ip text := public.pitchside__client_key(); v_revoke numeric; v_plain boolean := false;
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
    -- 008: 5 wrong codes from one IP -> codes from that IP are refused for 15 minutes (tokens keep working)
    if public.pitchside__admin_code_locked() then return null; end if;
    v_plain := true;
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
  if v_plain then perform public.pitchside__attempt_fail('admin_code_ip:' || v_ip); end if;
  return null;
end $$;

-- Exchange a code for a 12 h admin token (recorded, so it can be revoked). -> { ok, level, token, exp }
create or replace function public.pitchside_admin_login(p_code text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_level text; v_exp bigint; v_sig text;
begin
  if p_code is not null and p_code !~ '^adm\.' and public.pitchside__admin_code_locked() then
    return public.pitchside__err('rate_limited');
  end if;
  v_level := public.pitchside__admin_level(p_code);
  if v_level is null then return public.pitchside__err('invalid'); end if;
  v_exp := extract(epoch from now() + interval '12 hours')::bigint;
  v_sig := public.pitchside__sign('adm|' || v_level || '|' || v_exp);
  insert into public.pitchside_admin_tokens (sig, level, exp) values (v_sig, v_level, v_exp) on conflict (sig) do nothing;
  if random() < 0.02 then delete from public.pitchside_admin_tokens where exp < extract(epoch from now()) - 86400; end if;
  return json_build_object('ok', true, 'level', v_level, 'exp', v_exp, 'token', 'adm.' || v_level || '.' || v_exp || '.' || v_sig);
end $$;



-- ------------------------------------------------------------------ login (002 definition + sliding per-username / per-IP lock)
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
  -- 008: sliding 15 min window: 5 failures per username, 20 per IP
  if public.pitchside__attempts('login_u:' || v_key, interval '15 minutes') >= 5
     or public.pitchside__attempts('login_ip:' || v_ip, interval '15 minutes') >= 20 then
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
    perform public.pitchside__attempt_fail('login_u:' || v_key);
    perform public.pitchside__attempt_fail('login_ip:' || v_ip);
    if v.id is not null then
      perform public.pitchside__audit(v.id, 'login_failed', jsonb_build_object('ip', v_ip));
    end if;
    return public.pitchside__err('bad_credentials');
  end if;
  -- 008: the right password clears this username's failure counters
  perform public.pitchside__attempt_clear('login_u:' || v_key);
  delete from public.pitchside_throttle where bucket = 'login_fail_u:' || v_key;
  if public.pitchside__is_banned(v) then
    perform public.pitchside__audit(v.id, 'login_banned', jsonb_build_object('ip', v_ip));
    return json_build_object('ok', false, 'error', 'banned', 'ban', public.pitchside__ban_json(v));
  end if;
  update public.pitchside_profiles set last_login_at = now(), last_seen_at = now() where id = v.id returning * into v;
  v_token := public.pitchside__new_session(v.id);
  perform public.pitchside__audit(v.id, 'login', jsonb_build_object('ip', v_ip, 'ua', public.pitchside__ua_key()));
  return public.pitchside__account_json(v, v_token);
end $$;


-- ------------------------------------------------------------------ owner-name admin code while the IP is locked -> 'rate_limited'
-- (002 / 002 / 003 definitions; only the one marked line is new in each)
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
    if public.pitchside__admin_code_locked() then return public.pitchside__err('rate_limited'); end if; -- 008
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
    if public.pitchside__admin_code_locked() then return public.pitchside__err('rate_limited'); end if; -- 008
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
    if public.pitchside__admin_code_locked() then return public.pitchside__err('rate_limited'); end if; -- 008
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


-- ------------------------------------------------------------------ in-match admin tokens (002 definition + bad-signature lock)
create or replace function public.pitchside_verify_admin_token(p_token text, p_bind text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_parts text[]; v_pid uuid; v_exp bigint; v public.pitchside_profiles; v_ip text := public.pitchside__client_key();
begin
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(owner|mod)\.[0-9]{9,11}\.[0-9a-f]{64}$' then
    return public.pitchside__err('invalid');
  end if;
  if p_bind is not null and p_bind !~ '^[A-Za-z0-9_-]{1,64}$' then return public.pitchside__err('invalid'); end if;
  if not public.pitchside__throttle('mtokv:' || public.pitchside__client_key(), interval '1 hour', 600) then
    return public.pitchside__err('rate_limited');
  end if;
  -- 008: 5 forged / mismatched signatures from one IP in 15 minutes -> refused for a while
  if public.pitchside__attempts('mtok_bad_ip:' || v_ip, interval '15 minutes') >= 5 then
    return public.pitchside__err('rate_limited');
  end if;
  v_parts := string_to_array(p_token, '.');
  if public.pitchside__sign(v_parts[1] || '.' || v_parts[2] || '.' || v_parts[3] || '|' || coalesce(p_bind, '')) <> v_parts[4] then
    perform public.pitchside__attempt_fail('mtok_bad_ip:' || v_ip);
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


-- ------------------------------------------------------------------ function privileges (same rule as 001-007)
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

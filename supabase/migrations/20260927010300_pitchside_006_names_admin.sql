-- =====================================================================================
-- Pitchside 3D — migration 006 (run AFTER 001-005). Idempotent: safe to run more than once.
--   * Names: an account's display name IS its username, everywhere (friends, market seller, matchmaking,
--     invites, admin lists). A trigger keeps profiles.name = username; existing drifted names are repaired;
--     set_name no longer changes an account's name (guests keep their free display name).
--   * Friends list rows carry username + friend code.
-- Same security model as 001-005: RLS on, no table grants, SECURITY DEFINER RPCs with a fixed
-- search_path; owner powers = full/super code (or token) or an owner account; every action audited.
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ names follow usernames
create or replace function public.pitchside__name_follows_username()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if new.username is not null and new.name is distinct from left(new.username, 16) then
    new.name := left(new.username, 16);
  end if;
  return new;
end $$;
drop trigger if exists pitchside_profiles_name_follows on public.pitchside_profiles;
create trigger pitchside_profiles_name_follows before insert or update of name, username on public.pitchside_profiles
  for each row execute function public.pitchside__name_follows_username();
update public.pitchside_profiles set name = left(username, 16) where username is not null and name is distinct from left(username, 16);

-- Guests: free display name (filtered). Accounts: always the username (change it with change_username).
create or replace function public.pitchside_set_name(p_id uuid, p_secret text, p_name text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_name text;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.username is not null then return json_build_object('ok', true, 'name', v.username); end if;
  v_name := public.pitchside__safe_name(p_name, v.role);
  if v_name is null then return public.pitchside__err('name_not_allowed'); end if;
  if not public.pitchside__throttle('name:' || v.id, interval '1 hour', 20) then return public.pitchside__err('rate_limited'); end if;
  update public.pitchside_profiles set name = v_name where id = v.id;
  return json_build_object('ok', true, 'name', v_name);
end $$;

-- 002's list_friends + username and friendCode per row.
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
           'id', p.id, 'username', p.username, 'name', coalesce(p.username, p.name), 'role', p.role, 'friendCode', p.friend_code,
           'status', case when f.status = 'accepted' then 'friend' when f.status = 'blocked' then 'blocked'
                          when f.requested_by = v.id then 'outgoing' else 'incoming' end,
           'online', f.status = 'accepted' and p.last_seen_at > now() - interval '60 seconds',
           'rating', case when f.status = 'accepted' then p.rating end,
           'division', case when f.status = 'accepted' then p.division end,
           'rivalsDivision', case when f.status = 'accepted' then p.rivals_division end)
         order by (f.status = 'accepted' and p.last_seen_at > now() - interval '60 seconds') desc, coalesce(p.username, p.name)), '[]'::json)
    into v_items
  from public.pitchside_friends f
  join public.pitchside_profiles p on p.id = case when f.a = v.id then f.b else f.a end
  where v.id in (f.a, f.b) and not (f.status = 'blocked' and f.blocked_by <> v.id);
  return json_build_object('ok', true, 'code', v.friend_code, 'items', v_items);
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001-005)
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

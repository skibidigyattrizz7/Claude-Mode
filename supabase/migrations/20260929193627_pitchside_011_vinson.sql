-- EVIL VINSON: server-owned three-minute doom deadline, ban and owner-only release.
-- The Supabase CLI is unavailable in this workspace; this migration follows the existing numbered convention.
-- No client can read/write this table directly. Only authenticated, bounded RPCs below access it.
create table if not exists public.pitchside_vinson (
  profile_id uuid primary key references public.pitchside_profiles(id) on delete cascade,
  phase text not null check (phase in ('doom', 'banned', 'released', 'locked')),
  deadline timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.pitchside_vinson enable row level security;
revoke all on table public.pitchside_vinson from public, anon, authenticated;

-- Every ordinary authenticated RPC already uses __auth; a player cannot avoid the deadline by reloading or
-- refusing to call the visual client's timer. Status/login sees the same virtual ban before it is materialised.
create or replace function public.pitchside__is_banned(v public.pitchside_profiles)
returns boolean language sql stable
set search_path = public, extensions, pg_temp
as $$
  select (coalesce(v.banned, false) and (v.banned_until is null or v.banned_until > now()))
    or exists (select 1 from public.pitchside_vinson x where x.profile_id = v.id
      and (x.phase = 'banned' or (x.phase = 'doom' and x.deadline <= now())))
$$;

create or replace function public.pitchside__ban_json(v public.pitchside_profiles)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$
  select case when exists (select 1 from public.pitchside_vinson x where x.profile_id = v.id
      and (x.phase = 'banned' or (x.phase = 'doom' and x.deadline <= now())))
    then json_build_object('reason', 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON', 'until', null)
    else json_build_object('reason', coalesce(v.ban_reason, ''), 'until', v.banned_until) end
$$;

-- Raw auth is deliberate: a banned player must be able to read the final cinematic and detect an unban.
create or replace function public.pitchside_vinson_status(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson;
begin
  v := public.pitchside__auth_raw(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.role = 'owner' then return json_build_object('ok', true, 'exempt', true, 'phase', null, 'serverNow', now()); end if;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if not found then return json_build_object('ok', true, 'phase', null, 'serverNow', now()); end if;
  if x.phase = 'doom' and x.deadline <= now() then
    update public.pitchside_vinson set phase = 'banned', updated_at = now() where profile_id = v.id returning * into x;
    update public.pitchside_profiles set banned = true, ban_reason = 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON',
      banned_until = null, banned_at = now(), banned_by = 'vinson' where id = v.id;
    perform public.pitchside__audit(v.id, 'vinson_ban');
  end if;
  return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline, 'serverNow', now());
end $$;

-- Called only after an actual pack roll containing secret_vinson. It is idempotent during one doom window.
create or replace function public.pitchside_vinson_pull(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson;
begin
  v := public.pitchside__auth_raw(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.role = 'owner' then return json_build_object('ok', true, 'exempt', true); end if;
  if public.pitchside__is_banned(v) then return public.pitchside__err('banned'); end if;
  if not public.pitchside__throttle('vinson:' || v.id, interval '1 hour', 10) then return public.pitchside__err('rate_limited'); end if;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if found and x.phase in ('doom', 'locked') then
    return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline);
  end if;
  insert into public.pitchside_vinson (profile_id, phase, deadline) values (v.id, 'doom', now() + interval '3 minutes')
    on conflict (profile_id) do update set phase = 'doom', deadline = excluded.deadline, updated_at = now()
    returning * into x;
  perform public.pitchside__audit(v.id, 'vinson_pull');
  return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline);
end $$;

create or replace function public.pitchside_vinson_lock(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_vinson set phase = 'locked', updated_at = now()
    where profile_id = v.id and phase in ('released', 'locked') returning * into x;
  if not found then return public.pitchside__err('not_released'); end if;
  return json_build_object('ok', true, 'phase', x.phase);
end $$;

create or replace function public.pitchside_vinson_unban(p_id uuid, p_secret text, p_player uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare actor public.pitchside_profiles; target public.pitchside_profiles; x public.pitchside_vinson;
begin
  actor := public.pitchside__auth(p_id, p_secret);
  if actor.id is null or actor.role <> 'owner' then return public.pitchside__err('not_allowed'); end if;
  select * into target from public.pitchside_profiles where id = p_player for update;
  if not found or target.id = actor.id then return public.pitchside__err('not_found'); end if;
  select * into x from public.pitchside_vinson where profile_id = target.id for update;
  if not found or x.phase not in ('doom', 'banned') then return public.pitchside__err('not_vinson'); end if;
  update public.pitchside_vinson set phase = 'released', deadline = null, updated_at = now() where profile_id = target.id;
  if target.ban_reason = 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON' then
    update public.pitchside_profiles set banned = false, ban_reason = null, banned_until = null,
      banned_at = null, banned_by = null where id = target.id returning * into target;
  end if;
  perform public.pitchside__audit(target.id, 'vinson_unban', jsonb_build_object('byId', actor.id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(target));
end $$;

-- A locked card cannot be removed by sending a modified cloud save from another browser. Only the active
-- squad is pinned; other saved squads may exist, but switching to one must reinsert the card client-side.
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
  if exists (select 1 from public.pitchside_vinson x where x.profile_id = v.id and x.phase = 'locked')
    and not (coalesce(p_data -> 'club', '[]'::jsonb) ? 'secret_vinson'
      and (coalesce(p_data #> '{squad,slots}', '[]'::jsonb) ? 'secret_vinson'
        or coalesce(p_data #> '{squad,bench}', '[]'::jsonb) ? 'secret_vinson')) then
    return public.pitchside__err('vinson_locked');
  end if;
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

-- The RPCs are public endpoints but each authenticates and checks identity/role. Helpers remain private.
revoke all on function public.pitchside_vinson_status(uuid,text), public.pitchside_vinson_pull(uuid,text),
  public.pitchside_vinson_lock(uuid,text), public.pitchside_vinson_unban(uuid,text,uuid) from public;
grant execute on function public.pitchside_vinson_status(uuid,text), public.pitchside_vinson_pull(uuid,text),
  public.pitchside_vinson_lock(uuid,text), public.pitchside_vinson_unban(uuid,text,uuid) to anon, authenticated;

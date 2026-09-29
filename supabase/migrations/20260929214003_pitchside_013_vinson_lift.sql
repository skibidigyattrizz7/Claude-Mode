-- One-minute Vinson doom and an owner-only, durable lift. Preserve existing owner restrictions.
alter table public.pitchside_vinson drop constraint if exists pitchside_vinson_phase_check;
alter table public.pitchside_vinson add constraint pitchside_vinson_phase_check
  check (phase in ('doom', 'banned', 'released', 'locked', 'lifted'));
alter table public.pitchside_vinson add column if not exists prior_restrictions jsonb;

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
  if found and x.phase in ('doom', 'locked', 'lifted') then
    return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline);
  end if;
  insert into public.pitchside_vinson (profile_id, phase, deadline)
    values (v.id, 'doom', now() + interval '1 minute')
    on conflict (profile_id) do update set phase = 'doom', deadline = excluded.deadline,
      prior_restrictions = null, updated_at = now() returning * into x;
  perform public.pitchside__audit(v.id, 'vinson_pull');
  return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline);
end $$;

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
      banned_until = null, banned_at = now(), banned_by = 'vinson' where id = v.id returning * into v;
    perform public.pitchside__audit(v.id, 'vinson_ban');
  end if;
  return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline,
    'restrictions', public.pitchside__restrictions_json(v.restrictions), 'serverNow', now());
end $$;

create or replace function public.pitchside_vinson_lock(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if not found or x.phase not in ('released', 'locked') then return public.pitchside__err('not_released'); end if;
  if x.phase = 'released' then
    update public.pitchside_vinson set phase = 'locked', prior_restrictions =
      public.pitchside__restrictions_json(v.restrictions) - 'packs' - 'messages', updated_at = now() where profile_id = v.id;
    update public.pitchside_profiles set restrictions = public.pitchside__restrictions_json(restrictions) ||
      '{"admin":true,"codes":true,"market":true,"sbc":true}'::jsonb where id = v.id;
    perform public.pitchside__audit(v.id, 'vinson_lock');
  end if;
  return json_build_object('ok', true, 'phase', 'locked');
end $$;

create or replace function public.pitchside_vinson_lift(p_id uuid, p_secret text, p_player uuid)
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
  if not found or x.phase = 'lifted' then return public.pitchside__err('not_vinson'); end if;
  if x.phase = 'locked' and x.prior_restrictions is not null then
    update public.pitchside_profiles set restrictions =
      (public.pitchside__restrictions_json(restrictions) - 'admin' - 'codes' - 'market' - 'sbc') ||
      coalesce(x.prior_restrictions, '{}'::jsonb) where id = target.id returning * into target;
  end if;
  if target.ban_reason = 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON' then
    update public.pitchside_profiles set banned = false, ban_reason = null, banned_until = null,
      banned_at = null, banned_by = null where id = target.id returning * into target;
  end if;
  update public.pitchside_vinson set phase = 'lifted', deadline = null, updated_at = now() where profile_id = target.id;
  perform public.pitchside__audit(target.id, 'vinson_lift', jsonb_build_object('byId', actor.id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(target));
end $$;
revoke all on function public.pitchside_vinson_lift(uuid,text,uuid) from public;
grant execute on function public.pitchside_vinson_lift(uuid,text,uuid) to anon, authenticated;

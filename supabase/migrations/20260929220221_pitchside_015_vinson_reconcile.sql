-- The first Vinson release left legacy cloud saves locked without a matching server row.
-- Make the server state visible to owner tools, and clear saved/local lock when the owner lifts it.
insert into public.pitchside_vinson (profile_id, phase, deadline, prior_restrictions)
select s.profile_id, 'locked', null,
  public.pitchside__restrictions_json(p.restrictions) - 'packs' - 'messages'
from public.pitchside_saves s
join public.pitchside_profiles p on p.id = s.profile_id
where s.data #>> '{vinson,phase}' = 'locked' and p.role <> 'owner'
  and not exists (select 1 from public.pitchside_vinson x where x.profile_id = s.profile_id)
on conflict (profile_id) do nothing;

update public.pitchside_profiles p set restrictions =
  public.pitchside__restrictions_json(p.restrictions) ||
  '{"admin":true,"codes":true,"market":true,"sbc":true}'::jsonb
where exists (select 1 from public.pitchside_vinson x where x.profile_id = p.id and x.phase = 'locked');

-- A previous successful lift could leave a stale cloud save marked locked.
update public.pitchside_saves s set data = jsonb_set(s.data, '{vinson}',
  '{"phase":"lifted","doomUntil":0,"phaseUntil":0,"pin":null}'::jsonb, true),
  rev = s.rev + 1, updated_at = now()
where s.data #>> '{vinson,phase}' = 'locked'
  and exists (select 1 from public.pitchside_vinson x where x.profile_id = s.profile_id and x.phase = 'lifted');

create or replace function public.pitchside__mod_row(v public.pitchside_profiles)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$
  select json_build_object('id', v.id, 'username', v.username, 'name', v.name, 'role', v.role, 'friendCode', v.friend_code,
    'coins', v.coins, 'rating', v.rating, 'rivalsDivision', v.rivals_division,
    'wins', v.wins, 'draws', v.draws, 'losses', v.losses,
    'banned', public.pitchside__is_banned(v), 'banReason', v.ban_reason, 'bannedUntil', v.banned_until, 'bannedAt', v.banned_at,
    'createdAt', v.created_at, 'lastLoginAt', v.last_login_at, 'lastSeenAt', v.last_seen_at,
    'vinsonPhase', coalesce(
      (select nullif(x.phase, 'lifted') from public.pitchside_vinson x where x.profile_id = v.id),
      (select case when s.data #>> '{vinson,phase}' = 'locked' then 'locked' end
         from public.pitchside_saves s where s.profile_id = v.id)))
$$;

create or replace function public.pitchside_vinson_lift(p_id uuid, p_secret text, p_player uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare actor public.pitchside_profiles; target public.pitchside_profiles; x public.pitchside_vinson; saved_locked boolean;
begin
  actor := public.pitchside__auth(p_id, p_secret);
  if actor.id is null or actor.role <> 'owner' then return public.pitchside__err('not_allowed'); end if;
  select * into target from public.pitchside_profiles where id = p_player for update;
  if not found or target.id = actor.id then return public.pitchside__err('not_found'); end if;
  select * into x from public.pitchside_vinson where profile_id = target.id for update;
  select coalesce(data #>> '{vinson,phase}' = 'locked', false) into saved_locked
    from public.pitchside_saves where profile_id = target.id;
  if x.profile_id is null and not coalesce(saved_locked, false) then return public.pitchside__err('not_vinson'); end if;
  if x.phase = 'lifted' and not coalesce(saved_locked, false) then return public.pitchside__err('not_vinson'); end if;
  if x.phase = 'locked' and x.prior_restrictions is not null then
    update public.pitchside_profiles set restrictions =
      (public.pitchside__restrictions_json(restrictions) - 'admin' - 'codes' - 'market' - 'sbc') ||
      x.prior_restrictions where id = target.id returning * into target;
  end if;
  if target.ban_reason = 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON' then
    update public.pitchside_profiles set banned = false, ban_reason = null, banned_until = null,
      banned_at = null, banned_by = null where id = target.id returning * into target;
  end if;
  insert into public.pitchside_vinson (profile_id, phase, deadline) values (target.id, 'lifted', null)
    on conflict (profile_id) do update set phase = 'lifted', deadline = null, updated_at = now();
  update public.pitchside_saves set data = jsonb_set(data, '{vinson}',
    '{"phase":"lifted","doomUntil":0,"phaseUntil":0,"pin":null}'::jsonb, true),
    rev = rev + 1, updated_at = now()
    where profile_id = target.id and data #>> '{vinson,phase}' is distinct from 'lifted';
  perform public.pitchside__audit(target.id, 'vinson_lift', jsonb_build_object('byId', actor.id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(target));
end $$;

-- Legacy guest saves can reach the server after the one-time backfill. Register them on status.
create or replace function public.pitchside_vinson_status(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson;
begin
  v := public.pitchside__auth_raw(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.role = 'owner' then return json_build_object('ok', true, 'exempt', true, 'phase', null, 'serverNow', now()); end if;
  perform 1 from public.pitchside_profiles where id = v.id for update;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if not found and exists (select 1 from public.pitchside_saves s where s.profile_id = v.id
      and s.data #>> '{vinson,phase}' = 'locked') then
    insert into public.pitchside_vinson (profile_id, phase, prior_restrictions)
      values (v.id, 'locked', public.pitchside__restrictions_json(v.restrictions) - 'packs' - 'messages')
      on conflict (profile_id) do nothing;
    select * into x from public.pitchside_vinson where profile_id = v.id for update;
    if x.phase = 'locked' then
      update public.pitchside_profiles set restrictions = public.pitchside__restrictions_json(restrictions) ||
        '{"admin":true,"codes":true,"market":true,"sbc":true}'::jsonb where id = v.id returning * into v;
    end if;
  end if;
  if x.profile_id is null then return json_build_object('ok', true, 'phase', null, 'serverNow', now()); end if;
  if x.phase = 'doom' and x.deadline <= now() then
    update public.pitchside_vinson set phase = 'banned', updated_at = now() where profile_id = v.id returning * into x;
    update public.pitchside_profiles set banned = true, ban_reason = 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON',
      banned_until = null, banned_at = now(), banned_by = 'vinson' where id = v.id returning * into v;
    perform public.pitchside__audit(v.id, 'vinson_ban');
  end if;
  return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline,
    'restrictions', public.pitchside__restrictions_json(v.restrictions), 'serverNow', now());
end $$;

-- Do not let a stale browser upload a locked save after the owner has lifted the curse.
create or replace function public.pitchside_save_put(p_id uuid, p_secret text, p_data jsonb, p_rev int)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; s public.pitchside_saves; x public.pitchside_vinson; v_rev int; v_data jsonb;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  perform 1 from public.pitchside_profiles where id = v.id for update;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return public.pitchside__err('bad_value'); end if;
  if octet_length(p_data::text) > 1572864 then return public.pitchside__err('too_large'); end if;
  if v.role <> 'owner' and p_data #>> '{vinson,phase}' = 'locked'
    and not (coalesce(p_data -> 'club', '[]'::jsonb) ? 'secret_vinson'
      and (coalesce(p_data #> '{squad,slots}', '[]'::jsonb) ? 'secret_vinson'
        or coalesce(p_data #> '{squad,bench}', '[]'::jsonb) ? 'secret_vinson')) then
    return public.pitchside__err('vinson_locked');
  end if;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if not found and v.role <> 'owner' and p_data #>> '{vinson,phase}' = 'locked' then
    insert into public.pitchside_vinson (profile_id, phase, prior_restrictions)
      values (v.id, 'locked', public.pitchside__restrictions_json(v.restrictions) - 'packs' - 'messages')
      on conflict (profile_id) do nothing;
    select * into x from public.pitchside_vinson where profile_id = v.id for update;
    if x.phase = 'locked' then
      update public.pitchside_profiles set restrictions = public.pitchside__restrictions_json(restrictions) ||
        '{"admin":true,"codes":true,"market":true,"sbc":true}'::jsonb where id = v.id;
    end if;
  end if;
  v_data := case when x.phase = 'lifted' then jsonb_set(p_data, '{vinson}',
    '{"phase":"lifted","doomUntil":0,"phaseUntil":0,"pin":null}'::jsonb, true) else p_data end;
  if x.phase = 'locked'
    and not (coalesce(v_data -> 'club', '[]'::jsonb) ? 'secret_vinson'
      and (coalesce(v_data #> '{squad,slots}', '[]'::jsonb) ? 'secret_vinson'
        or coalesce(v_data #> '{squad,bench}', '[]'::jsonb) ? 'secret_vinson')) then
    return public.pitchside__err('vinson_locked');
  end if;
  if not public.pitchside__throttle('save:' || v.id, interval '1 hour', 240) then return public.pitchside__err('rate_limited'); end if;
  select * into s from public.pitchside_saves where profile_id = v.id for update;
  if not found then
    if coalesce(p_rev, 0) <> 0 then return json_build_object('ok', false, 'error', 'conflict', 'rev', 0); end if;
    insert into public.pitchside_saves (profile_id, data, rev) values (v.id, v_data, 1) on conflict (profile_id) do nothing;
    if not found then return json_build_object('ok', false, 'error', 'conflict', 'rev', 1); end if;
    return json_build_object('ok', true, 'rev', 1);
  end if;
  if coalesce(p_rev, -1) <> s.rev then return json_build_object('ok', false, 'error', 'conflict', 'rev', s.rev); end if;
  update public.pitchside_saves set data = v_data, rev = rev + 1, updated_at = now()
    where profile_id = v.id returning rev into v_rev;
  return json_build_object('ok', true, 'rev', v_rev);
end $$;

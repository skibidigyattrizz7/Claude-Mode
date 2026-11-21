-- Pitchside 019 (owner bug report 2026-09-30): owner "Reset coins / progress / club / account", "Delete player" and
-- owner card removals "don't function". The RPCs ran fine; the CLIENT never applied the per-profile reset epochs and
-- re-uploaded / re-registered its local club afterwards (fixed in 3d/js: meta/core/remote.js, net/services.js,
-- net/cloudsave.js). This migration adds the server half:
--   1. pitchside_identity_state(p_id): tells the client whether its profile still exists. After an 'auth' error the
--      client asks: deleted -> forget the identity and wipe the local club; expired session -> old behaviour.
--   2. pitchside_admin_reset: 'club' / 'all' now also delete the profile's CLOUD SAVE row (the old club can no longer be
--      downloaded by another device) and close the owner patches still queued for the old club. A profile under the
--      Vinson lock keeps its save (the curse owns it).
--   3. pitchside_admin_patch_player: removeCard / resetClub also cancel the player's market listings of that card, so a
--      removed card cannot be bought by someone else.
-- pitchside_admin_delete_player / _guests (010) are unchanged: every table that points at pitchside_profiles cascades
-- (saves, squads, sessions, gifts, gift claims, messages, friends, invites, queue, listings, owner patches, coin ops,
-- vinson) or sets null (audit, listings.buyer_id), so deleting the profile row removes everything.

create or replace function public.pitchside_identity_state(p_id uuid)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_id is null then return public.pitchside__err('bad_value'); end if;
  return json_build_object('ok', true, 'exists', exists (select 1 from public.pitchside_profiles where id = p_id));
end $$;

-- 003's admin_reset + cloud save / queued patches for club resets.
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
    delete from public.pitchside_saves where profile_id = v.id
      and not exists (select 1 from public.pitchside_vinson x where x.profile_id = v.id and x.phase = 'locked');
    update public.pitchside_owner_patches set applied_at = now() where profile_id = v.id and applied_at is null;
  end if;
  select * into v from public.pitchside_profiles where id = v.id;
  perform public.pitchside__audit(v.id, 'admin_reset', jsonb_build_object('what', p_what) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'player', public.pitchside__mod_row(v),
    'resets', json_build_object('coins', v.reset_coins_epoch, 'progress', v.reset_progress_epoch, 'club', v.reset_club_epoch));
end $$;

-- 012's admin_patch_player + market cleanup for removeCard / resetClub.
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
       ('addCard', 'removeCard', 'editCard', 'setTradable', 'resetClub', 'resetObjectives', 'resetSbcs', 'setClubName', 'forcePull') then
      return public.pitchside__err('bad_value');
    end if;
    v_names := v_names || to_jsonb(e ->> 'op');
  end loop;
  if not public.pitchside__throttle('patch:' || v.id, interval '1 hour', 600) then return public.pitchside__err('rate_limited'); end if;
  insert into public.pitchside_owner_patches (profile_id, ops, created_by) values (v.id, p_ops, v_actor) returning id into v_pid;
  for e in select * from jsonb_array_elements(p_ops) loop
    if e ->> 'op' = 'resetClub' then
      update public.pitchside_listings set status = 'cancelled' where seller_id = v.id and status in ('active', 'expired');
    elsif e ->> 'op' = 'removeCard' and (e ->> 'id') ~ '^[A-Za-z0-9_.:-]{1,40}$' then
      update public.pitchside_listings set status = 'cancelled'
       where seller_id = v.id and card ->> 'id' = e ->> 'id' and status in ('active', 'expired');
    end if;
  end loop;
  perform public.pitchside__audit(v.id, 'admin_patch', jsonb_build_object('patch', v_pid, 'ops', v_names) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'patchId', v_pid);
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001-010)
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

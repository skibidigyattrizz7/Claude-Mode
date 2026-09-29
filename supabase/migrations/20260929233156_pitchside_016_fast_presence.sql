-- Owner (Sep 29): admin commands, messages and Store changes must reach players near-instantly.
-- Clients now check in every 3 s while the tab is visible (was 25 s), so the presence throttle goes
-- from 600 to 3600 calls an hour. Function body is otherwise unchanged.
create or replace function public.pitchside_presence(p_id uuid, p_secret text)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp
as $function$
declare v public.pitchside_profiles; v_gifts int; v_unread int; v_inv int; v_req int; v_epoch bigint; v_patches int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if not public.pitchside__throttle('pres:' || v.id, interval '1 hour', 3600) then return public.pitchside__err('rate_limited'); end if;
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
end $function$;

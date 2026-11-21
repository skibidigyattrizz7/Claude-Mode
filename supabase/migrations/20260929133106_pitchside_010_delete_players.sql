-- Pitchside 010 (owner request 2026-09-29): Owner Access can delete a player completely (account or device guest),
-- one at a time or every guest idle for N+ days in one go. Every table that points at pitchside_profiles cascades
-- or sets null (listings.buyer_id, audit.profile_id), so deleting the profile row removes their saves, squads,
-- sessions, gifts, messages, friends, queue entries and patches. Never the owner account or yourself; the audit
-- row is written first and keeps the id/name. Super only (owner account or the super code), not mods.

create or replace function public.pitchside_admin_delete_player(p_code text, p_player uuid,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v public.pitchside_profiles;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if v_actor is distinct from 'super' then return public.pitchside__err(case when v_actor is null then 'not_admin' else 'needs_super' end); end if;
  select * into v from public.pitchside_profiles where id = p_player for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if v.role = 'owner' or v.id = p_id then return public.pitchside__err('not_allowed'); end if;
  perform public.pitchside__audit(null, 'admin_delete_player', jsonb_build_object('player', v.id, 'username', v.username, 'name', v.name)
    || public.pitchside__mod_by(v_actor, p_id));
  delete from public.pitchside_profiles where id = v.id;
  return json_build_object('ok', true, 'deleted', 1);
end $$;

-- Every device guest (no username) not seen for p_days days (0 = all guests), never staff. -> { ok, deleted }
create or replace function public.pitchside_admin_delete_guests(p_code text, p_days int default 0,
  p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_n int;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if v_actor is distinct from 'super' then return public.pitchside__err(case when v_actor is null then 'not_admin' else 'needs_super' end); end if;
  if p_days is null or p_days < 0 or p_days > 3650 then return public.pitchside__err('bad_value'); end if;
  with d as (
    delete from public.pitchside_profiles q
     where q.username is null and q.role = 'player' and q.id is distinct from p_id
       and coalesce(q.last_seen_at, q.created_at) < now() - make_interval(days => p_days)
    returning 1)
  select count(*) into v_n from d;
  perform public.pitchside__audit(null, 'admin_delete_guests', jsonb_build_object('days', p_days, 'deleted', v_n) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'deleted', v_n);
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001-006)
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

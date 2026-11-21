-- Pitchside 012 (recorded as pitchside_011_force_pull; 011 was already taken by another branch) (owner request 2026-09-29): owner patches may also queue a forced pack pull
-- ({ op: 'forcePull', id }: the player's next pack leads with that card; meta/core/ownerpatch.js). Same function
-- as 007's pitchside_admin_patch_player; only the allowed op list changed.
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
  perform public.pitchside__audit(v.id, 'admin_patch', jsonb_build_object('patch', v_pid, 'ops', v_names) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'patchId', v_pid);
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

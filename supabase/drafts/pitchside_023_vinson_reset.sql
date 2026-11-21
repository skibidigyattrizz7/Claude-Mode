-- 023 Vinson reset (owner, Oct 2: "the Vinson card doesn't work if a person pulled it twice ... I'm trying to test it").
-- By design a profile is cursed once: after an owner lift or a battle win (immunity) pitchside_vinson_pull starts no
-- new doom. This owner-only RPC wipes one profile's Vinson record (phase, deadline, immunity, battle and reward
-- marks), undoes what the curse did to them (squad-lock restrictions, the Vinson ban), and audits it. Their next
-- Vinson pull then runs the whole experience again. Normal rules are unchanged.
create or replace function public.pitchside_vinson_reset(p_id uuid, p_secret text, p_player uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare actor public.pitchside_profiles; target public.pitchside_profiles; x public.pitchside_vinson;
begin
  actor := public.pitchside__auth(p_id, p_secret);
  if actor.id is null or actor.role <> 'owner' then return public.pitchside__err('not_allowed'); end if;
  select * into target from public.pitchside_profiles where id = p_player for update;
  if not found or target.id = actor.id or target.role = 'owner' then return public.pitchside__err('not_found'); end if;
  select * into x from public.pitchside_vinson where profile_id = target.id for update;
  if not found then return json_build_object('ok', true, 'reset', false, 'player', public.pitchside__mod_row(target)); end if;
  if x.phase = 'locked' and x.prior_restrictions is not null then
    update public.pitchside_profiles set restrictions =
      (public.pitchside__restrictions_json(restrictions) - 'admin' - 'codes' - 'market' - 'sbc') ||
      coalesce(x.prior_restrictions, '{}'::jsonb) where id = target.id returning * into target;
  end if;
  if target.ban_reason = 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON' then
    update public.pitchside_profiles set banned = false, ban_reason = null, banned_until = null,
      banned_at = null, banned_by = null where id = target.id returning * into target;
  end if;
  delete from public.pitchside_vinson where profile_id = target.id;
  perform public.pitchside__audit(target.id, 'vinson_reset', jsonb_build_object('byId', actor.id, 'phase', x.phase, 'immune', x.immune));
  return json_build_object('ok', true, 'reset', true, 'player', public.pitchside__mod_row(target));
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001-022)
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

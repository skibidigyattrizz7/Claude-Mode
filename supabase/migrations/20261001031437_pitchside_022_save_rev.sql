-- FAST DEVICE SYNC (owner, Oct 1): "switching device to device takes a long time to transfer changes". Devices now ask
-- for just the revision number of the cloud save (a few bytes) every few seconds and on a poke, and download the full
-- save only when it changed. Read-only; same auth as pitchside_save_get.
create or replace function public.pitchside_save_rev(p_id uuid, p_secret text)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_rev int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select s.rev into v_rev from public.pitchside_saves s where s.profile_id = v.id;
  return json_build_object('ok', true, 'exists', v_rev is not null, 'rev', coalesce(v_rev, 0));
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001-021)
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

-- Pitchside 009 (owner approved 2026-09-29): the owner ACCOUNT counts as the top admin level ('super').
-- Before this, an owner account without a fresh admin code in this browser session acted as 'owner' (one level
-- below 'super'), so gifting an admin card above 99 OVR from a laptop failed with `needs_super`, and the owner had
-- to re-enter the code every session. Same function as 007's pitchside__actor; only the owner-role line changed.

create or replace function public.pitchside__actor(p_code text, p_id uuid, p_secret text)
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_role text; v_level text;
begin
  if p_id is not null and p_secret is not null then
    v := public.pitchside__auth(p_id, p_secret);
    if v.id is not null and public.pitchside__restricted(v.restrictions, 'admin') then return null; end if;
    if v.id is not null and v.role = 'owner' then v_role := 'super'; -- 009: owner account = Owner Access
    elsif v.id is not null and v.role = 'mod' then v_role := 'mod'; end if;
  end if;
  if p_code is not null and p_code <> '' and not (v.id is not null and public.pitchside__restricted(v.restrictions, 'codes')) then
    v_level := public.pitchside__admin_level(p_code);
  end if;
  return coalesce(v_level, v_role);
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

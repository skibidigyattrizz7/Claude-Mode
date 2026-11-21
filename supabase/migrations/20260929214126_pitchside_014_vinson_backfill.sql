-- Existing Vinson pulls obey the new one-minute limit; existing locked accounts receive the same restrictions.
update public.pitchside_vinson set deadline = least(deadline, updated_at + interval '1 minute')
  where phase = 'doom' and deadline is not null;
with locked as (
  update public.pitchside_vinson x set prior_restrictions =
    public.pitchside__restrictions_json(p.restrictions) - 'packs' - 'messages'
    from public.pitchside_profiles p
    where x.profile_id = p.id and x.phase = 'locked' and x.prior_restrictions is null
    returning x.profile_id
)
update public.pitchside_profiles p set restrictions =
  public.pitchside__restrictions_json(p.restrictions) ||
  '{"admin":true,"codes":true,"market":true,"sbc":true}'::jsonb
where p.id in (select profile_id from locked);

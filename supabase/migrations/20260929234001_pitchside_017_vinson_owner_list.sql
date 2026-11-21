-- Owner (Sep 29): the owner panel's player list marks Vinson-cursed players (blood red) and only shows
-- "Lift Vinson curse" on them. Adds 'vinsonPhase' (doom | banned | locked, null otherwise) to each row of
-- pitchside_admin_players; the rest of the function is unchanged (patched in place from its current body).
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.pitchside_admin_players(text,text,integer,integer,uuid,text)'::regprocedure);
  if position('vinsonPhase' in d) = 0 then
    d := replace(d, '''squadRating'', ',
      '''vinsonPhase'', (select nullif(xv.phase, ''lifted'') from public.pitchside_vinson xv where xv.profile_id = x.id), ''squadRating'', ');
    if position('vinsonPhase' in d) = 0 then raise exception 'pitchside_admin_players: anchor not found'; end if;
    execute d;
  end if;
end $mig$;

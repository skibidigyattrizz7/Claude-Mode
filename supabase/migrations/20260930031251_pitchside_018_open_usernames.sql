-- 018 (owner, Sep 30): remove username restrictions. Any characters, 1-16 long; only control / invisible characters
-- are refused (they break how names render). No word filter (this also stops guest display names falling back to
-- 'Player'). Uniqueness and the reserved owner name are checked elsewhere and still apply.
-- Mirrored in 3d/js/net/accountcore.js usernameError.
create or replace function public.pitchside__username_error(p_username text)
returns text language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
begin
  if p_username is null or char_length(p_username) not between 1 and 16
     or p_username ~ '[[:cntrl:]​-‏‪-‮⁦-⁩]' then return 'bad_username'; end if;
  return null;
end $$;

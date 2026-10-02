-- VINSON BATTLE FROM THE BAN SCREEN (ChatGPT's request, Sep 30): a player banned by the Vinson curse can start, win and
-- claim the fight straight from the ban screen, without an owner unban first. Real moderation bans stay blocked with the
-- same 'banned' exception pitchside__auth raises. Bodies of battle_start / _win / _claim_rewards are migration 020's with
-- only the auth call swapped.

-- ------------------------------------------------------------------ auth that lets only a Vinson ban through
create or replace function public.pitchside__auth_battle(p_id uuid, p_secret text)
returns public.pitchside_profiles
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles;
begin
  v := public.pitchside__auth_raw(p_id, p_secret);
  if v.id is not null
     and coalesce(v.banned, false) and (v.banned_until is null or v.banned_until > now())
     and coalesce(v.banned_by, '') <> 'vinson'
     and v.ban_reason is distinct from 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON' then
    raise exception 'banned' using errcode = 'P0001', detail = public.pitchside__ban_json(v)::text, hint = 'pitchside_banned';
  end if;
  return v;
end $$;

-- ------------------------------------------------------------------ battle start: issue a one-time nonce
create or replace function public.pitchside_vinson_battle_start(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson; v_nonce text;
begin
  v := public.pitchside__auth_battle(p_id, p_secret);   -- Vinson-banned players may fight from the ban screen
  if v.id is null then return public.pitchside__err('auth'); end if;
  perform 1 from public.pitchside_profiles where id = v.id for update;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if not found then return public.pitchside__err('not_cursed'); end if;
  if x.immune then return public.pitchside__err('already_immune'); end if;
  if x.phase not in ('doom', 'banned', 'released', 'locked') then return public.pitchside__err('not_cursed'); end if;
  if not public.pitchside__throttle('vinsonbs:' || v.id, interval '1 hour', 30) then return public.pitchside__err('rate_limited'); end if;
  v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
  -- starting again simply replaces the previous open nonce
  update public.pitchside_vinson set battle_nonce_hash = public.pitchside__hash(v_nonce), battle_started_at = now(),
    updated_at = now() where profile_id = v.id;
  perform public.pitchside__audit(v.id, 'vinson_battle_start');
  return json_build_object('ok', true, 'nonce', v_nonce, 'minSeconds', 60, 'maxSeconds', 7200, 'serverNow', now());
end $$;

-- ------------------------------------------------------------------ battle win: consume the nonce, lift + immunise
create or replace function public.pitchside_vinson_battle_win(p_id uuid, p_secret text, p_nonce text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson; v_age numeric;
begin
  v := public.pitchside__auth_battle(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  perform 1 from public.pitchside_profiles where id = v.id for update;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if not found then return public.pitchside__err('no_battle'); end if;
  -- idempotent: a repeat (reload, second device, retry after a lost answer) gets the same success and changes nothing
  if x.immune then
    return json_build_object('ok', true, 'immune', true, 'phase', 'lifted', 'battleWon', true,
      'rewardsClaimed', x.rewards_claimed_at is not null);
  end if;
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{32}$' then return public.pitchside__err('bad_nonce'); end if;
  if not public.pitchside__throttle('vinsonbw:' || v.id, interval '1 hour', 60) then return public.pitchside__err('rate_limited'); end if;
  if x.battle_nonce_hash is null or x.battle_started_at is null then return public.pitchside__err('no_battle'); end if;
  if x.battle_nonce_hash <> public.pitchside__hash(p_nonce) then return public.pitchside__err('bad_nonce'); end if;
  v_age := extract(epoch from (now() - x.battle_started_at));
  if v_age > 7200 then
    update public.pitchside_vinson set battle_nonce_hash = null, battle_started_at = null where profile_id = v.id;
    return public.pitchside__err('expired');
  end if;
  -- too fast to be a real fight: refuse but keep the nonce so an honest (slower) win can still land
  if v_age < 60 then
    return json_build_object('ok', false, 'error', 'too_soon', 'retryAfter', ceil(60 - v_age));
  end if;
  perform public.pitchside__vinson_end_curse(v.id);
  update public.pitchside_vinson set immune = true, battle_won_at = now(), battle_nonce_hash = null,
    battle_started_at = null, updated_at = now() where profile_id = v.id;
  perform public.pitchside__audit(v.id, 'vinson_battle_win');
  return json_build_object('ok', true, 'immune', true, 'phase', 'lifted', 'battleWon', true, 'rewardsClaimed', false);
end $$;

-- ------------------------------------------------------------------ rewards: one claim per account, ids only
create or replace function public.pitchside_vinson_claim_rewards(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson; v_first boolean := false;
begin
  v := public.pitchside__auth_battle(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  perform 1 from public.pitchside_profiles where id = v.id for update;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if not found or not x.immune or x.battle_won_at is null then return public.pitchside__err('not_won'); end if;
  if x.rewards_claimed_at is null then
    update public.pitchside_vinson set rewards_claimed_at = now(), updated_at = now() where profile_id = v.id;
    v_first := true;
    perform public.pitchside__audit(v.id, 'vinson_rewards');
  end if;
  -- a repeat returns claimed:false with the same ids, so a device that reloaded mid-claim can reconcile its club
  return json_build_object('ok', true, 'claimed', v_first,
    'cards', json_build_array('vinson_reward_world', 'vinson_reward_phonk', 'vinson_reward_captain'));
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001-019)
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

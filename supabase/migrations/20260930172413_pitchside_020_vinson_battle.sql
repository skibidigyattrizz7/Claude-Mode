-- VINSON BATTLE (owner, Sep 30): a cursed player can fight Vinson in a single-player encounter. Winning ends the
-- curse for good: the account becomes permanently IMMUNE and can collect three reward cards exactly once.
-- Three separate concepts, three separate paths (none of them implies another):
--   moderation unban   pitchside_mod_unban / pitchside_vinson_unban  (owner only)  doom|banned -> released
--   owner lift         pitchside_vinson_lift                          (owner only)  any cursed phase -> lifted
--   earned immunity    pitchside_vinson_battle_start / _win (this file, the player themself)  -> lifted + immune
-- The client is never trusted about the fight itself. It gets a one-time nonce when it starts and must present it back
-- at least 60 s later (and at most 2 h later). Everything is stored on the caller's own pitchside_vinson row, so a
-- nonce can only ever be redeemed by the profile it was issued to. Only a sha256 of the nonce is stored.

alter table public.pitchside_vinson add column if not exists immune boolean not null default false;
alter table public.pitchside_vinson add column if not exists battle_won_at timestamptz;
alter table public.pitchside_vinson add column if not exists rewards_claimed_at timestamptz;
alter table public.pitchside_vinson add column if not exists battle_nonce_hash text;
alter table public.pitchside_vinson add column if not exists battle_started_at timestamptz;
-- immunity is only ever recorded together with the win time; a reward claim needs both.
alter table public.pitchside_vinson drop constraint if exists pitchside_vinson_battle_check;
alter table public.pitchside_vinson add constraint pitchside_vinson_battle_check
  check (immune = (battle_won_at is not null) and (rewards_claimed_at is null or immune));

-- ------------------------------------------------------------------ internal helper (not callable by clients)
-- The owner-lift logic of migration 015 without the owner check: restores the restrictions a locked curse added, clears a
-- Vinson ban, marks the row 'lifted' and the saved club's curse state 'lifted'.
create or replace function public.pitchside__vinson_end_curse(p_id uuid)
returns void language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare target public.pitchside_profiles; x public.pitchside_vinson;
begin
  select * into target from public.pitchside_profiles where id = p_id for update;
  select * into x from public.pitchside_vinson where profile_id = p_id for update;
  if not found then return; end if;
  if x.phase = 'locked' and x.prior_restrictions is not null then
    update public.pitchside_profiles set restrictions =
      (public.pitchside__restrictions_json(restrictions) - 'admin' - 'codes' - 'market' - 'sbc') ||
      x.prior_restrictions where id = target.id;
  end if;
  if target.ban_reason = 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON' then
    update public.pitchside_profiles set banned = false, ban_reason = null, banned_until = null,
      banned_at = null, banned_by = null where id = target.id;
  end if;
  update public.pitchside_vinson set phase = 'lifted', deadline = null, updated_at = now() where profile_id = target.id;
  update public.pitchside_saves set data = jsonb_set(data, '{vinson}',
    '{"phase":"lifted","doomUntil":0,"phaseUntil":0,"pin":null}'::jsonb, true),
    rev = rev + 1, updated_at = now()
    where profile_id = target.id and data #>> '{vinson,phase}' is distinct from 'lifted';
end $$;

-- ------------------------------------------------------------------ battle start: issue a one-time nonce
create or replace function public.pitchside_vinson_battle_start(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson; v_nonce text;
begin
  v := public.pitchside__auth(p_id, p_secret);   -- a banned (doom expired) player must be unbanned first
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
  v := public.pitchside__auth(p_id, p_secret);
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
  v := public.pitchside__auth(p_id, p_secret);
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

-- ------------------------------------------------------------------ curse entry point: immune profiles are skipped
-- Same body as migration 013 plus the immunity check (before the ban / throttle checks and again under the row lock).
create or replace function public.pitchside_vinson_pull(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson;
begin
  v := public.pitchside__auth_raw(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.role = 'owner' then return json_build_object('ok', true, 'exempt', true); end if;
  if exists (select 1 from public.pitchside_vinson i where i.profile_id = v.id and i.immune) then
    return json_build_object('ok', true, 'immune', true, 'phase', 'lifted', 'deadline', null);
  end if;
  if public.pitchside__is_banned(v) then return public.pitchside__err('banned'); end if;
  if not public.pitchside__throttle('vinson:' || v.id, interval '1 hour', 10) then return public.pitchside__err('rate_limited'); end if;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if found and x.immune then
    return json_build_object('ok', true, 'immune', true, 'phase', 'lifted', 'deadline', null);
  end if;
  if found and x.phase in ('doom', 'locked', 'lifted') then
    return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline);
  end if;
  insert into public.pitchside_vinson (profile_id, phase, deadline)
    values (v.id, 'doom', now() + interval '1 minute')
    on conflict (profile_id) do update set phase = 'doom', deadline = excluded.deadline,
      prior_restrictions = null, updated_at = now() returning * into x;
  perform public.pitchside__audit(v.id, 'vinson_pull');
  return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline);
end $$;

-- ------------------------------------------------------------------ status: body of 015 plus immune / battleWon / rewardsClaimed
create or replace function public.pitchside_vinson_status(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; x public.pitchside_vinson;
begin
  v := public.pitchside__auth_raw(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if v.role = 'owner' then
    return json_build_object('ok', true, 'exempt', true, 'phase', null, 'immune', false, 'battleWon', false,
      'rewardsClaimed', false, 'serverNow', now());
  end if;
  perform 1 from public.pitchside_profiles where id = v.id for update;
  select * into x from public.pitchside_vinson where profile_id = v.id for update;
  if not found and exists (select 1 from public.pitchside_saves s where s.profile_id = v.id
      and s.data #>> '{vinson,phase}' = 'locked') then
    insert into public.pitchside_vinson (profile_id, phase, prior_restrictions)
      values (v.id, 'locked', public.pitchside__restrictions_json(v.restrictions) - 'packs' - 'messages')
      on conflict (profile_id) do nothing;
    select * into x from public.pitchside_vinson where profile_id = v.id for update;
    if x.phase = 'locked' then
      update public.pitchside_profiles set restrictions = public.pitchside__restrictions_json(restrictions) ||
        '{"admin":true,"codes":true,"market":true,"sbc":true}'::jsonb where id = v.id returning * into v;
    end if;
  end if;
  if x.profile_id is null then
    return json_build_object('ok', true, 'phase', null, 'immune', false, 'battleWon', false,
      'rewardsClaimed', false, 'serverNow', now());
  end if;
  if x.phase = 'doom' and x.deadline <= now() then
    update public.pitchside_vinson set phase = 'banned', updated_at = now() where profile_id = v.id returning * into x;
    update public.pitchside_profiles set banned = true, ban_reason = 'YOU''VE BEEN STRUCK BY THE WRATH OF VINSON',
      banned_until = null, banned_at = now(), banned_by = 'vinson' where id = v.id returning * into v;
    perform public.pitchside__audit(v.id, 'vinson_ban');
  end if;
  return json_build_object('ok', true, 'phase', x.phase, 'deadline', x.deadline,
    'immune', x.immune, 'battleWon', x.battle_won_at is not null, 'rewardsClaimed', x.rewards_claimed_at is not null,
    'restrictions', public.pitchside__restrictions_json(v.restrictions), 'serverNow', now());
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

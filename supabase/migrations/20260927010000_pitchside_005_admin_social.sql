-- =====================================================================================
-- Pitchside 3D — migration 005 (run AFTER 001-004). Idempotent: safe to run more than once.
--   * Gifts: Card Creator cards travel with their photo (data URL, <= 200 000 chars; the rest of the card
--     stays <= 4000 bytes), optional expiry per gift (p_minutes), owner list / cancel / clear-all of
--     pending gifts.
-- Same security model as 001-004: RLS on, no table grants, SECURITY DEFINER RPCs with a fixed
-- search_path, owner powers = full/super code (or token) or an owner account; every action audited.
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Functions (re)created here with a new signature: drop every overload first.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array[
       'pitchside__gift_card', 'pitchside_admin_gift', 'pitchside_admin_gifts', 'pitchside_admin_cancel_gift',
       'pitchside_admin_clear_gifts'])
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

-- ------------------------------------------------------------------ gifts: photos, expiry, cancel
alter table public.pitchside_gifts add column if not exists cancelled_at timestamptz;
alter table public.pitchside_gifts drop constraint if exists pitchside_gifts_payload_chk;
alter table public.pitchside_gifts add constraint pitchside_gifts_payload_chk
  check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144);
create index if not exists pitchside_gifts_pending on public.pitchside_gifts (expires_at desc);

-- Card gifts are always tradable. OVR above 99 (admin cards) needs the super code. A Card Creator photo
-- ('photo': data:image/png|jpeg|webp;base64,...) is allowed on top of the 4000-byte card.
create or replace function public.pitchside__gift_card(p_card jsonb, p_super boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare v_ovr numeric; v_photo text;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' then return null; end if;
  if p_card ? 'photo' and jsonb_typeof(p_card -> 'photo') <> 'null' then
    if jsonb_typeof(p_card -> 'photo') <> 'string' then return null; end if;
    v_photo := p_card ->> 'photo';
    if char_length(v_photo) > 200000 or v_photo !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$' then return null; end if;
  end if;
  if octet_length((p_card - 'photo')::text) > 4000 then return null; end if;
  if jsonb_typeof(p_card -> 'id') <> 'string' or (p_card ->> 'id') !~ '^[A-Za-z0-9_.:-]{1,40}$' then return null; end if;
  if jsonb_typeof(p_card -> 'name') <> 'string' or char_length(p_card ->> 'name') not between 1 and 32 then return null; end if;
  if jsonb_typeof(p_card -> 'ovr') <> 'number' then return null; end if;
  v_ovr := (p_card ->> 'ovr')::numeric;
  if v_ovr <> trunc(v_ovr) or v_ovr < 1 or v_ovr > (case when p_super then 999 else 99 end) then return null; end if;
  if p_card ? 'pos' and (jsonb_typeof(p_card -> 'pos') <> 'string' or (p_card ->> 'pos') !~ '^[A-Z]{2,4}$') then return null; end if;
  return (p_card - 'untradable' - 'photo') || '{"tradable": true}'::jsonb
    || case when v_photo is not null then jsonb_build_object('photo', v_photo) else '{}'::jsonb end;
end $$;

-- 003's admin_gift + p_minutes: how long the gift can be claimed (1 minute .. 90 days, default 14 days).
create or replace function public.pitchside_admin_gift(p_code text, p_to uuid, p_all boolean, p_kind text, p_coins bigint,
  p_payload jsonb, p_message text default null, p_key text default null, p_id uuid default null, p_secret text default null,
  p_minutes int default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_prev jsonb; v_payload jsonb := '{}'::jsonb; v_card jsonb; v_gid uuid; v_res jsonb; v_count numeric;
  v public.pitchside_profiles; v_until timestamptz;
begin
  if not public.pitchside__op_key_ok(p_key) then return public.pitchside__err('bad_key'); end if;
  if p_key is not null then
    select result into v_prev from public.pitchside_admin_ops where op_key = 'gift:' || p_key;
    if found then return (v_prev || jsonb_build_object('replay', true))::json; end if;
  end if;
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if coalesce(p_all, false) = (p_to is not null) then return public.pitchside__err('bad_target'); end if;
  if p_minutes is not null and p_minutes not between 1 and 129600 then return public.pitchside__err('bad_value'); end if;
  v_until := now() + coalesce(make_interval(mins => p_minutes), interval '14 days');
  if p_to is not null then
    select * into v from public.pitchside_profiles where id = p_to;
    if not found then return public.pitchside__err('not_found'); end if;
  end if;
  if p_kind = 'coins' then
    if p_coins is null or p_coins not between 1 and 1000000000 then return public.pitchside__err('bad_amount'); end if;
  elsif p_kind = 'pack' then
    if p_payload is null or jsonb_typeof(p_payload -> 'packId') <> 'string' or (p_payload ->> 'packId') !~ '^[A-Za-z0-9_-]{1,32}$' then
      return public.pitchside__err('bad_pack');
    end if;
    v_count := case when jsonb_typeof(p_payload -> 'count') = 'number' then (p_payload ->> 'count')::numeric else 1 end;
    if v_count <> trunc(v_count) or v_count not between 1 and 50 then return public.pitchside__err('bad_pack'); end if;
    v_payload := jsonb_build_object('packId', p_payload ->> 'packId', 'count', v_count::int);
  elsif p_kind = 'card' then
    v_card := public.pitchside__gift_card(p_payload -> 'card', v_actor = 'super');
    if v_card is null then return public.pitchside__err(case when v_actor <> 'super' and jsonb_typeof(p_payload -> 'card' -> 'ovr') = 'number'
      and (p_payload -> 'card' ->> 'ovr')::numeric > 99 then 'needs_super' else 'bad_card' end); end if;
    v_payload := jsonb_build_object('card', v_card);
  else
    return public.pitchside__err('bad_kind');
  end if;
  if not public.pitchside__throttle('gift:' || v_actor || ':' || coalesce(p_id::text, public.pitchside__client_key()), interval '1 hour', 300) then
    return public.pitchside__err('rate_limited');
  end if;
  insert into public.pitchside_gifts (to_id, kind, coins, payload, message, created_by, expires_at)
  values (p_to, p_kind, case when p_kind = 'coins' then p_coins else 0 end, v_payload,
          nullif(public.pitchside__clean_text(p_message, 200), ''), v_actor, v_until)
  returning id into v_gid;
  v_res := jsonb_build_object('ok', true, 'giftId', v_gid, 'until', v_until);
  if p_key is not null then
    insert into public.pitchside_admin_ops (op_key, result) values ('gift:' || p_key, v_res) on conflict do nothing;
  end if;
  if random() < 0.01 then delete from public.pitchside_gifts where expires_at < now() - interval '30 days'; end if;
  perform public.pitchside__audit(p_to, 'admin_gift', jsonb_build_object('gift', v_gid, 'kind', p_kind, 'all', p_to is null,
    'coins', p_coins, 'until', v_until, 'payload', v_payload - 'card' || case when v_card is not null then
      jsonb_build_object('card', jsonb_build_object('id', v_card ->> 'id', 'name', v_card ->> 'name', 'ovr', v_card -> 'ovr')) else '{}'::jsonb end)
    || public.pitchside__mod_by(v_actor, p_id));
  return v_res::json;
end $$;

-- Owner: pending (unexpired, not cancelled) gifts, newest first. -> { ok, items:[{ id, kind, coins, packId, count,
-- card:{id,name,ovr}, message, all, to:{ id, username, name }, claims, at, until }] }
create or replace function public.pitchside_admin_gifts(p_code text, p_id uuid default null, p_secret text default null, p_limit int default 100)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_items json;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  select coalesce(json_agg(x.j order by x.created_at desc), '[]'::json) into v_items from (
    select g.created_at, json_build_object('id', g.id, 'kind', g.kind, 'coins', g.coins, 'packId', g.payload ->> 'packId',
      'count', (g.payload ->> 'count')::int,
      'card', case when g.payload ? 'card' then json_build_object('id', g.payload -> 'card' ->> 'id', 'name', g.payload -> 'card' ->> 'name',
        'ovr', g.payload -> 'card' -> 'ovr') end,
      'message', g.message, 'all', g.to_id is null,
      'to', case when g.to_id is not null then json_build_object('id', p.id, 'username', p.username, 'name', coalesce(p.username, p.name)) end,
      'claims', (select count(*) from public.pitchside_gift_claims c where c.gift_id = g.id),
      'at', g.created_at, 'until', g.expires_at) as j
      from public.pitchside_gifts g left join public.pitchside_profiles p on p.id = g.to_id
     where g.expires_at > now() and g.cancelled_at is null
       and (g.to_id is null or not exists (select 1 from public.pitchside_gift_claims c where c.gift_id = g.id))
     order by g.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) x;
  return json_build_object('ok', true, 'items', v_items);
end $$;

-- Owner: cancel one pending gift (it can no longer be claimed). -> { ok }
create or replace function public.pitchside_admin_cancel_gift(p_code text, p_gift uuid, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; g public.pitchside_gifts;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  update public.pitchside_gifts set expires_at = least(expires_at, now()), cancelled_at = now()
   where id = p_gift and cancelled_at is null returning * into g;
  if g.id is null then return public.pitchside__err('not_found'); end if;
  perform public.pitchside__audit(g.to_id, 'admin_gift_cancel', jsonb_build_object('gift', g.id, 'kind', g.kind) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true);
end $$;

-- Owner: cancel every pending gift at once. -> { ok, cancelled }
create or replace function public.pitchside_admin_clear_gifts(p_code text, p_id uuid default null, p_secret text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text; v_n int;
begin
  v_actor := public.pitchside__actor(p_code, p_id, p_secret);
  if not public.pitchside__owner_power(v_actor) then return public.pitchside__err(case when v_actor = 'mod' then 'not_allowed' else 'not_admin' end); end if;
  if not public.pitchside__throttle('gift_clear', interval '1 hour', 30) then return public.pitchside__err('rate_limited'); end if;
  update public.pitchside_gifts set expires_at = now(), cancelled_at = now() where expires_at > now() and cancelled_at is null;
  get diagnostics v_n = row_count;
  perform public.pitchside__audit(p_id, 'admin_gift_clear', jsonb_build_object('cancelled', v_n) || public.pitchside__mod_by(v_actor, p_id));
  return json_build_object('ok', true, 'cancelled', v_n);
end $$;

-- ------------------------------------------------------------------ function privileges (same rule as 001-004)
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

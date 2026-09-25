-- =====================================================================================
-- Pitchside 3D — online backend (profiles, coins, transfer market, matchmaking, admin)
-- Migration 001. Idempotent: safe to run more than once.
--
-- Security model (no Supabase Auth):
--   * A device identity = (player_id uuid, secret). The secret is 32 random bytes (64 hex
--     chars) generated in the browser and kept in localStorage. The server stores only
--     sha256(secret) — the secret has 256 bits of entropy, so a fast hash is sufficient.
--   * Every table has RLS enabled and anon/authenticated have NO insert/update/delete
--     rights. The only direct read is a column-restricted SELECT on active market listings.
--   * All writes go through SECURITY DEFINER functions that validate (player_id, secret)
--     on every call. No dynamic SQL is used anywhere.
--   * The admin code is stored only as a bcrypt hash in pitchside_admin (row inserted
--     privately by the project owner — see supabase/README.md). This file inserts no row.
--
-- Contents: profiles + coins, transfer market, matchmaking queue (friendly / ut / rivals),
-- Rivals (weekly ranked UT divisions), friends list + match invites, admin check, throttles.
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ tables
create table if not exists public.pitchside_profiles (
  id                  uuid primary key default gen_random_uuid(),
  secret_hash         text not null,
  name                text not null default 'Player',
  coins               bigint not null default 5000,
  rating              int not null default 1000,
  division            int not null default 8,
  wins                int not null default 0,
  draws               int not null default 0,
  losses              int not null default 0,
  created_at          timestamptz not null default now(),
  last_reward_at      timestamptz,
  reward_window_start timestamptz,
  reward_window_count int not null default 0,
  reward_window_coins bigint not null default 0,
  constraint pitchside_profiles_coins_nonneg check (coins >= 0),
  constraint pitchside_profiles_name_len check (char_length(name) between 1 and 16),
  constraint pitchside_profiles_rating_rng check (rating between 100 and 3000),
  constraint pitchside_profiles_division_rng check (division between 1 and 10),
  constraint pitchside_profiles_secret_fmt check (secret_hash ~ '^[0-9a-f]{64}$')
);
create unique index if not exists pitchside_profiles_secret_hash_key on public.pitchside_profiles (secret_hash);
-- friends: shareable code + presence
alter table public.pitchside_profiles add column if not exists friend_code  text;
alter table public.pitchside_profiles add column if not exists last_seen_at timestamptz;
-- rivals: division 10 (lowest) .. 1, 0 = Elite; points carry within a division; weekly (ISO week) stats
alter table public.pitchside_profiles add column if not exists rivals_division      int not null default 10;
alter table public.pitchside_profiles add column if not exists rivals_points        int not null default 0;
alter table public.pitchside_profiles add column if not exists rivals_week          text;
alter table public.pitchside_profiles add column if not exists rivals_week_wins     int not null default 0;
alter table public.pitchside_profiles add column if not exists rivals_week_matches  int not null default 0;
alter table public.pitchside_profiles add column if not exists rivals_peak          int not null default 10;
alter table public.pitchside_profiles add column if not exists rivals_prev_week     text;
alter table public.pitchside_profiles add column if not exists rivals_prev_peak     int;
alter table public.pitchside_profiles add column if not exists rivals_prev_wins     int;
alter table public.pitchside_profiles add column if not exists rivals_claimed_week  text;
create unique index if not exists pitchside_profiles_friend_code_key on public.pitchside_profiles (friend_code);
alter table public.pitchside_profiles drop constraint if exists pitchside_profiles_rivals_rng;
alter table public.pitchside_profiles add constraint pitchside_profiles_rivals_rng
  check (rivals_division between 0 and 10 and rivals_points >= 0 and rivals_peak between 0 and 10);

create table if not exists public.pitchside_listings (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references public.pitchside_profiles(id) on delete cascade,
  card          jsonb not null,
  ovr           int not null,
  pos           text not null,
  rarity        text not null,
  name          text not null,
  price         bigint not null,
  seller_credit bigint not null,
  status        text not null default 'active',
  buyer_id      uuid references public.pitchside_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  sold_at       timestamptz,
  claimed       boolean not null default false,
  constraint pitchside_listings_price_rng check (price between 150 and 15000000),
  constraint pitchside_listings_credit_rng check (seller_credit between 0 and price),
  constraint pitchside_listings_status_chk check (status in ('active', 'sold', 'cancelled', 'expired')),
  constraint pitchside_listings_card_obj check (jsonb_typeof(card) = 'object'),
  constraint pitchside_listings_card_size check (octet_length(card::text) <= 4096),
  constraint pitchside_listings_ovr_rng check (ovr between 1 and 99),
  constraint pitchside_listings_not_self check (buyer_id is null or buyer_id <> seller_id)
);
create index if not exists pitchside_listings_active_newest on public.pitchside_listings (created_at desc) where status = 'active';
create index if not exists pitchside_listings_active_price  on public.pitchside_listings (price) where status = 'active';
create index if not exists pitchside_listings_active_pos    on public.pitchside_listings (pos, ovr desc) where status = 'active';
create index if not exists pitchside_listings_seller        on public.pitchside_listings (seller_id, status);
create index if not exists pitchside_listings_unclaimed     on public.pitchside_listings (seller_id) where status = 'sold' and not claimed;
-- the same card cannot be on the market twice at once for one seller
create unique index if not exists pitchside_listings_active_card on public.pitchside_listings (seller_id, (card->>'id')) where status = 'active';

create table if not exists public.pitchside_queue (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.pitchside_profiles(id) on delete cascade,
  mode          text not null,
  peer_id       text not null,
  rating        int not null,
  name          text not null,
  created_at    timestamptz not null default now(),
  last_poll_at  timestamptz not null default now(),
  matched_with  uuid,
  matched_at    timestamptz,
  host          boolean not null default false,
  match_token   text,
  opp_player_id uuid,
  opp_peer_id   text,
  opp_rating    int,
  opp_name      text,
  reported      boolean not null default false,
  constraint pitchside_queue_peer_fmt check (peer_id ~ '^[A-Za-z0-9_-]{8,64}$')
);
alter table public.pitchside_queue add column if not exists division int;
alter table public.pitchside_queue drop constraint if exists pitchside_queue_mode_chk;
alter table public.pitchside_queue add constraint pitchside_queue_mode_chk check (mode in ('friendly', 'ut', 'rivals'));
create index if not exists pitchside_queue_waiting on public.pitchside_queue (mode, created_at) where matched_with is null;
create index if not exists pitchside_queue_player  on public.pitchside_queue (player_id, matched_at desc);

-- Friendships are stored once per pair (a < b). status: pending (requested_by asked) / accepted / blocked (by blocked_by).
create table if not exists public.pitchside_friends (
  a            uuid not null references public.pitchside_profiles(id) on delete cascade,
  b            uuid not null references public.pitchside_profiles(id) on delete cascade,
  status       text not null,
  requested_by uuid not null,
  blocked_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (a, b),
  constraint pitchside_friends_order check (a < b),
  constraint pitchside_friends_status_chk check (status in ('pending', 'accepted', 'blocked')),
  constraint pitchside_friends_req_chk check (requested_by in (a, b) and (blocked_by is null or blocked_by in (a, b)))
);
create index if not exists pitchside_friends_b on public.pitchside_friends (b);

-- Match invites between friends. Live for 60 s. The inviter's peer id is only revealed to the invitee on accept.
create table if not exists public.pitchside_invites (
  id           uuid primary key default gen_random_uuid(),
  from_id      uuid not null references public.pitchside_profiles(id) on delete cascade,
  to_id        uuid not null references public.pitchside_profiles(id) on delete cascade,
  mode         text not null,
  peer_id      text not null,
  token        text not null,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint pitchside_invites_mode_chk check (mode in ('friendly', 'ut')),
  constraint pitchside_invites_peer_fmt check (peer_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  constraint pitchside_invites_status_chk check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  constraint pitchside_invites_not_self check (from_id <> to_id)
);
create index if not exists pitchside_invites_to   on public.pitchside_invites (to_id, created_at desc) where status = 'pending';
create index if not exists pitchside_invites_from on public.pitchside_invites (from_id, created_at desc);

-- Admin code hash. Exactly one row (id = 1), inserted privately by the owner. Never readable by clients.
create table if not exists public.pitchside_admin (
  id        int primary key default 1,
  code_hash text not null,
  constraint pitchside_admin_single check (id = 1)
);

-- Fixed-window counters used for rate limits (registration, rewards, admin failures, ...).
create table if not exists public.pitchside_throttle (
  bucket       text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, window_start)
);

-- ------------------------------------------------------------------ RLS + table privileges
alter table public.pitchside_profiles enable row level security;
alter table public.pitchside_listings enable row level security;
alter table public.pitchside_queue    enable row level security;
alter table public.pitchside_admin    enable row level security;
alter table public.pitchside_throttle enable row level security;
alter table public.pitchside_friends  enable row level security;
alter table public.pitchside_invites  enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_profiles, public.pitchside_listings, public.pitchside_queue, public.pitchside_admin, public.pitchside_throttle, public.pitchside_friends, public.pitchside_invites from %I', r);
      -- the one safe direct read: active listings, without seller/buyer ids or credits
      execute format('grant select (id, card, ovr, pos, rarity, name, price, status, created_at) on public.pitchside_listings to %I', r);
    end if;
  end loop;
end $$;
revoke all on table public.pitchside_profiles, public.pitchside_listings, public.pitchside_queue, public.pitchside_admin, public.pitchside_throttle, public.pitchside_friends, public.pitchside_invites from public;

drop policy if exists pitchside_listings_read_active on public.pitchside_listings;
create policy pitchside_listings_read_active on public.pitchside_listings
  for select using (status = 'active' and created_at > now() - interval '72 hours');
-- (no insert/update/delete policies on any table: with RLS enabled that means "deny")

-- ------------------------------------------------------------------ internal helpers (not callable by clients)
create or replace function public.pitchside__hash(p_secret text)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $$ select encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex') $$;

-- Returns the caller's profile row, or a row of NULLs when (id, secret) do not match.
create or replace function public.pitchside__auth(p_id uuid, p_secret text)
returns public.pitchside_profiles
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles;
begin
  if p_id is null or p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then return v; end if;
  select * into v from public.pitchside_profiles where id = p_id;
  if not found or v.secret_hash <> public.pitchside__hash(p_secret) then
    v := null;
  end if;
  return v;
end $$;

-- Fixed-window rate limit. Returns true when the hit is allowed (and counts it).
create or replace function public.pitchside__throttle(p_bucket text, p_window interval, p_max int)
returns boolean language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_ws timestamptz := date_bin(p_window, now(), timestamptz '2000-01-01 00:00:00+00'); v_hits int;
begin
  insert into public.pitchside_throttle as t (bucket, window_start, hits) values (p_bucket, v_ws, 1)
  on conflict (bucket, window_start) do update set hits = t.hits + 1
  returning t.hits into v_hits;
  if random() < 0.01 then
    delete from public.pitchside_throttle where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_max;
end $$;

-- Best-effort client IP (PostgREST exposes request headers as a GUC), hashed before storage.
create or replace function public.pitchside__client_key()
returns text language plpgsql stable
set search_path = public, extensions, pg_temp
as $$
declare h json; ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null;
  end;
  if h is not null then
    ip := coalesce(nullif(btrim(h->>'cf-connecting-ip'), ''),
                   nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
                   nullif(btrim(h->>'x-real-ip'), ''));
  end if;
  return left(public.pitchside__hash(coalesce(ip, 'unknown')), 32);
end $$;

create or replace function public.pitchside__clean_name(p_name text)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(nullif(btrim(left(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')), 16)), ''), 'Player')
$$;

create or replace function public.pitchside__division(p_rating int)
returns int language sql immutable
set search_path = public, extensions, pg_temp
as $$ select greatest(1, least(10, 10 - (p_rating - 800) / 100)) $$;

-- Admin code check with a global failure throttle (>= 20 failures in the current minute -> false, no check).
create or replace function public.pitchside__admin_check(p_code text)
returns boolean language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_ws timestamptz := date_trunc('minute', now()); v_fail int; v_hash text; v_ok boolean;
begin
  select hits into v_fail from public.pitchside_throttle where bucket = 'admin_fail' and window_start = v_ws;
  if coalesce(v_fail, 0) >= 20 then return false; end if;
  select code_hash into v_hash from public.pitchside_admin where id = 1;
  v_ok := p_code is not null and char_length(p_code) between 1 and 128 and v_hash is not null
          and extensions.crypt(p_code, v_hash) = v_hash;
  if not v_ok then
    insert into public.pitchside_throttle as t (bucket, window_start, hits) values ('admin_fail', v_ws, 1)
    on conflict (bucket, window_start) do update set hits = t.hits + 1;
  end if;
  return v_ok;
end $$;

-- 8-char friend code from an unambiguous alphabet; unique.
create or replace function public.pitchside__new_friend_code()
returns text language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_code text; v_bytes bytea; i int;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.pitchside_profiles where friend_code = v_code);
  end loop;
  return v_code;
end $$;

create or replace function public.pitchside__friend_code_trg()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.friend_code is null then new.friend_code := public.pitchside__new_friend_code(); end if;
  return new;
end $$;
drop trigger if exists pitchside_profiles_friend_code on public.pitchside_profiles;
create trigger pitchside_profiles_friend_code before insert on public.pitchside_profiles
  for each row execute function public.pitchside__friend_code_trg();
update public.pitchside_profiles set friend_code = public.pitchside__new_friend_code() where friend_code is null;

create or replace function public.pitchside__iso_week()
returns text language sql stable
set search_path = public, extensions, pg_temp
as $$ select to_char(now() at time zone 'utc', 'IYYY-"W"IW') $$;

-- points needed to leave a rivals division (null = Elite, the top)
create or replace function public.pitchside__rivals_threshold(p_div int)
returns int language sql immutable
set search_path = public, extensions, pg_temp
as $$ select case p_div when 10 then 10 when 9 then 10 when 8 then 11 when 7 then 12 when 6 then 12
                        when 5 then 13 when 4 then 13 when 3 then 14 when 2 then 15 when 1 then 15 else null end $$;

-- weekly reward from the peak division reached that week (0 = Elite) and the number of wins
create or replace function public.pitchside__rivals_reward(p_peak int, p_wins int)
returns json language sql immutable
set search_path = public, extensions, pg_temp
as $$
  select json_build_object(
    'coins', (case p_peak when 0 then 25000 when 1 then 15000 when 2 then 12000 when 3 then 10000 when 4 then 8000
              when 5 then 6500 when 6 then 5000 when 7 then 4000 when 8 then 3000 when 9 then 2000 else 1500 end)
             + 300 * least(greatest(coalesce(p_wins, 0), 0), 20),
    'packs', (select coalesce(json_agg(x), '[]'::json) from unnest(
              case when p_peak = 0 then array['stars', 'rare', 'premium']
                   when p_peak <= 2 then array['rare', 'premium']
                   when p_peak <= 5 then array['premium', 'gold']
                   when p_peak <= 8 then array['gold']
                   else array['silver'] end
              || case when coalesce(p_wins, 0) >= 10 then array['rare'] else array[]::text[] end
              || case when coalesce(p_wins, 0) >= 20 then array['stars'] else array[]::text[] end) x))
$$;

-- move a finished week into the claimable slot and start the current week
create or replace function public.pitchside__rivals_rollover(p_id uuid)
returns void language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_week text := public.pitchside__iso_week();
begin
  update public.pitchside_profiles set
    rivals_prev_week = case when rivals_week is not null and rivals_week_matches > 0 then rivals_week else rivals_prev_week end,
    rivals_prev_peak = case when rivals_week is not null and rivals_week_matches > 0 then rivals_peak else rivals_prev_peak end,
    rivals_prev_wins = case when rivals_week is not null and rivals_week_matches > 0 then rivals_week_wins else rivals_prev_wins end,
    rivals_week = v_week, rivals_week_wins = 0, rivals_week_matches = 0, rivals_peak = rivals_division
  where id = p_id and rivals_week is distinct from v_week;
end $$;

create or replace function public.pitchside__err(p_code text)
returns json language sql immutable
set search_path = public, extensions, pg_temp
as $$ select json_build_object('ok', false, 'error', p_code) $$;

-- ------------------------------------------------------------------ public RPCs: profile
create or replace function public.pitchside_ping()
returns boolean language sql stable
set search_path = public, extensions, pg_temp
as $$ select true $$;

create or replace function public.pitchside_register(p_secret text, p_name text)
returns uuid language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_id uuid; v_hash text;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid secret' using errcode = '22023';
  end if;
  v_hash := public.pitchside__hash(p_secret);
  -- idempotent: re-registering the same secret returns the same profile
  select id into v_id from public.pitchside_profiles where secret_hash = v_hash;
  if found then return v_id; end if;
  if not public.pitchside__throttle('reg_ip:' || public.pitchside__client_key(), interval '1 hour', 20)
     or not public.pitchside__throttle('reg_all', interval '1 hour', 300) then
    raise exception 'rate limited' using errcode = 'P0001';
  end if;
  insert into public.pitchside_profiles (secret_hash, name)
  values (v_hash, public.pitchside__clean_name(p_name))
  on conflict (secret_hash) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.pitchside_profiles where secret_hash = v_hash;
  end if;
  return v_id;
end $$;

create or replace function public.pitchside_get_profile(p_id uuid, p_secret text)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_unclaimed bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select coalesce(sum(seller_credit), 0) into v_unclaimed from public.pitchside_listings
   where seller_id = v.id and status = 'sold' and not claimed;
  return json_build_object('ok', true, 'id', v.id, 'name', v.name, 'coins', v.coins, 'rating', v.rating,
    'division', v.division, 'wins', v.wins, 'draws', v.draws, 'losses', v.losses, 'unclaimed', v_unclaimed,
    'friendCode', v.friend_code, 'rivalsDivision', v.rivals_division);
end $$;

create or replace function public.pitchside_set_name(p_id uuid, p_secret text, p_name text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_name text := public.pitchside__clean_name(p_name);
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if not public.pitchside__throttle('name:' || v.id, interval '1 hour', 20) then return public.pitchside__err('rate_limited'); end if;
  update public.pitchside_profiles set name = v_name where id = v.id;
  return json_build_object('ok', true, 'name', v_name);
end $$;

-- ------------------------------------------------------------------ coins
-- Result reward: win 800 / draw 400 / loss 200, at most 12 rewarded results per hour and one per 60 s.
-- Rating: Elo-lite. The opponent rating comes from the caller's latest unreported matchmade game
-- (server-side record); otherwise E = 0.5 with a smaller K.
create or replace function public.pitchside_report_result(p_id uuid, p_secret text, p_mode text,
  p_won boolean, p_drawn boolean, p_gf int, p_ga int)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.pitchside_profiles;
  q public.pitchside_queue;
  v_ws timestamptz := date_bin(interval '1 hour', now(), timestamptz '2000-01-01 00:00:00+00');
  v_count int; v_coins bigint; v_opp int; v_k numeric; v_exp numeric; v_score numeric; v_delta int; v_rating int; v_old int;
  v_matched boolean := false; v_rivals json := null; v_div int; v_pts int; v_thr int; v_promoted boolean := false;
begin
  if p_mode is null or p_mode not in ('friendly', 'ut', 'rivals', 'offline') then return public.pitchside__err('bad_mode'); end if;
  if coalesce(p_won, false) and coalesce(p_drawn, false) then return public.pitchside__err('bad_result'); end if;
  if p_gf is null or p_ga is null or p_gf not between 0 and 50 or p_ga not between 0 and 50 then return public.pitchside__err('bad_score'); end if;
  if v_ws is null then return public.pitchside__err('clock'); end if;
  -- lock the profile row: serialises concurrent reports by the same player
  select * into v from public.pitchside_profiles where id = p_id for update;
  if not found or p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or v.secret_hash <> public.pitchside__hash(p_secret) then
    return public.pitchside__err('auth');
  end if;
  v_count := case when v.reward_window_start = v_ws then v.reward_window_count else 0 end;
  if v_count >= 12 or (v.last_reward_at is not null and v.last_reward_at > now() - interval '60 seconds') then
    return json_build_object('ok', true, 'capped', true, 'coinsAwarded', 0, 'coins', v.coins, 'rating', v.rating,
      'ratingDelta', 0, 'division', v.division);
  end if;
  v_old := v.rating;
  v_coins := case when p_won then 800 when p_drawn then 400 else 200 end;
  v_score := case when p_won then 1 when p_drawn then 0.5 else 0 end;
  v_opp := v.rating; v_k := 16;
  if p_mode in ('friendly', 'ut', 'rivals') then
    select * into q from public.pitchside_queue
     where player_id = v.id and matched_with is not null and not reported and mode = p_mode
       and matched_at > now() - interval '3 hours'
     order by matched_at desc limit 1 for update;
    if found then
      update public.pitchside_queue set reported = true where id = q.id;
      v_opp := coalesce(q.opp_rating, v.rating); v_k := 32; v_matched := true;
    end if;
  end if;
  if p_mode = 'offline' then v_k := 0; end if;
  v_exp := 1.0 / (1.0 + power(10.0, (v_opp - v.rating) / 400.0));
  v_delta := round(v_k * (v_score - v_exp));
  v_rating := greatest(100, least(3000, v.rating + v_delta));
  update public.pitchside_profiles set
    coins = coins + v_coins,
    rating = v_rating,
    division = public.pitchside__division(v_rating),
    wins = wins + case when p_won then 1 else 0 end,
    draws = draws + case when p_drawn then 1 else 0 end,
    losses = losses + case when not coalesce(p_won, false) and not coalesce(p_drawn, false) then 1 else 0 end,
    last_reward_at = now(),
    reward_window_start = v_ws,
    reward_window_count = v_count + 1,
    reward_window_coins = case when v.reward_window_start = v_ws then reward_window_coins else 0 end + v_coins
  where id = v.id
  returning * into v;
  -- Rivals progress only for matchmade rivals games (server-side queue record)
  if p_mode = 'rivals' and v_matched then
    perform public.pitchside__rivals_rollover(v.id);
    select * into v from public.pitchside_profiles where id = v.id;
    v_div := v.rivals_division;
    v_pts := v.rivals_points + case when p_won then 3 when p_drawn then 1 else 0 end;
    loop
      v_thr := public.pitchside__rivals_threshold(v_div);
      exit when v_thr is null or v_pts < v_thr;
      v_pts := v_pts - v_thr; v_div := v_div - 1; v_promoted := true;
    end loop;
    update public.pitchside_profiles set
      rivals_division = v_div, rivals_points = v_pts, rivals_peak = least(rivals_peak, v_div),
      rivals_week_wins = rivals_week_wins + case when p_won then 1 else 0 end,
      rivals_week_matches = rivals_week_matches + 1
    where id = v.id returning * into v;
    v_rivals := json_build_object('division', v.rivals_division, 'points', v.rivals_points,
      'threshold', public.pitchside__rivals_threshold(v.rivals_division), 'promoted', v_promoted, 'weekWins', v.rivals_week_wins);
  end if;
  return json_build_object('ok', true, 'capped', false, 'coinsAwarded', v_coins, 'coins', v.coins,
    'rating', v.rating, 'ratingDelta', v.rating - v_old, 'division', v.division, 'rivals', v_rivals);
end $$;

-- Spending online coins (e.g. packs bought with the online balance). Positive amounts only.
create or replace function public.pitchside_spend_coins(p_id uuid, p_secret text, p_amount bigint, p_reason text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_bal bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then return public.pitchside__err('bad_amount'); end if;
  update public.pitchside_profiles set coins = coins - p_amount
   where id = v.id and coins >= p_amount
  returning coins into v_bal;
  if not found then return public.pitchside__err('insufficient_coins'); end if;
  return json_build_object('ok', true, 'coins', v_bal);
end $$;

create or replace function public.pitchside_admin_verify(p_code text)
returns boolean language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$ begin return public.pitchside__admin_check(p_code); end $$;

create or replace function public.pitchside_admin_add_coins(p_id uuid, p_secret text, p_code text, p_delta bigint)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_bal bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000000 then return public.pitchside__err('bad_amount'); end if;
  if not public.pitchside__admin_check(p_code) then return public.pitchside__err('not_admin'); end if;
  update public.pitchside_profiles set coins = greatest(0, coins + p_delta) where id = v.id returning coins into v_bal;
  return json_build_object('ok', true, 'coins', v_bal);
end $$;

-- ------------------------------------------------------------------ transfer market
create or replace function public.pitchside_list_card(p_id uuid, p_secret text, p_card jsonb, p_price bigint)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.pitchside_profiles;
  v_ovr numeric; v_pos text; v_name text; v_cid text; v_rarity text; v_special text; v_tier text;
  v_active int; v_lid uuid;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_price is null or p_price < 150 or p_price > 15000000 then return public.pitchside__err('bad_price'); end if;
  if p_card is null or jsonb_typeof(p_card) <> 'object' then return public.pitchside__err('bad_card'); end if;
  if octet_length(p_card::text) > 4096 then return public.pitchside__err('card_too_large'); end if;
  if not (p_card ? 'id' and p_card ? 'name' and p_card ? 'pos' and p_card ? 'ovr') then return public.pitchside__err('bad_card'); end if;
  if jsonb_typeof(p_card->'id') <> 'string' or jsonb_typeof(p_card->'name') <> 'string'
     or jsonb_typeof(p_card->'pos') <> 'string' or jsonb_typeof(p_card->'ovr') <> 'number' then
    return public.pitchside__err('bad_card');
  end if;
  v_cid := p_card->>'id';
  if v_cid !~ '^[A-Za-z0-9_.:-]{1,40}$' then return public.pitchside__err('bad_card'); end if;
  v_ovr := (p_card->>'ovr')::numeric;
  if v_ovr <> trunc(v_ovr) or v_ovr < 1 or v_ovr > 99 then return public.pitchside__err('bad_card'); end if;
  v_pos := p_card->>'pos';
  if v_pos not in ('GK','CB','LB','RB','LWB','RWB','CDM','CM','CAM','LM','RM','LW','RW','ST','CF') then
    return public.pitchside__err('bad_card');
  end if;
  v_name := left(btrim(regexp_replace(p_card->>'name', '[[:cntrl:]]', '', 'g')), 32);
  if v_name = '' then return public.pitchside__err('bad_card'); end if;
  v_special := case when jsonb_typeof(p_card->'special') = 'string' then p_card->>'special' end;
  v_tier := case when jsonb_typeof(p_card->'tier') = 'string' then p_card->>'tier' end;
  v_rarity := case
    when v_special in ('legend', 'hero', 'inform', 'icon') then v_special
    when v_tier in ('gold', 'silver', 'bronze') then v_tier || case when (p_card->>'rare') = 'true' then '_rare' else '' end
    else 'common' end;
  if not public.pitchside__throttle('list:' || v.id, interval '1 hour', 60) then return public.pitchside__err('rate_limited'); end if;
  select count(*) into v_active from public.pitchside_listings where seller_id = v.id and status = 'active';
  if v_active >= 30 then return public.pitchside__err('too_many_listings'); end if;
  begin
    insert into public.pitchside_listings (seller_id, card, ovr, pos, rarity, name, price, seller_credit)
    values (v.id, p_card, v_ovr::int, v_pos, v_rarity, v_name, p_price, (p_price * 95) / 100)
    returning id into v_lid;
  exception when unique_violation then
    return public.pitchside__err('already_listed');
  end;
  return json_build_object('ok', true, 'listingId', v_lid);
end $$;

-- Read-only search (never returns seller ids or secrets). Expired rows are filtered here and
-- marked lazily by my_listings / claim / buy.
create or replace function public.pitchside_search_listings(
  p_q text default null, p_pos text default null, p_min_ovr int default null, p_max_price bigint default null,
  p_rarity text default null, p_sort text default 'newest', p_page int default 0)
returns json language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare v_q text; v_page int := greatest(0, least(coalesce(p_page, 0), 49)); v_items json;
begin
  v_q := nullif(left(btrim(coalesce(p_q, '')), 24), '');
  if v_q is not null then
    v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  end if;
  select coalesce(json_agg(json_build_object('listingId', s.id, 'card', s.card, 'price', s.price,
           'seller', s.seller, 'listedAt', s.created_at) order by s.rn), '[]'::json)
    into v_items
  from (
    select l.id, l.card, l.price, p.name as seller, l.created_at,
      row_number() over (order by
        case when p_sort = 'price_asc'  then l.price end asc nulls last,
        case when p_sort = 'price_desc' then l.price end desc nulls last,
        case when p_sort = 'ovr_desc'   then l.ovr end desc nulls last,
        l.created_at desc, l.id) as rn
    from public.pitchside_listings l
    join public.pitchside_profiles p on p.id = l.seller_id
    where l.status = 'active'
      and l.created_at > now() - interval '72 hours'
      and (v_q is null or l.name ilike '%' || v_q || '%')
      and (nullif(p_pos, '') is null or l.pos = p_pos)
      and (p_min_ovr is null or l.ovr >= p_min_ovr)
      and (p_max_price is null or p_max_price <= 0 or l.price <= p_max_price)
      and (nullif(p_rarity, '') is null or l.rarity = p_rarity)
    order by rn
    limit 20 offset v_page * 20
  ) s;
  return json_build_object('ok', true, 'items', v_items, 'page', v_page);
end $$;

create or replace function public.pitchside_buy(p_id uuid, p_secret text, p_listing uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; l public.pitchside_listings; v_bal bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_listing is null then return public.pitchside__err('not_found'); end if;
  if not public.pitchside__throttle('buy:' || v.id, interval '1 hour', 120) then return public.pitchside__err('rate_limited'); end if;
  -- lock order everywhere: listing row first, then profile row
  select * into l from public.pitchside_listings where id = p_listing for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if l.status <> 'active' then return public.pitchside__err('unavailable'); end if;
  if l.created_at <= now() - interval '72 hours' then
    update public.pitchside_listings set status = 'expired' where id = l.id;
    return public.pitchside__err('expired');
  end if;
  if l.seller_id = v.id then return public.pitchside__err('own_listing'); end if;
  update public.pitchside_profiles set coins = coins - l.price
   where id = v.id and coins >= l.price
  returning coins into v_bal;
  if not found then return public.pitchside__err('insufficient_coins'); end if;
  update public.pitchside_listings set status = 'sold', buyer_id = v.id, sold_at = now() where id = l.id;
  return json_build_object('ok', true, 'card', l.card, 'price', l.price, 'coins', v_bal);
end $$;

-- Remove an active (or expired) listing and hand the card back to the seller.
create or replace function public.pitchside_cancel_listing(p_id uuid, p_secret text, p_listing uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_card jsonb;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_listings set status = 'cancelled'
   where id = p_listing and seller_id = v.id and status in ('active', 'expired')
  returning card into v_card;
  if not found then return public.pitchside__err('not_cancellable'); end if;
  return json_build_object('ok', true, 'card', v_card);
end $$;

create or replace function public.pitchside_my_listings(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_items json;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_listings set status = 'expired'
   where seller_id = v.id and status = 'active' and created_at <= now() - interval '72 hours';
  select coalesce(json_agg(json_build_object('listingId', s.id, 'card', s.card, 'price', s.price, 'status', s.status,
           'listedAt', s.created_at, 'soldAt', s.sold_at, 'claimed', s.claimed, 'credit', s.seller_credit)
           order by s.created_at desc), '[]'::json)
    into v_items
  from (
    select * from public.pitchside_listings
     where seller_id = v.id and (status in ('active', 'expired') or (status = 'sold' and (not claimed or sold_at > now() - interval '7 days')))
     order by created_at desc limit 100
  ) s;
  return json_build_object('ok', true, 'items', v_items);
end $$;

-- Credit the seller for sold listings. Each listing is claimed exactly once (row-level atomic flip).
create or replace function public.pitchside_claim_sales(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_total bigint; v_n int; v_bal bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_listings set status = 'expired'
   where seller_id = v.id and status = 'active' and created_at <= now() - interval '72 hours';
  with c as (
    update public.pitchside_listings set claimed = true
     where seller_id = v.id and status = 'sold' and not claimed
    returning seller_credit
  )
  select coalesce(sum(seller_credit), 0), count(*) into v_total, v_n from c;
  update public.pitchside_profiles set coins = coins + v_total where id = v.id returning coins into v_bal;
  return json_build_object('ok', true, 'coins', v_total, 'count', v_n, 'balance', v_bal);
end $$;

-- ------------------------------------------------------------------ matchmaking
create or replace function public.pitchside__mm_purge()
returns void language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
begin
  delete from public.pitchside_queue where id in (
    select id from public.pitchside_queue
     where (matched_with is null and last_poll_at < now() - interval '60 seconds')
        or created_at < now() - interval '3 hours'
     for update skip locked);
end $$;

create or replace function public.pitchside__mm_result(r public.pitchside_queue)
returns json language sql stable
set search_path = public, extensions, pg_temp
as $$
  select case when r.matched_with is null then
    json_build_object('ok', true, 'matched', false, 'queueId', r.id,
      'waitedMs', (extract(epoch from now() - r.created_at) * 1000)::bigint)
  else
    json_build_object('ok', true, 'matched', true, 'queueId', r.id,
      'role', case when r.host then 'host' else 'guest' end,
      'opponentPeerId', r.opp_peer_id, 'token', r.match_token,
      'opponent', json_build_object('name', r.opp_name, 'rating', r.opp_rating))
  end
$$;

-- Pair queue row `me` (already inserted/locked by the caller) with the oldest compatible waiting row.
-- The newer entry always initiates, so two pollers never wait on each other (skip locked).
create or replace function public.pitchside__mm_pair(me public.pitchside_queue)
returns public.pitchside_queue language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare c public.pitchside_queue; v_tok text;
begin
  select * into c from public.pitchside_queue q
   where q.mode = me.mode and q.matched_with is null and q.id <> me.id and q.player_id <> me.player_id
     and q.last_poll_at > now() - interval '20 seconds'
     and (q.created_at, q.id) < (me.created_at, me.id)
     and abs(q.rating - me.rating) <= least(1000, 100 + (10 * extract(epoch from now() - q.created_at))::int)
     and (me.mode <> 'rivals'
          or abs(coalesce(q.division, 10) - coalesce(me.division, 10)) <= 1 + (extract(epoch from now() - q.created_at) / 20)::int)
   order by q.created_at, q.id
   limit 1
   for update skip locked;
  if not found then return me; end if;
  v_tok := encode(extensions.gen_random_bytes(16), 'hex');
  update public.pitchside_queue set matched_with = me.id, matched_at = now(), host = true, match_token = v_tok,
         opp_player_id = me.player_id, opp_peer_id = me.peer_id, opp_rating = me.rating, opp_name = me.name
   where id = c.id;
  update public.pitchside_queue set matched_with = c.id, matched_at = now(), host = false, match_token = v_tok,
         opp_player_id = c.player_id, opp_peer_id = c.peer_id, opp_rating = c.rating, opp_name = c.name,
         last_poll_at = now()
   where id = me.id
  returning * into me;
  return me;
end $$;

create or replace function public.pitchside_mm_enqueue(p_id uuid, p_secret text, p_mode text, p_peer_id text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; r public.pitchside_queue;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_mode is null or p_mode not in ('friendly', 'ut', 'rivals') then return public.pitchside__err('bad_mode'); end if;
  if p_peer_id is null or p_peer_id !~ '^[A-Za-z0-9_-]{8,64}$' then return public.pitchside__err('bad_peer'); end if;
  if not public.pitchside__throttle('mm:' || v.id, interval '1 hour', 120) then return public.pitchside__err('rate_limited'); end if;
  perform public.pitchside__rivals_rollover(v.id);
  perform public.pitchside__mm_purge();
  -- one search at a time per player
  delete from public.pitchside_queue where id in (
    select id from public.pitchside_queue where player_id = v.id and matched_with is null for update skip locked);
  insert into public.pitchside_queue (player_id, mode, peer_id, rating, name, division)
  values (v.id, p_mode, p_peer_id, v.rating, v.name, v.rivals_division)
  returning * into r;
  r := public.pitchside__mm_pair(r);
  return public.pitchside__mm_result(r);
end $$;

create or replace function public.pitchside_mm_poll(p_id uuid, p_secret text, p_queue_id uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; r public.pitchside_queue;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select * into r from public.pitchside_queue where id = p_queue_id and player_id = v.id for update;
  if not found then return public.pitchside__err('not_queued'); end if;
  if r.matched_with is not null then return public.pitchside__mm_result(r); end if;
  update public.pitchside_queue set last_poll_at = now() where id = r.id returning * into r;
  r := public.pitchside__mm_pair(r);
  return public.pitchside__mm_result(r);
end $$;

create or replace function public.pitchside_mm_cancel(p_id uuid, p_secret text, p_queue_id uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; r public.pitchside_queue;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select * into r from public.pitchside_queue where id = p_queue_id and player_id = v.id for update;
  if not found then return json_build_object('ok', true, 'matched', false); end if;
  if r.matched_with is not null then return public.pitchside__mm_result(r); end if;
  delete from public.pitchside_queue where id = r.id;
  return json_build_object('ok', true, 'matched', false);
end $$;

-- ------------------------------------------------------------------ rivals
create or replace function public.pitchside_rivals_status(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_claimable boolean;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  perform public.pitchside__rivals_rollover(v.id);
  select * into v from public.pitchside_profiles where id = v.id;
  v_claimable := v.rivals_prev_week is not null and v.rivals_prev_week is distinct from v.rivals_claimed_week;
  return json_build_object('ok', true,
    'division', v.rivals_division, 'points', v.rivals_points, 'threshold', public.pitchside__rivals_threshold(v.rivals_division),
    'week', v.rivals_week, 'weekWins', v.rivals_week_wins, 'weekMatches', v.rivals_week_matches, 'peak', v.rivals_peak,
    'claimable', v_claimable, 'claimWeek', case when v_claimable then v.rivals_prev_week end,
    'reward', case when v_claimable then public.pitchside__rivals_reward(v.rivals_prev_peak, v.rivals_prev_wins) end,
    'nextResetAt', date_trunc('week', now() at time zone 'utc') at time zone 'utc' + interval '7 days');
end $$;

create or replace function public.pitchside_rivals_claim_weekly(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_reward json; v_coins bigint;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  perform public.pitchside__rivals_rollover(v.id);
  select * into v from public.pitchside_profiles where id = v.id for update;
  if v.rivals_prev_week is null then return public.pitchside__err('nothing_to_claim'); end if;
  if v.rivals_prev_week = v.rivals_claimed_week then return public.pitchside__err('already_claimed'); end if;
  v_reward := public.pitchside__rivals_reward(v.rivals_prev_peak, v.rivals_prev_wins);
  v_coins := (v_reward->>'coins')::bigint;
  update public.pitchside_profiles set coins = coins + v_coins, rivals_claimed_week = rivals_prev_week
   where id = v.id and rivals_claimed_week is distinct from rivals_prev_week
  returning * into v;
  if not found then return public.pitchside__err('already_claimed'); end if;
  return json_build_object('ok', true, 'week', v.rivals_claimed_week, 'coins', v_coins, 'packs', v_reward->'packs', 'balance', v.coins);
end $$;

-- ------------------------------------------------------------------ friends + invites
create or replace function public.pitchside_heartbeat(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_inv int; v_req int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_profiles set last_seen_at = now()
   where id = v.id and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  select count(*) into v_inv from public.pitchside_invites where to_id = v.id and status = 'pending' and created_at > now() - interval '60 seconds';
  select count(*) into v_req from public.pitchside_friends where v.id in (a, b) and status = 'pending' and requested_by <> v.id;
  return json_build_object('ok', true, 'invites', v_inv, 'requests', v_req);
end $$;

create or replace function public.pitchside_add_friend(p_id uuid, p_secret text, p_code text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; o public.pitchside_profiles; f public.pitchside_friends; v_code text; v_n int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_code !~ '^[A-Z0-9]{8}$' then return public.pitchside__err('bad_code'); end if;
  if not public.pitchside__throttle('friend:' || v.id, interval '1 hour', 30) then return public.pitchside__err('rate_limited'); end if;
  select * into o from public.pitchside_profiles where friend_code = v_code;
  if not found then return public.pitchside__err('not_found'); end if;
  if o.id = v.id then return public.pitchside__err('self'); end if;
  select * into f from public.pitchside_friends where a = least(v.id, o.id) and b = greatest(v.id, o.id) for update;
  if found then
    if f.status = 'blocked' then
      return public.pitchside__err(case when f.blocked_by = v.id then 'blocked' else 'not_found' end);
    elsif f.status = 'accepted' then
      return public.pitchside__err('already_friends');
    elsif f.requested_by = v.id then
      return public.pitchside__err('already_requested');
    end if;
    -- they had already asked us: adding them back accepts
    update public.pitchside_friends set status = 'accepted', updated_at = now() where a = f.a and b = f.b;
    return json_build_object('ok', true, 'status', 'friend', 'friend', json_build_object('id', o.id, 'name', o.name));
  end if;
  select count(*) into v_n from public.pitchside_friends where v.id in (a, b) and status <> 'blocked';
  if v_n >= 200 then return public.pitchside__err('too_many_friends'); end if;
  insert into public.pitchside_friends (a, b, status, requested_by) values (least(v.id, o.id), greatest(v.id, o.id), 'pending', v.id)
  on conflict (a, b) do nothing;
  if not found then return public.pitchside__err('retry'); end if;
  return json_build_object('ok', true, 'status', 'outgoing', 'friend', json_build_object('id', o.id, 'name', o.name));
end $$;

create or replace function public.pitchside_respond_friend(p_id uuid, p_secret text, p_friend uuid, p_action text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; f public.pitchside_friends; v_a uuid; v_b uuid;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_friend is null or p_friend = v.id then return public.pitchside__err('not_found'); end if;
  if p_action is null or p_action not in ('accept', 'decline', 'remove', 'block', 'unblock') then return public.pitchside__err('bad_action'); end if;
  if not exists (select 1 from public.pitchside_profiles where id = p_friend) then return public.pitchside__err('not_found'); end if;
  v_a := least(v.id, p_friend); v_b := greatest(v.id, p_friend);
  select * into f from public.pitchside_friends where a = v_a and b = v_b for update;
  if p_action = 'block' then
    if found and f.status = 'blocked' then return json_build_object('ok', true); end if;
    insert into public.pitchside_friends (a, b, status, requested_by, blocked_by) values (v_a, v_b, 'blocked', v.id, v.id)
    on conflict (a, b) do update set status = 'blocked', blocked_by = v.id, requested_by = v.id, updated_at = now();
    update public.pitchside_invites set status = 'cancelled'
     where status = 'pending' and ((from_id = v.id and to_id = p_friend) or (from_id = p_friend and to_id = v.id));
    return json_build_object('ok', true);
  end if;
  if not found or (f.status = 'blocked' and f.blocked_by <> v.id) then return public.pitchside__err('not_found'); end if;
  if p_action = 'unblock' then
    if f.status <> 'blocked' then return public.pitchside__err('not_found'); end if;
    delete from public.pitchside_friends where a = v_a and b = v_b;
  elsif p_action = 'accept' then
    if f.status <> 'pending' or f.requested_by = v.id then return public.pitchside__err('not_found'); end if;
    update public.pitchside_friends set status = 'accepted', updated_at = now() where a = v_a and b = v_b;
  else -- decline / remove
    if f.status = 'blocked' then return public.pitchside__err('blocked'); end if;
    delete from public.pitchside_friends where a = v_a and b = v_b;
    update public.pitchside_invites set status = 'cancelled'
     where status = 'pending' and ((from_id = v.id and to_id = p_friend) or (from_id = p_friend and to_id = v.id));
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.pitchside_list_friends(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_items json;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_profiles set last_seen_at = now()
   where id = v.id and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'name', p.name,
           'status', case when f.status = 'accepted' then 'friend' when f.status = 'blocked' then 'blocked'
                          when f.requested_by = v.id then 'outgoing' else 'incoming' end,
           'online', f.status = 'accepted' and p.last_seen_at > now() - interval '60 seconds',
           'rating', case when f.status = 'accepted' then p.rating end,
           'division', case when f.status = 'accepted' then p.division end,
           'rivalsDivision', case when f.status = 'accepted' then p.rivals_division end)
         order by (f.status = 'accepted' and p.last_seen_at > now() - interval '60 seconds') desc, p.name), '[]'::json)
    into v_items
  from public.pitchside_friends f
  join public.pitchside_profiles p on p.id = case when f.a = v.id then f.b else f.a end
  where v.id in (f.a, f.b) and not (f.status = 'blocked' and f.blocked_by <> v.id);
  return json_build_object('ok', true, 'code', v.friend_code, 'items', v_items);
end $$;

create or replace function public.pitchside_send_invite(p_id uuid, p_secret text, p_friend uuid, p_mode text, p_peer_id text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_inv uuid; v_tok text;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  if p_mode is null or p_mode not in ('friendly', 'ut') then return public.pitchside__err('bad_mode'); end if;
  if p_peer_id is null or p_peer_id !~ '^[A-Za-z0-9_-]{8,64}$' then return public.pitchside__err('bad_peer'); end if;
  if p_friend is null or not exists (select 1 from public.pitchside_friends
      where a = least(v.id, p_friend) and b = greatest(v.id, p_friend) and status = 'accepted') then
    return public.pitchside__err('not_friends');
  end if;
  if not public.pitchside__throttle('invite:' || v.id, interval '10 minutes', 20) then return public.pitchside__err('rate_limited'); end if;
  update public.pitchside_invites set status = 'cancelled' where from_id = v.id and status = 'pending';
  v_tok := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.pitchside_invites (from_id, to_id, mode, peer_id, token) values (v.id, p_friend, p_mode, p_peer_id, v_tok)
  returning id into v_inv;
  update public.pitchside_profiles set last_seen_at = now() where id = v.id;
  return json_build_object('ok', true, 'inviteId', v_inv, 'token', v_tok, 'expiresInMs', 60000);
end $$;

-- Heartbeat + incoming invites (no peer ids) + the status of my recent outgoing invites.
create or replace function public.pitchside_poll_invites(p_id uuid, p_secret text)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_in json; v_out json; v_req int;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_profiles set last_seen_at = now()
   where id = v.id and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  select coalesce(json_agg(json_build_object('inviteId', i.id, 'mode', i.mode, 'createdAt', i.created_at,
           'from', json_build_object('id', p.id, 'name', p.name, 'rating', p.rating)) order by i.created_at desc), '[]'::json)
    into v_in
  from public.pitchside_invites i
  join public.pitchside_profiles p on p.id = i.from_id
  join public.pitchside_friends f on f.a = least(i.from_id, i.to_id) and f.b = greatest(i.from_id, i.to_id) and f.status = 'accepted'
  where i.to_id = v.id and i.status = 'pending' and i.created_at > now() - interval '60 seconds';
  select coalesce(json_agg(json_build_object('inviteId', i.id, 'mode', i.mode, 'toId', i.to_id,
           'status', case when i.status = 'pending' and i.created_at <= now() - interval '60 seconds' then 'expired' else i.status end)
           order by i.created_at desc), '[]'::json)
    into v_out
  from public.pitchside_invites i
  where i.from_id = v.id and i.created_at > now() - interval '2 minutes';
  select count(*) into v_req from public.pitchside_friends where v.id in (a, b) and status = 'pending' and requested_by <> v.id;
  return json_build_object('ok', true, 'incoming', v_in, 'outgoing', v_out, 'requests', v_req);
end $$;

create or replace function public.pitchside_respond_invite(p_id uuid, p_secret text, p_invite uuid, p_accept boolean)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; i public.pitchside_invites; o public.pitchside_profiles;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  select * into i from public.pitchside_invites where id = p_invite and to_id = v.id for update;
  if not found then return public.pitchside__err('not_found'); end if;
  if i.status <> 'pending' then return public.pitchside__err('unavailable'); end if;
  if i.created_at <= now() - interval '60 seconds' then
    update public.pitchside_invites set status = 'expired' where id = i.id;
    return public.pitchside__err('expired');
  end if;
  if not coalesce(p_accept, false) then
    update public.pitchside_invites set status = 'declined', responded_at = now() where id = i.id;
    return json_build_object('ok', true, 'accepted', false);
  end if;
  if not exists (select 1 from public.pitchside_friends where a = least(i.from_id, i.to_id) and b = greatest(i.from_id, i.to_id) and status = 'accepted') then
    update public.pitchside_invites set status = 'cancelled' where id = i.id;
    return public.pitchside__err('unavailable');
  end if;
  update public.pitchside_invites set status = 'accepted', responded_at = now() where id = i.id;
  select * into o from public.pitchside_profiles where id = i.from_id;
  return json_build_object('ok', true, 'accepted', true, 'mode', i.mode, 'peerId', i.peer_id, 'token', i.token,
    'from', json_build_object('id', o.id, 'name', o.name, 'rating', o.rating));
end $$;

create or replace function public.pitchside_cancel_invite(p_id uuid, p_secret text, p_invite uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.pitchside_profiles; v_status text;
begin
  v := public.pitchside__auth(p_id, p_secret);
  if v.id is null then return public.pitchside__err('auth'); end if;
  update public.pitchside_invites set status = 'cancelled' where id = p_invite and from_id = v.id and status = 'pending'
  returning status into v_status;
  if not found then
    select status into v_status from public.pitchside_invites where id = p_invite and from_id = v.id;
    return json_build_object('ok', true, 'status', coalesce(v_status, 'not_found'));
  end if;
  return json_build_object('ok', true, 'status', 'cancelled');
end $$;

-- ------------------------------------------------------------------ function privileges
-- Supabase grants EXECUTE on new public functions to anon/authenticated by default: revoke everything,
-- then grant only the client-facing RPCs.
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

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
  constraint pitchside_queue_mode_chk check (mode in ('friendly', 'ut')),
  constraint pitchside_queue_peer_fmt check (peer_id ~ '^[A-Za-z0-9_-]{8,64}$')
);
create index if not exists pitchside_queue_waiting on public.pitchside_queue (mode, created_at) where matched_with is null;
create index if not exists pitchside_queue_player  on public.pitchside_queue (player_id, matched_at desc);

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

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pitchside_profiles, public.pitchside_listings, public.pitchside_queue, public.pitchside_admin, public.pitchside_throttle from %I', r);
      -- the one safe direct read: active listings, without seller/buyer ids or credits
      execute format('grant select (id, card, ovr, pos, rarity, name, price, status, created_at) on public.pitchside_listings to %I', r);
    end if;
  end loop;
end $$;
revoke all on table public.pitchside_profiles, public.pitchside_listings, public.pitchside_queue, public.pitchside_admin, public.pitchside_throttle from public;

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
  select coalesce(nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')), 16), ''), 'Player')
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
  if not public.pitchside__throttle('reg_ip:' || public.pitchside__client_key(), interval '1 hour', 5)
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
    'division', v.division, 'wins', v.wins, 'draws', v.draws, 'losses', v.losses, 'unclaimed', v_unclaimed);
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
begin
  if p_mode is null or p_mode not in ('friendly', 'ut', 'offline') then return public.pitchside__err('bad_mode'); end if;
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
  if p_mode in ('friendly', 'ut') then
    select * into q from public.pitchside_queue
     where player_id = v.id and matched_with is not null and not reported and mode = p_mode
       and matched_at > now() - interval '3 hours'
     order by matched_at desc limit 1 for update;
    if found then
      update public.pitchside_queue set reported = true where id = q.id;
      v_opp := coalesce(q.opp_rating, v.rating); v_k := 32;
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
  return json_build_object('ok', true, 'capped', false, 'coinsAwarded', v_coins, 'coins', v.coins,
    'rating', v.rating, 'ratingDelta', v.rating - v_old, 'division', v.division);
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
  if p_mode is null or p_mode not in ('friendly', 'ut') then return public.pitchside__err('bad_mode'); end if;
  if p_peer_id is null or p_peer_id !~ '^[A-Za-z0-9_-]{8,64}$' then return public.pitchside__err('bad_peer'); end if;
  if not public.pitchside__throttle('mm:' || v.id, interval '1 hour', 120) then return public.pitchside__err('rate_limited'); end if;
  perform public.pitchside__mm_purge();
  -- one search at a time per player
  delete from public.pitchside_queue where id in (
    select id from public.pitchside_queue where player_id = v.id and matched_with is null for update skip locked);
  insert into public.pitchside_queue (player_id, mode, peer_id, rating, name)
  values (v.id, p_mode, p_peer_id, v.rating, v.name)
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

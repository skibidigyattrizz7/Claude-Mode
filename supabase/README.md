# Pitchside 3D — online backend (Supabase)

Idempotent migrations, applied in order: `20260925140338_pitchside_001.sql` (live), `20260926000000_pitchside_002_accounts.sql`, `20260926000100_pitchside_003_owner_social.sql`, `20260926120000_pitchside_004_sync_reset.sql`.
All objects are prefixed `pitchside_`. No Supabase Auth is used.

## What it contains

| Area | Objects |
|---|---|
| Profiles & coins | `pitchside_profiles`, `pitchside_register`, `pitchside_get_profile`, `pitchside_set_name`, `pitchside_report_result`, `pitchside_spend_coins` |
| Transfer market | `pitchside_listings`, `pitchside_list_card`, `pitchside_search_listings`, `pitchside_buy`, `pitchside_cancel_listing`, `pitchside_my_listings`, `pitchside_claim_sales` |
| Matchmaking | `pitchside_queue`, `pitchside_mm_enqueue`, `pitchside_mm_poll`, `pitchside_mm_cancel` (modes `friendly`, `ut`, `rivals`) |
| Rivals | columns on profiles, `pitchside_rivals_status`, `pitchside_rivals_claim_weekly` |
| Friends | `pitchside_friends`, `pitchside_invites`, `pitchside_heartbeat`, `pitchside_add_friend`, `pitchside_respond_friend`, `pitchside_list_friends`, `pitchside_send_invite`, `pitchside_poll_invites`, `pitchside_respond_invite`, `pitchside_cancel_invite` |
| Admin | `pitchside_admin` (code hash only), `pitchside_admin_verify`, `pitchside_admin_add_coins` |
| Misc | `pitchside_ping`, `pitchside_throttle` (rate limits), internal helpers `pitchside__*` (not callable by clients) |

## Security model

- **Device identity**: the browser generates a random 32-byte secret (64 hex chars) and keeps it in
  `localStorage`. The server stores only `sha256(secret)`; every write RPC re-checks `(player_id, secret)`.
- **RLS is enabled on every table** and `anon`/`authenticated` have no table privileges except a
  column-restricted `SELECT` on *active* market listings (no seller/buyer ids, no credits).
  There are no insert/update/delete policies at all.
- **All writes** go through `SECURITY DEFINER` functions with `set search_path = public, extensions, pg_temp`.
  No dynamic SQL. Internal `pitchside__*` helpers have `EXECUTE` revoked from clients.
- **Money safety**: purchases lock the listing row (`FOR UPDATE`), refuse self-buys, deduct with
  `coins >= price` in the same statement (`coins >= 0` is also a CHECK), and mark it sold atomically.
  The seller gets 95 % (5 % tax) as an unclaimed credit; each sale is claimed exactly once.
  Tested with 12 concurrent buyers / 8 concurrent claims against real Postgres 16.
- **Rate limits**: 20 registrations/hour per IP and 300/hour globally; 12 rewarded results per hour and
  one per 60 s per player; 60 listings/hour; 120 buys/hour; 120 matchmaking searches/hour;
  30 friend requests/hour; 20 match invites per 10 min. Rivals points only count for games that were
  actually paired by the server queue.
- **Admin code** never appears in any file. Only its bcrypt hash is stored. `pitchside_admin_verify`
  stops checking (returns false) after 20 failed attempts in the current minute, globally.
- Known limitation (inherent to a client-simulated game): match results are reported by the clients,
  so the reward caps above are what limits abuse.

## Going live

1. **Resume the project** in the Supabase dashboard if it is paused.
2. **Apply the migration**: SQL editor → paste `migrations/001_pitchside.sql` → Run
   (or `supabase db push` / the MCP `apply_migration` tool). Re-running it is harmless.
3. **Set the admin code hash** (run privately in the SQL editor; replace `<CODE>`, do not commit it):
   ```sql
   insert into pitchside_admin(id, code_hash) values (1, crypt('<CODE>', gen_salt('bf', 10)))
   on conflict (id) do update set code_hash = excluded.code_hash;
   ```
   (If `crypt` is not found, use `extensions.crypt(...)` / `extensions.gen_salt(...)`.)
4. **Configure the client**: put the project's *anon / publishable* key into
   `3d/js/net/config.js` → `export const SUPABASE_KEY = '...'`. It is public by design; never use the
   `service_role` key in the client.
5. Check: the main-menu pill should read **Online: connected**.

## Testing without the backend

`3d/index.html?mockOnline=1` swaps the backend for an in-browser mock (`3d/js/net/mockbackend.js`)
that mirrors these functions; open two tabs to matchmake / add friends against each other.
Unit tests: `node 3d/js/net/tests/net.test.mjs`.

## Admin code hashes (003) — run privately, never commit codes
```sql
insert into pitchside_admin_codes(level, code_hash) values ('full', extensions.crypt('<FULL_CODE>', extensions.gen_salt('bf', 10)))
on conflict (level) do update set code_hash = excluded.code_hash, updated_at = now();
insert into pitchside_admin_codes(level, code_hash) values ('super', extensions.crypt('<SUPER_CODE>', extensions.gen_salt('bf', 10)))
on conflict (level) do update set code_hash = excluded.code_hash, updated_at = now();
```
(003 copies the existing `pitchside_admin` row as the 'full' code automatically.)

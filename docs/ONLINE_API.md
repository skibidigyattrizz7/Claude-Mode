# Pitchside 3D — online services API (`online.*`)

For UI agents (meta / admin panel / gifts inbox / rewards). Import once:

```js
import { online } from '../../net/services.js';          // or use app.online (main.js passes it into meta)
import { verifyAdminCodeLocal, verifyAdminCode, getAdminLevel, bindOnline } from '../../shared/adminauth.js';
```

Rules: **every call returns a Promise and never throws**. Failures resolve `{ ok:false, error, message }`
(`message` is user-readable; `error` is a code such as `offline`, `auth`, `no_account`, `not_admin`,
`not_allowed`, `rate_limited`, `insufficient_coins`, `banned`, `bad_*`). With `?mockOnline=1` everything runs
against the in-browser mock (`3d/js/net/mockbackend.js`); the mock admin codes are `mock-full` / `mock-super`.

Server: Supabase SQL migrations in `supabase/migrations/` (001 live, 002 accounts, 003 owner/social).

---

## Accounts — `online.account`
| call | result |
|---|---|
| `current()` (sync) | `{ state:'none'|'account'|'banned'|'offline', id, username, role:'player'|'mod'|'owner'|null, ban, hasDevice }` |
| `status()` | server check of the saved session (refreshes role / ban) |
| `signup({ username, password, confirm, remember, adminCode })` | `{ ok, id, username, role, claimed }` — claims this device's old guest profile automatically (keeps coins etc.). Reserved name "Shawky Fc" (+ lookalikes) needs the full or super code → role `owner`. |
| `login({ username, password, remember })` | `{ ok, id, username, role }` |
| `logout({ all })` | always `{ ok:true }` |
| `changeUsername({ username, password, adminCode })` | `{ ok, username }` (display name follows) |
| `changePassword({ password, newPassword, confirm })` | `{ ok }` (other sessions are ended) |
| `guest()` / `isGuest()` | remember "Continue as guest" (device profile keeps working) |
| `onChange(fn)` | subscribe to login / logout / role changes → unsubscribe fn |

Account UI (gate + Settings → Account) is provided by `3d/js/net/accountui.js` (mounted from `main.js`).

## Admin codes — `3d/js/shared/adminauth.js` and `online.admin`
- `verifyAdminCodeLocal(code)` → `'super'|'full'|'temp'|null` (PBKDF2-SHA256, 600 000 iters; offline check, no network).
- `verifyAdminCode(code, online?)` → `{ ok, level, server:boolean }`. Server first (bcrypt, returns a 12 h signed
  admin token kept in sessionStorage — never the code), otherwise the local check. Stores the session level.
- `getAdminLevel()` → `'super'|'full'|'mod'|'temp'|null` = max(code session level, account role: owner→`full`, mod→`mod`).
- `adminCaps(level)` → `{ adminCards, maxOvr, onlinePowers, ... }` (super = admin cards up to 999 OVR).
- `online.admin.verifyLevel(code)` → `{ ok, level:'super'|'full' }` (server only). `online.admin.verify(code)` → boolean (compat).
- `online.admin.level` → `'super'|'full'|'owner'|'mod'|null` (server-verified code level, else account role).
- `online.admin.canOwner()` → true when owner powers will be accepted by the server (code token or owner account).
- `online.admin.forget()` — drop the server admin token.
- Temp code: local only (60 min, limited) — the server does not know it, so owner RPCs below refuse it.

## Owner powers — `online.owner` (full/super code **or** owner account; mods: moderation only)
All take an optional trailing `{ key }` idempotency key (auto-generated; retried calls with the same key never double-apply).
| call | notes |
|---|---|
| `giveCoins(playerId|null, amount, { reason })` | `null` = yourself. amount ±1e9. Retries 3× on network errors with the same key. → `{ ok, coins }` |
| `gift({ to, kind, coins, packId, count, card, message })` | `to`: player id, or `'all'` (everyone, 14 days). `kind`: `'coins'|'pack'|'card'`. Cards are forced `tradable:true`; OVR > 99 needs **super**. → `{ ok, giftId }` |
| `reset(playerId, what)` | `what`: `'coins'|'progress'|'club'|'all'`. Club resets reach the client via `presence` → `resets.club` epoch. |
| `broadcast(text, minutes=30)` / `clearBroadcast(id)` | banner for everyone online (≤ 200 chars, 1–1440 min) |
| `setConfig(key, value)` | see Config |
| `setInfinite(on)` | infinite coins for **your own** online wallet: spends and market buys succeed without deducting |
| `players(query)` | same as `online.moderation.search` |

Moderation (`online.moderation`, from 002): `search(q)`, `player(id)`, `ban(id, reason, until|null)`, `unban(id)`,
`adjustCoins(id, delta, reason)`, `setRole(id, 'player'|'mod'|'owner')` ("grant admin" = role `mod`; `owner` needs super).

## Global config — `online.config`
Read at startup and every 3 min (also on every presence tick when `configVersion` changes).
- `get()` → `{ ok, config }` (cached; offline → last cached / defaults). `value(path, fallback)` sync, e.g. `value('packs.gold.price', 7500)`.
- `onChange(fn)` → unsubscribe.
- Keys (server-validated, ≤ 8 KB each):
  - `promos`: `{ [promoId]: boolean }`
  - `packs`: `{ [packId]: { enabled?:boolean, price?:int 0..10 000 000 } }`
  - `rewards`: `{ multiplier: 0..10, packChance: 0..1 }` (server uses both for match rewards)
  - `market`: `{ tax: 0..0.5 }` (server uses it on every sale)
  - `features`: `{ [name]: boolean }` (free-form switches)

## Coins — `online.coins` (one model)
When logged in (account or guest device profile) **and** online, the server balance is the UT balance; every
change goes through an atomic RPC. Offline the UT save's local balance is used.
- `get()` → `{ ok, coins, infinite }`
- `spend(amount, reason)` → `{ ok, coins }` | `insufficient_coins` (infinite wallets never fail)
- `earn(amount, reason)` → `{ ok, coins, granted }` — capped server-side (reason whitelist: `quicksell`, `objective`,
  `sbc`, `season`, `ut-earn`, `event`; ≤ 250 000/h, ≤ 1 000 000/day; over the cap `granted` < amount).
- `add(delta, reason)` (compat) → spend when negative, earn when positive (admin top-ups: `online.owner.giveCoins`).

## Market — `online.market`
Seller is credited **instantly** inside `buy` (tax from config). `mine()` returns only `active` (+ `expired`, so
the card can be taken back with `cancel`). `claimSales()` stays for old unclaimed sales (returns 0 normally).

## Presence, broadcasts, counter — `online.presence`
- `start()` (main.js calls it) — heartbeat every 25 s (only while the tab is visible).
- `count()` → `{ ok, online }` (profiles seen < 60 s; works for guests without a profile).
- `onUpdate(fn)` → `fn({ online, broadcasts:[{id,text,until}], gifts, unread, resets:{coins,progress,club}, configVersion })`.
- `onBroadcast(fn)` → new broadcast banners (main.js already shows them as a top banner).

## Gifts inbox — `online.gifts`
- `inbox()` → `{ ok, items:[{ id, kind, coins, packId, count, card, message, from, at }] }`
- `claim(id)` → `{ ok, kind, coins, balance, packId, count, card }` — coins are added server-side; the UI adds
  packs / cards to the UT club. Each gift can be claimed exactly once.

## Post-match rewards — `online.rewards`
- `match({ mode, won, drawn, gf, ga })` (`mode`: `'ut'|'friendly'|'rivals'|'offline'`) → `{ ok, coinsAwarded,
  coins, pack:null|packId, capped, multiplier, rating, ratingDelta }`. Coins always (win 800 / draw 400 / loss 200 ×
  multiplier, ≤ 12 rewarded games/h, 1/min); `pack` is rare and server-random (`gold`, `premium`, `rare`, `stars`).
  Offline → `{ ok:false, error:'offline' }` (UI falls back to local rewards).

## Social — `online.messages`, `online.squads`, `online.players`
- `players.find(query)` → `{ ok, items:[{ id, username, name, friendCode, online }] }` (username prefix or friend code)
- `messages.send(toId, text, imageDataUrl?)` (text ≤ 300 chars; image = JPEG data URL ≤ 150 KB, use
  `messages.compressImage(file)`), `messages.conversations()`, `messages.thread(withId)`, `messages.unread()`
- `squads.publish(snapshot)` (JSON ≤ 20 KB: `{ name, formation, players:[{ name, pos, ovr, ... }] }`),
  `squads.view(usernameOrFriendCode)` → `{ ok, owner:{ username, name }, squad, updatedAt }`
- UI: `3d/js/net/social.js` (`mountSocial(root, { online })`) — Messages + View squad, opened from the Online screen.

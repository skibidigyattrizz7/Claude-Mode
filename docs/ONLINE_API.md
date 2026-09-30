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
  - `features`: `{ [name]: boolean | number }` (e.g. `promosEnabled`, `packsEnabled`, `packPriceMult`, `resetEpoch`)
- `set({ promosOn, packsInShop, priceMult })` — compat for the admin toggles: merges into `features` (owner powers).

## Coins — `online.coins` (one model)
When logged in (account or guest device profile) **and** online, the server balance is the UT balance; every
change goes through an atomic RPC. Offline the UT save's local balance is used.
- `get()` → `{ ok, coins, infinite }`
- `spend(amount, reason)` → `{ ok, coins }` | `insufficient_coins` (infinite wallets never fail)
- `earn(amount, reason)` → `{ ok, coins, granted }` — capped server-side (reason whitelist: `quicksell`, `objective`,
  `sbc`, `season`, `ut-earn`, `event`; ≤ 250 000/h, ≤ 1 000 000/day; over the cap `granted` < amount).
- `onChange(fn)` → fn(balance) whenever a server balance is seen (buy, coin ops, gifts, rewards, presence) — meta `app.setOnlineBalance` subscribes.
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

## Transfer list pile (meta/core/pmarket.js, local UT state `state.transferList`)
`sendToTransferList(state, pid)`, `removeFromTransferList(state, pid)`, `transferList(state)` (owned + tradeable only, max 100),
`onTransferList(state, pid)`, `listFromTransferList(state, online, pid, price)`. `listCard` removes the card from the pile.
`fetchMine(state, online)` → `{ ok, items, sold }` (sold = local listings that disappeared: already paid). `buyListing` returns `coins`.

## Status / notes
- Meta `getAdminLevel()` reports a SUPER session as `'full'` (UI compat); use `isSuperAdmin()` / `adminInfo().super` or shared `getAdminLevel()`.
- main.js wires everything: account gate (first visit; `?gate=0` skips, webdriver needs `?gate=1`), Settings → Account tab, menu chip + online counter, broadcast banner, gift toast, presence (every 25 s) + config (every 60 s) for every client, cloud save of the UT club, `setConfigProvider` for meta/core/config.js and the owner-toggle cache (meta/ui/config.js) fed from the server.

## Migration 004 — reset everyone, player list, cloud save
- `online.owner.resetEveryone()` (alias `resetAllEconomy`) → `{ ok, epoch, affected }`: new `features.resetEpoch`; every profile that
  existed before it is set to 5 000 coins / infinite off **on the server**. Profiles created later are never reset.
- `online.presence.last.resetDue` — epoch still to apply locally for this profile (else null); after applying call
  `online.account.ackReset(epoch)` (meta app.js does this; at most once per profile per reset).
- `online.owner.listPlayers({ query, limit, offset })` → `{ ok, total, items:[{ id, username, name, clubName, coins, role, banned,
  friendCode, createdAt, lastSeenAt, online }] }` — owner/mod; empty query = everyone (newest first); matches name, username, club, friend code.
  Moderation search (`online.moderation.search`) also matches names/usernames.
- `online.cloud.get()` / `put(data, rev)` — UT save per account (≤ 1.5 MB). `net/cloudsave.js` syncs `pitchside.ut` automatically:
  sign up / first login uploads, login on another device downloads (old local club kept in `pitchside.ut.backup`).
- Dev: `node 3d/js/net/tests/mockserver.mjs 8202` + `/3d/index.html?mockServer=http://127.0.0.1:8202&presenceMs=1500` = one shared
  mock backend for several browser contexts (mock codes `mock-full` / `mock-super`).

## Migrations 005–007 — gifts, names, owner control panel
- Gifts (005): `owner.gift({ ..., minutes })` (expiry 1 min – 90 days, default 14 days); Card Creator cards travel
  with their photo (`photo` data URL ≤ 200 000 chars). `owner.gifts()` (pending), `owner.cancelGift(id)`, `owner.clearGifts()`.
  Receivers: `meta/core/customreg.js receiveCard(state, card)` puts any gifted card in the club, tradable.
- Every owner/mod call that takes a player accepts an id, username or friend code (`players.resolve(q)`).
- Names (006): an account's display name is always its username (friends, market seller, matchmaking, lists).
- Owner panel (007, owner powers only, audited): `owner.allPlayers()` / `listPlayers({limit ≤ 1000})` (accounts + guests,
  all in-game info), `owner.playerDetail(p)` (profile, cloud-saved club, squad, pending patches, audit, listings),
  `owner.patchPlayer(p, ops)` (club edits applied by the player's client — `meta/core/ownerpatch.js`: addCard,
  removeCard, editCard, setTradable, resetClub, resetObjectives, resetSbcs, setClubName; `online.patches.pending()/ack(ids)`),
  `owner.setUsername(p, name)`, `owner.giveAdmin(p)` / `revokeAdmin(p)`, `owner.revokeAllAdmin()` (roles → player,
  every issued admin token revoked; caller gets a fresh token), `owner.restrict(p, 'codes'|'admin'|'market'|'packs'|'messages',
  { on, minutes })` (enforced server-side; `presence.last.restrictions`, `admin.restricted(key)`), `owner.message(p, text)`.
  `owner.giveCoins` / `moderation.adjustCoins` up to ±9e15. Staff may list on the market at any price (1 – 9e15).
  Guests keep a cloud save too (`cloud.get/put` for any identity) so the owner sees every club.

## Migration 019 — owner resets, deletes and card removals actually reach the device
The server already did its part (epochs bumped, rows deleted); the client used to ignore it and re-upload / re-register its
local club. Now (client: `meta/core/remote.js`, `meta/core/wipe.js`, `net/services.js`, `net/cloudsave.js`):
- **Per-profile reset epochs.** `presence.last.resets` = `{ coins, progress, club }` (`hasResets` is false for the anonymous
  fallback). The device stores the last applied epochs per profile id (`pitchside.resetSeen.<id>`); higher epochs apply once:
  coins → wallet 5 000 / infinite off; progress → match stats, Rivals, weekly battles, objectives, SBCs, season track; club →
  fresh starter club (name, kit, coins, progress and the Vinson curse kept; saved cards, vault, saved squads, pending packs
  and market records go); all = the three. The player sees "An admin reset your club/progress/coins/account.". **First sight of
  a profile on a device only records** the epochs (new devices / logins are never reset by old epochs).
- **Server.** `owner.reset(p, 'club'|'all')` also deletes the cloud save row (a Vinson-locked profile keeps it) and closes the
  owner patches queued for the old club. `owner.patchPlayer` removeCard / resetClub cancel the player's market listings.
- **Deleted accounts.** After an `auth` error the client asks `identity_state(p_id)` → `{ exists }`. Deleted: the online
  identity (session, device secret, guest choice, admin token) is forgotten, `online.account.onDeleted(fn)` fires (main.js wipes
  the local club/progress synchronously, then shows "Your account was deleted by an admin." and the account gate) and calls
  resolve `{ ok:false, error:'deleted' }`. A network error while asking changes nothing; an expired session (profile still
  exists) logs out as before and keeps the local club.
- **Owner patches** (`meta/core/ownerpatch.js`): idempotent (applied ids kept in `state.appliedPatches`, so a lost ack never
  replays resetClub); removeCard removes the card from the club, squad, other saved squads, vault, saved cards, pending pack,
  transfer list, forced pulls and local market records. They are applied to the live club (or the saved club when the UT
  screen is closed) BEFORE every cloud upload (`createCloudSync({ beforeSync })`), and acknowledged only after the patched club is
  on the server (`afterSync` → `remote.flushAcks`); if a newer server copy replaces the local club first, the patch stays
  pending and re-applies.

## Migration 020 — Vinson battle: earned immunity and one-time rewards (`online.vinson`)
Three separate concepts, three separate paths; none implies another:
| concept | who / call | result |
|---|---|---|
| moderation unban | owner: `moderation.unban(id)` / `vinson.unban(id)` | `doom`/`banned` -> `released` (curse side effects stay) |
| owner lift | owner: `vinson.lift(id)` | any cursed phase -> `lifted`, **not** immune, no rewards |
| earned immunity | the player: `battleStart` + `battleWin` | `lifted` + permanent `immune`, rewards claimable once |

All three calls use the same auth as other authed RPCs (account session or device profile) and never throw.
- `vinson.battleStart()` -> `{ ok, nonce, minSeconds: 60, maxSeconds: 7200 }`. Only while cursed (`doom`/`banned`/`released`/`locked`)
  and not immune; a banned player must be unbanned first (`error:'banned'`). One open nonce per profile: starting again replaces it.
  Max 30 starts/hour (`rate_limited`). Errors: `not_cursed` (never cursed, owner, or already lifted), `already_immune`.
- `vinson.battleWin({ nonce })` -> `{ ok, immune:true, phase:'lifted', battleWon:true, rewardsClaimed }`. In one transaction: checks the
  nonce (issued to THIS profile, unconsumed, 60 s <= age <= 2 h), consumes it, lifts the curse exactly like the owner lift (restores
  restrictions added by the lock, clears the Vinson ban, marks the cloud save `vinson.phase = 'lifted'`) and sets immune + `battle_won_at`.
  **Idempotent**: once immune, any further call (any nonce) returns the same success and changes nothing. Errors: `no_battle` (no open nonce),
  `bad_nonce` (malformed, wrong, replaced, or another profile's), `too_soon` (`retryAfter` seconds; the nonce stays valid, retry later),
  `expired` (older than 2 h, nonce dropped: call `battleStart` again). An owner lift during the fight does not invalidate the open nonce.
- `vinson.claimBattleRewards()` -> `{ ok, claimed, cards:['vinson_reward_world','vinson_reward_phonk','vinson_reward_captain'] }`.
  Only after a win (`not_won` otherwise). The first call returns `claimed:true` and stamps `rewards_claimed_at`; every later call returns
  `claimed:false` with the **same ids**, so a device that reloaded mid-claim can reconcile. The server returns ids only: the client adds
  the cards to the club (and should keep a pending flag until it has saved them).
- `vinson.status()` now also returns `immune`, `battleWon`, `rewardsClaimed` (all booleans, false on older servers / owners / never cursed).
  Reload or a second device reads them to reconcile; a cloud save can never restore the curse.
- **Immune profiles are never re-cursed**: `vinson.pull()` answers `{ ok:true, immune:true, phase:'lifted' }` and starts no doom
  (server `pitchside_vinson_pull` checks immunity first and again under the row lock). `vinson.lock()` / `unban` / `lift` find nothing to act on.
- Server: table `pitchside_vinson` gains `immune`, `battle_won_at`, `rewards_claimed_at`, `battle_nonce_hash` (sha256 only), `battle_started_at`
  (check: immune <=> battle_won_at set; claimed needs immune). RPCs `pitchside_vinson_battle_start(p_id, p_secret)`,
  `pitchside_vinson_battle_win(p_id, p_secret, p_nonce)`, `pitchside_vinson_claim_rewards(p_id, p_secret)`; replaced `pitchside_vinson_pull`
  and `pitchside_vinson_status`; internal `pitchside__vinson_end_curse(uuid)` (not client-callable). Audit actions: `vinson_battle_start`,
  `vinson_battle_win`, `vinson_rewards`. Mock: same RPCs in `mockbackend.js`; tests in `net/tests/net.test.mjs` ("vinson battle: ...").
- Not checked server-side: the fight itself (only nonce + minimum duration). The owner list has no extra column for immunity.

# Meta core API (for the UI/net agents)

Owner: agent B (`3d/js/meta/core/**`, `3d/js/meta/tests/**`), except `chemistry.js` and `admincards.js`
(agent C). This doc covers the exports UI/net code is expected to call. Read a file's own header comment
for the full picture — this is a index/quick-reference, not a spec.

## Global config (`core/config.js`)
Owner-controlled settings (promos on/off, packs enabled, prices, reward multiplier, market tax) come from
`online.config` (net agent). This module never talks to the network:
- `setConfigProvider(fn)` — call once wherever `online` is wired up; `fn()` must be sync and return the
  latest known config object (or throw/return null — always handled safely).
- `getConfig()` — always returns a complete object (`CONFIG_DEFAULTS` merged with the provider's data).
  Keys: `promosEnabled`, `packsEnabled`, `disabledPacks` (id array), `packPriceMult`, `rewardMult`,
  `marketTaxPct`.
- `configuredPackPrice(price, cfg?)`, `configuredCoins(coins, cfg?)` — apply the multipliers.

Consumers already wired: `UT.storePacks()` (packsEnabled/disabledPacks/promosEnabled),
`UT.packPriceFor(pack)` (use this instead of `pack.price` when charging the user),
`UT.grantReward`/`UT.applyBattleResult` (rewardMult via `addCoins`), `PM.afterTax` (marketTaxPct).

## Coins — one consistent balance model (`core/ut.js`)
- `addCoins(state, delta)` — the only way anything should mutate `state.coins`. Clamps to >= 0, rounds,
  never NaN. Used internally by every reward/sale/purchase/admin-grant path in `core/`.

## SBC storage vault (`core/ut.js`)
Untradeable duplicate cards no longer vanish into a flat coin payout — they go to a vault (max 200 slots,
`VAULT_CAP`), which allows duplicates and can be spent in SBCs.
- `state.vault: string[]` — card ids, duplicates allowed, oldest trimmed once over `VAULT_CAP`.
- `vaultPlayers(state)` → player objects.
- `sendToVault(state, pid)` — push a card straight to the vault (does not touch club/squad).
- `takeFromVault(state, pid)` — move one copy back into the club.
- `isOwnedAnywhere(state, pid)` — true if in the club or the vault.
- `claimPackItem(state, pid)` — call this instead of `addToClub` when awarding a pack/reward card by id: if
  the player already owns that base player untradeably (or that exact id), it auto-routes to the vault
  instead of the club. Returns `{ where: 'club' | 'vault' | null }`.
- `submitSbc` now accepts ids from the vault as well as the club (spends the vault copy first, so the
  club's own copy of the same card survives). `sbcAutoFill` also draws candidates from the vault.

## Transfer list (`core/pmarket.js`)
FUT-style "send to transfer list": the card stays in the club/squad-eligible pool, just flagged for sale,
until it's actually listed.
- `transferList(state)` → player objects still flagged (auto-reconciles if a card left the club another way).
- `onTransferList(state, pid)`.
- `sendToTransferList(state, pid)` → `{ok}` | `{ok:false, error}` (rejects untradeable cards; cap
  `TRANSFER_LIST_MAX` = 100).
- `removeFromTransferList(state, pid)`.
- `listFromTransferList(state, online, pid, price)` — same contract as `listCard`, sourced from the list.

## Promos (`core/promos.js`) — 10 campaigns, release schedule, pack themes
`PROMOS` now has 10 entries (was 7): the original 7 plus `showdown`, `oty`, `centurions`, each with a
`releaseWeek` (absolute week number from `calendar.js`) — the first week it may appear **anywhere**. Every
promo also carries `theme` (a stable string id, currently equal to the promo id) for the pack-opening
agent's per-campaign background/rig — read it off `PROMO_BY_ID[id].theme` / `.colors` / `.tag`.
- `isPromoReleased(id, week?)` — has the release week arrived?
- `isCardReleased(card, week?)` — true for any non-promo card, or a promo card whose campaign released.
- `releasedLivePromos(week?)` — `livePromos(week)` filtered to released campaigns; use this (not
  `livePromos`) wherever you build player-facing content (objectives, "what's in the store").
- `isPromoLive(id, week?)` now also requires release — safe to keep using as-is.
- **Everything that can leak a spoiler now checks release status**: `UT.marketSearch`, `UT.storePacks`,
  `UT.sbcAvailable`, `OBJ.catalog`, `UT.battleOpponents`, `RV.aiOpponent`, `DR.chooseFormation`/`slotOptions`,
  and `UT.openPack`'s new "promo can drop from any pack" bonus (see below). A promo with a future
  `releaseWeek` is invisible everywhere until then, then behaves exactly like the original 7.

## Packs: promo drop-in (`core/ut.js`)
Non-promo packs (`gold`, `premium`, `rare`, `legend`, `lotg`) now have a small (1.5%) chance on their
higher-tier slots (`goldRare`/`gold83`/`gold86`/`lotg`) to swap in a card from a currently released+live
promo instead — so packs feel less repetitive. Dedicated promo packs are unaffected. The opened item's
`cat` becomes `promo_<id>` when this happens (same key format as the existing promo categories), so any
UI keyed off `CATEGORIES[cat].label` keeps working unmodified.

## Squad rules — no duplicate player (`core/teams.js`, `core/ut.js`)
- `personOf(p)` (`core/players.js`) — canonical identity of the real player/base card behind any version
  (regular, promo, admin, evolved…). Two cards with the same `personOf` are "the same player" and must
  never both be in one XI/bench.
- `bestLineup` / `autoBuildSquad` (`teams.js`) now enforce this internally — every AI/auto-built XI (Squad
  Battles, Rivals, Draft, tournaments, national teams, UT auto-squad) is duplicate-free by construction.
- `UT.setSquad(state, {formation, slots, bench})` — validated setter (formation exists, ids owned, no
  duplicate person); prefer this over assigning `state.squad` directly. `UT.dedupeSquad(state)` is the
  underlying sanitiser and also runs inside `migrateUT` and `squadSlots`, so even a squad written directly
  by other code self-heals.
- `UT.evaluateSbc` now always includes a leading `"No duplicate player"` check in `checks[0]`.
- Real players' `alt` arrays may hold up to **4** sensible alternates when that's what the position truly
  supports (e.g. Messi: `RW` + `RM`/`CAM`/`CF`/`ST`); generated players stay at ≤3 (unchanged).

## Real players (`core/realplayers.js`)
- `personOf`, `REAL_NAMES`, `REAL_ROW_COUNT`, `REG_ROW_COUNT` as before. `REG_CAP` (regulars-per-club cap,
  currently 29) **must stay well under 32** — a fictional club's roster doubles as a Career Mode starting
  squad (`career.js` caps a user's squad at 32; `makeBid` refuses once you're at the cap), so raising it
  without checking every club's total stays comfortably below 32 will break Career transfers.

## Admin cards (`core/admincards.js` — owned by agent C)
Not documented here beyond: it exists, resolves `ad_<baseId>` ids via `getPlayer`, and is intentionally kept
out of `db.all`/`db.players` so no pool that iterates those (packs, AI market, AI-opponent squads) can ever
surface one. Ask agent C for its current export list before integrating against it.

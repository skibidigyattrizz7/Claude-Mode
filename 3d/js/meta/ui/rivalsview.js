// Rivals: ranked UT mode. Divisions 10 -> 1 -> Elite, win +3 / draw +1 / loss 0.
// Online (when `online.rivals` + startOnlineMatch exist) the server owns the ladder; "Play vs AI Rival"
// always works and updates a local ladder only (clearly labelled).
import { h, add, fmtNum, confirmBox, modal } from './dom.js';
import { resultView, safeCall } from './app.js';
import { rewardFlow, rewardText } from './modesview.js';
import { tileIcon } from './icons.js';
import * as UT from '../core/ut.js';
import * as RV from '../core/rivals.js';
import { setFlag } from '../core/objectives.js';
import { msToWeekReset, fmtCountdown } from '../core/calendar.js';
import { resolveKitClash, gkKitFor } from '../core/teams.js';

const isTop = (app, view) => app.stack[app.stack.length - 1] === view;
const DIFF_LABEL = { amateur: 'Amateur', pro: 'Professional', world: 'World Class', legendary: 'Legendary' };

export function rivalsTile(app) {
  const r = RV.ensureRivals(app.ut);
  const ready = !!RV.claimableWeekly(r);
  return h('button', { class: 'pm-tile pm-tile--wide pm-tile--online', onclick: () => app.push(rivalsView()) },
    tileIcon('rivals'),
    ready ? h('span', { class: 'pm-badge' }, '!') : null,
    h('div', { class: 'pm-tile-body' }, h('h2', null, 'Rivals'), h('p', null, `${RV.divisionLabel(r.division)} · ${r.points} pts · ${app.startOnlineMatchFn ? 'online ranked + AI Rivals' : 'AI Rivals (offline)'}`)));
}

function normStatus(st) {
  if (!st || st.ok === false) return null;
  const d = Number(st.division);
  if (!Number.isFinite(d)) return null;
  return { division: d, points: Number(st.points) || 0, stageTargets: Array.isArray(st.stageTargets) && st.stageTargets.length ? st.stageTargets.map(Number) : RV.stageTargets(d), weeklyWins: Number(st.weeklyWins) || 0, rewardsReady: !!st.rewardsReady };
}

export function rivalsView() {
  const ui = { online: null, status: null, loading: false };
  const view = {
    title: 'Rivals', kicker: 'Ultimate Team', coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const local = RV.ensureRivals(s);
      if (ui.online === null && !ui.loading) {
        ui.loading = true;
        (async () => {
          const ok = !!(app.online && app.online.rivals && typeof app.online.rivals.status === 'function' && await app.onlineAvailable());
          ui.status = ok ? normStatus(await safeCall(() => app.online.rivals.status(), null)) : null;
          ui.online = !!ui.status;
          ui.loading = false;
          if (ui.online) onlineMilestone(app, ui.status);
          if (isTop(app, view)) app.refresh();
        })();
      }
      const online = ui.online && ui.status;
      const cur = online ? ui.status : { division: local.division, points: local.points, stageTargets: RV.stageTargets(local.division), weeklyWins: local.weeklyWins };
      const targets = cur.stageTargets;
      const max = targets[targets.length - 1] || 1;
      const bar = h('div', { class: 'pm-rvbar' }, h('i', { style: { width: `${Math.min(100, (cur.points / max) * 100)}%` } }),
        targets.map((t, i) => h('span', { class: `pm-rvmark ${cur.points >= t ? 'hit' : ''}`, style: { left: `${(t / max) * 100}%` }, title: i === targets.length - 1 && cur.division !== RV.ELITE ? 'Rank up' : 'Checkpoint' }, h('small', null, i === targets.length - 1 && cur.division !== RV.ELITE ? `▲ ${t}` : t))));
      const wr = RV.weeklyReward(cur.division, Math.max(1, cur.weeklyWins));
      const claim = online ? (ui.status.rewardsReady ? { online: true } : null) : RV.claimableWeekly(local);
      const canOnline = !!(app.startOnlineMatchFn && online);
      add(main,
        h('section', { class: 'pm-rankcard pm-rivals' },
          h('div', { class: `pm-rankbadge r${cur.division === RV.ELITE ? 4 : Math.max(0, Math.min(3, Math.floor((10 - cur.division) / 2.5)))}` }, cur.division === RV.ELITE ? 'E' : String(cur.division), h('small', null, cur.division === RV.ELITE ? 'ELITE' : 'DIV')),
          h('div', { class: 'pm-rankinfo' },
            h('div', { class: 'pm-kicker' }, online ? 'Online ranked ladder' : ui.loading ? 'Checking online…' : 'Local ladder (offline / AI Rivals)'),
            h('h2', null, RV.divisionLabel(cur.division)),
            bar,
            h('small', { class: 'pm-dim' }, cur.division === RV.ELITE ? `${cur.points} pts in Elite` : `${cur.points} / ${max} pts to rank up · Win +3 · Draw +1 · Loss 0`)),
          h('div', { class: 'pm-rankside' },
            h('button', { class: 'pm-btn pm-btn--primary pm-btn--lg', disabled: !canOnline, title: canOnline ? '' : 'Online Rivals unavailable', onclick: () => playOnline(app, view, ui) }, 'Play Rivals online'),
            h('button', { class: 'pm-btn', onclick: () => playAi(app, view, ui) }, 'Play vs AI Rival'),
            !canOnline ? h('small', { class: 'pm-dim' }, 'Online unavailable — AI Rival matches count on your local ladder.') : online ? h('small', { class: 'pm-dim' }, 'AI Rival matches only update your local ladder.') : null)),
        h('section', { class: 'pm-panel pm-rvweek' },
          h('div', null, h('h3', null, 'Weekly rewards'), h('small', { class: 'pm-dim' }, `Resets in ${fmtCountdown(msToWeekReset())} · ${cur.weeklyWins} win${cur.weeklyWins === 1 ? '' : 's'} this week`),
            h('div', { class: 'pm-rvtiers' }, RV.TIER_WINS.map((w) => h('div', { class: `pm-rvtier ${cur.weeklyWins >= w ? 'hit' : ''}` }, h('b', null, `${w}W`), h('small', null, rewardText(RV.weeklyReward(cur.division, w))))))),
          claim ? h('button', { class: 'pm-btn pm-btn--accent pm-btn--lg pm-pulse', onclick: () => claimWeekly(app, view, ui) }, 'Claim weekly rewards') : h('small', { class: 'pm-dim' }, online ? 'Rewards unlock at the weekly reset.' : `Reach 3 wins to unlock this week's rewards (now: ${rewardText(wr)}).`)),
        h('section', { class: 'pm-section' }, h('h3', { class: 'pm-h' }, 'Divisions'),
          h('div', { class: 'pm-rvladder' }, RV.DIVISIONS.slice().reverse().map((d) => h('div', { class: `pm-rvrow ${d === cur.division ? 'me' : ''}` },
            h('b', null, RV.divisionLabel(d)), h('small', { class: 'pm-dim' }, d === RV.ELITE ? 'Top tier' : `${RV.rankUpTarget(d)} pts to rank up`),
            h('small', null, `7W: ${rewardText(RV.weeklyReward(d, 7))}`), h('small', { class: 'pm-dim' }, `Milestone: ${rewardText(RV.milestoneReward(d))}`))))),
        local.history.length ? h('section', { class: 'pm-section' }, h('h3', { class: 'pm-h' }, 'Recent Rivals matches'),
          h('div', { class: 'pm-history' }, local.history.slice(0, 8).map((x) => h('div', { class: `pm-hrow o-${x.outcome}` }, h('b', null, x.outcome), h('span', null, `${x.gf ?? '?'}–${x.ga ?? '?'} vs ${x.opp}${x.ai ? ' (AI)' : ''}`), h('small', { class: 'pm-dim' }, `+${x.pts} pts`))))) : null);
    },
  };
  return view;
}

function onlineMilestone(app, st) {
  const s = app.ut;
  const r = RV.ensureRivals(s);
  r.onlineMilestones = r.onlineMilestones || [];
  const d = st.division;
  const prevBest = r.onlineBest ?? 10;
  const better = d === RV.ELITE ? prevBest !== RV.ELITE : prevBest !== RV.ELITE && d < prevBest;
  if (!better) return;
  r.onlineBest = d;
  if (r.onlineMilestones.includes(d)) { app.saveUT(); return; }
  r.onlineMilestones.push(d);
  rewardFlow(app, () => UT.grantReward(s, RV.milestoneReward(d), `Rivals milestone: ${RV.divisionLabel(d)}`), `Rank up! ${RV.divisionLabel(d)}`);
}

async function claimWeekly(app, view, ui) {
  const s = app.ut;
  if (ui.online) {
    const res = await safeCall(() => app.online.rivals.claimWeekly(), { ok: false });
    if (!res || res.ok === false) { app.toast(res && res.error ? String(res.error) : 'Could not claim rewards.', 'bad'); return; }
    await app.refreshOnlineCoins();
    rewardFlow(app, () => {
      const out = [];
      if (Number(res.coins)) out.push(`${fmtNum(Number(res.coins))} coins (online balance)`);
      for (const pk of res.packs || []) if (UT.PACK_BY_ID[pk]) { s.packs.push({ type: pk, from: 'Rivals weekly' }); out.push(UT.PACK_BY_ID[pk].name); }
      if (res.pick) out.push(...UT.grantReward(s, { pick: res.pick }, 'Rivals weekly'));
      return out.length ? out : ['Rewards claimed'];
    }, 'Rivals weekly rewards');
    ui.online = null;
    return;
  }
  const r = RV.ensureRivals(s);
  const reward = RV.takeWeekly(r);
  if (!reward) return;
  rewardFlow(app, () => {
    const out = UT.grantReward(s, { coins: reward.coins, pick: reward.pick }, 'Rivals weekly');
    for (const pk of reward.packs) { s.packs.push({ type: pk, from: 'Rivals weekly' }); out.push(UT.PACK_BY_ID[pk].name); }
    return out;
  }, 'Rivals weekly rewards');
}

function recordLocal(app, outcome, meta) {
  const s = app.ut;
  const r = RV.ensureRivals(s);
  const res = RV.applyRivalsResult(r, outcome, meta);
  s.stats.matches++; s.stats.goals += meta.gf || 0;
  if (outcome === 'W') s.stats.wins++; else if (outcome === 'D') s.stats.draws++; else s.stats.losses++;
  setFlag(s, 'rivalsPlayed');
  app.saveUT();
  if (res.milestone) setTimeout(() => rewardFlow(app, () => UT.grantReward(s, res.milestone, `Rivals milestone: ${RV.divisionLabel(r.division)}`), `Rank up! ${RV.divisionLabel(r.division)}`), 300);
  else if (res.rankedUp) app.toast(`Ranked up to ${RV.divisionLabel(r.division)}!`, 'good');
  return res;
}

async function playAi(app, view, ui) {
  const s = app.ut;
  const team = UT.utTeam(s);
  if (!team) { app.toast('Complete your starting XI first.', 'warn'); return; }
  const r = RV.ensureRivals(s);
  const diff = RV.aiDifficulty(r.division);
  const opp = RV.aiOpponent(`rv-${r.week}-${r.weeklyPlayed}-${r.division}`, diff, { label: 'RIV' });
  if (!(await confirmBox(app.root, 'AI Rival', `${opp.name} · ${DIFF_LABEL[diff]} · rating ${opp.rating}. Counts on your local Rivals ladder only.`, 'Kick off'))) return;
  const away = structuredClone(opp.team);
  away.kit = resolveKitClash(team.kit, away.kit, opp.awayKit);
  away.gkKit = gkKitFor(team.kit, away.kit, team.gkKit);
  const result = await app.playMatch(team, away, { halfMinutes: app.settings.halfMinutes, difficulty: diff, userSide: 'home', mode: 'rivals' });
  if (!result) return;
  const after = app.afterMatch({ team, result, side: 'home', mode: 'rivals' });
  const m = after.m;
  const res = recordLocal(app, m.outcome, { gf: m.gf, ga: m.ga, opp: opp.name, ai: true });
  app.push(resultView({ title: 'Rivals (AI)', kicker: RV.divisionLabel(RV.ensureRivals(s).division), home: team, away, result, userSide: 'home',
    extra: h('section', { class: 'pm-rewards' }, h('div', null, h('span', { class: 'pm-dim' }, 'Points'), h('b', null, `+${res.points}`)), h('div', null, h('span', { class: 'pm-dim' }, 'Division'), h('b', null, RV.divisionLabel(RV.ensureRivals(s).division)))),
    onContinue: (a) => a.pop() }));
}

async function playOnline(app, view, ui) {
  const s = app.ut;
  const team = UT.utTeam(s);
  if (!team) { app.toast('Complete your starting XI first.', 'warn'); return; }
  let finished = false;
  let offerAi = null;
  const aiBtn = h('button', { class: 'pm-btn', hidden: true, onclick: () => { cancel(); offerAi = true; } }, 'Play vs AI Rival instead');
  const cancel = () => { try { app.online && app.online.matchmaking && app.online.matchmaking.cancelSearch && app.online.matchmaking.cancelSearch(); } catch { /* ignore */ } };
  const busy = h('div', { class: 'pm-busy', role: 'status' }, h('div', { class: 'pm-spinner' }), h('div', null, 'Rivals'), h('small', null, 'Searching for an opponent…'),
    h('div', { class: 'pm-btnrow' }, h('button', { class: 'pm-btn pm-btn--ghost', onclick: () => { cancel(); } }, 'Cancel search'), aiBtn));
  app.root.appendChild(busy);
  const t = setTimeout(() => { if (!finished) { aiBtn.hidden = false; busy.querySelector('small').textContent = 'No opponent yet (60 s). Keep waiting or play an AI Rival.'; } }, 60000);
  let res = null;
  try { res = await app.startOnlineMatchFn({ mode: 'rivals', team, searchTimeoutMs: 60000 }); } catch (e) { console.warn('[meta] rivals online failed', e); }
  finished = true; clearTimeout(t); busy.remove();
  if (app.destroyed) return;
  if (offerAi || !res || res.ok === false || res.abandoned || res.cancelled) {
    const why = res && (res.error || res.reason) ? String(res.error || res.reason).replace('no_opponent', 'No opponent found') : 'No online match was played.';
    if (offerAi || /opponent|timeout|no match|unavailable|offline/i.test(why)) {
      if (offerAi || await confirmBox(app.root, 'No opponent found', `${why} Play an AI Rival instead? (local ladder only)`, 'Play AI Rival')) playAi(app, view, ui);
    } else app.toast(why, 'warn');
    return;
  }
  const side = res.userSide || res.side || (res.role === 'guest' ? 'away' : 'home');
  const after = app.afterMatch({ team, result: res, side, mode: 'rivals' });
  const m = after ? after.m : { outcome: 'D', gf: 0, ga: 0 };
  s.stats.matches++; s.stats.goals += m.gf;
  if (m.outcome === 'W') s.stats.wins++; else if (m.outcome === 'D') s.stats.draws++; else s.stats.losses++;
  setFlag(s, 'rivalsPlayed');
  const r = RV.ensureRivals(s);
  r.history.unshift({ outcome: m.outcome, pts: m.outcome === 'W' ? 3 : m.outcome === 'D' ? 1 : 0, gf: m.gf, ga: m.ga, opp: (res.opponent && (res.opponent.name || res.opponent)) || 'Online rival', ai: false });
  r.history = r.history.slice(0, 20);
  app.saveUT();
  await app.refreshOnlineCoins();
  ui.online = null;
  const coins = Number(res.coinsAwarded);
  modal(app.root, {
    title: m.outcome === 'W' ? 'Victory!' : m.outcome === 'L' ? 'Defeat' : 'Draw', className: 'pm-claim',
    body: h('div', { class: 'pm-claim-body' }, h('h2', null, `${m.gf} – ${m.ga}`), h('div', { class: 'pm-claim-chips' },
      h('div', { class: 'pm-claim-chip' }, `+${m.outcome === 'W' ? 3 : m.outcome === 'D' ? 1 : 0} Rivals points`),
      Number.isFinite(coins) && coins ? h('div', { class: 'pm-claim-chip' }, `+${fmtNum(coins)} coins`) : null)),
    actions: [{ label: 'Continue', primary: true, onClick: () => app.refresh() }],
  });
}

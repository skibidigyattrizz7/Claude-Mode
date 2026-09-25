// UT "Online Seasons" (Rivals-style divisions). The match itself (matchmaking + online play) is run by
// main.js through startOnlineMatch({ mode:'ut', team }); main.js also reports results to the server.
import { h, add, fmtNum, confirmBox } from './dom.js';
import * as UT from '../core/ut.js';
import { safeCall } from './app.js';

const isTop = (app, view) => app.stack[app.stack.length - 1] === view;

/** Division name for a numeric division (10 = lowest .. 1 = highest). */
export function divisionName(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return String(d || 'Unranked');
  return n <= 1 ? 'Division 1 · Elite' : `Division ${n}`;
}

export function onlineSeasonsTile(app) {
  const enabled = !!app.startOnlineMatchFn;
  return h('button', {
    class: `pm-tile pm-tile--wide pm-tile--online ${enabled ? '' : 'is-disabled'}`,
    'aria-disabled': enabled ? 'false' : 'true',
    onclick: () => { if (!enabled) { app.toast('Online Seasons is not available in this build (no online match service).', 'warn'); return; } app.push(onlineSeasonsView()); },
  },
  h('div', { class: 'pm-tile-art pm-art-online', 'aria-hidden': 'true' }, h('span', null, 'VS')),
  h('div', { class: 'pm-tile-body' }, h('h2', null, 'Online Seasons'), h('p', null, enabled ? 'Ranked UT matches vs real managers · climb divisions' : 'Unavailable — online play not connected')));
}

export function onlineSeasonsView() {
  const st = { profile: null, loading: false, last: null };
  const view = {
    title: 'Online Seasons', kicker: 'Ultimate Team', coins: true,
    render(main, app) {
      const s = app.ut;
      if (!st.profile && !st.loading && app.online && typeof app.online.profile === 'function') {
        st.loading = true;
        safeCall(() => app.online.profile(), { ok: false }).then((r) => { st.loading = false; st.profile = r || { ok: false }; if (isTop(app, view)) app.refresh(); });
      }
      const p = st.profile;
      const online = p && p.ok !== false;
      const div = online ? p.division : null;
      const divNum = Number(div);
      const team = UT.utTeam(s);
      add(main,
        h('section', { class: 'pm-rankcard pm-rivals' },
          h('div', { class: `pm-rankbadge r${Number.isFinite(divNum) ? Math.max(0, Math.min(4, Math.floor((10 - divNum) / 2.5))) : 0}` }, Number.isFinite(divNum) ? String(divNum) : '–', h('small', null, 'DIV')),
          h('div', { class: 'pm-rankinfo' },
            h('div', { class: 'pm-kicker' }, online ? `Manager: ${String(p.name || 'Anonymous').slice(0, 24)}` : st.loading ? 'Loading profile…' : 'Offline'),
            h('h2', null, online ? divisionName(div) : st.loading ? '…' : 'Profile unavailable'),
            h('div', { class: 'pm-progress' }, h('i', { style: { width: `${Number.isFinite(divNum) ? ((10 - Math.min(10, Math.max(1, divNum))) / 9) * 100 : 0}%` } })),
            h('small', { class: 'pm-dim' }, online ? `Skill rating ${fmtNum(Number(p.rating) || 0)} · Online coins ${fmtNum(Number(p.coins) || 0)}` : 'Connect to play ranked matches. Your division and rating come from the online profile.'),
            h('small', { class: 'pm-dim' }, 'Divisions 10 → 1. Win to gain rating; rewards are credited to your online balance.')),
          h('div', { class: 'pm-rankside' },
            h('button', {
              class: 'pm-btn pm-btn--primary pm-btn--lg', disabled: !team,
              onclick: () => play(app, view, st),
            }, 'Find match'),
            team ? h('small', { class: 'pm-dim' }, `${team.name} · ${team.formation} · Chem ${team.chemistry}`) : h('small', { class: 'pm-warnline' }, 'Complete your starting XI first.'))),
        st.last ? lastResult(st.last) : null,
        h('p', { class: 'pm-hint' }, 'Matchmaking pairs you with a real manager. Leaving a match early counts as a loss.'));
    },
  };
  return view;
}

function lastResult(r) {
  return h('section', { class: `pm-panel pm-onlineres o-${r.outcome}` },
    h('div', { class: 'pm-kicker' }, 'Last online match'),
    h('h3', null, `${r.outcome === 'W' ? 'Victory' : r.outcome === 'L' ? 'Defeat' : 'Draw'} ${r.gf}–${r.ga}${r.opponent ? ` vs ${r.opponent}` : ''}`),
    h('div', { class: 'pm-rewards' },
      h('div', null, h('span', { class: 'pm-dim' }, 'Coins'), h('b', null, r.coins != null ? `+${fmtNum(r.coins)}` : '—')),
      h('div', null, h('span', { class: 'pm-dim' }, 'Rating'), h('b', null, r.rating != null ? fmtNum(r.rating) : '—')),
      h('div', null, h('span', { class: 'pm-dim' }, 'Division'), h('b', null, r.division != null ? divisionName(r.division) : '—'))));
}

async function play(app, view, st) {
  const s = app.ut;
  const team = UT.utTeam(s);
  if (!team) { app.toast('Your starting XI is incomplete.', 'warn'); return; }
  if (!app.startOnlineMatchFn) { app.toast('Online play is not available.', 'warn'); return; }
  if (!(await confirmBox(app.root, 'Online Seasons', `Search for an opponent with ${team.name} (${team.formation}, chemistry ${team.chemistry})?`, 'Find match'))) return;
  const busy = h('div', { class: 'pm-busy', role: 'status' }, h('div', { class: 'pm-spinner' }), h('div', null, 'Online Seasons'), h('small', null, 'Finding an opponent…'));
  app.root.appendChild(busy);
  let res = null;
  try { res = await app.startOnlineMatchFn({ mode: 'ut', team }); } catch (e) { console.warn('[meta] startOnlineMatch failed', e); } finally { busy.remove(); }
  if (app.destroyed) return;
  if (!res || res.abandoned || res.ok === false || res.cancelled) { app.toast(res && res.error ? String(res.error) : 'No online match was played.', 'warn'); return; }
  const side = res.userSide || res.side || (res.role === 'guest' ? 'away' : 'home');
  const hg = Number(res.homeGoals) || 0, ag = Number(res.awayGoals) || 0;
  const gf = side === 'home' ? hg : ag, ga = side === 'home' ? ag : hg;
  const outcome = gf > ga ? 'W' : gf < ga ? 'L' : (res.pens ? ((side === 'home' ? res.pens[0] > res.pens[1] : res.pens[1] > res.pens[0]) ? 'W' : 'L') : 'D');
  s.stats.matches++; s.stats.goals += gf;
  if (outcome === 'W') s.stats.wins++; else if (outcome === 'D') s.stats.draws++; else s.stats.losses++;
  s.online = s.online || { played: 0, wins: 0 };
  s.online.played++; if (outcome === 'W') s.online.wins++;
  app.saveUT();
  const rep = res.report || res.reward || res;
  const opp = res.opponent && (res.opponent.name || res.opponent);
  st.last = { outcome, gf, ga, coins: Number.isFinite(Number(rep.coinsAwarded)) ? Number(rep.coinsAwarded) : null, rating: Number.isFinite(Number(rep.rating)) ? Number(rep.rating) : null, division: rep.division ?? null, opponent: typeof opp === 'string' ? opp.slice(0, 30) : null };
  if (app.onEvolutionMatch) app.onEvolutionMatch(res, side, team);
  st.profile = null;
  await app.refreshOnlineCoins();
  app.toast(`${outcome === 'W' ? 'Victory' : outcome === 'L' ? 'Defeat' : 'Draw'} ${gf}–${ga}${st.last.coins ? ` · +${fmtNum(st.last.coins)} coins` : ''}`, outcome === 'W' ? 'good' : 'info');
  if (isTop(app, view)) app.refresh();
}

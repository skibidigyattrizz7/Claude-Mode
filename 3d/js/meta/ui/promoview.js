// V3 promo campaigns hub: live campaigns (pack with odds, SBCs, objectives), calendar and every promo card.
import { h, add, fmtNum, confirmBox } from './dom.js';
import { playerCard } from './card.js';
import { packArt } from './packopen.js';
import * as UT from '../core/ut.js';
import { getDB } from '../core/players.js';
import { PROMOS, PROMO_BY_ID, releasedLivePromos, promoSchedule, isPromoReleased } from '../core/promos.js';
import { weekNumber, msToWeekReset, fmtCountdown } from '../core/calendar.js';
import { getConfig, effPrice } from './config.js';

const promoCards = (id) => (getDB().promos || []).filter((p) => p.special === id).sort((a, b) => b.ovr - a.ovr);
const style = (pr) => ({ '--pa': pr.colors[0], '--pb': pr.colors[1], '--pc': pr.colors[2] });

/** Hub tile subtitle. */
export function promoTileSub() { return releasedLivePromos().map((id) => PROMO_BY_ID[id].name).join(' · '); }

export function promoHubView(deps) {
  const ui = { browse: releasedLivePromos()[0] || PROMOS[0].id };
  return {
    title: 'Promos', kicker: `Week ${weekNumber()}`, coins: true, cls: 'pm-main--wide',
    render(main, app) {
      const s = app.ut;
      const cfg = getConfig();
      const live = cfg.promosOn ? releasedLivePromos() : [];
      const released = PROMOS.filter((pr) => isPromoReleased(pr.id));
      const week = weekNumber();
      const sched = promoSchedule(week, 6);
      add(main,
        !cfg.promosOn ? h('p', { class: 'pm-warnline' }, 'Promo campaigns are temporarily disabled by the owner. The calendar and card gallery below still work.') : h('p', { class: 'pm-lead' }, `Two campaigns are live every week; a new one starts in ${fmtCountdown(msToWeekReset())}.`),
        ...live.map((id, i) => {
          const pr = PROMO_BY_ID[id];
          const pack = UT.PACK_BY_ID[`promo_${id}`];
          const price = effPrice(pack.price);
          const cards = promoCards(id);
          const sbcs = UT.SBCS.filter((x) => x.promo === id);
          const ends = i === 0 && live.length > 1 ? 'Ends in 2 weeks' : `Ends in ${fmtCountdown(msToWeekReset())}`;
          return h('section', { class: `pm-promo pm-promo--${id}`, style: style(pr), 'data-promo': id },
            // Announcement screen (FUT21/22 style): big campaign title over a themed stage, the squad in rows.
            h('div', { class: 'pm-promo-head' },
              h('div', { class: 'pm-promo-titles' }, h('div', { class: 'pm-kicker' }, i === 0 ? 'New this week' : 'Last chance', ' · ', ends),
                h('h2', { class: 'pm-promo-title' }, pr.name), h('div', { class: 'pm-promo-batch' }, `Batch 1 · ${cards.length} players`), h('p', null, pr.desc))),
            h('div', { class: 'pm-promo-stage' }, cards.map((p) => playerCard(p, { size: 'sm', onClick: () => deps.playerModal(app, p) }))),
            h('div', { class: 'pm-promo-row' },
              h('div', { class: 'pm-storeitem pm-promo-pack' }, packArt(pack, 'md'),
                h('div', { class: 'pm-storeinfo' }, h('h4', null, pack.name), h('p', { class: 'pm-dim' }, pack.desc),
                  h('div', { class: 'pm-price' }, h('i', { class: 'pm-coin', 'aria-hidden': 'true' }), fmtNum(price)),
                  h('div', { class: 'pm-btnrow' },
                    h('button', { class: 'pm-btn pm-btn--ghost pm-btn--sm', onclick: () => deps.oddsModal(app, pack) }, 'View odds'),
                    h('button', {
                      class: 'pm-btn pm-btn--primary pm-btn--sm', disabled: s.coins < price, 'data-buy': pack.id,
                      onclick: async () => {
                        if (!(await confirmBox(app.root, pack.name, `Buy ${pack.name} for ${fmtNum(price)} coins?`, 'Buy & open'))) return;
                        if (s.coins < price) return;
                        s.coins -= price; app.saveUT(); app.renderTop(app.stack[app.stack.length - 1]);
                        deps.openPackFlow(app, pack.id);
                      },
                    }, 'Buy & open')))),
              h('div', { class: 'pm-promo-side' },
                h('h4', null, 'SBCs'),
                sbcs.map((sbc) => h('button', { class: 'pm-btn pm-btn--sm pm-promo-sbc', disabled: !UT.sbcAvailable(s, sbc), onclick: () => app.push(deps.sbcDetailView(sbc.id)) },
                  sbc.name, h('small', { class: 'pm-dim' }, ` · ${deps.rewardText(sbc.reward)}`))),
                h('h4', null, 'Objectives'),
                h('button', { class: 'pm-btn pm-btn--sm', onclick: () => app.push(deps.objectivesHubView('promo')) }, 'Promo objectives ›'))),
          );
        }),
        h('section', { class: 'pm-section' }, h('h3', { class: 'pm-h' }, 'Promo calendar'),
          h('div', { class: 'pm-promo-cal' }, sched.map((x, i) => {
            const pr = PROMO_BY_ID[x.promo];
            // an unreleased campaign stays a teaser (no name, no colours) until its launch week
            if (!isPromoReleased(pr.id)) return h('div', { class: 'pm-promo-calitem is-teaser' }, h('small', null, `Week ${x.week}`), h('b', null, 'NEW PROMO'));
            return h('div', { class: `pm-promo-calitem ${i === 0 ? 'is-now' : ''}`, style: style(pr) }, h('small', null, i === 0 ? 'This week' : `Week ${x.week}`), h('b', null, pr.short));
          }))),
        h('section', { class: 'pm-section' }, h('h3', { class: 'pm-h' }, 'All campaigns'),
          h('div', { class: 'pm-tabs', role: 'tablist' }, released.map((pr) => h('button', {
            class: `pm-tab ${ui.browse === pr.id ? 'on' : ''}`, role: 'tab', 'aria-selected': String(ui.browse === pr.id), onclick: () => { ui.browse = pr.id; app.refresh(); },
          }, pr.short))),
          h('p', { class: 'pm-dim' }, PROMO_BY_ID[ui.browse].desc, live.includes(ui.browse) ? ' Live now.' : ' Not live this week. Cards can still appear on the markets.'),
          h('div', { class: 'pm-cardgrid' }, promoCards(ui.browse).map((p) => playerCard(p, { size: 'sm', onClick: () => deps.playerModal(app, p) })))),
      );
    },
  };
}

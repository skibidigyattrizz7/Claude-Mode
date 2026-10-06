// Friends inside Ultimate Team (no need to leave UT): add by username or friend code, requests, friends
// list with view squad and invite (friend challenge). The panel itself is net/friendsui.js (also used by
// Settings → Account).
import { h, add } from './dom.js';
import { icon } from './icons.js';
import { mountFriends } from '../../net/friendsui.js';

/** Header button that opens the Friends view (badge = pending friend requests). */
export function friendsButton(app) {
  const btn = h('button', { class: 'pm-giftsbtn', 'aria-label': 'Friends', title: 'Friends', 'data-friends-btn': '1', onclick: () => app.push(friendsView()) }, icon('squad'));
  const n = app.online && app.online.presence && app.online.presence.last ? app.online.presence.last.requests : 0;
  if (n) btn.appendChild(h('span', { class: 'pm-badge pm-badge--dot' }, String(n)));
  return btn;
}

export function friendsView() {
  let panel = null; // kept across re-renders (account / presence refreshes) so messages and open squads stay
  return {
    title: 'Friends', kicker: 'Ultimate Team', coins: true,
    render(main, app) {
      if (!app.online || !app.online.friends) { add(main, h('p', { class: 'pm-dim' }, 'Friends need the online service.')); return; }
      const canInvite = typeof app.startOnlineMatchFn === 'function';
      add(main,
        h('section', { class: 'pm-panel' }, panel || (panel = mountFriends(app.online, {
          toast: (t) => app.toast(t, 'good'),
          onInvite: canInvite ? async (f, mode) => {
            const r = await app.startOnlineMatchFn({ mode, friend: { id: f.id, name: f.name, rating: f.rating } });
            if (app.destroyed) return;
            if (r && r.ok) app.toast(`Match vs ${f.name} finished.`, 'good');
            else if (r && r.reason && r.reason !== 'cancelled') app.toast(`Invite to ${f.name}: ${r.message || r.reason}.`, 'warn');
            if (mode === 'ut' && typeof app.refreshOnlineCoins === 'function') app.refreshOnlineCoins();
          } : null,
        }))),
        h('p', { class: 'pm-dim' }, icon('bell'), ' Invites reach friends who have Pitchside open; they get a banner to accept.'));
    },
  };
}

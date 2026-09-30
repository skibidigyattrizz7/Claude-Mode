// Pitchside 3D — relay fallback for online play.
// When a direct WebRTC link can't open (strict NAT / firewalls), both sides meet on a Supabase
// Realtime broadcast channel named after the room and exchange the same encoded messages there.
// Handshake: guest broadcasts 'hello' {n} until the host answers 'welcome' {n}; every data message
// carries the nonce so stale guests are ignored.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

let clientP = null;
function client() {
  if (clientP) return clientP;
  clientP = new Promise((resolve, reject) => {
    const make = () => {
      try {
        resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          realtime: { params: { eventsPerSecond: 60 } },
        }));
      } catch (e) { reject(e); }
    };
    if (window.supabase && window.supabase.createClient) { make(); return; }
    const s = document.createElement('script');
    s.src = new URL('../../vendor/supabase.js', import.meta.url).href;
    s.async = true;
    s.onload = () => (window.supabase && window.supabase.createClient ? make() : reject(new Error('supabase-js did not initialise')));
    s.onerror = () => reject(new Error('Could not load supabase-js'));
    document.head.appendChild(s);
  }).catch((e) => { clientP = null; throw e; });
  return clientP;
}

/**
 * Owner "pokes" (owner, Sep 30: admin commands must land near-instantly). One shared broadcast channel; after an
 * owner / mod action the owner's client sends { to: playerId | null } and the matching clients check in with the
 * server at once (services.js presence). A poke carries no data and grants nothing: the worst a forged poke can
 * do is make a client ask the server for its own state early (rate-limited on both sides).
 */
export async function openPokes(onPoke) {
  const sb = await client();
  const ch = sb.channel('ps-poke', { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'p' }, ({ payload }) => { try { onPoke(payload && typeof payload === 'object' ? payload : {}); } catch { /* ignore */ } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('poke channel timed out')), 12000);
    ch.subscribe((st) => {
      if (st === 'SUBSCRIBED') { clearTimeout(t); resolve(); } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); reject(new Error('poke channel unavailable')); }
    });
  });
  return {
    // k: what changed ('cfg' = global config such as store packs), so receivers can refetch it directly
    send(to, k) { try { ch.send({ type: 'broadcast', event: 'p', payload: { to: typeof to === 'string' ? to : null, k: k === 'cfg' ? 'cfg' : null } }); } catch { /* ignore */ } },
    close() { try { sb.removeChannel(ch); } catch { /* ignore */ } },
  };
}

/**
 * Join the relay channel for room `id` as side 'h' (host) or 'g' (guest).
 * handlers: onData(raw, nonce), onHello({n}), onWelcome({n}). Resolves once subscribed.
 */
export async function openRelay(id, side, { onData, onHello, onWelcome } = {}) {
  const sb = await client();
  const ch = sb.channel('ps-relay-' + id, { config: { broadcast: { self: false, ack: false } } });
  const other = side === 'h' ? 'g' : 'h';
  ch.on('broadcast', { event: 'm' }, ({ payload: p }) => {
    if (p && p.s === other && typeof p.d === 'string' && onData) onData(p.d, p.n);
  });
  ch.on('broadcast', { event: 'hello' }, ({ payload: p }) => { if (side === 'h' && p && onHello) onHello(p); });
  ch.on('broadcast', { event: 'welcome' }, ({ payload: p }) => { if (side === 'g' && p && onWelcome) onWelcome(p); });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Relay server timed out.')), 12000);
    ch.subscribe((st) => {
      if (st === 'SUBSCRIBED') { clearTimeout(t); resolve(); } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); reject(new Error('Relay server unavailable.')); }
    });
  });
  return {
    send(raw, n, rt = false) {
      // realtime messages are dropped while the socket still has a backlog (see transport.js backlogged)
      try { const ws = sb.realtime && sb.realtime.conn; if (rt && ws && ws.bufferedAmount > 48 * 1024) return false; } catch { /* ignore */ }
      try { ch.send({ type: 'broadcast', event: 'm', payload: { s: side, n, d: raw } }); return true; } catch { return false; }
    },
    signal(event, payload) { try { ch.send({ type: 'broadcast', event, payload }); } catch { /* ignore */ } },
    close() { try { sb.removeChannel(ch); } catch { /* ignore */ } },
  };
}

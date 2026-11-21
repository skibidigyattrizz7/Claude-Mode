// Queue the initial Vinson pull until the pack has closed.
export function createVinsonPackClaim(items, cardId, onPull) {
  let seen = items.some(item => item.pid === cardId), closed = false;
  return {
    observe(pid) { if (pid === cardId) seen = true; },
    close() {
      if (closed) return;
      closed = true;
      if (seen) onPull();
    },
  };
}

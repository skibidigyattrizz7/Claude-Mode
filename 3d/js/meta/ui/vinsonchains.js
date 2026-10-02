const SVG = 'http://www.w3.org/2000/svg';
let chainId = 0;

function node(name, attrs = {}) {
  const el = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** Metal X-chains with a center lock, sized to fill a player-card overlay. */
export function createVinsonChains() {
  const instance = ++chainId;
  const metalId = `vinson-chain-metal-${instance}`;
  const lockMetalId = `vinson-lock-metal-${instance}`;
  const svg = node('svg', {
    class: 'vinson-chains', viewBox: '0 0 260 360', preserveAspectRatio: 'xMidYMid meet',
    role: 'img', 'aria-label': 'Crossed metal chains and padlock', focusable: 'false',
  });
  const defs = node('defs');
  const metal = node('linearGradient', { id: metalId, x1: '0', y1: '0', x2: '1', y2: '1' });
  for (const [offset, color] of [['0%', '#403d3a'], ['18%', '#e3ddd2'], ['38%', '#77736d'], ['54%', '#f4eee3'], ['77%', '#69645d'], ['100%', '#242321']]) {
    metal.append(node('stop', { offset, 'stop-color': color }));
  }
  const lockMetal = node('linearGradient', { id: lockMetalId, x1: '0', y1: '0', x2: '0', y2: '1' });
  for (const [offset, color] of [['0%', '#ded8cc'], ['24%', '#77736b'], ['48%', '#f5efe3'], ['76%', '#777067'], ['100%', '#302e2b']]) {
    lockMetal.append(node('stop', { offset, 'stop-color': color }));
  }
  defs.append(metal, lockMetal);
  svg.append(defs);

  const chains = node('g', { class: 'vinson-chain-links', 'stroke-linejoin': 'round', fill: 'none' });
  const links = [
    ['58', '-3', '-42', '80', '55'], ['158', '177', '-42', '180', '235'],
    ['158', '-3', '42', '180', '55'], ['58', '177', '42', '80', '235'],
  ];
  for (const [x, y, angle, cx, cy] of links) {
    const attrs = { x, y, width: 44, height: 116, rx: 22, transform: `rotate(${angle} ${cx} ${cy})` };
    chains.append(node('rect', { ...attrs, class: 'vinson-chain-link-shadow', stroke: '#11100f', 'stroke-width': 14 }));
    chains.append(node('rect', { ...attrs, class: 'vinson-chain-link-metal', stroke: `url(#${metalId})`, 'stroke-width': 9 }));
    chains.append(node('rect', { ...attrs, class: 'vinson-chain-link-edge', stroke: '#f6f0e6', 'stroke-width': 1.5, opacity: '.74' }));
  }
  svg.append(chains);

  const lock = node('g', { class: 'vinson-chain-lock', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  lock.append(
    node('path', { d: 'M96 151v-18c0-20 13-34 34-34s34 14 34 34v18', fill: 'none', stroke: '#171615', 'stroke-width': 17 }),
    node('path', { d: 'M96 151v-18c0-20 13-34 34-34s34 14 34 34v18', fill: 'none', stroke: `url(#${lockMetalId})`, 'stroke-width': 11 }),
    node('rect', { x: 82, y: 145, width: 96, height: 88, rx: 12, fill: '#171615', stroke: '#100f0e', 'stroke-width': 9 }),
    node('rect', { x: 86, y: 148, width: 88, height: 80, rx: 9, fill: `url(#${lockMetalId})`, stroke: '#ded7c9', 'stroke-width': 3 }),
    node('path', { d: 'M130 172a12 12 0 0 0-7 22v17h14v-17a12 12 0 0 0-7-22z', fill: '#272522', stroke: '#d0c8ba', 'stroke-width': 2 }),
    node('path', { d: 'M96 156h68', stroke: '#fff8ea', 'stroke-width': 2, opacity: '.72' }),
  );
  svg.append(lock);
  return svg;
}

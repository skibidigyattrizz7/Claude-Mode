// Match commentary: short text lines shown in the HUD ticker and (setting 'voice') spoken with the
// Web Speech API. Lines are generated locally from match effects, so host and guest both get them.
const LINES = {
  kickoff: ['And we are under way!', 'The referee gets us started.', 'Here we go!'],
  goal: ['GOAL! {name} finds the net!', 'What a finish from {name}!', '{name} scores! The crowd erupts!', 'It is in! {name} with the goal!'],
  owngoal: ['Oh dear, an own goal!', 'Disaster, it goes in off {name}!'],
  save: ['Great save!', 'Denied by the keeper!', 'What a stop!', 'Brilliant reflexes from {name}!'],
  post: ['Off the woodwork!', 'Rattles the post!', 'So close, it hits the frame!'],
  penalty: ['Penalty! The referee points to the spot!'],
  yellow: ['{name} goes into the book.', 'Yellow card for {name}.'],
  red: ['Red card! {name} is off!', '{name} is sent off!'],
  halftime: ['That is half time: {score}.', 'The whistle goes for the break, {score}.'],
  extratime: ['Level after ninety minutes, we go to extra time!'],
  shootout: ['It all comes down to penalties!'],
  penscored: ['{name} scores from the spot.', 'Cool as you like from {name}.'],
  penmissed: ['{name} misses!', 'Saved! {name} cannot believe it!'],
  fulltime: ['Full time, {score}.', 'The final whistle, {score}.'],
};

export class Commentary {
  constructor(mode, home, away) {
    this.mode = mode || 'text';
    this.home = home; this.away = away;
    this.queue = [];
    this.cool = 0;
    this.n = 0;
    this.voiceOk = this.mode === 'voice' && typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  say(kind, d = {}) {
    if (this.mode === 'off') return;
    const k = kind === 'goal' && d.og ? 'owngoal' : kind;
    const list = LINES[k];
    if (!list) return;
    const score = d.score ? `${this.home.short || this.home.name} ${d.score[0]} - ${d.score[1]} ${this.away.short || this.away.name}${d.pens ? ` (${d.pens[0]}-${d.pens[1]} on penalties)` : ''}` : '';
    const line = list[this.n++ % list.length].replace('{name}', d.name || 'the player').replace('{score}', score);
    // goals / full time jump the queue
    if (kind === 'goal' || kind === 'fulltime') this.queue = [line];
    else if (this.queue.length < 3) this.queue.push(line);
  }

  update(dt, hud) {
    this.cool -= dt;
    if (this.cool > 0 || !this.queue.length) return;
    const line = this.queue.shift();
    this.cool = 2.2;
    if (hud && hud.ticker) hud.ticker(line);
    if (this.voiceOk) {
      try {
        const u = new SpeechSynthesisUtterance(line);
        u.rate = 1.08; u.pitch = 1; u.volume = 0.9;
        window.speechSynthesis.speak(u);
      } catch { /* ignore */ }
    }
  }

  stop() {
    this.queue = [];
    if (this.voiceOk) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
  }
}

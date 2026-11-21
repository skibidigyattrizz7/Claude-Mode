// Prototype 7-Claude: dialogue. PLACEHOLDER lines for the stand-in cast ("Warden" vs "The Eclipse"), kept short so
// the cinematic dialogue system can be seen working. ChatGPT: replace the cast and lines with the real script; the
// system only needs { who: 'hero' | 'boss', name, text }. Click / tap / Enter / J finishes a line, then advances.
export const SCRIPT = {
  intro: [
    { who: 'boss', name: 'THE ECLIPSE', text: 'Another warden. The sky still remembers how the last one fell.' },
    { who: 'hero', name: 'WARDEN', text: 'Then let it remember this one standing.' },
    { who: 'boss', name: 'THE ECLIPSE', text: 'Kneel, and the dark will be gentle with you.' },
    { who: 'hero', name: 'WARDEN', text: 'Not today.' },
  ],
  reborn: [
    { who: 'boss', name: 'THE ECLIPSE · UNBOUND', text: 'You burned that bright just to lose a little slower?' },
    { who: 'hero', name: 'WARDEN · REBORN', text: 'I burned that bright so everyone could see.' },
  ],
  domain: [
    { who: 'boss', name: 'THE ECLIPSE · UNBOUND', text: 'Enough. My domain has swallowed a thousand suns.' },
    { who: 'hero', name: 'WARDEN · REBORN', text: 'Then try to swallow this one.' },
  ],
  totality: [
    { who: 'boss', name: 'TOTALITY', text: 'You found the hidden dark. Now you will live in it forever.' },
    { who: 'hero', name: 'WARDEN · ASCENDED', text: 'Light never needed your permission.' },
  ],
  // shouted during the mash (one at the start, then one per escalation mark) and during the struggle after it
  push: {
    1: [{ who: 'boss', text: 'Your light is a candle!' }, { who: 'hero', text: "Then watch it burn!" }, { who: 'boss', text: 'Why won\'t you break?!' }, { who: 'hero', text: 'Because they are behind me!' }],
    2: [{ who: 'boss', text: 'My domain swallows suns!' }, { who: 'hero', text: 'Not this one!' }, { who: 'boss', text: 'KNEEL!' }, { who: 'hero', text: 'NEVER!' }],
    3: [{ who: 'boss', text: 'TOTALITY IS FOREVER!' }, { who: 'hero', text: 'Nothing is forever!' }, { who: 'boss', text: 'I AM THE DARK!' }, { who: 'hero', text: 'And I am the dawn!' }],
  },
  struggle: {
    1: [{ who: 'boss', text: 'Fall!' }, { who: 'hero', text: 'Not yet!' }],
    2: [{ who: 'boss', text: 'This world is MINE!' }, { who: 'hero', text: 'Then take it from me!' }],
    3: [{ who: 'boss', text: 'BE SWALLOWED!' }, { who: 'hero', text: 'EVERYTHING I HAVE!' }],
  },
  // stop-and-read beats inside each clash's struggle (the fight pauses until you click)
  clashBeats: {
    1: [{ who: 'boss', name: 'THE ECLIPSE', text: 'You cannot hold this forever.' }, { who: 'hero', name: 'WARDEN', text: "I don't need forever. Just long enough." }],
    2: [{ who: 'boss', name: 'THE ECLIPSE · UNBOUND', text: 'Everything you love burns under my sky.' }, { who: 'hero', name: 'WARDEN · REBORN', text: "Then I'll stand in front of all of it." }],
    3: [{ who: 'boss', name: 'TOTALITY', text: 'There is no dawn here.' }, { who: 'hero', name: 'WARDEN · ASCENDED', text: "Then I'll make one." }],
  },
};

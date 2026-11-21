// Prototype 3-Claude: dialogue. PLACEHOLDER lines for the stand-in cast ("Warden" vs "The Eclipse"), kept short so
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
};

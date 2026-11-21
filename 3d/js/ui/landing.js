// Landing page (/index.html) background: the animated stadium. Kept out of index.html so the
// Content-Security-Policy can forbid inline scripts.
import { mountStadium } from './stadium.js';

mountStadium(document.querySelector('.bg'), { seed: 5 });

// A track's code is "grid-editable" when it only uses the shapes the code generator emits:
//   silence | (voice | stack(voice, ...))[.slow(num)]
//   voice = note(mini)[.velocity(num|mini)]             (instrument tracks)
//         | s(mini)[.bank(str)][.velocity(num|mini)]    (kit tracks)
// Anything else (transforms, alternation, other randomness) makes it a code track.

import type { TrackKind } from './kit';

// `?0.3` (chance of dropping a note) is allowed: notes are read back with their chance.
const NOTE_MINI = /^(?:\s|[a-gA-G][#bsf]*-?\d*|\d+(?:\.\d+)?|\?(?:\d*\.?\d+)?|[~\-_@[\],.*!])*$/;
const KIT_MINI = /^(?:\s|[A-Za-z][\w#]*(?::\d+)?|\d+(?:\.\d+)?|\?(?:\d*\.?\d+)?|[~\-_@[\],.*!])*$/;

export function isGridCode(code: string, kind: TrackKind = 'notes'): boolean {
  const kit = kind === 'kit';
  const fn = kit ? 's(' : 'note(';
  const mini = kit ? KIT_MINI : NOTE_MINI;
  const s = code.trim();
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const lit = (x: string) => {
    ws();
    if (!s.startsWith(x, i)) return false;
    i += x.length;
    return true;
  };
  const num = () => {
    ws();
    const m = /^\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/.exec(s.slice(i));
    if (!m) return false;
    i += m[0].length;
    return true;
  };
  const str = () => {
    ws();
    const q = s[i];
    if (q !== '`' && q !== '"') return false;
    const end = s.indexOf(q, i + 1);
    if (end < 0) return false;
    const body = s.slice(i + 1, end);
    i = end + 1;
    return mini.test(body);
  };
  const voice = () => {
    if (!(lit(fn) && str() && lit(')'))) return false;
    let save = i;
    if (kit && lit('.bank(')) {
      if (!(str() && lit(')'))) return false;
      save = i;
    } else i = save;
    if (lit('.velocity(')) return (num() || str()) && lit(')');
    i = save;
    return true;
  };
  const body = () => {
    if (lit('silence')) return true;
    if (lit('stack(')) {
      if (!voice()) return false;
      while (lit(',')) {
        const save = i;
        if (lit(')')) {
          i = save;
          break;
        }
        if (!voice()) return false;
      }
      return lit(')');
    }
    return voice();
  };
  if (!body()) return false;
  const save = i;
  if (lit('.slow(')) {
    if (!(num() && lit(')'))) return false;
  } else i = save;
  ws();
  return i === s.length;
}

// A track's code is "grid-editable" when it only uses the shapes the code generator emits:
//   silence | (note(mini)[.velocity(num|mini)] | stack(voice, ...))[.slow(num)]
// Anything else (transforms, randomness, alternation) makes it a code track.

const MINI_OK = /^(?:\s|[a-gA-G][#bsf]*-?\d*|\d+(?:\.\d+)?|[~\-_@[\],.*!])*$/;

export function isGridCode(code: string): boolean {
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
    return MINI_OK.test(body);
  };
  const voice = () => {
    if (!(lit('note(') && str() && lit(')'))) return false;
    const save = i;
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

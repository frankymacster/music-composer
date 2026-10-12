import type { Project, Track } from './store';
import { songInfo } from './store';
import { TPW } from './music/time';
import { laneKey } from './music/kit';

const outputSuffix = (t: Track): string => {
  const parts: string[] = [];
  if (t.output.type === 'synth') parts.push(`.s("${t.output.sound}")`);
  if (t.output.type === 'midi' && t.kind === 'kit') {
    const notes = JSON.stringify(Object.fromEntries((t.lanes ?? []).map((l) => [laneKey(l), l.note])));
    parts.push(`.withValue(v => ({ ...v, note: (${notes})[(v.bank ? v.bank + '_' : '') + v.s + (v.n ? ':' + v.n : '')] }))`);
  }
  if (t.output.type === 'midi') parts.push(`.midichan(${t.output.channel})`, `.midi('${t.output.port}')`);
  else if (t.gain !== 1) parts.push(`.postgain(${t.gain})`);
  return parts.join('');
};

export function songCode(project: Project): string {
  const { song, tracks } = project;
  const { length } = songInfo(song);
  const meters = song.meters.map((m) => `bar ${m.bar + 1}: ${m.num}/${m.den}`).join(' · ');
  const anySolo = tracks.some((t) => t.solo);
  const lines = [
    '// Music Composer · 1 cycle = 1 whole note',
    `// ${song.bars} bars (${+(length / TPW).toFixed(4)} cycles) · ${meters}`,
    `setcpm(${song.bpm}/4)`,
  ];
  for (const t of tracks) {
    const muted = t.mute || (anySolo && !t.solo);
    const suffix = outputSuffix(t);
    const body = suffix && t.code.includes('//') ? `(${t.code}\n)${suffix}` : suffix ? `${t.code}\n  ${suffix}` : t.code;
    lines.push('', `// ${t.name}`, `${muted ? '_' : ''}$: ${body}`);
  }
  return lines.join('\n') + '\n';
}

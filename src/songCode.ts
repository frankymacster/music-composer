import { clipOf, songTimeline, type Project, type Track } from './store';
import { sectionInfo } from './music/arrangement';
import { TPW } from './music/time';
import { laneKey } from './music/kit';
import { modifiersCode } from './music/modifiers';

const outputSuffix = (t: Track, bpm: number): string => {
  const parts: string[] = [];
  const mods = modifiersCode(t.modifiers, bpm);
  if (mods) parts.push(mods);
  if (t.output.type === 'synth') parts.push(`.s("${t.output.sound}")`);
  if (t.output.type === 'midi' && t.kind === 'kit') {
    const notes = JSON.stringify(Object.fromEntries((t.lanes ?? []).map((l) => [laneKey(l), l.note])));
    parts.push(`.withValue(v => ({ ...v, note: (${notes})[(v.bank ? v.bank + '_' : '') + v.s + (v.n ? ':' + v.n : '')] }))`);
  }
  if (t.output.type === 'midi') parts.push(`.midichan(${t.output.channel})`, `.midi('${t.output.port}')`);
  else if (t.gain !== 1) parts.push(`.postgain(${t.gain})`);
  return parts.join('');
};

const fmt = (x: number) => String(+x.toFixed(4));

/** camelCase JS identifier from free text. */
function ident(text: string): string {
  const words = text.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const id = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join('') || 'x';
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

const withSuffix = (body: string, suffix: string) =>
  !suffix ? body : body.includes('//') ? `(${body}\n)${suffix}` : `${body}\n  ${suffix}`;

/** The whole project as one Strudel program (one `$:` per track, sections combined with `arrange`). */
export function songCode(project: Project): string {
  const tl = songTimeline(project);
  const anySolo = project.tracks.some((t) => t.solo);
  const used = project.sections.filter((s) => project.arrangement.includes(s.id));
  const describe = used
    .map((s) => `${s.name}: ${s.bars} bars ${s.meters.map((m) => `${m.num}/${m.den}`).join('→')}`)
    .join(' · ');
  const lines = [
    '// Music Composer · 1 cycle = 1 whole note',
    `// ${describe}`,
    `// Arrangement: ${tl.instances.map((i) => i.section.name).join(' → ') || '(empty)'} · ${fmt(tl.length / TPW)} cycles`,
    `setcpm(${project.bpm}/4)`,
  ];

  const names = new Set<string>();
  const unique = (base: string) => {
    let name = base;
    for (let i = 2; names.has(name); i++) name = `${base}${i}`;
    names.add(name);
    return name;
  };

  for (const t of project.tracks) {
    const muted = t.mute || (anySolo && !t.solo);
    const label = `${muted ? '_' : ''}$:`;
    lines.push('', `// ${t.name}`);
    if (tl.instances.length === 1) {
      lines.push(`${label} ${withSuffix(clipOf(t, tl.instances[0].section.id).code, outputSuffix(t, project.bpm))}`);
      continue;
    }
    const vars = new Map<string, string>();
    for (const sec of used) {
      const name = unique(`${ident(t.name)}_${ident(sec.name)}`);
      vars.set(sec.id, name);
      lines.push(`const ${name} = ${clipOf(t, sec.id).code}`);
    }
    const parts = tl.instances.map((i) => `[${fmt(sectionInfo(i.section).length / TPW)}, ${vars.get(i.section.id)}]`);
    lines.push(`${label} ${withSuffix(`arrange(${parts.join(', ')})`, outputSuffix(t, project.bpm))}`);
  }
  return lines.join('\n') + '\n';
}

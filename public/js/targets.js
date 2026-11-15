// The five targets the challenge asks every tool to be tested on.
// Positions are (ra, dec) in degrees at `epoch`; proper motion in mas/yr moves them to the SPHEREx era.
// AI-assisted: written with Claude Code (Anthropic).
import { propagate } from './sky.js';

export const DATA_YEAR = 2026.0;

export const TARGETS = [
  {
    id: 'barnard', kind: 'move', ra: 269.452080, dec: 4.693364, epoch: 2000, pmra: -801.55, pmdec: 10362.39, dets: null,
    name: { en: "Barnard's Star", zh: '巴纳德星' },
    fact: { en: 'The fastest-moving star in our sky: about 10.4″ every year. It is only 6 light-years away.', zh: '天空中移动最快的恒星：每年约 10.4 角秒。它离我们只有 6 光年。' },
    look: { en: 'Watch the bright star in the middle step north.', zh: '盯着中间那颗亮星，看它一步步往北走。' },
    aliases: ['barnard', 'barnards', 'barnardsstar', '巴纳德', '巴纳德星'],
  },
  {
    id: 'wise0855', kind: 'move', ra: 133.795129, dec: -7.245147, epoch: 2010.5, pmra: -8118, pmdec: 680, dets: [4, 5],
    name: { en: 'WISE 0855', zh: 'WISE 0855' },
    fact: { en: 'The coldest known brown dwarf, colder than ice. It only glows at the longest wavelengths, so detectors D5 and D6 are switched on.', zh: '已知最冷的褐矮星，比冰还冷。它只在最长的波长发光，所以这里只打开了 D5 和 D6 探测器。' },
    look: { en: 'A faint dot near the centre slides west, past a background star.', zh: '中心附近有一个暗点在往西移动，正从一颗背景恒星旁边经过。' },
    aliases: ['wise0855', 'wise085507', 'w0855', '0855', 'wisej0855', 'wisej08551083071442'],
  },
  {
    id: 'epsindi', kind: 'move', ra: 331.043833, dec: -56.782703, epoch: 2000, pmra: 3966, pmdec: -2536, dets: null,
    name: { en: 'Epsilon Indi B', zh: '印第安座 ε B' },
    fact: { en: 'Two brown dwarfs circling each other, 12 light-years away. From here they blend into one faint red dot that drifts 4.7″ every year.', zh: '两颗互相绕转的褐矮星，距离 12 光年。从地球上看，它们合成一个暗红色的点，每年移动 4.7 角秒。' },
    look: { en: 'The dot in the middle shifts by about one pixel toward the south-east.', zh: '中间那个点会向东南方向移动大约一个像素。' },
    aliases: ['epsilonindib', 'epsilonindi', 'epsindib', 'epsindi', 'epsind', 'epsindb', '印第安座', '印第安座εb'],
  },
  {
    id: 'rwaur', kind: 'vary', ra: 76.956417, dec: 30.401417, epoch: 2000, pmra: 0, pmdec: 0, dets: [4, 5],
    name: { en: 'RW Aurigae', zh: '御夫座 RW' },
    fact: { en: 'A baby star still wrapped in dust. It dims when dust clouds drift in front of it.', zh: '一颗还裹在尘埃里的婴儿恒星。尘埃云飘到它前面时，它就会变暗。' },
    look: { en: 'The star in the middle stays put but changes brightness between visits.', zh: '中间那颗星不动，但每次观测的亮度不一样。' },
    aliases: ['rwaurigae', 'rwaur', '御夫座rw'],
  },
  {
    id: 'rdra', kind: 'vary', ra: 248.1675, dec: 66.755, epoch: 2000, pmra: 0, pmdec: 0, dets: [3],
    name: { en: 'R Draconis', zh: '天龙座 R' },
    fact: { en: 'An old red giant that swells and shrinks about every 245 days. SPHEREx sees this part of the sky almost every day.', zh: '一颗年老的红巨星，大约每 245 天膨胀收缩一次。SPHEREx 几乎每天都会看到这片天空。' },
    look: { en: 'It is so bright that its centre saturates. Watch its glow grow and shrink.', zh: '它太亮了，中心已经饱和。看它的光晕变大又变小。' },
    aliases: ['rdraconis', 'rdra', '天龙座r'],
  },
];

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** Where a preset is in the sky during the SPHEREx survey. */
export function presetField(t) {
  const [ra, dec] = propagate(t.ra, t.dec, t.pmra, t.pmdec, DATA_YEAR - t.epoch);
  return { preset: t.id, ra: round5(ra), dec: round5(dec) };
}

export function findPreset(text) {
  const key = String(text).toLowerCase().replace(/[\s'’\-_.]/g, '');
  if (!key) return null;
  return TARGETS.find((t) => t.id === key || t.aliases.some((a) => key === a || (key.length >= 5 && a.startsWith(key)))) || null;
}

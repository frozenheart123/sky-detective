// Turn the stacks made by pipeline/build.py (web/data/<id>.json) into saved copies the app can open
// without the IRSA search service: public/snap/<id>.bin. Each "frame" in a copy is one finished stack
// (one sky visit, one detector), so the five test targets keep working when IRSA is slow or down.
// Usage: node scripts/make-saved-copies.js
// AI-assisted: written with Claude Code (Anthropic).
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gridToSky } from '../public/js/sky.js';
import { TARGETS } from '../public/js/targets.js';
import { gaiaCone } from '../src/gaia.js';
import { packFrames } from '../src/pack.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'snap');
const f32 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
mkdirSync(OUT, { recursive: true });

for (const t of TARGETS) {
  const file = path.join(ROOT, 'web', 'data', t.id + '.json');
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const n = j.n, s = j.scale, half = 0.5 * s / 3600;
  // build.py put the field centre on pixel (24, 23); the app's grid is centred on (23.5, 23.5),
  // so the grid centre lies half a pixel east and south of the field centre.
  const grid = { ra: j.center.ra + half / Math.cos(j.center.dec * Math.PI / 180), dec: j.center.dec - half, n, scale: s };
  const epochs = j.epochs.map((ep) => ({ start: ep.mjdStart, end: ep.mjdEnd, mid: (ep.mjdStart + ep.mjdEnd) / 2, counts: ep.images }));
  const results = [], paths = [];
  epochs.forEach((ep, e) => {
    for (let d = 1; d <= 6; d++) {
      const b64 = j.dets[String(d)].frames[e];
      if (!b64) continue;
      results.push({ ok: true, data: f32(b64), meta: { det: d, e, mjd: ep.mid, lam: null, sig: j.dets[String(d)].sigma, count: ep.counts[d - 1], q: { dqa: 'Pass' } } });
      paths.push(`${t.id}/e${e}/d${d}`);
    }
  });
  let catalog = [];
  try {
    catalog = (await gaiaCone(grid.ra, grid.dec, n * s / 3600 * 0.75)).stars;
  } catch (e) {
    // Offline fallback: the Gaia DR3 positions build.py saved (2016 pixel positions, total proper motion only).
    // Only the preset's own fast-moving star gets a direction of motion, taken from the preset.
    const fastTarget = Math.hypot(t.pmra, t.pmdec) >= 1000;
    catalog = j.gaia.map((g) => {
      const [ra, dec] = gridToSky(g.x, g.y, grid), isTarget = fastTarget && g.pm >= 1000;
      return { id: null, ra, dec, pmra: isTarget ? t.pmra : 0, pmdec: isTarget ? t.pmdec : 0, plx: null, g: g.g };
    }).sort((a, b) => a.g - b.g);
    console.log(`  ${t.id}: live Gaia query failed, using the ${catalog.length} Gaia stars saved by build.py`);
  }
  const sat = Object.values(j.spec.saturated).reduce((a, b) => a + b, 0);
  const extra = {
    stacked: true, grid, epochs, found: j.totalImages, used: j.usedImages, made: statSync(file).mtime.toISOString().slice(0, 10), catalog,
    spec: {
      x: j.target.reduce((a, p) => a + p.x, 0) / j.target.length, y: j.target.reduce((a, p) => a + p.y, 0) / j.target.length,
      points: j.spec.points, sat: sat / Math.max(1, sat + j.spec.points.length),
    },
  };
  const buf = packFrames(n, results, paths, extra);
  writeFileSync(path.join(OUT, t.id + '.bin'), buf);
  console.log(`${t.id}: ${results.length} stacks, ${epochs.length} visits, ${j.usedImages} of ${j.totalImages} images, ${catalog.length} Gaia stars, ${j.spec.points.length} spectrum points -> ${(buf.length / 1024).toFixed(0)} KB`);
}

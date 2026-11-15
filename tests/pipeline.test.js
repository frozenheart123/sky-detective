// Browser-side maths (sky visits, stacking, measuring a source) on synthetic data.
// AI-assisted: written with Claude Code (Anthropic).
import assert from 'node:assert/strict';
import test from 'node:test';
import { aperture, centroid, fillCores, groupEpochs, measure, medianStack, planLoad, Store } from '../public/js/pipeline.js';
import { fmtDec, fmtRa, gridToSky, parseCoords, propagate, sepArcsec, skyToGrid } from '../public/js/sky.js';

function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5) * 2; }

function field({ shift = 0, amps = [100, 100, 100] } = {}) {
  const grid = { ra: 150, dec: 20, n: 32, scale: 6.15 }, rnd = lcg(7), images = [];
  [60900, 61080, 61260].forEach((mjd) => { for (let d = 1; d <= 6; d++) for (let k = 0; k < 5; k++) images.push({ p: `e${mjd}d${d}k${k}`, mjd: mjd + k * 0.3, det: d }); });
  const epochs = groupEpochs(images), store = new Store(grid, epochs);
  epochs.forEach((ep, e) => ep.images.forEach((im) => {
    const k = Number(im.p.slice(-1)), data = new Float32Array(32 * 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const star = amps[e] * Math.exp(-((x - (16 + shift * e)) ** 2 + (y - 16) ** 2) / (2 * 0.7 * 0.7));
      const steady = 60 * Math.exp(-((x - 8) ** 2 + (y - 24) ** 2) / (2 * 0.7 * 0.7));
      data[y * 32 + x] = star + steady + rnd();
    }
    store.add(e, { det: im.det, mjd: im.mjd, lam: 0.8 + im.det * 0.7 + k * 0.02, sig: 0.6, q: { dqa: 'Pass' } }, data);
  }));
  store.restack();
  return store;
}
const ALL = [0, 1, 2, 3, 4, 5];

test('Sky visits: gaps start a new visit, long runs are split', () => {
  const short = [];
  for (const start of [60800, 60980, 61160]) for (let k = 0; k < 20; k++) short.push({ p: 'a' + start + k, mjd: start + k * 0.5, det: 1 + (k % 6) });
  const eps = groupEpochs(short);
  assert.equal(eps.length, 3);
  assert.deepEqual(eps.map((e) => e.images.length), [20, 20, 20]);
  assert.ok(eps[1].mid > eps[1].start && eps[1].mid < eps[1].end);
  const long = [];
  for (let k = 0; k < 226; k++) long.push({ p: 'b' + k, mjd: 60800 + k * 2, det: 1 });
  const cut = groupEpochs(long);
  assert.equal(cut.length, 10);
  assert.ok(cut.every((e) => e.end - e.start <= 46));
});

test('Loading plan gives every (visit, detector) one image before any gets a second', () => {
  const store = field(), plan = planLoad(store.epochs, 240);
  assert.equal(plan.length, 90);
  const first = plan.slice(0, 18).map((im) => im.e + ':' + im.det);
  assert.equal(new Set(first).size, 18);
  assert.equal(planLoad(store.epochs, 240, new Set(plan.slice(0, 10).map((im) => im.p))).length, 80);
  assert.equal(planLoad(store.epochs, 36).length, 54, 'at least 3 per cell');
});

test('Median stacking ignores NaN and rejects outliers', () => {
  const s = medianStack([new Float32Array([1, NaN, 5]), new Float32Array([2, NaN, 900]), new Float32Array([3, 7, 6])], 3);
  assert.deepEqual([...s], [2, 7, 6]);
  assert.ok(Number.isNaN(medianStack([new Float32Array([NaN]), new Float32Array([NaN])], 1)[0]));
});

test('Saturated cores are filled, blank regions are not', () => {
  const img = new Float32Array(25).fill(0.5);
  img[12] = NaN; img[11] = 200; img[13] = 180; img[0] = NaN;
  const out = fillCores(img, 5, 1);
  assert.equal(out[12], 200);
  assert.ok(Number.isNaN(out[0]));
});

test('Centroid and aperture on a synthetic star', () => {
  const img = new Float32Array(32 * 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img[y * 32 + x] = 50 * Math.exp(-((x - 12.3) ** 2 + (y - 20.6) ** 2) / (2 * 0.8 * 0.8));
  const c = centroid(img, 32, 13, 20, 2.5);
  assert.ok(Math.abs(c.x - 12.3) < 0.1 && Math.abs(c.y - 20.6) < 0.1, `${c.x}, ${c.y}`);
  const total = 50 * 2 * Math.PI * 0.8 * 0.8, ap = aperture(img, 32, 12.3, 20.6, 2);
  assert.ok(ap.sum > 0.85 * total && ap.sum < 1.05 * total && ap.bad === 0);
});

test('A moving star is measured as moving, a still one is not', () => {
  const store = field({ shift: 0.8 });
  const m = measure(store, 16.6, 16.2, ALL);
  assert.ok(m.found && m.motion.moved);
  assert.ok(Math.abs(m.motion.px - 1.6) < 0.2, 'moved ' + m.motion.px + ' px');
  assert.equal(m.motion.dir, 'W');
  assert.ok(Math.abs(m.motion.rate - 1.6 * 6.15 / (360 / 365.25)) < 1.5);
  assert.equal(m.variable, false);
  const still = measure(store, 8, 24, ALL);
  assert.ok(still.found && !still.motion.moved && !still.variable);
  assert.equal(measure(store, 27, 5, ALL).found, false);
});

test('A star that dims is measured as changing, with a spectrum point per frame', () => {
  const store = field({ amps: [100, 50, 100] });
  const m = measure(store, 16, 16, ALL);
  assert.ok(m.found && m.variable && !m.motion.moved);
  assert.equal(m.points.length, 90);
  const rel = m.relative.map((r) => r.rel);
  assert.ok(Math.abs(rel[1] / rel[0] - 0.5) < 0.05, 'ratio ' + rel[1] / rel[0]);
  assert.equal(m.method, 'spectrum');
  assert.ok(m.points.every((p) => p.flux > 0 && !p.sat));
});

test('Pictures: blink, difference and added views', () => {
  const store = field({ shift: 0.8 });
  assert.deepEqual(store.epochsFor([2]), [0, 1, 2]);
  const blink = store.view('blink', 0, ALL), diff = store.view('diff', 0, ALL), add = store.view('add', 0, ALL);
  assert.ok(blink.img[16 * 32 + 16] > 20 * blink.sigma);
  assert.ok(Math.abs(diff.img[24 * 32 + 8]) < 6 * diff.sigma, 'steady star cancels');
  assert.ok(diff.img[16 * 32 + 16] > 10 * diff.sigma, 'moving star leaves a residual');
  assert.ok(add.sigma < blink.sigma);
});

test('Coordinates: parsing, formatting, grid and proper motion', () => {
  assert.deepEqual(parseCoords('269.45 4.69'), { ra: 269.45, dec: 4.69 });
  assert.deepEqual(parseCoords('133.795, -7.245'), { ra: 133.795, dec: -7.245 });
  const sexa = parseCoords('08h55m10.831s -07d14m42.53s');
  assert.ok(Math.abs(sexa.ra - 133.795129) < 1e-5 && Math.abs(sexa.dec + 7.245147) < 1e-5);
  assert.ok(Math.abs(parseCoords('17:57:48.5 +04:41:36').ra - 269.452083) < 1e-5);
  assert.equal(parseCoords("Barnard's star"), null);
  assert.equal(parseCoords('400 10'), null);
  assert.equal(fmtRa(269.452083), '17h 57m 48.5s');
  assert.equal(fmtDec(-7.245147), '−07° 14′ 43″');
  const g = { ra: 10, dec: 60, n: 48, scale: 6.15 };
  const [ra, dec] = gridToSky(5.25, 40.5, g), [i, j] = skyToGrid(ra, dec, g);
  assert.ok(Math.abs(i - 5.25) < 1e-9 && Math.abs(j - 40.5) < 1e-9);
  const north = gridToSky(23.5, 0, g), east = gridToSky(0, 23.5, g);
  assert.ok(north[1] > 60 && east[0] > 10, 'north is up, east is left');
  const [r2, d2] = propagate(269.45208, 4.693364, -801.55, 10362.39, 26);
  assert.ok(Math.abs(sepArcsec(269.45208, 4.693364, r2, d2) - 270.2) < 0.5);
});

// Backend maths checked against astropy/scipy reference values made by scripts/make_fixtures.py.
// AI-assisted: written with Claude Code (Anthropic).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseSesame } from '../api/resolve.js';
import { parseFrames } from '../public/js/api.js';
import { gridToSky } from '../public/js/sky.js';
import { dataSize, parseHeader, readTableRow } from '../src/fits.js';
import { dataPath, isDataPath, parseCsv, siaRows } from '../src/irsa.js';
import { packFrames } from '../src/pack.js';
import { clippedStats, quality, resample, waveLookup } from '../src/spherex.js';
import { Wcs } from '../src/wcs.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/spherex-d6.json', import.meta.url), 'utf8'));
const head = Buffer.from(fx.headB64, 'base64');
const p0 = parseHeader(head, 0), p1 = parseHeader(head, p0.next);
const f32 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };

test('FITS headers: primary, IMAGE, HIERARCH keywords, data offset', () => {
  assert.equal(p0.h.SIMPLE, true);
  assert.equal(p1.h.EXTNAME, 'IMAGE');
  assert.equal(p1.h.BITPIX, -32);
  assert.equal(p1.h.BUNIT, 'MJy / sr');
  assert.equal(p1.next, fx.dataStart);
  assert.equal(dataSize(p1.h), 2040 * 2040 * 4);
  assert.ok(Object.keys(fx.flags).length > 5);
  for (const [k, v] of Object.entries(fx.flags)) assert.equal(p1.h[k], v, k);
  assert.equal(parseHeader(head.subarray(0, 2880 * 3), p0.next), null, 'END outside the buffer');
});

test('WCS (TAN-SIP) agrees with astropy in both directions', () => {
  const wcs = new Wcs(p1.h);
  for (const [x, y, ra, dec] of fx.pix2world) {
    const [r, d] = wcs.pix2world(x, y);
    assert.ok(Math.abs(r - ra) * Math.cos(dec * Math.PI / 180) < 2e-9 && Math.abs(d - dec) < 2e-9, `pix2world(${x},${y})`);
    const [bx, by] = wcs.world2pix(ra, dec);
    assert.ok(Math.abs(bx - x) < 1e-4 && Math.abs(by - y) < 1e-4, `world2pix -> ${bx},${by} expected ${x},${y}`);
  }
  const [cx, cy] = wcs.world2pix(fx.ra, fx.dec);
  assert.ok(Math.abs(cx - fx.center[0]) < 1e-4 && Math.abs(cy - fx.center[1]) < 1e-4);
});

test('WCS-WAVE table: binary table read and wavelength lookup agree with astropy', () => {
  const raw = Buffer.from(fx.wave.rawB64, 'base64');
  const ph = parseHeader(raw, 0);
  assert.equal(ph.next, fx.wave.headerBytes);
  const tab = readTableRow(ph.h, raw.subarray(ph.next));
  assert.deepEqual(tab.X, fx.wave.X);
  assert.deepEqual(tab.Y, fx.wave.Y);
  assert.deepEqual(tab.VALUES, fx.wave.VALUES);
  for (const [x, y, lam, bw] of fx.wave.samples) {
    const [l, b] = waveLookup(tab, p1.h, x, y);
    assert.ok(Math.abs(l - lam) < 5e-6, `wavelength at ${x},${y}: ${l} vs ${lam}`);
    assert.ok(Math.abs(b - bw) < 5e-6, `bandwidth at ${x},${y}: ${b} vs ${bw}`);
  }
});

test('Resampling onto the north-up grid matches astropy + scipy', () => {
  const wcs = new Wcs(p1.h), n = fx.n, grid = { ra: fx.ra, dec: fx.dec, n, scale: fx.scale };
  const xin = new Float64Array(n * n), yin = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [ra, dec] = gridToSky(i, j, grid);
    [xin[j * n + i], yin[j * n + i]] = wcs.world2pix(ra, dec);
  }
  const got = resample(f32(fx.patch.b64), fx.patch.w, fx.patch.h, fx.patch.x0, fx.patch.y0, xin, yin, n);
  const want = f32(fx.frameB64);
  let finite = 0, worst = 0;
  for (let k = 0; k < n * n; k++) {
    assert.equal(Number.isFinite(got[k]), Number.isFinite(want[k]), 'NaN pattern at ' + k);
    if (!Number.isFinite(want[k])) continue;
    finite++;
    worst = Math.max(worst, Math.abs(got[k] - want[k]) / (2e-3 + 1e-4 * Math.abs(want[k])));
  }
  assert.ok(finite > n * n * 0.9, 'most pixels are finite');
  assert.ok(worst < 1, 'largest scaled difference ' + worst);
});

test('Background statistics ignore NaN and bright outliers', () => {
  const v = new Float32Array(1000);
  for (let i = 0; i < v.length; i++) v[i] = 5 + Math.sin(i * 12.9898) * 0.1;
  v[10] = NaN; v[20] = 500; v[30] = 900;
  const s = clippedStats(v);
  assert.ok(Math.abs(s.median - 5) < 0.05 && s.sigma > 0 && s.sigma < 0.2);
  assert.ok(Number.isNaN(clippedStats(new Float32Array([NaN, NaN])).median));
});

test('Quality metadata comes from the image header', () => {
  const q = quality(p1.h);
  assert.equal(q.dqa, p1.h.L2DQAFLG);
  assert.equal(q.flags.transient, p1.h['L2 N_TRANSIENT']);
  assert.equal(typeof q.aurora, 'boolean');
});

test('Only SPHEREx Level-2 image paths are accepted', () => {
  assert.ok(isDataPath(fx.path));
  assert.equal(dataPath('ibe/data/spherex/' + fx.path), fx.path);
  for (const bad of ['', '../etc/passwd', 'dr1/level2/../../secret.fits', 'https://evil.example/x.fits', 'dr1/level3/a.fits', 'dr1/level2/a.txt', 'dr1/level2/a b.fits']) {
    assert.equal(isDataPath(bad), false, bad);
  }
});

test('Search replies: IRSA SIA rows with unquoted JSON, and strict CSV', () => {
  const url = 'https://irsa.ipac.caltech.edu/ibe/data/spherex/' + fx.path;
  const sia = 's_ra,energy_bandpassname,access_url,t_min,t_max,cloud_access,upload_row_id\n' +
    `268.3,SPHEREx-D6,${url},60902.864715,60902.866,{"aws": {"bucket_name": "nasa-irsa-spherex", "key":"x.fits", "region": "us-east-1"}},1\n`;
  const rows = siaRows(sia);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { access_url: url, t_min: '60902.864715', energy_bandpassname: 'SPHEREx-D6' });
  assert.equal(dataPath(rows[0].access_url), fx.path);
  assert.throws(() => siaRows('a,b\n1,2\n'));
  assert.deepEqual(parseCsv('source_id,ra,note\n42,1.5,"a, ""b"""\n43,2.5,\n'), [{ source_id: '42', ra: '1.5', note: 'a, "b"' }, { source_id: '43', ra: '2.5', note: '' }]);
});

test('Frame packing round-trips through the browser parser', () => {
  const a = new Float32Array([1, 2, NaN, 4]), b = new Float32Array([5, 6, 7, 8]);
  const buf = packFrames(2, [{ ok: true, meta: { det: 3, lam: 2.1 }, data: a }, { ok: false, reason: 'off the detector' }, { ok: true, meta: { det: 6 }, data: b }], ['p1', 'p2', 'p3']);
  const { head: h, frames } = parseFrames(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  assert.equal(h.n, 2);
  assert.deepEqual(frames.map((f) => f.meta.ok), [true, false, true]);
  assert.equal(frames[0].meta.lam, 2.1);
  assert.equal(frames[1].meta.reason, 'off the detector');
  assert.deepEqual([...frames[0].data].map((v) => (Number.isNaN(v) ? 'NaN' : v)), [1, 2, 'NaN', 4]);
  assert.deepEqual([...frames[2].data], [5, 6, 7, 8]);
});

test('Sesame name-resolver replies are parsed', () => {
  const hit = parseSesame("# Barnard's star\n%J 269.45207696 +4.69336497 = 17 57 48.498  +04 41 36.11 \n%P -801.551 10362.394 [0.032 0.036 90] A");
  assert.deepEqual(hit, { ra: 269.45207696, dec: 4.69336497, pmra: -801.551, pmdec: 10362.394 });
  assert.equal(parseSesame('#! nothing found'), null);
});

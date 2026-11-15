// SPHEREx Level-2 spectral images: find them, read a small patch, put it on a north-up grid.
// One image costs two small HTTP requests: the FITS headers, then only the pixel rows we need.
// AI-assisted: written with Claude Code (Anthropic).
import { gridToSky } from '../public/js/sky.js';
import { BLOCK, dataSize, padded, parseHeader, readTableRow } from './fits.js';
import { dataPath, dataUrl, getRange, getRanges, isDataPath, sia, tap } from './irsa.js';
import { Wcs } from './wcs.js';

// The current data releases. A new release only needs its collection name added here.
export const COLLECTIONS = ['spherex_dr1', 'spherex_qr3', 'spherex_dr1_deep', 'spherex_qr3_deep'];
const WIDE = 2; // the first two cover the whole sky; the "deep" ones only the ecliptic poles

/**
 * Every SPHEREx spectral image whose footprint contains (ra, dec), oldest first: [{ p, mjd, det }].
 * Uses IRSA's image search (SIA), one request per collection; falls back to the TAP service if that fails.
 */
export async function searchImages(ra, dec) {
  const settled = await Promise.allSettled(COLLECTIONS.map((c) => sia(c, ra, dec)));
  let rows = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value.map((r) => ({ uri: r.access_url, mjd: r.t_min, band: r.energy_bandpassname })) : []));
  if (settled.slice(0, WIDE).some((s) => s.status !== 'fulfilled')) {
    try {
      const viaTap = await tap(
        'SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname FROM spherex.artifact a ' +
        'JOIN spherex.plane p ON a.planeid = p.planeid ' +
        `WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)`, 25000);
      rows = rows.concat(viaTap.map((r) => ({ uri: r.uri, mjd: r.time_bounds_lower, band: r.energy_bandpassname })));
    } catch (e) {
      if (!rows.length) throw new Error('The NASA archive (IRSA) image search is not answering right now. Try again in a minute.');
    }
  }
  const seen = new Set(), out = [];
  for (const r of rows) {
    const p = dataPath(r.uri || ''), mjd = Number(r.mjd), det = Number(String(r.band).slice(-1));
    const key = p && /level2_(.+?D\d)_spx_/.exec(p);
    if (!key || !isDataPath(p) || !(det >= 1 && det <= 6) || !Number.isFinite(mjd) || seen.has(key[1])) continue;
    seen.add(key[1]);
    out.push({ p, mjd, det });
  }
  return out.sort((a, b) => a.mjd - b.mjd);
}

/** Bilinear resampling of a patch (origin x0, y0 on the detector) at detector coordinates (xin, yin). */
export function resample(patch, w, h, x0, y0, xin, yin, n) {
  const out = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    const x = xin[k] - x0, y = yin[k] - y0, xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi + 1 >= w || yi + 1 >= h) { out[k] = NaN; continue; }
    const fx = x - xi, fy = y - yi, p = yi * w + xi;
    out[k] = (1 - fx) * (1 - fy) * patch[p] + fx * (1 - fy) * patch[p + 1] + (1 - fx) * fy * patch[p + w] + fx * fy * patch[p + w + 1];
  }
  return out;
}

const median = (sorted) => (sorted.length & 1 ? sorted[sorted.length >> 1] : 0.5 * (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]));

/** Sigma-clipped median and robust scatter (1.4826 x MAD) of the finite values. */
export function clippedStats(values) {
  let v = Float64Array.from(values).filter(Number.isFinite).sort();
  let med = NaN, sigma = NaN;
  for (let it = 0; it < 5 && v.length; it++) {
    med = median(v);
    const dev = v.map((x) => Math.abs(x - med)).sort();
    sigma = 1.4826 * median(dev);
    const keep = v.filter((x) => Math.abs(x - med) <= 3 * sigma);
    if (keep.length === v.length || !keep.length) break;
    v = keep;
  }
  return { median: med, sigma };
}

/* ---------- wavelength: the WCS-WAVE lookup table (FITS -TAB) ---------- */
function fracIndex(vec, v) {
  let k = 0;
  while (k < vec.length - 2 && v > vec[k + 1]) k++;
  return k + (v - vec[k]) / (vec[k + 1] - vec[k]);
}

/** Central wavelength and bandwidth (micron) seen by 0-based detector pixel (x, y). */
export function waveLookup(tab, h, x, y) {
  const X = tab[h.PS1_2W || 'X'], Y = tab[h.PS2_2W || 'Y'], V = tab[h.PS1_1W || 'VALUES'];
  const nx = X.length, ny = Y.length, M = V.length / (nx * ny);
  const fx = fracIndex(X, x + 1), fy = fracIndex(Y, y + 1); // the table is indexed by 1-based FITS pixels
  const ix = Math.min(nx - 2, Math.max(0, Math.floor(fx))), iy = Math.min(ny - 2, Math.max(0, Math.floor(fy)));
  const tx = fx - ix, ty = fy - iy;
  const at = (m, a, b) => V[m + M * (a + nx * b)];
  const interp = (m) => (1 - tx) * (1 - ty) * at(m, ix, iy) + tx * (1 - ty) * at(m, ix + 1, iy) + (1 - tx) * ty * at(m, ix, iy + 1) + tx * ty * at(m, ix + 1, iy + 1);
  return [interp((h.PV1_3W || 1) - 1), interp((h.PV2_3W || 2) - 1)];
}

const waveCache = new Map();
/** The table describes the detector's linear variable filter; read it once per detector, release and pipeline version. */
function waveTable(path, url, imgHeader, dataStart) {
  const m = /^([a-z]+\d+(?:_deep)?)\/level2\/[^/]+\/[^/]*?(v\d+)[^/]*\/(\d)\//.exec(path);
  const key = m ? m.slice(1).join('|') : path;
  if (!waveCache.has(key)) {
    const job = (async () => {
      let off = dataStart + padded(dataSize(imgHeader));
      for (let k = 0; k < 8; k++) {
        let buf = await getRange(url, off, off + 8 * BLOCK);
        let ph = parseHeader(buf, 0);
        if (!ph) { buf = await getRange(url, off, off + 60 * BLOCK); ph = parseHeader(buf, 0); }
        if (!ph) throw new Error('FITS header too long');
        const size = dataSize(ph.h);
        if (ph.h.EXTNAME === 'WCS-WAVE') {
          const data = buf.length >= ph.next + size ? buf.subarray(ph.next, ph.next + size) : await getRange(url, off + ph.next, off + ph.next + size);
          return readTableRow(ph.h, data);
        }
        off += ph.next + padded(size);
      }
      throw new Error('WCS-WAVE table not found');
    })();
    job.catch(() => waveCache.delete(key));
    waveCache.set(key, job);
  }
  return waveCache.get(key);
}

const FLAG_KEYS = ['TRANSIENT', 'OVERFLOW', 'SNOWBALL', 'BLOOM', 'PERSIST', 'OUTLIER', 'HOT', 'COLD', 'NONFUNC', 'XTALK', 'GHOST'];

/** Quality and contamination metadata the pipeline wrote into the image header. */
export function quality(h) {
  const flags = {};
  for (const k of FLAG_KEYS) if (typeof h['L2 N_' + k] === 'number') flags[k.toLowerCase()] = h['L2 N_' + k];
  return {
    dqa: h.L2DQAFLG ?? null, astrom: h.FINAST ?? null, streaks: h['L2 SATSTRKS'] ?? null,
    aurora: h.AURORA_CONT === true, glow: h.SHUTTLE_GLOW_CONT === true, airglow: h.HE_AIRGLOW_CONT === true,
    sband: h.OBS_IN_SBAND === true, flags,
  };
}

/**
 * Read one image and resample it onto `grid` ({ ra, dec, n, scale }).
 * Returns { ok: true, meta, data: Float32Array(n*n) } (background-subtracted, MJy/sr, row 0 = north)
 * or { ok: false, reason }.
 */
export async function readFrame(path, grid) {
  if (!isDataPath(path)) return { ok: false, reason: 'bad path' };
  const url = dataUrl(path);
  let head = await getRange(url, 0, 11 * BLOCK);
  let p0 = parseHeader(head, 0), p1 = p0 && parseHeader(head, p0.next);
  if (!p1) {
    head = await getRange(url, 0, 60 * BLOCK);
    p0 = parseHeader(head, 0);
    p1 = p0 && parseHeader(head, p0.next);
  }
  if (!p1 || p1.h.EXTNAME !== 'IMAGE' || p1.h.BITPIX !== -32 || p1.h.NAXIS !== 2) return { ok: false, reason: 'unexpected file layout' };
  const h = p1.h, nx = h.NAXIS1, ny = h.NAXIS2, dataStart = p1.next, n = grid.n;
  const wcs = new Wcs(h);

  const xin = new Float64Array(n * n), yin = new Float64Array(n * n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [ra, dec] = gridToSky(i, j, grid);
      const [x, y] = wcs.world2pix(ra, dec);
      xin[j * n + i] = x; yin[j * n + i] = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(nx - 1, Math.floor(maxX) + 1);
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(ny - 1, Math.floor(maxY) + 1);
  if (!(x1 > x0 && y1 > y0)) return { ok: false, reason: 'off the detector' };
  const w = x1 - x0 + 1, hh = y1 - y0 + 1;
  if (w > 400 || hh > 400) return { ok: false, reason: 'field too large' };

  const ranges = [];
  for (let r = y0; r <= y1; r++) ranges.push([dataStart + (r * nx + x0) * 4, dataStart + (r * nx + x1 + 1) * 4]);
  const rows = await getRanges(url, ranges);
  const patch = new Float32Array(w * hh);
  for (let r = 0; r < hh; r++) for (let c = 0; c < w; c++) patch[r * w + c] = rows[r].readFloatBE(c * 4);

  const data = resample(patch, w, hh, x0, y0, xin, yin, n);
  const stats = clippedStats(data);
  let good = 0;
  for (let k = 0; k < data.length; k++) {
    if (Number.isFinite(data[k])) { good++; data[k] -= stats.median; }
  }
  if (good < n * n * 0.25) return { ok: false, reason: 'mostly outside the detector' };

  let lam = null, bw = null;
  try {
    const [cx, cy] = wcs.world2pix(grid.ra, grid.dec);
    [lam, bw] = waveLookup(await waveTable(path, url, h, dataStart), h, cx, cy);
  } catch { /* the frame is still usable for blinking; it just gets no spectrum point */ }

  const r4 = (v) => (Number.isFinite(v) ? Number(v.toPrecision(5)) : null);
  return {
    ok: true,
    data,
    meta: {
      det: h.DETECTOR, obs: h.OBSID ?? null, mjd: h['MJD-AVG'] ?? h['MJD-OBS'] ?? null, exp: h.XPOSURE ?? null,
      fwhm: r4(h.PSF_FWHM), lam: r4(lam), bw: r4(bw), bg: r4(stats.median), sig: r4(stats.sigma),
      cover: Number((good / (n * n)).toFixed(3)), ver: p0.h.VERSION ?? null, q: quality(h),
    },
  };
}

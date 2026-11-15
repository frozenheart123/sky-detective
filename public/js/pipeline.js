// Turning single SPHEREx frames into blinkable pictures: sky visits, stacking, and measuring a source.
// Pure maths on typed arrays: no DOM, so it also runs under `node --test`.
// AI-assisted: written with Claude Code (Anthropic).
import { gridToSky, mjdToYear } from './sky.js';

export const NDET = 6;
export const APERTURE = 2;           // px radius for photometry (about 12 arcsec)
const BRIGHT = 30;                   // a NaN pixel next to something this many sigma bright is a saturated core

/** Split images (sorted by mjd) into sky visits: a gap > `gap` days starts a new one; long runs are cut into ~`bin`-day pieces. */
export function groupEpochs(images, gap = 60, maxSpan = 75, bin = 45) {
  const groups = [];
  let cur = [];
  for (const im of images) {
    if (cur.length && im.mjd - cur[cur.length - 1].mjd > gap) { groups.push(cur); cur = []; }
    cur.push(im);
  }
  if (cur.length) groups.push(cur);
  const out = [];
  for (const g of groups) {
    const span = g[g.length - 1].mjd - g[0].mjd;
    if (span <= maxSpan) { out.push(g); continue; }
    const nb = Math.ceil(span / bin), width = span / nb + 1e-9;
    const bins = Array.from({ length: nb }, () => []);
    for (const im of g) bins[Math.min(nb - 1, Math.floor((im.mjd - g[0].mjd) / width))].push(im);
    for (const b of bins) if (b.length) out.push(b);
  }
  return out.map((g, e) => ({ e, start: g[0].mjd, end: g[g.length - 1].mjd, mid: g.reduce((s, im) => s + im.mjd, 0) / g.length, images: g }));
}

/** Loading order: evenly sampled images per (visit, detector), round-robin so every cell gets its first image early. */
export function planLoad(epochs, budget = 240, skip = new Set()) {
  const perCell = budget === Infinity ? Infinity : Math.max(3, Math.min(14, Math.floor(budget / (epochs.length * NDET))));
  const cells = [];
  for (const ep of epochs) {
    for (let d = 1; d <= NDET; d++) {
      let list = ep.images.filter((im) => im.det === d);
      if (list.length > perCell) {
        const idx = new Set();
        for (let k = 0; k < perCell; k++) idx.add(Math.round(k * (list.length - 1) / (perCell - 1)));
        list = list.filter((_, i) => idx.has(i));
      }
      cells.push(list.map((im) => ({ ...im, e: ep.e })));
    }
  }
  const order = [];
  for (let k = 0, any = true; any; k++) {
    any = false;
    for (const c of cells) if (k < c.length) { any = true; if (!skip.has(c[k].p)) order.push(c[k]); }
  }
  return order;
}

const medianOf = (sorted, m) => (m & 1 ? sorted[m >> 1] : 0.5 * (sorted[m / 2 - 1] + sorted[m / 2]));

/** Per-pixel median of several frames, ignoring NaN. */
export function medianStack(arrs, n2) {
  if (arrs.length === 1) return Float32Array.from(arrs[0]);
  const out = new Float32Array(n2), buf = new Float32Array(arrs.length);
  for (let p = 0; p < n2; p++) {
    let m = 0;
    for (let a = 0; a < arrs.length; a++) { const v = arrs[a][p]; if (v === v) buf[m++] = v; }
    if (!m) { out[p] = NaN; continue; }
    for (let i = 1; i < m; i++) { const v = buf[i]; let j = i - 1; while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; } buf[j + 1] = v; }
    out[p] = medianOf(buf, m);
  }
  return out;
}

/** Robust scatter (1.4826 x MAD) of the finite values of one or more arrays. */
export function madSigma(arrs) {
  const vals = [];
  for (const a of arrs) if (a) for (let p = 0; p < a.length; p++) if (a[p] === a[p]) vals.push(a[p]);
  if (!vals.length) return NaN;
  const v = Float64Array.from(vals).sort(), med = medianOf(v, v.length);
  const dev = v.map((x) => Math.abs(x - med)).sort();
  return 1.4826 * medianOf(dev, dev.length) || NaN;
}

/** Saturated star cores arrive as NaN. Fill NaN pixels that touch very bright pixels with the image maximum. */
export function fillCores(img, n, sigma) {
  let max = -Infinity, hasNaN = false;
  for (let p = 0; p < img.length; p++) { const v = img[p]; if (v !== v) hasNaN = true; else if (v > max) max = v; }
  if (!hasNaN || !(max > BRIGHT * sigma)) return img;
  const out = Float32Array.from(img);
  for (let pass = 0; pass < 6; pass++) {
    const src = Float32Array.from(out);
    let changed = false;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const p = y * n + x;
      if (src[p] === src[p]) continue;
      let bright = false;
      for (let dy = -1; dy <= 1 && !bright; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && xx >= 0 && yy < n && xx < n && src[yy * n + xx] > BRIGHT * sigma) { bright = true; break; }
      }
      if (bright) { out[p] = max; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

const passes = (meta) => !meta.q || typeof meta.q.dqa !== 'string' || /^pass$/i.test(meta.q.dqa);

/** All frames of one field, their stacks per (visit, detector), and the pictures made from them. */
export class Store {
  constructor(grid, epochs) {
    this.grid = grid;
    this.n = grid.n;
    this.n2 = grid.n * grid.n;
    this.epochs = epochs;
    this.frames = [];
    this.rejected = [];
    this.cells = epochs.map(() => Array.from({ length: NDET }, () => ({ frames: [], stack: null, dirty: false })));
    this.sigma = new Array(NDET).fill(NaN);
    this.cache = new Map();
  }

  /** Add one frame ({ meta..., data }) to visit e. Frames that failed the pipeline's quality check are kept apart. */
  add(e, meta, data) {
    const f = { ...meta, e, data };
    if (!passes(meta)) { this.rejected.push(f); return false; }
    this.frames.push(f);
    const c = this.cells[e][meta.det - 1];
    c.frames.push(f);
    c.dirty = true;
    return true;
  }

  /** Recompute stacks that received new frames. Returns true when any picture changed. */
  restack() {
    const touched = new Set();
    for (const row of this.cells) row.forEach((c, d) => {
      if (!c.dirty) return;
      c.stack = medianStack(c.frames.map((f) => f.data), this.n2);
      c.dirty = false;
      touched.add(d);
    });
    for (const d of touched) this.sigma[d] = madSigma(this.cells.map((row) => row[d].stack));
    if (touched.size) this.cache.clear();
    return touched.size > 0;
  }

  /** Visits that have a stack for at least one of the detectors (0-based indices). */
  epochsFor(dets) {
    return this.epochs.map((ep) => ep.e).filter((e) => dets.some((d) => this.cells[e][d].stack));
  }

  /** Detectors (of `dets`) present in every visit that has any of them; blinking these keeps the picture consistent. */
  commonDets(dets) {
    const eps = this.epochsFor(dets);
    const common = dets.filter((d) => eps.every((e) => this.cells[e][d].stack));
    return common.length ? common : dets;
  }

  /** One visit, detectors added together (each divided by its noise first), saturated cores filled. */
  combine(e, dets) {
    const key = 'c' + e + ':' + dets.join('');
    if (this.cache.has(key)) return this.cache.get(key);
    const list = this.commonDets(dets).filter((d) => this.cells[e][d].stack);
    let out = null;
    if (list.length) {
      out = new Float32Array(this.n2);
      const cnt = new Uint8Array(this.n2);
      for (const d of list) {
        const s = this.cells[e][d].stack, sg = this.sigma[d] || 1;
        for (let p = 0; p < this.n2; p++) { const v = s[p]; if (v === v) { out[p] += v / sg; cnt[p]++; } }
      }
      for (let p = 0; p < this.n2; p++) out[p] = cnt[p] ? out[p] / cnt[p] : NaN;
      out = fillCores(out, this.n, list.length === 1 ? 1 : 1 / Math.sqrt(list.length));
    }
    this.cache.set(key, out);
    return out;
  }

  meanOf(epochs, dets) {
    const out = new Float32Array(this.n2), cnt = new Uint8Array(this.n2);
    for (const e of epochs) {
      const img = this.combine(e, dets);
      if (img) for (let p = 0; p < this.n2; p++) { const v = img[p]; if (v === v) { out[p] += v; cnt[p]++; } }
    }
    for (let p = 0; p < this.n2; p++) out[p] = cnt[p] ? out[p] / cnt[p] : NaN;
    return out;
  }

  /** The picture to show: 'blink' = this visit, 'diff' = this visit minus the others, 'add' = all visits together. */
  view(mode, e, dets) {
    const key = mode + e + ':' + dets.join('');
    if (this.cache.has(key)) return this.cache.get(key);
    const eps = this.epochsFor(dets);
    const skey = 's:' + dets.join('');
    if (!this.cache.has(skey)) this.cache.set(skey, madSigma(eps.map((x) => this.combine(x, dets))) || 1);
    const sigma = this.cache.get(skey);
    let img = null, s = sigma;
    if (mode === 'add') { img = eps.length ? this.meanOf(eps, dets) : null; s = sigma / Math.sqrt(Math.max(1, eps.length)); }
    else if (mode === 'diff') {
      const a = this.combine(e, dets), others = eps.filter((x) => x !== e);
      if (a && others.length) { const m = this.meanOf(others, dets); img = new Float32Array(this.n2); for (let p = 0; p < this.n2; p++) img[p] = a[p] - m[p]; }
    } else img = this.combine(e, dets);
    const res = { img, sigma: s };
    this.cache.set(key, res);
    return res;
  }
}

/* ---------- measuring one source ---------- */
export function aperture(img, n, x, y, r) {
  let sum = 0, npix = 0, bad = 0;
  for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(n - 1, Math.ceil(y + r)); yy++) {
    for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(n - 1, Math.ceil(x + r)); xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      const v = img[yy * n + xx];
      if (v === v) { sum += v; npix++; } else bad++;
    }
  }
  return { sum, npix, bad };
}

function ring(img, n, x, y, r1, r2) {
  const vals = [];
  for (let yy = Math.max(0, Math.floor(y - r2)); yy <= Math.min(n - 1, Math.ceil(y + r2)); yy++) {
    for (let xx = Math.max(0, Math.floor(x - r2)); xx <= Math.min(n - 1, Math.ceil(x + r2)); xx++) {
      const d2 = (xx - x) ** 2 + (yy - y) ** 2, v = img[yy * n + xx];
      if (d2 >= r1 * r1 && d2 <= r2 * r2 && v === v) vals.push(v);
    }
  }
  return vals;
}
const median = (vals) => { if (!vals.length) return NaN; const v = Float64Array.from(vals).sort(); return medianOf(v, v.length); };

/** Brightest pixel within `search` px of (x, y), refined to a flux-weighted centroid. */
export function centroid(img, n, x, y, search = 2.5, box = 2) {
  let best = -Infinity, bi = -1, bj = -1;
  for (let j = Math.max(0, Math.floor(y - search)); j <= Math.min(n - 1, Math.ceil(y + search)); j++) {
    for (let i = Math.max(0, Math.floor(x - search)); i <= Math.min(n - 1, Math.ceil(x + search)); i++) {
      const v = img[j * n + i];
      if ((i - x) ** 2 + (j - y) ** 2 <= search * search && v === v && v > best) { best = v; bi = i; bj = j; }
    }
  }
  if (bi < 0) return null;
  let min = Infinity;
  const win = [];
  for (let j = Math.max(0, bj - box); j <= Math.min(n - 1, bj + box); j++) {
    for (let i = Math.max(0, bi - box); i <= Math.min(n - 1, bi + box); i++) {
      const v = img[j * n + i];
      if (v === v) { win.push([i, j, v]); if (v < min) min = v; }
    }
  }
  let sw = 0, sx = 0, sy = 0;
  for (const [i, j, v] of win) { const w = v - min; sw += w; sx += w * i; sy += w * j; }
  return sw > 0 ? { x: sx / sw, y: sy / sw, peak: best } : { x: bi, y: bj, peak: best };
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const DET_EDGES = [0.75, 1.10, 1.63, 2.42, 3.83, 4.42, 5.00];
const detOf = (lam) => { for (let d = 0; d < 5; d++) if (lam < DET_EDGES[d + 1]) return d; return 5; };
const BIN = Math.log(1 + 1 / 40);     // spectral bins of resolving power 40
export const binOf = (lam) => Math.floor(Math.log(lam / 0.7) / BIN);
export const binCentre = (b) => 0.7 * Math.exp((b + 0.5) * BIN);

/**
 * Measure the source nearest grid position (x, y): where it is in every visit, its spectrum from the
 * single frames (each frame sees one wavelength), and its relative brightness per visit.
 */
export function measure(store, x, y, dets) {
  const n = store.n, scale = store.grid.scale, eps = store.epochsFor(dets);
  if (!eps.length) return null;
  const add = store.view('add', eps[0], dets);
  const c0 = add.img && centroid(add.img, n, x, y, 2.5);
  if (!c0 || !(c0.peak >= 5 * add.sigma)) return { found: false, x, y, sky: gridToSky(x, y, store.grid) };

  const track = eps.map((e) => {
    const v = store.view('blink', e, dets), c = v.img && centroid(v.img, n, c0.x, c0.y, 3);
    const snr = c ? c.peak / v.sigma : 0;
    return c && snr >= 5 ? { e, x: c.x, y: c.y, snr, ok: true } : { e, x: c0.x, y: c0.y, snr, ok: false };
  });
  const seen = track.filter((t) => t.ok);
  let motion = null;
  if (seen.length >= 2) {
    const a = seen[0], b = seen[seen.length - 1];
    const east = -(b.x - a.x) * scale, north = -(b.y - a.y) * scale, px = Math.hypot(b.x - a.x, b.y - a.y);
    const years = (store.epochs[b.e].mid - store.epochs[a.e].mid) / 365.25;
    const err = Math.hypot(0.08 + 0.9 / a.snr, 0.08 + 0.9 / b.snr);
    const pa = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
    // A core that is saturated in every chosen detector has no real centre: its "position" only follows the filled blob.
    const blank = (t) => {
      const have = dets.filter((d) => store.cells[t.e][d].stack), xi = Math.round(t.x), yi = Math.round(t.y);
      return have.length > 0 && have.every((d) => {
        const s = store.cells[t.e][d].stack;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const v = s[Math.min(n - 1, Math.max(0, yi + dy)) * n + Math.min(n - 1, Math.max(0, xi + dx))];
          if (v !== v) return true;
        }
        return false;
      });
    };
    const saturated = seen.some(blank);
    motion = { arcsec: px * scale, px, years, rate: years > 0 ? px * scale / years : NaN, pa, dir: DIRS[Math.round(pa / 45) % 8], east, north, saturated, moved: !saturated && px >= 0.3 && px >= 4 * err };
  }

  const toMjy = (scale / 206264.806) ** 2 * 1e9;   // MJy/sr summed over pixels -> mJy
  const where = new Map(track.map((t) => [t.e, t]));
  // A saved copy holds stacks, not single frames, so it carries the target's own spectrum points ready-made.
  const saved = store.spec && Math.hypot(c0.x - store.spec.x, c0.y - store.spec.y) < 2.5 ? store.spec : null;
  const points = saved ? saved.points.map(([lam, flux, e]) => ({ lam, e, det: 0, mjd: store.epochs[e].mid, sat: false, flux, err: 0 })) : [];
  for (const f of saved ? [] : store.frames) {
    if (f.lam == null) continue;
    const t = where.get(f.e) || c0;
    const ap = aperture(f.data, n, t.x, t.y, APERTURE);
    const back = median(ring(f.data, n, t.x, t.y, 4, 6.5)) || 0;
    points.push({ lam: f.lam, e: f.e, det: f.det, mjd: f.mjd, sat: ap.bad > 0, flux: (ap.sum - back * ap.npix) * toMjy, err: (f.sig || 0) * Math.sqrt(Math.max(1, ap.npix)) * toMjy });
  }
  const good = points.filter((p) => !p.sat);

  // Relative brightness per visit: compare visits bin by bin in wavelength, so that it does not
  // matter which wavelengths each visit happened to sample. Only the chosen detectors count,
  // because a star can dim at long wavelengths while brightening at short ones.
  let relative = [], method = 'spectrum';
  const bins = new Map();
  for (const p of good) {
    if (!dets.includes(detOf(p.lam))) continue;
    const b = binOf(p.lam);
    if (!bins.has(b)) bins.set(b, new Map());
    const m = bins.get(b);
    if (!m.has(p.e)) m.set(p.e, []);
    m.get(p.e).push(p);
  }
  const allE = store.epochs.map((ep) => ep.e);
  const ratios = new Map(allE.map((e) => [e, []]));
  // point-to-point scatter inside one bin of one visit: an honest noise estimate that ignores real changes between visits
  const resid = [];
  for (const m of bins.values()) for (const ps of m.values()) {
    if (ps.length < 2) continue;
    const mid = median(ps.map((p) => p.flux));
    for (const p of ps) resid.push(Math.abs(p.flux - mid));
  }
  const scatter = resid.length >= 6 ? 1.4826 * median(resid) : 0;
  for (const m of bins.values()) {
    if (m.size < 2) continue;
    const means = [...m].map(([e, ps]) => [e, ps.reduce((s, p) => s + p.flux, 0) / ps.length]);
    const ref = means.reduce((s, [, v]) => s + v, 0) / means.length;
    const noise = Math.max(scatter, median([...m.values()].flat().map((p) => p.err)));
    if (!(ref > 4 * noise)) continue;
    for (const [e, v] of means) ratios.get(e).push(v / ref);
  }
  let relErr = 0;
  relative = allE.map((e) => {
    const r = ratios.get(e);
    if (r.length < 3) return { e, rel: null, bins: r.length };
    const mid = median(r);
    relErr = Math.max(relErr, 1.4826 * median(r.map((v) => Math.abs(v - mid))) / Math.sqrt(r.length));
    return { e, rel: mid, bins: r.length };
  });
  if (relative.filter((r) => r.rel != null).length < 2) {
    relErr = 0;
    // Too saturated (or too faint) for the spectrum: use the light in the star's wings on the stacked pictures.
    method = 'wings';
    const sums = eps.map((e) => { const v = store.view('blink', e, dets); return v.img ? ring(v.img, n, c0.x, c0.y, 3.5, 7).reduce((s, q) => s + q, 0) : NaN; });
    const ok = sums.filter((s) => Number.isFinite(s) && s > 0), mean = ok.reduce((s, q) => s + q, 0) / (ok.length || 1);
    const bright = c0.peak >= 50 * add.sigma;
    relative = eps.map((e, i) => ({ e, rel: bright && Number.isFinite(sums[i]) && mean > 0 ? sums[i] / mean : null, bins: 0 }));
  }
  const rels = relative.map((r) => r.rel).filter((r) => r != null);
  const range = rels.length >= 2 ? Math.max(...rels) - Math.min(...rels) : 0;
  const change = rels.length >= 2 ? range / Math.max(...rels) : 0;   // brightest visit to faintest visit

  return {
    found: true, x: c0.x, y: c0.y, sky: gridToSky(c0.x, c0.y, store.grid), snr: c0.peak / add.sigma,
    year: mjdToYear(store.epochs[eps[0]].mid), track, motion, points, relative, method,
    range, change, variable: range >= 0.15 && range >= 4 * relErr, saturated: saved ? saved.sat : points.length ? 1 - good.length / points.length : 0,
  };
}

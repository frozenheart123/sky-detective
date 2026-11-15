// Drawing: the sky picture (false colour), small visit thumbnails, and the overlay (Gaia stars, selection).
// AI-assisted: written with Claude Code (Anthropic).
import { propagate, skyToGrid } from './sky.js';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function makeLut(stops) {
  const lut = new Uint8ClampedArray(256 * 3), s = stops.map(([p, c]) => [p, hex(c)]);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let j = 0;
    while (j < s.length - 2 && v > s[j + 1][0]) j++;
    const [p0, c0] = s[j], [p1, c1] = s[j + 1], f = Math.min(1, Math.max(0, (v - p0) / (p1 - p0)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * f;
  }
  return lut;
}
// Brightness runs black -> deep blue -> white, with steadily rising lightness so faint stars stay visible.
const SKY = makeLut([[0, '#000000'], [0.2, '#0b1640'], [0.45, '#2447b8'], [0.7, '#5fb0f0'], [0.88, '#d6efff'], [1, '#ffffff']]);
// Difference pictures: pink = dimmer or gone, lime = brighter or newly arrived, dark = unchanged.
const DIFF = makeLut([[0, '#ff5fa2'], [0.35, '#4a1230'], [0.5, '#07080d'], [0.65, '#2c3d0e'], [1, '#c8f560']]);
const BLANK = [22, 27, 40];
export const COLORS = { gone: '#ff5fa2', arrived: '#c8f560', gaia: '#4de3c8', pick: '#ffd166' };

const off = document.createElement('canvas');

/** Paint an n x n float image onto a canvas. `brightness` is 0..100; mode 'diff' uses the two-sided colours. */
export function paint(canvas, img, n, sigma, mode, brightness) {
  const ctx = canvas.getContext('2d');
  if (!img || !n) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
  if (off.width !== n) { off.width = n; off.height = n; }
  const octx = off.getContext('2d'), id = octx.createImageData(n, n), px = id.data, b = brightness / 100;
  const s = sigma > 0 ? sigma : 1;
  const half = s * 10 ** (0.6 + 2.2 * (1 - b));
  const hi = s * 10 ** (0.9 + 2.6 * (1 - b)), lo = -1.5 * s, soft = 2 * s, top = Math.asinh((hi - lo) / soft);
  for (let p = 0; p < n * n; p++) {
    const v = img[p];
    let r = BLANK[0], g = BLANK[1], bl = BLANK[2];
    if (v === v) {
      let i, lut;
      if (mode === 'diff') { i = Math.round((Math.max(-1, Math.min(1, v / half)) * 0.5 + 0.5) * 255); lut = DIFF; }
      else { i = Math.round(Math.max(0, Math.min(1, Math.asinh(Math.max(0, v - lo) / soft) / top)) * 255); lut = SKY; }
      r = lut[i * 3]; g = lut[i * 3 + 1]; bl = lut[i * 3 + 2];
    }
    px[p * 4] = r; px[p * 4 + 1] = g; px[p * 4 + 2] = bl; px[p * 4 + 3] = 255;
  }
  octx.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

function arrow(ctx, x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 7;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45));
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45));
  ctx.stroke();
}

/**
 * Draw the overlay. o = { n, grid, year, firstYear, lastYear, stars, showGaia, track, epoch, sel, fastLabel }.
 * Gaia positions (epoch 2016) are moved by their proper motion to the year of the picture being shown.
 */
export function drawOverlay(canvas, o) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!o || !o.n) return;
  const S = w / o.n, P = (v) => (v + 0.5) * S, c = P((o.n - 1) / 2);

  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(c + dx * 14, c + dy * 14); ctx.lineTo(c + dx * 26, c + dy * 26); }
  ctx.stroke();

  if (o.showGaia && o.stars) {
    ctx.font = '600 11px "Atkinson Hyperlegible Next", system-ui, sans-serif';
    for (const s of o.stars) {
      const at = (year) => { const [ra, dec] = propagate(s.ra, s.dec, s.pmra, s.pmdec, year - 2016); return skyToGrid(ra, dec, o.grid); };
      const [i, j] = at(o.year);
      if (i < -0.5 || j < -0.5 || i > o.n - 0.5 || j > o.n - 0.5) continue;
      ctx.strokeStyle = COLORS.gaia;
      ctx.globalAlpha = s.fast ? 1 : 0.75;
      ctx.lineWidth = s.fast ? 2 : 1.25;
      ctx.beginPath();
      ctx.arc(P(i), P(j), Math.max(5, Math.min(13, 15 - 0.6 * s.g)), 0, Math.PI * 2);
      ctx.stroke();
      if (s.fast && o.lastYear > o.firstYear) {
        const [i1, j1] = at(o.firstYear), [i2, j2] = at(o.lastYear);
        const len = Math.hypot(P(i2) - P(i1), P(j2) - P(j1));
        if (len > 6) {
          // lengthen short arrows so the direction stays readable; the label carries the real speed
          const k = Math.max(1, 26 / len), mx = (P(i1) + P(i2)) / 2, my = (P(j1) + P(j2)) / 2;
          const ox = 22, x1 = mx - (P(i2) - P(i1)) * k / 2 + ox, x2 = mx + (P(i2) - P(i1)) * k / 2 + ox;
          arrow(ctx, x1, my - (P(j2) - P(j1)) * k / 2, x2, my + (P(j2) - P(j1)) * k / 2);
          ctx.fillStyle = COLORS.gaia;
          ctx.fillText(o.fastLabel(s), Math.min(w - 96, Math.max(x1, x2) + 6), Math.max(12, Math.min(h - 6, my + 4)));
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  if (o.track && o.track.length) {
    ctx.fillStyle = COLORS.pick;
    for (const tr of o.track) if (tr.ok) { ctx.beginPath(); ctx.arc(P(tr.x), P(tr.y), 2.5, 0, Math.PI * 2); ctx.fill(); }
    const cur = o.track.find((tr) => tr.e === o.epoch) || o.sel;
    if (cur) {
      ctx.strokeStyle = COLORS.pick;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(P(cur.x), P(cur.y), Math.max(12, 2.6 * S), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (o.sel) {
    ctx.strokeStyle = COLORS.pick;
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(P(o.sel.x), P(o.sel.y), Math.max(12, 2.6 * S), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

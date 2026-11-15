// Small SVG charts for a measured source: its infrared spectrum and its brightness in each visit.
// Text put into the SVG is either numbers or interface strings, never user input.
// AI-assisted: written with Claude Code (Anthropic).
import { binCentre, binOf } from './pipeline.js';

export const DET_EDGES = [0.75, 1.10, 1.63, 2.42, 3.83, 4.42, 5.00];
const f1 = (v) => v.toFixed(1);
const nice = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toPrecision(2));

/** A colour per visit: distinct hues for a few visits, a blue-to-orange ramp (earlier to later) for many. */
export function visitColor(k, count) {
  const few = ['#3b6cf4', '#f08c00', '#12b886', '#cc5de8'];
  if (count <= few.length) return few[k];
  return `hsl(${Math.round(225 - 195 * k / (count - 1))} 75% 55%)`;
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length & 1 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]); };

/** Spectrum: every unsaturated frame is a dot (one wavelength per frame); one averaged line per visit. Returns false when empty. */
export function spectrumChart(svg, m, nVisits, dets, t) {
  const x0 = 40, x1 = 332, yb = 126, yt = 12, E = DET_EDGES;
  const X = (l) => x0 + (l - 0.75) / (5.0 - 0.75) * (x1 - x0);
  let h = '';
  for (let i = 0; i < 6; i++) {
    h += `<rect x="${f1(X(E[i]) + 0.5)}" y="134" width="${f1(X(E[i + 1]) - X(E[i]) - 1)}" height="7" rx="2" fill="var(--d${i + 1})" fill-opacity="${dets.includes(i) ? 1 : 0.3}"/>`;
    h += `<text x="${f1((X(E[i]) + X(E[i + 1])) / 2)}" y="153" text-anchor="middle">D${i + 1}</text>`;
  }
  for (const l of [1, 2, 3, 4, 5]) h += `<text x="${f1(X(l))}" y="170" text-anchor="middle">${l}</text>`;
  h += `<text x="${x1}" y="184" text-anchor="end">${t('specX')}</text>`;
  h += `<line class="axis" x1="${x0}" y1="${yb}" x2="${x1}" y2="${yb}"/><line class="axis" x1="${x0}" y1="${yt}" x2="${x0}" y2="${yb}"/>`;
  const good = m.points.filter((p) => !p.sat && p.lam >= 0.74 && p.lam <= 5.01);
  if (good.length < 3) { svg.innerHTML = h; return false; }

  const lines = [];
  for (let e = 0; e < nVisits; e++) {
    const bins = new Map();
    for (const p of good) if (p.e === e) { const b = binOf(p.lam); if (!bins.has(b)) bins.set(b, []); bins.get(b).push(p.flux); }
    const pts = [...bins].sort((a, b) => a[0] - b[0]).map(([b, v]) => [b, binCentre(b), median(v)]);
    if (pts.length) lines.push({ e, pts });
  }
  const fl = good.map((p) => p.flux).sort((a, b) => a - b);
  const top = Math.max(quantile(fl, 0.98), ...lines.flatMap((l) => l.pts.map((p) => p[2]))) * 1.1 || 1;
  const bot = Math.min(0, quantile(fl, 0.02));
  const Y = (v) => yb - (Math.max(bot, Math.min(top, v)) - bot) / (top - bot) * (yb - yt);
  if (bot < 0) h += `<line class="grid" x1="${x0}" y1="${f1(Y(0))}" x2="${x1}" y2="${f1(Y(0))}"/>`;
  h += `<text x="${x0 - 5}" y="${yt + 4}" text-anchor="end">${nice(top)}</text><text x="${x0 - 5}" y="${f1(Y(0) + 4)}" text-anchor="end">0</text>`;
  h += `<text x="${x0 + 5}" y="${yt + 4}">${t('specY')}</text>`;
  for (const p of good) h += `<circle cx="${f1(X(p.lam))}" cy="${f1(Y(p.flux))}" r="1.6" fill="${visitColor(p.e, nVisits)}" fill-opacity=".38"/>`;
  for (const l of lines) {
    let seg = [], prev = null;
    const flush = () => { if (seg.length > 1) h += `<polyline class="spec-line" stroke="${visitColor(l.e, nVisits)}" points="${seg.join(' ')}"/>`; seg = []; };
    for (const [b, lam, v] of l.pts) {
      if (prev !== null && b - prev > 3) flush();
      seg.push(f1(X(lam)) + ',' + f1(Y(v)));
      prev = b;
    }
    flush();
  }
  svg.innerHTML = h;
  return true;
}

/** Brightness per visit as bars around the source's own average (100%). */
export function relativeChart(svg, relative, labels) {
  const rows = relative.filter((r) => r.rel != null), nAll = relative.length;
  if (rows.length < 2) { svg.innerHTML = ''; return false; }
  const x0 = 40, x1 = 332, yt = 16, yb = 92, mid = (yt + yb) / 2;
  const span = Math.max(0.25, ...rows.map((r) => Math.abs(r.rel - 1))) * 1.2;
  const Y = (v) => mid - (v - 1) / span * (mid - yt);
  const step = (x1 - x0) / rows.length, bw = Math.min(46, step * 0.62);
  let h = `<line class="grid" x1="${x0}" y1="${mid}" x2="${x1}" y2="${mid}"/><text x="${x0 - 5}" y="${mid + 4}" text-anchor="end">100%</text>`;
  h += `<text x="${x0 - 5}" y="${yt + 4}" text-anchor="end">+${Math.round(span * 100)}%</text><text x="${x0 - 5}" y="${yb + 4}" text-anchor="end">−${Math.round(span * 100)}%</text>`;
  const every = Math.ceil(rows.length / 6);
  rows.forEach((r, k) => {
    const cx = x0 + step * (k + 0.5), y = Y(r.rel), top = Math.min(y, mid), hgt = Math.max(1.5, Math.abs(y - mid));
    h += `<rect x="${f1(cx - bw / 2)}" y="${f1(top)}" width="${f1(bw)}" height="${f1(hgt)}" rx="3" fill="${visitColor(r.e, nAll)}"/>`;
    const pct = Math.round((r.rel - 1) * 100);
    if (rows.length <= 8) h += `<text class="strong" x="${f1(cx)}" y="${f1(r.rel >= 1 ? top - 4 : top + hgt + 12)}" text-anchor="middle">${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%</text>`;
    if (k % every === 0) h += `<text x="${f1(cx)}" y="112" text-anchor="middle">${labels[r.e]}</text>`;
  });
  svg.innerHTML = h;
  return true;
}

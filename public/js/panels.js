// Side panels: the measured source (inspector), the preset note, and the data details.
// Strings placed into HTML are interface text or numbers; anything else goes through esc().
// AI-assisted: written with Claude Code (Anthropic).
import { relativeChart, spectrumChart, visitColor } from './charts.js';
import { fmtDec, fmtRa, mjdToDate } from './sky.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function visitLegend(c) {
  if (c.nVisits <= 4) return c.labels.map((lab, k) => `<span><i style="background:${visitColor(k, c.nVisits)}"></i>${esc(lab)}</span>`).join('');
  const stops = c.labels.map((_, k) => visitColor(k, c.nVisits)).join(',');
  return `<span>${c.t('earlier')}</span><i class="ramp" style="background:linear-gradient(90deg,${stops})"></i><span>${c.t('later')}</span>`;
}

/** c = { t, m, dets, nVisits, labels, gaia (undefined = catalogue not loaded, null = no match, { s } = match), wise, on: { clear, centre } } */
export function renderInspector(root, c) {
  const { t, m } = c;
  const out = [`<div class="ins-head"><h2>${t('insTitle')}</h2>${m ? `<button type="button" class="link" data-act="clear">${t('clear')}</button>` : ''}</div>`];
  if (!m) out.push(`<p class="muted">${t('insEmpty')}</p>`);
  else if (!m.found) out.push(`<p class="mono">${fmtRa(m.sky[0])}&nbsp; ${fmtDec(m.sky[1])}</p><p class="muted">${t('insNone')}</p>`);
  else {
    const mo = m.motion, rel = m.relative.filter((r) => r.rel != null);
    out.push(`<p class="mono">${fmtRa(m.sky[0])}&nbsp; ${fmtDec(m.sky[1])}</p>`);
    const tags = [];
    if (mo && !mo.saturated) tags.push(mo.moved ? `<span class="tag move">${t('moving')}</span>` : `<span class="tag">${t('notMoving')}</span>`);
    if (rel.length >= 2) tags.push(m.variable ? `<span class="tag vary">${t('changing')}</span>` : `<span class="tag">${t('steady')}</span>`);
    out.push(`<div class="tags">${tags.join('')}</div>`);
    if (!mo) out.push(`<p class="muted">${t('oneVisit')}</p>`);
    else if (mo.saturated) out.push(`<p class="muted">${t('satMotion')}</p>`);
    else if (mo.moved) {
      out.push(`<div class="motion"><svg class="dial" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><text x="24" y="9" text-anchor="middle">${t('north')}</text>` +
        `<g transform="rotate(${(-mo.pa).toFixed(0)} 24 24)"><path d="M24 37V14M24 14l-6 7M24 14l6 7"/></g></svg>` +
        `<div><p class="big">${t('movedBig', { arc: mo.arcsec.toFixed(1) })}</p><p>${t('movedText', { dir: t('dir' + mo.dir), months: Math.max(1, Math.round(mo.years * 12)) })}</p>` +
        `<p class="muted small">${t('perYear', { rate: mo.rate.toFixed(1) })} · ${t('pxNote', { px: mo.px.toFixed(1) })}</p></div></div>`);
    } else out.push(`<p class="muted">${t('noMotion', { arc: Math.max(2, Math.ceil(mo.arcsec)) })}</p>`);
    out.push(`<h3>${t('relTitle')}</h3><svg class="chart" id="relChart" viewBox="0 0 340 118" role="img" aria-label="${t('relTitle')}"></svg><p class="muted small" id="relNote"></p>`);
    out.push(`<h3>${t('specTitle')}</h3><svg class="chart" id="specChart" viewBox="0 0 340 188" role="img" aria-label="${t('specTitle')}"></svg>`);
    out.push(`<div class="legend">${visitLegend(c)}</div><p class="muted small" id="specNote"></p>`);
    if (c.gaia === null) out.push(`<p class="gaia">${t('gaiaMiss')}</p>`);
    else if (c.gaia) {
      const s = c.gaia.s, bits = [t('gaiaMag', { g: s.g.toFixed(1) })], pm = Math.hypot(s.pmra || 0, s.pmdec || 0) / 1000;
      if (pm >= 0.05) bits.push(t('gaiaPm', { pm: pm.toFixed(2) }));
      if (s.plx > 1) bits.push(t('gaiaDist', { ly: (3261.56 / s.plx).toFixed(s.plx > 100 ? 1 : 0) }));
      out.push(`<p class="gaia hit"><strong>${t('gaiaHit')}</strong><br>${bits.join(' · ')}${s.id ? `<br><span class="mono small">Gaia DR3 ${esc(s.id)}</span>` : ''}</p>`);
    }
    out.push(`<div class="actions"><button type="button" class="btn" data-act="centre">${t('centreHere')}</button>` +
      `<a class="btn" href="${esc(c.wise)}" target="_blank" rel="noopener">${t('wiseview')} ↗</a></div>`);
  }
  root.innerHTML = out.join('');
  if (m && m.found) {
    const okRel = relativeChart(root.querySelector('#relChart'), m.relative, c.labels);
    root.querySelector('#relChart').hidden = !okRel;
    root.querySelector('#relNote').textContent = !okRel ? t('relNone')
      : t(m.method === 'wings' ? 'relWings' : 'relNote') + (m.variable ? ' ' + t('changedBy', { pct: Math.round(m.change * 100) }) : '');
    const okSpec = spectrumChart(root.querySelector('#specChart'), m, c.nVisits, c.dets, t);
    root.querySelector('.legend').hidden = !okSpec;
    root.querySelector('#specNote').textContent = !okSpec ? t(m.saturated > 0.8 ? 'specNone' : c.stacked ? 'specLive' : 'relNone')
      : t('specNote') + (m.saturated > 0.05 ? ' ' + t('specSat', { pct: Math.round(m.saturated * 100) }) : '');
  }
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => c.on[b.dataset.act]()));
}

/** The note shown for one of the five test targets: p = { title, name, fact, lookTitle, look } or null. */
export function renderAbout(root, p) {
  root.hidden = !p;
  if (p) root.innerHTML = `<h2>${esc(p.title)}: ${esc(p.name)}</h2><p>${esc(p.fact)}</p><p><strong>${esc(p.lookTitle)}:</strong> ${esc(p.look)}</p>`;
}

const day = (mjd) => mjdToDate(mjd).toISOString().slice(0, 10);
const median = (a) => { const s = a.filter((v) => typeof v === 'number').sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

/** c = { t, store, images, fov, labels, shown (current image or null), epoch, dets } */
export function renderDetails(root, c) {
  const { t, store: st, images } = c;
  if (!st || !images.length) { root.innerHTML = ''; return; }
  const rel = {};
  for (const im of images) { const r = im.p.split('/')[0].toUpperCase(); rel[r] = (rel[r] || 0) + 1; }
  const pictures = (frames) => frames.reduce((s, f) => s + (f.count || 1), 0);
  const relText = st.stacked ? 'DR1 + QR3' : Object.entries(rel).map(([k, v]) => `${esc(k)}: ${v}`).join(', ');
  const out = [`<p>${t('dFound', { n: c.found || images.length, rel: relText })} ${t('dUsed', { n: c.used })} ` +
    `${t('dSpan', { a: day(images[0].mjd), b: day(images[images.length - 1].mjd), n: st.epochs.length })}</p>`,
  `<p>${t('dGrid', { fov: c.fov, n: st.n, s: st.grid.scale })}</p>`];
  let rows = '';
  st.epochs.forEach((ep, e) => {
    const cells = st.cells[e].map((cell, d) => `<td>${pictures(cell.frames)}<span class="muted">/${ep.images.filter((im) => im.det === d + 1).length}</span></td>`).join('');
    rows += `<tr><th scope="row">${esc(c.labels[e])}</th><td class="mono">${day(ep.start)} – ${day(ep.end)}</td>${cells}</tr>`;
  });
  out.push(`<div class="table-wrap"><table><thead><tr><th>${t('dVisit')}</th><th>${t('dDates')}</th>${[1, 2, 3, 4, 5, 6].map((d) => `<th>D${d}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`);
  const fl = (k) => median(st.frames.map((f) => f.q && f.q.flags && f.q.flags[k]));
  const kinds = [['transient', 'qTransient'], ['overflow', 'qOverflow'], ['snowball', 'qSnowball'], ['bloom', 'qBloom'], ['persist', 'qPersist'], ['outlier', 'qOutlier']]
    .map(([k, label]) => [t(label), fl(k)]).filter(([, v]) => v != null);
  if (kinds.length) {
    out.push(`<h3>${t('dQuality')}</h3><p class="muted small">${t('dQualityNote')}</p><ul class="flags">${kinds.map(([l, v]) => `<li><span>${l}</span><strong>${v.toLocaleString('en')}</strong></li>`).join('')}</ul>`);
    out.push(`<p class="small">${t('dStreaks', { n: st.frames.filter((f) => f.q && f.q.streaks > 0).length })}<br>` +
      `${t('dCont', { n: st.frames.filter((f) => f.q && (f.q.aurora || f.q.glow)).length })}<br>${t('dRejected', { n: st.rejected.length })}</p>`);
  }
  if (c.shown) {
    let nan = 0;
    for (let p = 0; p < c.shown.length; p++) if (c.shown[p] !== c.shown[p]) nan++;
    out.push(`<p class="small">${t('dMasked', { pct: (100 * nan / c.shown.length).toFixed(1) })}</p>`);
  }
  const first = st.cells[c.epoch] && c.dets.map((d) => st.cells[c.epoch][d].frames[0]).find(Boolean);
  if (first && !st.stacked) out.push(`<p class="small"><a href="https://irsa.ipac.caltech.edu/ibe/data/spherex/${esc(first.p)}" target="_blank" rel="noopener">${t('dFits')} ↗</a></p>`);
  out.push(`<p class="muted small">${t('dAck')}</p>`);
  root.innerHTML = out.join('');
}

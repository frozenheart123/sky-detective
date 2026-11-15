// Sky Detective: page logic. Finds SPHEREx images of a sky position, stacks them per visit, and blinks them.
// AI-assisted: written with Claude Code (Anthropic).
import * as api from './api.js';
import { makeT } from './i18n.js';
import { renderAbout, renderDetails, renderInspector } from './panels.js';
import { groupEpochs, measure, planLoad, Store } from './pipeline.js';
import { fmtDec, fmtRa, gridToSky, mjdToDate, mjdToYear, parseCoords, propagate, sepArcsec } from './sky.js';
import { DATA_YEAR, findPreset, presetField, TARGETS } from './targets.js';
import { COLORS, drawOverlay, paint } from './viewer.js';

const SCALE = 6.15, CONCURRENCY = 3, BUDGET = 240, FOVS = [3, 5, 10], ALL = [0, 1, 2, 3, 4, 5];
const DET_RANGES = ['0.75–1.10', '1.10–1.63', '1.63–2.42', '2.42–3.83', '3.83–4.42', '4.42–5.00'];
const $ = (id) => document.getElementById(id);
const mem = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const params = new URLSearchParams(location.search);
const embed = params.get('embed') === '1';
let lang = params.get('lang') || mem.get('sd-lang', null);
if (lang !== 'en' && lang !== 'zh') lang = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
const t = makeT(() => lang);
const L = (o) => (o ? o[lang] || o.en : '');
const round5 = (v) => Math.round(v * 1e5) / 1e5;

const state = {
  field: null, grid: null, fov: 5, dets: [...ALL], mode: 'blink', epoch: 0, playing: !matchMedia('(prefers-reduced-motion: reduce)').matches,
  speed: 550, brightness: 55, gaia: true, store: null, images: [], found: 0, status: 'idle', error: null, loaded: 0, planned: 0, failed: 0,
  snapshot: null, catalog: null, stars: [], sel: null, selPos: null, shown: null, gen: 0, abort: null, timer: null, t0: 0,
};

const preset = () => TARGETS.find((x) => x.id === (state.field && state.field.preset)) || null;
const gridFor = (f, fov) => ({ ra: f.ra, dec: f.dec, n: 2 * Math.round(fov * 60 / SCALE / 2), scale: SCALE });
const avail = () => (state.store ? state.store.epochsFor(state.dets) : []);
// a frame of a saved copy is already a stack of `count` pictures
const pictures = (frames) => frames.reduce((s, f) => s + (f.count || 1), 0);
const used = (st) => pictures(st.frames);
function visitLabel(ep) {
  const d = mjdToDate(ep.mid);
  return lang === 'zh' ? `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月` : d.toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* ---------- drawing ---------- */
function draw() {
  const st = state.store, eps = avail();
  if (eps.length && !eps.includes(state.epoch)) state.epoch = eps[0];
  const v = eps.length ? st.view(state.mode, state.epoch, state.dets) : null;
  state.shown = v && v.img;
  paint($('sky'), state.shown, st ? st.n : 0, v ? v.sigma : 1, state.mode, state.brightness);
  $('veil').hidden = !!state.shown && state.status !== 'error';
  document.querySelectorAll('#film button').forEach((b) => b.setAttribute('aria-pressed', String(state.mode !== 'add' && Number(b.dataset.e) === state.epoch)));
  drawChips();
  drawMarks();
}

function drawMarks() {
  const st = state.store, eps = avail();
  if (!st || !eps.length) { drawOverlay($('overlay'), null); return; }
  $('scaleBar').style.width = ($('plate').clientWidth * 60 / (st.n * st.grid.scale)) + 'px';
  const yr = (e) => mjdToYear(st.epochs[e].mid), y0 = yr(eps[0]), y1 = yr(eps[eps.length - 1]);
  drawOverlay($('overlay'), {
    n: st.n, grid: st.grid, year: state.mode === 'add' ? (y0 + y1) / 2 : yr(state.epoch), firstYear: y0, lastYear: y1,
    stars: state.stars, showGaia: state.gaia, track: state.sel && state.sel.found ? state.sel.track : null,
    epoch: state.mode === 'add' ? -1 : state.epoch, sel: state.selPos,
    fastLabel: (s) => 'Gaia ' + (Math.hypot(s.pmra, s.pmdec) / 1000).toFixed(1) + '″/' + (lang === 'zh' ? '年' : 'yr'),
  });
}

function drawChips() {
  const st = state.store, eps = avail();
  $('chipMode').hidden = state.mode !== 'diff' || !eps.length;
  if (!st || !eps.length) { $('visitDate').textContent = '…'; $('visitInfo').textContent = ''; return; }
  const count = (e) => state.dets.reduce((s, d) => s + pictures(st.cells[e][d].frames), 0);
  if (state.mode === 'add') {
    $('visitDate').textContent = t('allVisits', { n: eps.length });
    $('visitInfo').textContent = t('images', { n: eps.reduce((s, e) => s + count(e), 0) });
  } else {
    $('visitDate').textContent = visitLabel(st.epochs[state.epoch]);
    $('visitInfo').textContent = t('visitN', { i: eps.indexOf(state.epoch) + 1, n: eps.length }) + ' · ' + t('images', { n: count(state.epoch) }) + (state.mode === 'diff' ? ' · ' + t('minusOthers') : '');
  }
}

function buildFilm() {
  const st = state.store, film = $('film');
  film.textContent = '';
  if (!st) return;
  const eps = avail();
  for (const ep of st.epochs) {
    const b = document.createElement('button'), cv = document.createElement('canvas'), lab = document.createElement('span');
    b.type = 'button'; b.dataset.e = ep.e; b.disabled = !eps.includes(ep.e);
    cv.width = st.n; cv.height = st.n;
    const v = b.disabled ? null : st.view('blink', ep.e, state.dets);
    paint(cv, v && v.img, st.n, v ? v.sigma : 1, 'blink', state.brightness);
    lab.textContent = visitLabel(ep);
    b.append(cv, lab);
    b.addEventListener('click', () => { setPlaying(false); if (state.mode === 'add') state.mode = 'blink'; state.epoch = ep.e; drawControls(); draw(); });
    film.append(b);
  }
}

function drawStatus() {
  const st = state.store;
  let text = '', deep = false;
  if (state.status === 'search') text = t('searching') + ' ' + t('searchingSec', { s: Math.round((Date.now() - state.t0) / 1000) });
  else if (state.status === 'load') text = t('loading', { a: state.loaded, b: state.planned });
  else if (state.status === 'ready' && st) {
    text = t('ready', { used: used(st), found: state.found }) + (state.failed ? ' · ' + t('failedSome', { n: state.failed }) : '') +
      ' · ' + (state.snapshot ? t('snapshot', { date: state.snapshot }) : t('live'));
    deep = !st.stacked && st.frames.length + st.rejected.length < state.images.length;
  } else if (state.status === 'error') text = state.error + (preset() ? '' : ' ' + t('irsaDown'));
  $('statusText').textContent = text;
  $('statusText').classList.toggle('bad', state.status === 'error');
  $('deepBtn').hidden = !deep;
  $('deepBtn').textContent = t('stackRest', { n: state.images.length });
  $('liveBtn').hidden = !(state.status === 'ready' && state.snapshot);
  $('progress').hidden = state.status !== 'load';
  $('progressBar').style.transform = `scaleX(${state.planned ? state.loaded / state.planned : 0})`;
  $('veilText').textContent = text;
  $('retryBtn').hidden = state.status !== 'error';
  $('spinner').hidden = state.status === 'error';
}

const press = (sel, key, val) => document.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[key] === String(val))));
function drawControls() {
  press('#modeSeg button', 'mode', state.mode);
  press('#speedSeg button', 'speed', state.speed);
  press('#fovSeg button', 'fov', state.fov);
  document.querySelectorAll('#dets button[data-d]').forEach((b) => b.setAttribute('aria-pressed', String(state.dets.includes(Number(b.dataset.d)))));
  $('allDets').setAttribute('aria-pressed', String(state.dets.length === 6));
  $('gaiaSwitch').setAttribute('aria-checked', String(state.gaia));
  $('brightness').value = state.brightness;
  press('#presets button', 'id', state.field && state.field.preset);
  $('playBtn').setAttribute('aria-label', state.playing ? t('pause') : t('play'));
  $('icoPause').hidden = !state.playing;
  $('icoPlay').hidden = state.playing;
}

function drawField() {
  const f = state.field, p = preset();
  if (!f) return;
  $('fieldName').textContent = p ? L(p.name) : f.name || t('yourSpot');
  $('fieldCoords').textContent = `${fmtRa(f.ra)}  ${fmtDec(f.dec)}  ·  ${f.ra.toFixed(4)}°, ${f.dec >= 0 ? '+' : '−'}${Math.abs(f.dec).toFixed(4)}°`;
  renderAbout($('about'), p && { title: t('aboutTarget'), name: L(p.name), fact: L(p.fact), lookTitle: t('lookFor'), look: L(p.look) });
}

function drawInspector() {
  const st = state.store, m = state.sel;
  let gaia;
  if (m && m.found && state.catalog) {
    const tr = m.track.find((x) => x.ok), sky = tr ? gridToSky(tr.x, tr.y, st.grid) : m.sky, year = tr ? mjdToYear(st.epochs[tr.e].mid) : DATA_YEAR;
    // a saturated star has no precise position: search wider, and never claim it is missing from Gaia
    const blob = m.motion && m.motion.saturated;
    gaia = blob ? undefined : null;
    let best = blob ? 15 : 6;
    for (const s of state.catalog) {
      const [ra, dec] = propagate(s.ra, s.dec, s.pmra, s.pmdec, year - 2016), d = sepArcsec(sky[0], sky[1], ra, dec);
      if (d < best) { best = d; gaia = { s, d }; }
    }
  }
  renderInspector($('inspector'), {
    t, m, dets: state.dets, nVisits: st ? st.epochs.length : 0, labels: st ? st.epochs.map(visitLabel) : [], gaia, stacked: !!(st && st.stacked),
    wise: m && m.found ? `http://byw.tools/wiseview#ra=${m.sky[0].toFixed(5)}&dec=${m.sky[1].toFixed(5)}&size=176&band=3&speed=500` : '',
    on: {
      clear: () => { state.selPos = null; state.sel = null; drawInspector(); drawMarks(); },
      centre: () => load({ ra: round5(m.sky[0]), dec: round5(m.sky[1]) }),
    },
  });
}

function drawDetails() {
  const st = state.store;
  renderDetails($('detailsBody'), {
    t, store: st, images: state.images, found: state.found, used: st ? used(st) : 0, fov: state.fov,
    labels: st ? st.epochs.map(visitLabel) : [], shown: state.shown, epoch: state.epoch, dets: state.dets,
  });
}

function drawAll() { drawField(); drawControls(); buildFilm(); draw(); drawStatus(); drawInspector(); drawDetails(); }

/* ---------- measuring ---------- */
function remeasure() {
  state.sel = state.store && state.selPos ? measure(state.store, state.selPos.x, state.selPos.y, state.dets) : null;
  drawInspector();
  drawMarks();
}

/* ---------- loading ---------- */
let restackTimer = null, lastMeasure = 0;
function onStacks() {
  restackTimer = null;
  if (!state.store) return;
  if (state.store.restack()) {
    buildFilm();
    draw();
    if (state.selPos && Date.now() - lastMeasure > 2500) { lastMeasure = Date.now(); remeasure(); }
  }
  drawStatus();
}

async function pump(plan, gen, signal) {
  const eOf = new Map(plan.map((im) => [im.p, im.e])), grid = state.grid;
  let next = 0;
  state.planned += plan.length;
  const worker = async () => {
    while (next < plan.length && gen === state.gen) {
      const batch = plan.slice(next, next + api.BATCH);
      next += api.BATCH;
      let frames = null;
      for (let attempt = 0; attempt < 2 && !frames; attempt++) {
        try { frames = await api.frames(grid, batch.map((b) => b.p), signal); } catch (e) { if (signal.aborted) return; }
      }
      if (gen !== state.gen) return;
      state.loaded += batch.length;
      if (!frames) state.failed += batch.length;
      else for (const f of frames) { if (f.meta.ok) state.store.add(eOf.get(f.meta.p), f.meta, f.data); else state.failed++; }
      if (!restackTimer) restackTimer = setTimeout(onStacks, 450);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

function begin(images, grid) {
  state.images = images;
  state.grid = grid;
  state.store = new Store(grid, groupEpochs(images));
}

function setCatalog(stars) {
  const fast = (s) => Math.hypot(s.pmra || 0, s.pmdec || 0) >= 300;
  state.catalog = stars || [];
  state.stars = state.catalog.filter((s, i) => fast(s) || (s.g < 17.5 && i < 160)).map((s) => ({ ...s, fast: fast(s) }));
}

function finish() {
  clearTimeout(restackTimer);
  restackTimer = null;
  state.status = 'ready';
  state.store.restack();
  if (!state.selPos) {
    const c = (state.store.n - 1) / 2, m = measure(state.store, c, c, state.dets);
    if (m && m.found) { state.selPos = { x: c, y: c }; state.sel = m; }
  } else state.sel = measure(state.store, state.selPos.x, state.selPos.y, state.dets);
  drawAll();
}

async function load(field, opt = {}) {
  const gen = ++state.gen;
  if (state.abort) state.abort.abort();
  const ac = (state.abort = new AbortController());
  const p = TARGETS.find((x) => x.id === field.preset);
  if (!opt.keepDets) state.dets = p && p.dets ? [...p.dets] : [...ALL];
  clearTimeout(restackTimer);
  restackTimer = null;
  Object.assign(state, {
    field, grid: gridFor(field, state.fov), store: null, images: [], found: 0, status: 'search', error: null, loaded: 0, planned: 0, failed: 0,
    snapshot: null, catalog: null, stars: [], sel: null, selPos: null, shown: null, epoch: 0, t0: Date.now(),
  });
  syncUrl();
  drawAll();
  try {
    const snap = p && state.fov === 5 && !opt.live ? await api.snapshot(p.id, ac.signal) : null;
    if (gen !== state.gen) return;
    if (snap && snap.head.stacked && snap.head.grid) {
      // A saved copy: every "frame" is a finished stack of one visit and one detector.
      const h = snap.head;
      const epochs = h.epochs.map((ep, e) => ({
        e, start: ep.start, end: ep.end, mid: ep.mid,
        images: ep.counts.flatMap((c, d) => Array.from({ length: c }, (_, k) => ({ p: 'DR1+QR3/saved', det: d + 1, mjd: ep.start + (ep.end - ep.start) * (c > 1 ? k / (c - 1) : 0.5) }))),
      }));
      state.images = epochs.flatMap((ep) => ep.images);
      state.found = h.found;
      state.grid = h.grid;
      state.store = new Store(h.grid, epochs);
      state.store.spec = h.spec || null;
      state.store.stacked = true;
      for (const f of snap.frames) if (f.meta.ok && epochs[f.meta.e]) state.store.add(f.meta.e, f.meta, f.data);
      state.loaded = state.planned = snap.frames.length;
      state.snapshot = h.made || '';
      setCatalog(h.catalog);
    } else {
      const images = await api.search(state.grid.ra, state.grid.dec, ac.signal);
      if (gen !== state.gen) return;
      if (!images.length) throw new Error(t('noCoverage'));
      state.found = images.length;
      begin(images, state.grid);
      api.catalog(state.grid.ra, state.grid.dec, state.grid.n * SCALE / 3600 * 0.75, ac.signal)
        .then((c) => { if (gen === state.gen) { setCatalog(c.stars); drawMarks(); drawInspector(); } })
        .catch(() => { /* the overlay is optional */ });
      state.status = 'load';
      drawAll();
      await pump(planLoad(state.store.epochs, BUDGET), gen, ac.signal);
      if (gen !== state.gen) return;
    }
    finish();
  } catch (e) {
    if (gen !== state.gen || (e && e.name === 'AbortError')) return;
    state.status = 'error';
    state.error = (e && e.message) || String(e);
    drawAll();
  }
}

async function deepen() {
  const st = state.store, gen = state.gen;
  if (!st || state.status !== 'ready') return;
  const plan = planLoad(st.epochs, Infinity, new Set([...st.frames, ...st.rejected].map((f) => f.p)));
  if (!plan.length) return;
  Object.assign(state, { status: 'load', snapshot: null, loaded: 0, planned: 0, failed: 0 });
  drawStatus();
  await pump(plan, gen, state.abort.signal);
  if (gen === state.gen) finish();
}

/* ---------- controls ---------- */
function step(dir) {
  const eps = avail();
  if (eps.length < 2 || state.mode === 'add') return;
  state.epoch = eps[(eps.indexOf(state.epoch) + dir + eps.length) % eps.length];
  draw();
}
function setPlaying(on) {
  state.playing = on;
  clearInterval(state.timer);
  if (on) state.timer = setInterval(() => step(1), state.speed);
  drawControls();
}
function viewChanged() { syncUrl(); drawControls(); buildFilm(); draw(); drawDetails(); if (state.selPos) remeasure(); }

function syncUrl() {
  const f = state.field, q = new URLSearchParams();
  if (!f) return;
  if (f.preset) q.set('target', f.preset);
  else { q.set('ra', f.ra); q.set('dec', f.dec); if (f.name) q.set('name', f.name); }
  if (state.fov !== 5) q.set('fov', state.fov);
  const p = preset(), def = p && p.dets ? p.dets : ALL;
  if (state.dets.join() !== def.join()) q.set('det', state.dets.map((d) => d + 1).join(''));
  if (state.mode !== 'blink') q.set('mode', state.mode);
  if (embed) q.set('embed', '1');
  try { history.replaceState(null, '', '?' + q); } catch { /* not allowed in this frame */ }
  $('embedLink').href = '?' + q.toString().replace(/&?embed=1/, '');
}

async function onSearch(text) {
  const msg = $('searchMsg');
  msg.textContent = '';
  msg.classList.remove('bad');
  const raw = text.trim();
  if (!raw) return;
  const p = findPreset(raw);
  if (p) return load(presetField(p));
  const c = parseCoords(raw);
  if (c) return load({ ra: round5(c.ra), dec: round5(c.dec) });
  if (/^[\d\s.,+\-:°'"]+$/.test(raw)) { msg.textContent = t('badSearch'); msg.classList.add('bad'); return; }
  msg.textContent = t('resolving', { name: raw });
  try {
    const r = await api.resolve(raw);
    let pos = [r.ra, r.dec];
    const fast = r.pmra != null && Math.hypot(r.pmra, r.pmdec) > 200;
    if (fast) pos = propagate(r.ra, r.dec, r.pmra, r.pmdec, DATA_YEAR - 2000);
    msg.textContent = fast ? t('pmNote') : '';
    load({ name: raw.slice(0, 60), ra: round5(pos[0]), dec: round5(pos[1]) });
  } catch (e) {
    msg.textContent = ((e && e.message) || String(e)) + ' ' + t('badSearch');
    msg.classList.add('bad');
  }
}

function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  $('q').placeholder = t('searchPh');
  $('langBtn').textContent = t('langBtn');
  $('langBtn').setAttribute('aria-label', t('langAria'));
  $('readout').textContent = t('readoutIdle');
  $('presets').querySelectorAll('button').forEach((b) => { b.lastChild.textContent = L(TARGETS.find((x) => x.id === b.dataset.id).name); });
  $('chipMode').innerHTML = `<i style="background:${COLORS.gone}"></i>${t('legendGone')}<i style="background:${COLORS.arrived}"></i>${t('legendNew')}`;
  drawAll();
}

function wire() {
  const presets = $('presets');
  for (const p of TARGETS) {
    const b = document.createElement('button'), dot = document.createElement('i');
    b.type = 'button'; b.dataset.id = p.id; b.className = 'chip ' + p.kind;
    b.append(dot, document.createTextNode(''));
    b.addEventListener('click', () => load(presetField(p)));
    presets.append(b);
  }
  const dets = $('dets');
  DET_RANGES.forEach((r, d) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.d = d; b.className = 'det';
    b.innerHTML = `<i style="background:var(--d${d + 1})"></i><b>D${d + 1}</b><small>${r} µm</small>`;
    b.addEventListener('click', () => {
      const has = state.dets.includes(d);
      if (has && state.dets.length === 1) return;
      state.dets = has ? state.dets.filter((x) => x !== d) : [...state.dets, d].sort();
      viewChanged();
    });
    dets.append(b);
  });
  $('allDets').addEventListener('click', () => { state.dets = [...ALL]; viewChanged(); });
  $('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.mode = b.dataset.mode; viewChanged(); } });
  $('speedSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.speed = Number(b.dataset.speed); setPlaying(true); } });
  $('fovSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || Number(b.dataset.fov) === state.fov || !FOVS.includes(Number(b.dataset.fov))) return;
    state.fov = Number(b.dataset.fov);
    if (state.field) load(state.field, { keepDets: true });
  });
  $('brightness').addEventListener('input', (e) => { state.brightness = Number(e.target.value); buildFilm(); draw(); });
  $('gaiaSwitch').addEventListener('click', () => { state.gaia = !state.gaia; drawControls(); drawMarks(); });
  $('playBtn').addEventListener('click', () => setPlaying(!state.playing));
  $('prevBtn').addEventListener('click', () => { setPlaying(false); step(-1); });
  $('nextBtn').addEventListener('click', () => { setPlaying(false); step(1); });
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); onSearch($('q').value); });
  $('langBtn').addEventListener('click', () => { lang = lang === 'en' ? 'zh' : 'en'; mem.set('sd-lang', lang); applyLang(); });
  $('retryBtn').addEventListener('click', () => state.field && load(state.field, { keepDets: true }));
  $('deepBtn').addEventListener('click', deepen);
  $('liveBtn').addEventListener('click', () => state.field && load(state.field, { keepDets: true, live: true }));
  $('copyBtn').addEventListener('click', () => {
    const done = () => { $('copyBtn').textContent = t('copied'); setTimeout(() => { $('copyBtn').textContent = t('copyLink'); }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, () => {});
  });
  const sky = $('sky');
  const at = (e) => { const r = sky.getBoundingClientRect(), n = state.store.n; return { x: (e.clientX - r.left) / r.width * n - 0.5, y: (e.clientY - r.top) / r.height * n - 0.5 }; };
  sky.addEventListener('click', (e) => { if (!state.store || !state.shown) return; state.selPos = at(e); lastMeasure = Date.now(); remeasure(); });
  sky.addEventListener('pointermove', (e) => {
    if (!state.store || !state.shown) return;
    const p = at(e), [ra, dec] = gridToSky(p.x, p.y, state.store.grid);
    $('readout').textContent = t('readout', { ra: fmtRa(ra), dec: fmtDec(dec) });
  });
  sky.addEventListener('pointerleave', () => { $('readout').textContent = t('readoutIdle'); });
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes((document.activeElement || {}).tagName)) return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
    else if (e.key === 'ArrowRight') { setPlaying(false); step(1); }
    else if (e.key === 'ArrowLeft') { setPlaying(false); step(-1); }
  });
  new ResizeObserver(() => drawMarks()).observe($('plate'));
  setInterval(() => { if (state.status === 'search') drawStatus(); }, 1000);
}

function start() {
  document.body.classList.toggle('embed', embed);
  const fov = Number(params.get('fov')), mode = params.get('mode'), det = params.get('det') || '';
  if (FOVS.includes(fov)) state.fov = fov;
  if (['blink', 'diff', 'add'].includes(mode)) state.mode = mode;
  if (params.get('gaia') === '0') state.gaia = false;
  const p = TARGETS.find((x) => x.id === (params.get('target') || '').toLowerCase());
  const ra = parseFloat(params.get('ra')), dec = parseFloat(params.get('dec'));
  const here = Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra < 360 && dec >= -90 && dec <= 90;
  const field = p ? presetField(p) : here ? { ra: round5(ra), dec: round5(dec), name: (params.get('name') || '').slice(0, 60) || undefined } : presetField(TARGETS[0]);
  wire();
  applyLang();
  const picked = [...new Set(det.split('').map((c) => Number(c) - 1).filter((d) => d >= 0 && d <= 5))].sort();
  load(field, {}).catch(() => {});
  if (picked.length) { state.dets = picked; viewChanged(); }
  setPlaying(state.playing);
}
start();

/* Sky Detective page logic. AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5). */
(() => {
  "use strict";
  const { ALL, ARCSEC, DETS, TARGETS, HEAT, DIFF, NODATA } = SD;
  const W = 768;
  const $ = (id) => document.getElementById(id);
  const canvas = $("sky"), ctx = canvas.getContext("2d"), fx = $("fx"), fctx = fx.getContext("2d");
  const off = document.createElement("canvas");
  let octx = null, imgData = null, globe = null;
  const css = getComputedStyle(document.documentElement);
  const C = (name) => css.getPropertyValue(name).trim();
  const reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  let lang = store.get("skydet-lang", null);
  if (lang !== "zh" && lang !== "en") lang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  const solved = new Set(store.get("skydet-solved", []));
  const state = { target: TARGETS[0], data: null, det: ALL, frame: 0, playing: !reduceMotion, speed: 550, brightness: 55, diff: false, grown: false, gaia: true, smooth: false, stretch: "soft", black: 20, tries: 0, solved: false, revealed: false, hint: null, misses: [], timer: null, msg: null, msgKey: null };

  const t = (key, vars) => { let s = (SD.STR[lang] && SD.STR[lang][key]) || SD.STR.en[key] || key; if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]); return s; };
  const L = (o) => (o == null ? "" : typeof o === "string" ? o : (o[lang] || o.en));
  const ui = () => ({ t, lang, grown: state.grown });

  /* ---------- visits available for the chosen detector ---------- */
  const nEpochs = () => (state.data ? state.data.epochs.length : 3);
  function avail() {
    const D = state.data;
    if (!D) return [0];
    const idx = D.det[state.det].frames.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
    return idx.length ? idx : [0];
  }
  function stepFrame(dir) { const a = avail(), i = a.indexOf(state.frame); state.frame = i < 0 ? a[0] : a[(i + dir + a.length) % a.length]; }
  function snapFrame() { const a = avail(); if (!a.includes(state.frame)) state.frame = a.reduce((b, i) => (Math.abs(i - state.frame) < Math.abs(b - state.frame) ? i : b), a[0]); }

  /* ---------- sky rendering ---------- */
  function stretchFn(sigma) {
    const hi = sigma * Math.pow(10, 0.9 + 2.6 * (1 - state.brightness / 100));
    const lo = sigma * (-1.5 + (state.black - 20) / 10), soft = sigma * 2;
    if (state.stretch === "soft") { const top = Math.asinh((hi - lo) / soft); return (v) => Math.asinh(Math.max(0, v - lo) / soft) / top; }
    return (v) => (v - lo) / (hi - lo);
  }
  function setSkyMsg(text) { $("skyMsg").hidden = !text; $("skyMsgText").textContent = text || ""; }
  function render() {
    const D = state.data;
    ctx.fillStyle = C("--void"); ctx.fillRect(0, 0, W, W);
    if (!D) { updateChip(); return; }
    const n = D.n, k = Math.min(state.frame, D.epochs.length - 1), S = W / n;
    if (!octx || off.width !== n) { off.width = n; off.height = n; octx = off.getContext("2d"); imgData = octx.createImageData(n, n); }
    const set = D.det[state.det], sm = state.smooth;
    const frame = sm ? set.sframes[k] : set.frames[k], mean = sm ? set.smean : set.mean;
    if (!frame) setSkyMsg(t("noFrame"));
    else {
      setSkyMsg(state.msg);
      const px = imgData.data, sigma = sm ? set.ssigma : set.sigma;
      const put = (p, lut, idx) => { px[p * 4] = lut[idx * 3]; px[p * 4 + 1] = lut[idx * 3 + 1]; px[p * 4 + 2] = lut[idx * 3 + 2]; px[p * 4 + 3] = 255; };
      const blank = (p) => { px[p * 4] = NODATA[0]; px[p * 4 + 1] = NODATA[1]; px[p * 4 + 2] = NODATA[2]; px[p * 4 + 3] = 255; };
      if (state.diff) {
        const a = sigma * Math.pow(10, 0.6 + 2.2 * (1 - state.brightness / 100));
        for (let p = 0; p < n * n; p++) { const v = frame[p] - mean[p]; if (Number.isFinite(v)) put(p, DIFF, Math.round((Math.max(-1, Math.min(1, v / a)) * 0.5 + 0.5) * 255)); else blank(p); }
      } else {
        const f = stretchFn(sigma);
        for (let p = 0; p < n * n; p++) { const v = frame[p]; if (Number.isFinite(v)) put(p, HEAT, Math.round(Math.max(0, Math.min(1, f(v))) * 255)); else blank(p); }
      }
      octx.putImageData(imgData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, W, W);
    }
    drawOverlays(D, k, S);
    updateChip();
  }
  function updateChip() {
    const D = state.data;
    if (!D) { $("dateText").textContent = "…"; $("ofText").textContent = ""; return; }
    const k = Math.min(state.frame, D.epochs.length - 1), e = D.epochs[k];
    $("dateText").textContent = lang === "zh" ? e.zh : e.en;
    const nImg = state.det === ALL ? e.images.reduce((a, b) => a + b, 0) : e.images[state.det];
    $("ofText").textContent = t("of", { i: k + 1, n: D.epochs.length }) + " · " + t("pics", { n: nImg });
    const a = avail();
    document.querySelectorAll("#timeline .tick").forEach((b, i) => { b.setAttribute("aria-pressed", String(i === k)); b.disabled = !a.includes(i); });
  }
  function ring(S, x, y, r, color, width, dash) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.arc((x + 0.5) * S, (y + 0.5) * S, r * S, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  function drawOverlays(D, k, S) {
    const P = (v) => (v + 0.5) * S, mint = C("--mint"), coral = C("--coral");
    ctx.save(); ctx.strokeStyle = C("--text"); ctx.globalAlpha = 0.45; ctx.lineWidth = 3;
    const c = P((D.n - 1) / 2), g = 34, l = 22;
    ctx.beginPath();
    ctx.moveTo(c - g - l, c); ctx.lineTo(c - g, c); ctx.moveTo(c + g, c); ctx.lineTo(c + g + l, c);
    ctx.moveTo(c, c - g - l); ctx.lineTo(c, c - g); ctx.moveTo(c, c + g); ctx.lineTo(c, c + g + l);
    ctx.stroke(); ctx.restore();
    if (state.grown && state.gaia) {
      ctx.save(); ctx.globalAlpha = 0.8;
      for (const s of D.gaia) {
        if (s.g > 17 && s.pm < 1000) continue;
        ring(S, s.x, s.y, Math.max(1.0, Math.min(2.6, 2.6 - (s.g - 8) * 0.13)), mint, 2);
        if (s.pm >= 1000) {
          const p = D.pos[k];
          ctx.setLineDash([6, 8]); ctx.strokeStyle = mint; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(P(s.x), P(s.y)); ctx.lineTo(P(p.x), P(p.y)); ctx.stroke(); ctx.setLineDash([]);
          ctx.font = "600 24px Lexend, sans-serif"; ctx.fillStyle = mint; ctx.globalAlpha = 1;
          ctx.fillText(t("gaiaLabel"), P(s.x) + 40, P(s.y) + 8); ctx.globalAlpha = 0.8;
        }
      }
      ctx.restore();
    }
    if (state.hint) ring(S, state.hint.x, state.hint.y, 7.5, C("--sun"), 4, [14, 10]);
    for (const m of state.misses) {
      ctx.save(); ctx.strokeStyle = coral; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
      const x = P(m.x), y = P(m.y), d = 12;
      ctx.beginPath(); ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d); ctx.stroke(); ctx.restore();
    }
    if ((state.solved || state.revealed) && state.target.kind !== "custom") {
      if (state.target.kind === "move") {
        ctx.save(); ctx.fillStyle = mint;
        for (const q of D.pos) { ctx.beginPath(); ctx.arc(P(q.x), P(q.y), 4, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      ring(S, D.pos[k].x, D.pos[k].y, 2.9, mint, 5);
    }
  }

  /* ---------- panels ---------- */
  function drawThumb(cv, D) {
    const n = D.n, set = D.det[ALL], f = set.frames.find((x) => x);
    if (!f) return;
    cv.width = n; cv.height = n;
    const g = cv.getContext("2d"), id = g.createImageData(n, n), s = set.sigma, top = Math.asinh(30);
    for (let p = 0; p < n * n; p++) {
      const v = f[p], x = Number.isFinite(v) ? Math.asinh(Math.max(0, v + 1.5 * s) / (2 * s)) / top : 0;
      const i = Math.round(Math.max(0, Math.min(1, x)) * 255);
      id.data[p * 4] = HEAT[i * 3]; id.data[p * 4 + 1] = HEAT[i * 3 + 1]; id.data[p * 4 + 2] = HEAT[i * 3 + 2]; id.data[p * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }
  function buildTargets() {
    const ul = $("targets"); ul.innerHTML = "";
    for (const tg of TARGETS) {
      const li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; b.className = "target"; b.dataset.id = tg.id;
      b.setAttribute("aria-pressed", String(state.target.id === tg.id));
      const cv = document.createElement("canvas"); cv.width = 48; cv.height = 48; cv.setAttribute("aria-hidden", "true");
      SD.loadTarget(tg.id).then((D) => drawThumb(cv, D), () => {});
      const txt = document.createElement("span");
      txt.innerHTML = '<span class="t-name"></span><span class="t-short"></span><span class="kind ' + tg.kind + '"></span>';
      txt.querySelector(".t-name").textContent = L(tg.name);
      txt.querySelector(".t-short").textContent = L(tg.short);
      txt.querySelector(".kind").textContent = t(tg.kind);
      b.append(cv, txt);
      if (solved.has(tg.id)) { const ok = document.createElement("span"); ok.className = "solved"; ok.textContent = "✓"; ok.title = t("solvedTag"); ok.setAttribute("aria-label", t("solvedTag")); b.append(ok); }
      b.addEventListener("click", () => selectTarget(tg));
      li.append(b); ul.append(li);
    }
  }
  function updateScore() {
    const n = TARGETS.filter((x) => solved.has(x.id)).length;
    $("scoreLabel").textContent = t("score");
    $("scoreNum").textContent = n + "/" + TARGETS.length;
    $("score").setAttribute("aria-label", t("scoreAria", { n, total: TARGETS.length }));
    $("pips").innerHTML = TARGETS.map((x) => '<span class="pip' + (solved.has(x.id) ? " on" : "") + '"></span>').join("");
  }
  function buildTimeline() {
    const tl = $("timeline"); tl.innerHTML = "";
    if (!state.data) return;
    state.data.epochs.forEach((e, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tick";
      b.innerHTML = '<span class="dot" aria-hidden="true"></span><span></span>';
      b.lastChild.textContent = lang === "zh" ? e.zh : e.en;
      b.addEventListener("click", () => { setPlaying(false); state.frame = i; render(); });
      tl.append(b);
    });
  }
  function buildDets() {
    const box = $("dets"), D = state.data; box.innerHTML = "";
    const make = (det, label, range, color) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "det"; b.dataset.det = det;
      b.setAttribute("aria-pressed", String(state.det === det));
      if (D && !D.det[det].frames.some((f) => f)) b.disabled = true;
      const sw = document.createElement("span"); sw.className = "sw"; sw.style.background = color;
      const name = document.createElement("b"); name.textContent = label;
      b.append(sw, name);
      if (range) { const sm = document.createElement("small"); sm.textContent = range + " µm"; b.append(sm); }
      if (state.target.kind !== "custom" && det === state.target.best) {
        const st = document.createElement("span"); st.className = "star"; st.textContent = "★"; st.title = t("bestTip"); st.setAttribute("aria-label", t("bestTip")); b.append(st);
      }
      b.addEventListener("click", () => { state.det = det; snapFrame(); buildDets(); render(); updateCharts(); updateCase(); });
      box.append(b);
    };
    make(ALL, t("all"), "", "conic-gradient(var(--d1),var(--d2),var(--d3),var(--d4),var(--d5),var(--d6),var(--d1))");
    DETS.forEach((r, i) => make(i, "D" + (i + 1), r, "var(--d" + (i + 1) + ")"));
  }
  function fmtSexa(deg, isRa) {
    const v = isRa ? (((deg % 360) + 360) % 360) / 15 : Math.abs(deg);
    const a = Math.floor(v), b = Math.floor((v - a) * 60), c = ((v - a) * 60 - b) * 60, p2 = (x) => String(x).padStart(2, "0");
    return isRa ? p2(a) + "h " + p2(b) + "m " + c.toFixed(1).padStart(4, "0") + "s" : (deg < 0 ? "−" : "+") + p2(a) + "° " + p2(b) + "′ " + p2(Math.round(c)) + "″";
  }
  function shareUrl() {
    const base = /^https?:/.test(location.protocol) ? location.origin + location.pathname : "https://sky-detective.vercel.app/";
    const tg = state.target, det = state.det === ALL ? "all" : "D" + (state.det + 1);
    return tg.kind === "custom" ? base + "?ra=" + tg.raDeg.toFixed(4) + "&dec=" + tg.decDeg.toFixed(4) : base + "?target=" + tg.id + "&det=" + det;
  }
  function updateCase() {
    const tg = state.target, D = state.data, custom = tg.kind === "custom";
    $("missionText").textContent = tg.kind === "move" ? t("missionMove") : tg.kind === "vary" ? t("missionVary") : t("missionCustom");
    $("triesText").textContent = custom ? "" : t("tries", { n: state.tries });
    $("factTitle").textContent = custom ? t("custom") : t("didYouKnow") + " " + L(tg.name);
    $("factText").textContent = custom ? "" : L(tg.fact);
    const dl = $("stats"); dl.innerHTML = "";
    for (const [k, v] of tg.stats || []) {
      const d = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = t(k); dd.textContent = k === "dist" ? v + " " + t("ly") : L(v);
      d.append(dt, dd); dl.append(d);
    }
    $("hintBtn").disabled = $("revealBtn").disabled = custom || state.solved || !D;
    const co = $("coords"); co.innerHTML = "";
    const ra = D ? D.raw.center.ra : tg.raDeg, dec = D ? D.raw.center.dec : tg.decDeg;
    const rows = [["center", fmtSexa(ra, true) + "  " + fmtSexa(dec, false) + (D ? "  (" + D.raw.center.year.toFixed(1) + ")" : "")], ["fov", t("fovVal")]];
    if (D) rows.push(["data", t("dataVal", { used: D.raw.usedImages, total: D.raw.totalImages })]);
    rows.forEach(([k, v]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = t(k); dd.textContent = v; co.append(dt, dd); });
    $("shareInput").value = shareUrl();
  }
  function setResult(msg, cls, stamp) {
    const r = $("result"); r.textContent = ""; r.className = "result" + (cls ? " " + cls : "");
    if (stamp) { const s = document.createElement("span"); s.className = "stamp"; s.textContent = stamp; r.append(s); }
    r.append(document.createTextNode(msg));
  }
  const photDet = () => (state.det === ALL ? (state.target.best >= 0 ? state.target.best : state.data.measuredOn - 1) : state.det);
  function updateCharts() {
    const D = state.data, tg = state.target;
    $("specBox").hidden = tg.kind === "custom";
    if (!D) { $("chart").innerHTML = ""; $("specChart").innerHTML = ""; $("chartNote").textContent = ""; $("specMsg").textContent = ""; $("chartTitle").textContent = ""; return; }
    const d = photDet();
    $("chartTitle").textContent = t("chartTitle", { det: "D" + (d + 1) });
    $("chartNote").textContent = SD.charts.lightCurve($("chart"), D, d, ui());
    $("specMsg").textContent = SD.charts.spectrum($("specChart"), D, state.det, ui());
    $("specNote").textContent = L(tg.spec);
    $("specNote").hidden = !tg.spec;
  }
  function applyLang() {
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    $("langBtn").textContent = t("lang"); $("langBtn").setAttribute("aria-label", t("langAria"));
    canvas.setAttribute("aria-label", t("skyAria"));
    $("playBtn").setAttribute("aria-label", state.playing ? t("pause") : t("play"));
    document.title = t("appName");
    if (globe) globe.relabel();
    if (state.msgKey) state.msg = t(state.msgKey);
    buildTargets(); buildTimeline(); buildDets(); updateScore(); updateCase(); updateCharts(); render();
    if (!$("result").textContent || $("result").dataset.kind === "start") { setResult(t("startMsg")); $("result").dataset.kind = "start"; }
  }

  /* ---------- actions ---------- */
  function setPlaying(on) {
    state.playing = on; clearInterval(state.timer);
    if (on) state.timer = setInterval(() => { stepFrame(1); render(); }, state.speed);
    $("icoPause").hidden = !on; $("icoPlay").hidden = on;
    $("playBtn").setAttribute("aria-label", on ? t("pause") : t("play"));
  }
  function resetCase() { state.tries = 0; state.solved = false; state.revealed = false; state.hint = null; state.misses = []; state.frame = 0; }
  function setHash(id) { try { history.replaceState(null, "", id ? "#" + id : location.pathname + location.search); } catch (e) { /* not allowed here */ } }
  function selectTarget(tg, det) {
    state.target = tg; state.det = det != null ? det : (tg.start != null ? tg.start : ALL); resetCase();
    state.brightness = tg.bright || 55; $("brightness").value = state.brightness;
    state.smooth = !!tg.smooth; $("smoothSwitch").setAttribute("aria-checked", String(state.smooth));
    state.data = null; state.msgKey = "loading"; state.msg = t("loading");
    document.querySelectorAll(".target").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === tg.id)));
    if (globe) globe.focus(tg);
    setHash(tg.id);
    buildTimeline(); buildDets(); updateCase(); updateCharts(); render(); setSkyMsg(state.msg);
    setResult(t("startMsg")); $("result").dataset.kind = "start";
    SD.loadTarget(tg.id).then((D) => {
      if (state.target !== tg) return;
      state.data = D; state.msgKey = null; state.msg = null; setSkyMsg(null); snapFrame();
      buildTimeline(); buildDets(); updateCase(); updateCharts(); render();
    }, () => { if (state.target === tg) { state.msgKey = "loadFail"; state.msg = t("loadFail"); setSkyMsg(state.msg); } });
  }
  function goToCoords(c) {
    const near = TARGETS.find((tg) => Math.abs(tg.raDeg - c.ra) * Math.cos(c.dec * Math.PI / 180) < 0.08 && Math.abs(tg.decDeg - c.dec) < 0.08);
    if (near) { selectTarget(near); return; }
    const custom = { id: "custom", kind: "custom", name: { en: "Your spot", zh: "你的位置" }, raDeg: c.ra, decDeg: c.dec, stats: [], best: -1 };
    document.querySelectorAll(".target").forEach((b) => b.setAttribute("aria-pressed", "false"));
    state.target = custom; state.det = ALL; state.data = null; resetCase();
    state.msgKey = "customNoData"; state.msg = t("customNoData");
    if (globe) globe.focus(custom);
    setHash(null);
    buildTimeline(); buildDets(); updateCase(); updateCharts(); render(); setSkyMsg(state.msg);
    $("result").dataset.kind = ""; setResult("");
  }
  function celebrate(cx, cy) {
    if (reduceMotion) return;
    const r = fx.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    fx.width = Math.round(r.width * dpr); fx.height = Math.round(r.height * dpr);
    const cols = [C("--sun"), C("--mint"), C("--coral"), "#ffffff"], parts = [];
    for (let i = 0; i < 48; i++) {
      const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 5) * dpr;
      parts.push({ x: cx * dpr, y: cy * dpr, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2 * dpr, r: (3 + Math.random() * 4) * dpr, c: cols[i % cols.length] });
    }
    const t0 = performance.now();
    const star = (x, y, rr) => { fctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? rr * 0.45 : rr; fctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } fctx.closePath(); fctx.fill(); };
    (function step(now) {
      const k = (now - t0) / 1200;
      fctx.clearRect(0, 0, fx.width, fx.height);
      if (k >= 1) return;
      fctx.globalAlpha = 1 - k;
      for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.14 * dpr; p.vx *= 0.985; fctx.fillStyle = p.c; star(p.x, p.y, p.r); }
      fctx.globalAlpha = 1;
      requestAnimationFrame(step);
    })(t0);
  }
  function onSolved(tg, D, cx, cy) {
    const name = L(tg.name);
    let msg;
    if (tg.kind === "move") {
      const a = D.pos[0], b = D.pos[D.pos.length - 1], px = Math.hypot(b.x - a.x, b.y - a.y);
      const months = Math.round((D.epochs[D.epochs.length - 1].year - D.epochs[0].year) * 12);
      msg = t("foundMove", { name, arc: (px * ARCSEC).toFixed(1), months, px: px.toFixed(1) });
    } else {
      const d = photDet(), rows = (D.phot[String(d + 1)] || []).filter((q) => q && q.bad === 0).map((q) => q.flux);
      msg = rows.length > 1 && Math.max(...rows) > 0
        ? t("foundVaryPct", { name, det: "D" + (d + 1), pct: Math.round((Math.max(...rows) - Math.min(...rows)) / Math.max(...rows) * 100) })
        : t("foundVary", { name });
    }
    solved.add(tg.id); store.set("skydet-solved", [...solved]);
    if (solved.size >= TARGETS.length && TARGETS.every((x) => solved.has(x.id))) msg += " " + t("allSolved");
    setResult(msg, "good", t("stamp"));
    updateScore(); buildTargets(); celebrate(cx, cy);
  }

  /* ---------- events ---------- */
  canvas.addEventListener("click", (e) => {
    const tg = state.target, D = state.data;
    $("result").dataset.kind = "";
    if (tg.kind === "custom") { setResult(t("customClick")); return; }
    if (!D || state.solved || !D.det[state.det].frames[state.frame]) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * D.n - 0.5, y = (e.clientY - r.top) / r.height * D.n - 0.5;
    const p = D.pos[Math.min(state.frame, D.epochs.length - 1)];
    state.tries++;
    if (Math.hypot(x - p.x, y - p.y) <= 3.2) { state.solved = true; state.misses = []; onSolved(tg, D, e.clientX - r.left, e.clientY - r.top); }
    else { state.misses.push({ x, y }); if (state.misses.length > 3) state.misses.shift(); setResult(state.tries >= 3 && !state.hint ? t("missHint") : t("miss"), "miss"); }
    updateCase(); render();
  });
  $("hintBtn").addEventListener("click", () => {
    const D = state.data; if (!D) return;
    const mid = D.pos[Math.floor(D.pos.length / 2)];
    let h = 0; for (const ch of state.target.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    state.hint = { x: mid.x + ((h & 255) / 255 - 0.5) * 5, y: mid.y + (((h >> 8) & 255) / 255 - 0.5) * 5 };
    $("result").dataset.kind = ""; setResult(t("hintMsg")); render();
  });
  $("revealBtn").addEventListener("click", () => { state.revealed = true; $("result").dataset.kind = ""; setResult(t("revealMsg"), "good"); render(); });
  $("playBtn").addEventListener("click", () => setPlaying(!state.playing));
  $("prevBtn").addEventListener("click", () => { setPlaying(false); stepFrame(-1); render(); });
  $("nextBtn").addEventListener("click", () => { setPlaying(false); stepFrame(1); render(); });
  $("speedSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-speed]"); if (!b) return;
    state.speed = +b.dataset.speed;
    $("speedSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (state.playing) setPlaying(true);
  });
  $("brightness").addEventListener("input", (e) => { state.brightness = +e.target.value; render(); });
  $("blackPt").addEventListener("input", (e) => { state.black = +e.target.value; render(); });
  $("stretchSel").addEventListener("change", (e) => { state.stretch = e.target.value; render(); });
  const bindSwitch = (id, key, after) => { const el = $(id); el.addEventListener("click", () => { state[key] = !state[key]; el.setAttribute("aria-checked", String(state[key])); if (after) after(); render(); }); };
  bindSwitch("diffSwitch", "diff");
  bindSwitch("gaiaSwitch", "gaia");
  bindSwitch("smoothSwitch", "smooth");
  bindSwitch("grownSwitch", "grown", () => { $("adv").hidden = !state.grown; updateCharts(); });
  $("langBtn").addEventListener("click", () => { lang = lang === "en" ? "zh" : "en"; store.set("skydet-lang", lang); applyLang(); });
  $("copyBtn").addEventListener("click", () => {
    const inp = $("shareInput"), btn = $("copyBtn");
    const done = () => { btn.textContent = t("copied"); setTimeout(() => { btn.textContent = t("copy"); }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, () => inp.select()); else inp.select();
  });
  $("surpriseBtn").addEventListener("click", () => { const o = TARGETS.filter((x) => x.id !== state.target.id); selectTarget(o[Math.floor(Math.random() * o.length)]); });
  function parseCoords(raw) {
    const dm = raw.match(/^\s*([+-]?\d+(?:\.\d+)?)[\s,]+([+\-−]?\d+(?:\.\d+)?)\s*$/);
    if (dm) return { ra: +dm[1], dec: +dm[2].replace("−", "-") };
    const m = raw.match(/^\s*(\d{1,2})[h:\s]+(\d{1,2})[m:\s]+(\d{1,2}(?:\.\d+)?)s?[\s,]+([+\-−]?)(\d{1,2})[d°:\s]+(\d{1,2})['′m:\s]+(\d{1,2}(?:\.\d+)?)["″s]?\s*$/i);
    if (!m) return null;
    const sign = m[4] === "-" || m[4] === "−" ? -1 : 1;
    return { ra: (+m[1] + m[2] / 60 + m[3] / 3600) * 15, dec: sign * (+m[5] + m[6] / 60 + m[7] / 3600) };
  }
  const validCoords = (c) => c && c.ra >= 0 && c.ra < 360 && c.dec >= -90 && c.dec <= 90;
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("searchInput").value.trim(), msg = $("searchMsg"); msg.textContent = "";
    if (!raw) return;
    const key = raw.toLowerCase().replace(/[\s'’\-_.]/g, "");
    const hit = TARGETS.find((tg) => tg.aliases.some((a) => key === a || (key.length >= 4 && a.startsWith(key))));
    if (hit) { selectTarget(hit); return; }
    const c = parseCoords(raw);
    if (!validCoords(c)) { msg.textContent = t("notFound"); return; }
    goToCoords(c);
  });
  document.addEventListener("keydown", (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!state.playing); }
    else if (e.key === "ArrowRight") { setPlaying(false); stepFrame(1); render(); }
    else if (e.key === "ArrowLeft") { setPlaying(false); stepFrame(-1); render(); }
  });
  new ResizeObserver(() => { $("skyFrame").style.setProperty("--sky-w", $("skyFrame").clientWidth + "px"); }).observe($("skyFrame"));

  /* ---------- start: #target, ?target=…&det=…, or ?ra=…&dec=… ---------- */
  function fromLocation() {
    const q = new URLSearchParams(location.search);
    const detParam = (q.get("det") || "").toUpperCase(), det = /^D[1-6]$/.test(detParam) ? +detParam[1] - 1 : detParam === "ALL" ? ALL : null;
    const id = decodeURIComponent((location.hash || "").slice(1)).toLowerCase() || (q.get("target") || "").toLowerCase();
    const tg = TARGETS.find((x) => x.id === id);
    if (tg) return { tg, det };
    const c = { ra: parseFloat(q.get("ra")), dec: parseFloat(q.get("dec")) };
    return validCoords(c) ? { coords: c } : null;
  }
  window.addEventListener("hashchange", () => { const loc = fromLocation(); if (loc && loc.tg && loc.tg !== state.target) selectTarget(loc.tg); });

  globe = SD.initGlobe({
    wrap: $("globe"), help: $("globeHelp"), labels: $("glLabels"), targets: TARGETS, reduceMotion,
    selectedId: () => state.target.id, css: C, label: (tg) => L(tg.name),
    onPick: (tg) => (tg.kind === "custom" ? globe && globe.focus(tg) : selectTarget(tg))
  });
  applyLang();
  const start = fromLocation();
  if (start && start.coords) goToCoords(start.coords);
  else selectTarget(start ? start.tg : TARGETS[0], start ? start.det : null);
  setPlaying(state.playing);
})();

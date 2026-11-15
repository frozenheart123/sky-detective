/* Sky Detective charts: brightness per visit, and the light fingerprint (spectrum on the fly).
   AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
   Each function draws into an <svg> and returns the note to show under it. ui = { t, lang, grown }. */
window.SD = window.SD || {};
SD.charts = (() => {
  "use strict";
  const f1 = (v) => v.toFixed(1);
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const epochLabel = (e, ui) => (ui.lang === "zh" ? e.zh : e.en);

  function lightCurve(svg, D, d, ui) {
    const rows = D.phot[String(d + 1)] || [];
    const vals = rows.map((r) => (r ? r.flux : null));
    const max = Math.max(1e-9, ...vals.filter((v) => v != null));
    const n = vals.length, x0 = 44, x1 = 280, y0 = 104, y1 = 14;
    const xs = vals.map((_, i) => (n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * i / (n - 1)));
    const ys = vals.map((v) => (v == null ? null : y0 - (y0 - y1) * Math.max(0, v) / max));
    let h = '<line class="axis" x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y0 + '"/>';
    h += '<line class="axis" x1="' + x0 + '" y1="' + y1 + '" x2="' + x0 + '" y2="' + y0 + '"/>';
    h += '<text x="' + (x0 - 6) + '" y="' + (y1 + 4) + '" text-anchor="end">100%</text><text x="' + (x0 - 6) + '" y="' + (y0 + 4) + '" text-anchor="end">0</text>';
    const pts = xs.map((x, i) => (ys[i] == null ? null : f1(x) + "," + f1(ys[i]))).filter(Boolean);
    if (pts.length > 1) h += '<polyline class="lineC" points="' + pts.join(" ") + '"/>';
    let anySat = false;
    const showLabel = (i) => n <= 4 || i === 0 || i === n - 1 || i === Math.floor((n - 1) / 2);
    xs.forEach((x, i) => {
      if (ys[i] != null) {
        const sat = rows[i] && rows[i].bad > 0; anySat = anySat || sat;
        h += '<circle class="pt' + (sat ? " sat" : "") + '" cx="' + f1(x) + '" cy="' + f1(ys[i]) + '" r="' + (n > 6 ? 3.5 : 4.5) + '"/>';
      }
      if (showLabel(i)) h += '<text x="' + f1(x) + '" y="124" text-anchor="' + (i === 0 ? "start" : i === n - 1 ? "end" : "middle") + '">' + epochLabel(D.epochs[i], ui) + "</text>";
    });
    svg.innerHTML = h;
    const ring = D.raw.photMethod && D.raw.photMethod[String(d + 1)] === "ring";
    return ring ? ui.t("ringNote") : anySat ? ui.t("satNote") : "";
  }

  function spectrum(svg, D, det, ui) {
    let S = D.spec;
    const E = SD.DET_EDGES, x0 = 44, x1 = 292, yb = 108, yt = 12;
    const X = (l) => x0 + (l - 0.75) / (5.0 - 0.75) * (x1 - x0);
    let h = "";
    for (let i = 0; i < 6; i++) {
      const on = det === SD.ALL || det === i;
      h += '<rect x="' + f1(X(E[i]) + 0.5) + '" y="116" width="' + f1(X(E[i + 1]) - X(E[i]) - 1) + '" height="7" rx="2" fill="var(--d' + (i + 1) + ')" fill-opacity="' + (on ? 1 : 0.3) + '"/>';
      h += '<text x="' + f1((X(E[i]) + X(E[i + 1])) / 2) + '" y="134" text-anchor="middle">D' + (i + 1) + "</text>";
    }
    for (const l of [1, 2, 3, 4, 5]) h += '<text x="' + f1(X(l)) + '" y="152" text-anchor="middle">' + l + "</text>";
    h += '<text x="' + x0 + '" y="152" text-anchor="end" dx="-6">µm</text>';
    if (!S) { svg.innerHTML = h; return ""; }
    if (!S.points.length) {
      svg.innerHTML = h + '<line class="axis" x1="' + x0 + '" y1="' + yb + '" x2="' + x1 + '" y2="' + yb + '"/>';
      return ui.t("specNone");
    }
    // drop detectors where most pictures were saturated: the few left over are unreliable
    const detOf = (l) => Math.max(0, Math.min(5, E.findIndex((e, i) => i < 6 && l >= e && l < E[i + 1])));
    const nPts = [0, 0, 0, 0, 0, 0];
    for (const p of S.points) nPts[detOf(p[0])]++;
    const keep = nPts.map((c, i) => c > 0 && c >= ((S.saturated || {})[String(i + 1)] || 0));
    S = Object.assign({}, S, { points: S.points.filter((p) => keep[detOf(p[0])]), bins: S.bins.filter((b) => keep[detOf(b[0])]) });
    if (!S.points.length) { svg.innerHTML = h + '<line class="axis" x1="' + x0 + '" y1="' + yb + '" x2="' + x1 + '" y2="' + yb + '"/>'; return ui.t("specNone"); }
    const fl = S.points.map((p) => p[1]).sort((a, b) => a - b);
    const q = (p) => fl[Math.min(fl.length - 1, Math.max(0, Math.round(p * (fl.length - 1))))];
    const top = Math.max(q(0.97), ...S.bins.map((b) => b[1])) * 1.12 || 1;
    const bot = Math.min(0, q(0.03));
    const Y = (v) => yb - (Math.max(bot, Math.min(top, v)) - bot) / (top - bot) * (yb - yt);
    h += '<line class="axis" x1="' + x0 + '" y1="' + yb + '" x2="' + x1 + '" y2="' + yb + '"/>';
    h += '<line class="axis" x1="' + x0 + '" y1="' + yt + '" x2="' + x0 + '" y2="' + yb + '"/>';
    if (bot < 0) h += '<line class="grid" x1="' + x0 + '" y1="' + f1(Y(0)) + '" x2="' + x1 + '" y2="' + f1(Y(0)) + '"/>';
    h += '<text x="' + (x0 - 6) + '" y="' + (yt + 4) + '" text-anchor="end">' + (ui.grown ? fmt(top) : "") + "</text>";
    h += '<text x="' + (x0 - 6) + '" y="' + f1(Y(0) + 4) + '" text-anchor="end">0</text>';
    h += '<text x="' + (x0 + 6) + '" y="' + (yt + 4) + '">' + (ui.grown ? ui.t("specY") : ui.t("specYKid")) + "</text>";
    let dots = "";
    for (const p of S.points) dots += '<circle class="sp" cx="' + f1(X(p[0])) + '" cy="' + f1(Y(p[1])) + '" r="1.7"/>';
    h += dots;
    let seg = [], prev = null;
    const lines = [];
    for (const b of S.bins) {
      if (prev && b[0] - prev > 0.35) { lines.push(seg); seg = []; }
      seg.push(f1(X(b[0])) + "," + f1(Y(b[1]))); prev = b[0];
    }
    lines.push(seg);
    for (const s of lines) if (s.length > 1) h += '<polyline class="lineS" points="' + s.join(" ") + '"/>';
    svg.innerHTML = h;
    const satDets = keep.map((k, i) => (!k && ((D.spec.saturated || {})[String(i + 1)] || 0) > 0 ? "D" + (i + 1) : null)).filter(Boolean);
    return satDets.length ? ui.t("specSat", { dets: satDets.join(", ") }) : "";
  }

  return { lightCurve, spectrum };
})();

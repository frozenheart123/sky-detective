/* Sky Detective data: targets, loading the real SPHEREx stacks, colour maps.
   AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5). */
window.SD = window.SD || {};
(() => {
  "use strict";
  const ALL = 6;
  SD.ALL = ALL;
  SD.ARCSEC = 6.2;
  SD.DETS = ["0.75–1.09", "1.10–1.62", "1.63–2.41", "2.42–3.82", "3.83–4.41", "4.42–5.00"];
  SD.DET_EDGES = [0.75, 1.10, 1.63, 2.42, 3.83, 4.42, 5.00];

  // best = detector index that shows the target most clearly; start = detector shown first (6 = All)
  SD.TARGETS = [
    { id: "barnard", kind: "move", best: 4, start: ALL,
      name: { en: "Barnard's Star", zh: "巴纳德星" },
      short: { en: "The fastest star in the sky", zh: "天上跑得最快的星" },
      fact: { en: "The fastest-moving star in our sky. It travels the width of the full Moon in about 180 years.", zh: "天空中移动最快的恒星。大约 180 年就能走过一个满月那么宽的距离。" },
      spec: { en: "A cool red dwarf, a bit more than half as hot as the Sun.", zh: "一颗冷的红矮星，温度只有太阳的一半多一点。" },
      raDeg: 269.4521, decDeg: 4.6934, stats: [["dist", "6"], ["pm", "10.4″"]],
      aliases: ["barnard", "barnards", "barnardsstar", "巴纳德", "巴纳德星"] },
    { id: "wise0855", kind: "move", best: 5, start: 5, bright: 85, smooth: true,
      name: { en: "WISE 0855", zh: "WISE 0855" },
      short: { en: "The coldest brown dwarf", zh: "最冷的褐矮星" },
      fact: { en: "The coldest brown dwarf we know, about as cold as a freezer. It glows only in heat light, so try glasses D6.", zh: "已知最冷的褐矮星，大约和冰箱冷冻室一样冷。它只在“热量光”里发亮，所以试试 D6 眼镜。" },
      spec: { en: "The bump near 4.5 µm is WISE 0855 itself: too cold to shine at shorter colours. The light at short colours comes from a background star. In 2026 WISE 0855 passes only 3″ from it, closer than one SPHEREx pixel, so the two blend together.", zh: "4.5 微米附近的凸起就是 WISE 0855 本身：它太冷，在更短的波长不发光。短波长的光来自一颗背景恒星。2026 年 WISE 0855 从它旁边只有 3 角秒的地方经过，比 SPHEREx 一个像素还近，所以两者混在了一起。" },
      raDeg: 133.7951, decDeg: -7.2452, stats: [["dist", "7.4"], ["pm", "8.1″"]],
      aliases: ["wise0855", "wise085507", "w0855", "0855"] },
    { id: "epsindi", kind: "move", best: 5, start: ALL,
      name: { en: "Epsilon Indi B", zh: "印第安座 ε B" },
      short: { en: "Brown dwarf twins", zh: "褐矮星双胞胎" },
      fact: { en: "Two brown dwarfs that orbit each other, far from their star Epsilon Indi A. From here they look like one dot.", zh: "两颗互相绕转的褐矮星，离它们的恒星 ε Indi A 很远。从地球上看，它们只是一个点。" },
      spec: { en: "Bright peaks near 1.3, 1.6, 2.1 and 4 µm with dark gaps between them. Water and methane gas in the brown dwarfs' air swallow the light in the gaps; methane makes the long dark stretch around 3.3 µm.", zh: "在 1.3、1.6、2.1 和 4 微米附近有亮峰，中间是暗的缺口。褐矮星大气里的水和甲烷把缺口处的光吸收了；3.3 微米附近那一长段暗区是甲烷造成的。" },
      raDeg: 331.0438, decDeg: -56.7827, stats: [["dist", "12"], ["pm", "4.7″"]],
      aliases: ["epsilonindib", "epsilonindi", "epsindib", "epsindi", "印第安座", "印第安座εb"] },
    { id: "rwaur", kind: "vary", best: 5, start: 5,
      name: { en: "RW Aurigae", zh: "御夫座 RW" },
      short: { en: "A baby star that dims", zh: "会变暗的婴儿恒星" },
      fact: { en: "A baby star still wrapped in dust. It dims when clouds of dust pass in front of it.", zh: "一颗还裹在尘埃里的婴儿恒星。尘埃云挡在它前面时，它就会变暗。" },
      spec: { en: "It gets brighter and brighter toward long wavelengths: about 19 times brighter at 4.6 µm than at 0.75 µm. A plain star would get dimmer. The extra light is warm dust around the baby star.", zh: "它越往长波长越亮：4.6 微米比 0.75 微米亮了大约 19 倍。普通恒星应该是越来越暗的。多出来的光来自婴儿恒星周围的暖尘埃。" },
      raDeg: 76.9564, decDeg: 30.4014,
      stats: [["type", { en: "Young star", zh: "年轻恒星" }], ["cycle", { en: "Irregular", zh: "不规则" }]],
      aliases: ["rwaurigae", "rwaur", "御夫座rw"] },
    { id: "rdra", kind: "vary", best: 3, start: 3,
      name: { en: "R Draconis", zh: "天龙座 R" },
      short: { en: "A red giant that pulses", zh: "会脉动的红巨星" },
      fact: { en: "An old red giant that swells and shrinks. It gets brighter and dimmer about every 8 months.", zh: "一颗年老的红巨星，会膨胀又收缩。大约每 8 个月亮暗变化一轮。" },
      spec: null,
      raDeg: 248.1675, decDeg: 66.755,
      stats: [["type", { en: "Pulsing red giant", zh: "脉动红巨星" }], ["cycle", { en: "About 245 days", zh: "约 245 天" }]],
      aliases: ["rdraconis", "rdra", "天龙座r"] }
  ];

  /* ---------- decoding and clean-up of the stacked frames ---------- */
  function b64f32(s) {
    if (!s) return null;
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Float32Array(u8.buffer);
  }
  // Saturated star cores arrive as NaN. NaN pixels next to bright pixels are filled with the frame's
  // maximum so cores show as solid bright spots; other NaNs (no data) stay NaN.
  function fillSaturated(f, n, sigma) {
    if (!f) return f;
    let max = -Infinity;
    for (const v of f) if (v > max) max = v;
    const out = f.slice();
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      const src = out.slice();
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const p = y * n + x;
        if (!Number.isNaN(src[p])) continue;
        let bright = false;
        for (let dy = -1; dy <= 1 && !bright; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
          if (src[yy * n + xx] > 30 * sigma) { bright = true; break; }
        }
        if (bright) { out[p] = max; changed = true; }
      }
      if (!changed) break;
    }
    return out;
  }
  // light [1 2 1] x [1 2 1] smoothing that skips NaN pixels; helps faint targets stand out from noise
  function smooth3(f, n) {
    if (!f) return f;
    const out = new Float32Array(n * n), k = [1, 2, 1];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!Number.isFinite(f[y * n + x])) { out[y * n + x] = f[y * n + x]; continue; }
      let s = 0, w = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
        const v = f[yy * n + xx];
        if (!Number.isFinite(v)) continue;
        const wt = k[dy + 1] * k[dx + 1]; s += v * wt; w += wt;
      }
      out[y * n + x] = s / w;
    }
    return out;
  }
  function meanFrame(frames, n) {
    const m = new Float32Array(n * n), c = new Uint16Array(n * n);
    for (const f of frames) if (f) for (let p = 0; p < n * n; p++) if (Number.isFinite(f[p])) { m[p] += f[p]; c[p]++; }
    for (let p = 0; p < n * n; p++) m[p] = c[p] ? m[p] / c[p] : NaN;
    return m;
  }

  const cache = new Map();
  SD.loadTarget = function (id) {
    if (cache.has(id)) return cache.get(id);
    const pr = fetch("data/" + id + ".json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((j) => {
      const n = j.n, det = {};
      const make = (src) => {
        const frames = src.frames.map((s) => fillSaturated(b64f32(s), n, src.sigma));
        const sframes = frames.map((f) => smooth3(f, n));
        // smoothing lowers pixel noise by about 2.7x; keep its own sigma so the stretch stays comparable
        return { sigma: src.sigma, frames, mean: meanFrame(frames, n), sframes, smean: meanFrame(sframes, n), ssigma: src.sigma / 2.7 };
      };
      for (let d = 1; d <= 6; d++) det[d - 1] = make(j.dets[String(d)]);
      det[ALL] = make(j.all);
      return { raw: j, n, det, epochs: j.epochs, pos: j.target, gaia: j.gaia || [], phot: j.phot, measuredOn: j.measuredOn, spec: j.spec || null };
    });
    cache.set(id, pr);
    pr.catch(() => cache.delete(id));
    return pr;
  };

  /* ---------- colour maps ---------- */
  SD.hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function makeLUT(stops) {
    const lut = new Uint8ClampedArray(256 * 3), s = stops.map(([p, c]) => [p, SD.hex(c)]);
    for (let i = 0; i < 256; i++) {
      const v = i / 255; let j = 0;
      while (j < s.length - 2 && v > s[j + 1][0]) j++;
      const [p0, c0] = s[j], [p1, c1] = s[j + 1], t = Math.min(1, Math.max(0, (v - p0) / (p1 - p0)));
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * t;
    }
    return lut;
  }
  SD.HEAT = makeLUT([[0, "#03040b"], [0.18, "#24104a"], [0.42, "#8a1d5e"], [0.66, "#e2552c"], [0.86, "#ffc23d"], [1, "#fff7dc"]]);
  SD.DIFF = makeLUT([[0, "#59d2ff"], [0.38, "#123048"], [0.5, "#05060e"], [0.62, "#4a2a08"], [1, "#ffc23d"]]);
  SD.NODATA = SD.hex("#151827");

  SD.mulberry32 = (a) => function () { a |= 0; a = a + 0x6D2B79F5 | 0; let q = Math.imul(a ^ a >>> 15, 1 | a); q = q + Math.imul(q ^ q >>> 7, 61 | q) ^ q; return ((q ^ q >>> 14) >>> 0) / 4294967296; };
  SD.gauss = (r) => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
})();

/* Sky Detective 3D sky globe (Three.js r128). Targets sit at their real RA/Dec; the Milky Way band
   follows the real galactic plane; the other background stars are decoration.
   AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).

   SD.initGlobe(api) -> { focus(target), relabel() } or null when WebGL/Three.js is unavailable.
   api: { wrap, help, labels, targets, selectedId, onPick(target), css(name), label(target), reduceMotion } */
window.SD = window.SD || {};
SD.initGlobe = function (api) {
  "use strict";
  const { wrap, help } = api;
  const fail = () => { wrap.hidden = true; help.hidden = true; return null; };
  if (!window.THREE) return fail();
  const T = window.THREE;
  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { return fail(); }
  if (!renderer.getContext()) return fail();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const el = renderer.domElement;
  el.setAttribute("aria-hidden", "true");
  wrap.prepend(el);

  const scene = new T.Scene();
  scene.fog = new T.Fog(new T.Color(api.css("--void")), 2.6, 4.9);
  const camera = new T.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 0, 3.6);
  const sky = new T.Group();
  sky.rotation.order = "XYZ"; sky.rotation.x = 0.35;
  scene.add(sky);

  // RA/Dec in degrees -> point on the sky sphere
  const vec = (ra, dec, r) => {
    const a = ra * Math.PI / 180, d = dec * Math.PI / 180; r = r || 1;
    return new T.Vector3(r * Math.cos(d) * Math.cos(a), r * Math.sin(d), -r * Math.cos(d) * Math.sin(a));
  };
  const radial = (size, stops) => {
    const cv = document.createElement("canvas"); cv.width = cv.height = size;
    const g = cv.getContext("2d"), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([p, c]) => gr.addColorStop(p, c));
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return new T.CanvasTexture(cv);
  };
  const glow = (color) => {
    const [R, G, B] = SD.hex(color), rgba = (a) => "rgba(" + R + "," + G + "," + B + "," + a + ")";
    return radial(64, [[0, "#ffffff"], [0.18, rgba(1)], [0.45, rgba(0.35)], [1, rgba(0)]]);
  };
  const starTex = radial(32, [[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.8)"], [1, "rgba(255,255,255,0)"]]);

  // faint shell and a coordinate grid (declination circles and hour circles)
  sky.add(new T.Mesh(new T.SphereGeometry(0.99, 48, 32), new T.MeshBasicMaterial({ color: new T.Color(api.css("--raise")), transparent: true, opacity: 0.28, depthWrite: false })));
  const gridMat = new T.LineBasicMaterial({ color: new T.Color(api.css("--line")), transparent: true, opacity: 0.85 });
  const loop = (fn) => {
    const pts = [];
    for (let i = 0; i <= 160; i++) pts.push(fn(i / 160 * Math.PI * 2));
    return new T.Line(new T.BufferGeometry().setFromPoints(pts), gridMat);
  };
  [-60, -30, 0, 30, 60].forEach((dec) => sky.add(loop((s) => vec(s * 180 / Math.PI, dec))));
  const up = new T.Vector3(0, 1, 0);
  for (let ra = 0; ra < 180; ra += 30) {
    const e = vec(ra, 0);
    sky.add(loop((s) => e.clone().multiplyScalar(Math.cos(s)).add(up.clone().multiplyScalar(Math.sin(s)))));
  }

  // decorative background stars plus a Milky Way band on the real galactic plane
  const rr = SD.mulberry32(777), NS = 1300, NM = 1700;
  const P3 = new Float32Array((NS + NM) * 3), CL = new Float32Array((NS + NM) * 3);
  const A = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445], [-0.8676661490, -0.1980763734, 0.4559837762]];
  let n = 0;
  const put = (ra, dec, b, warm) => {
    const v = vec(ra, dec, 1.001);
    P3[n * 3] = v.x; P3[n * 3 + 1] = v.y; P3[n * 3 + 2] = v.z;
    CL[n * 3] = b * (0.85 + 0.15 * warm); CL[n * 3 + 1] = b * (0.88 + 0.05 * warm); CL[n * 3 + 2] = b * (1 - 0.25 * warm);
    n++;
  };
  for (let k = 0; k < NS; k++) put(rr() * 360, Math.asin(2 * rr() - 1) * 180 / Math.PI, 0.35 + 0.65 * rr() ** 3, rr());
  for (let k = 0; k < NM; k++) {
    const l = rr() * 2 * Math.PI, b = SD.gauss(rr) * 0.11;
    const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
    const ex = A[0][0] * g[0] + A[1][0] * g[1] + A[2][0] * g[2];
    const ey = A[0][1] * g[0] + A[1][1] * g[1] + A[2][1] * g[2];
    const ez = A[0][2] * g[0] + A[1][2] * g[1] + A[2][2] * g[2];
    put(Math.atan2(ey, ex) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, ez))) * 180 / Math.PI, 0.25 + 0.35 * rr(), rr());
  }
  const sg = new T.BufferGeometry();
  sg.setAttribute("position", new T.BufferAttribute(P3, 3));
  sg.setAttribute("color", new T.BufferAttribute(CL, 3));
  sky.add(new T.Points(sg, new T.PointsMaterial({ size: 0.03, map: starTex, vertexColors: true, transparent: true, depthWrite: false })));

  // Earth in the middle
  scene.add(new T.AmbientLight(0xffffff, 0.55));
  const lamp = new T.DirectionalLight(0xffffff, 0.9); lamp.position.set(2, 1.5, 3); scene.add(lamp);
  scene.add(new T.Mesh(new T.SphereGeometry(0.14, 32, 24), new T.MeshStandardMaterial({ color: new T.Color("#3d7be0"), emissive: new T.Color("#0a1f4d"), roughness: 0.85 })));

  // glowing target markers with clickable name tags
  const layer = api.labels; layer.innerHTML = "";
  const marks = [];
  const kindColor = (k) => api.css(k === "move" ? "--mint" : k === "vary" ? "--coral" : "--sun");
  function addMark(tg) {
    const sp = new T.Sprite(new T.SpriteMaterial({ map: glow(kindColor(tg.kind)), transparent: true, depthWrite: false }));
    sp.position.copy(vec(tg.raDeg, tg.decDeg, 1.01)); sp.scale.setScalar(0.16); sky.add(sp);
    const b = document.createElement("button");
    b.type = "button"; b.className = "gl-label " + tg.kind; b.textContent = api.label(tg);
    const m = { tg, sp, b, front: true };
    b.addEventListener("click", () => api.onPick(m.tg));
    sp.userData.mark = m; layer.append(b); marks.push(m);
    return m;
  }
  api.targets.forEach(addMark);
  let customMark = null, goal = null, spin = !api.reduceMotion, drag = null;

  function focus(tg) {
    spin = false;
    if (tg.kind === "custom") {
      if (!customMark) customMark = addMark(tg);
      customMark.tg = tg; customMark.sp.position.copy(vec(tg.raDeg, tg.decDeg, 1.01));
      customMark.b.textContent = api.label(tg); customMark.sp.visible = true; customMark.b.hidden = false;
    } else if (customMark) { customMark.sp.visible = false; customMark.b.hidden = true; }
    const v = vec(tg.raDeg, tg.decDeg);
    let d = -Math.atan2(v.x, v.z) - sky.rotation.y;
    d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    goal = { x: Math.max(-1.45, Math.min(1.45, Math.asin(v.y))), y: sky.rotation.y + d };
    if (api.reduceMotion) { sky.rotation.x = goal.x; sky.rotation.y = goal.y; goal = null; }
    wake();
  }

  // drag to spin; a short tap on a marker picks it
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  el.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 }; spin = false; goal = null;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* not supported */ }
    wake();
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    sky.rotation.y += dx * 0.009;
    sky.rotation.x = Math.max(-1.45, Math.min(1.45, sky.rotation.x + dy * 0.009));
  });
  const end = (e) => {
    if (drag && drag.moved < 6 && e.type === "pointerup") {
      const r = el.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(marks.filter((m) => m.front && m.sp.visible).map((m) => m.sp));
      if (hits.length) api.onPick(hits[0].object.userData.mark.tg);
    }
    drag = null;
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  // render loop, paused while the globe is off screen or the tab is hidden
  const tmp = new T.Vector3();
  let raf = 0, onScreen = true;
  function size() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function tick(now) {
    raf = 0;
    if (goal) {
      sky.rotation.x += (goal.x - sky.rotation.x) * 0.09;
      sky.rotation.y += (goal.y - sky.rotation.y) * 0.09;
      if (Math.abs(goal.x - sky.rotation.x) + Math.abs(goal.y - sky.rotation.y) < 0.0008) goal = null;
    } else if (spin && !drag) sky.rotation.y += 0.0016;
    const w = wrap.clientWidth, h = wrap.clientHeight, selected = api.selectedId();
    for (const m of marks) {
      const on = m.tg.id === selected;
      m.sp.scale.setScalar(on ? (api.reduceMotion ? 0.26 : 0.24 + 0.035 * Math.sin(now / 280)) : 0.16);
      m.sp.getWorldPosition(tmp);
      const front = tmp.z > 0.12;
      tmp.project(camera);
      m.b.style.transform = "translate(" + ((tmp.x + 1) / 2 * w).toFixed(1) + "px," + ((1 - tmp.y) / 2 * h).toFixed(1) + "px) translate(-50%,-165%)";
      if (front !== m.front) { m.front = front; m.b.classList.toggle("back", !front); m.b.tabIndex = front ? 0 : -1; }
      m.b.classList.toggle("on", on);
    }
    renderer.render(scene, camera);
    if (onScreen && !document.hidden) raf = requestAnimationFrame(tick);
  }
  function wake() { if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(tick); }
  new ResizeObserver(() => { size(); wake(); }).observe(wrap);
  new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; wake(); }).observe(wrap);
  document.addEventListener("visibilitychange", wake);
  size(); wake();
  return { focus, relabel() { for (const m of marks) m.b.textContent = api.label(m.tg); } };
};

/* A 360° panorama viewer for ordinary equirectangular photos (twice as wide as they are tall), and the full-screen overlay the DM and
   the players see. No libraries: a small WebGL renderer, with a plain scrolling picture as the fallback when WebGL isn't there.

   The view is { yaw, pitch, fov } in degrees: yaw turns left and right (0 is the middle of the picture), pitch looks up and down,
   fov is how wide the view is. The projection is written as plain functions so it can be tested exactly. */

export const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const FOV_MIN = 30, FOV_MAX = 110, PITCH_MAX = 85;
export const wrapYaw = (y) => ((((y + 180) % 360) + 360) % 360) - 180;
const shortest = (from, to) => wrapYaw(to - from);   // the short way round

/* The direction seen at a point of the screen (x and y from -1 to 1), for this view. */
export function viewRay(view, aspect, x, y) {
  const th = Math.tan((view.fov * DEG) / 2);
  let dx = x * th * aspect, dy = y * th, dz = -1;
  const n = Math.hypot(dx, dy, dz);
  dx /= n; dy /= n; dz /= n;
  const p = view.pitch * DEG, cp = Math.cos(p), sp = Math.sin(p);
  const y1 = dy * cp - dz * sp, z1 = dy * sp + dz * cp;
  const w = view.yaw * DEG, cy = Math.cos(w), sy = Math.sin(w);
  return [dx * cy - z1 * sy, y1, dx * sy + z1 * cy];
}
/* Where that direction lands in the picture: 0 to 1 across, 0 to 1 down. */
export const rayToUV = ([x, y, z]) => [Math.atan2(x, -z) / (2 * Math.PI) + 0.5, 0.5 - Math.asin(clamp(y, -1, 1)) / Math.PI];

const VERT = "attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}";
const FRAG = `precision highp float;varying vec2 v;uniform sampler2D t;uniform float yaw,pitch,th,asp;
void main(){
  vec3 d=normalize(vec3(v.x*th*asp,v.y*th,-1.0));
  float cp=cos(pitch),sp=sin(pitch);
  d=vec3(d.x,d.y*cp-d.z*sp,d.y*sp+d.z*cp);
  float cy=cos(yaw),sy=sin(yaw);
  d=vec3(d.x*cy-d.z*sy,d.y,d.x*sy+d.z*cy);
  gl_FragColor=texture2D(t,vec2(atan(d.x,-d.z)/6.2831853+0.5,0.5-asin(clamp(d.y,-1.0,1.0))/3.14159265));
}`;

export function createPanoViewer(container, { onUserMove = null } = {}) {
  const doc = container.ownerDocument;
  const view = { yaw: 0, pitch: 0, fov: 90 };
  let locked = false, destroyed = false, raf = 0, anim = null, tex = null, ready = false;
  const canvas = doc.createElement("canvas");
  canvas.className = "pano-canvas";
  container.appendChild(canvas);
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false }) || canvas.getContext("experimental-webgl");
  let flat = null, prog = null, loc = null;

  if (gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    loc = { yaw: gl.getUniformLocation(prog, "yaw"), pitch: gl.getUniformLocation(prog, "pitch"), th: gl.getUniformLocation(prog, "th"), asp: gl.getUniformLocation(prog, "asp") };
    canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  } else {   // no WebGL: the picture, scrollable sideways
    canvas.remove();
    flat = doc.createElement("div");
    flat.className = "pano-flat";
    flat.innerHTML = '<img alt="Panorama" draggable="false">';
    container.appendChild(flat);
  }

  function draw() {
    raf = 0;
    if (destroyed || !gl || !ready) return;
    const dpr = Math.min(2, container.ownerDocument.defaultView?.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(container.clientWidth * dpr)), h = Math.max(1, Math.round(container.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform1f(loc.yaw, view.yaw * DEG);
    gl.uniform1f(loc.pitch, view.pitch * DEG);
    gl.uniform1f(loc.th, Math.tan((view.fov * DEG) / 2));
    gl.uniform1f(loc.asp, w / h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const redraw = () => { if (!raf && !destroyed) raf = (doc.defaultView || window).requestAnimationFrame(draw); };

  function normalise() { view.yaw = wrapYaw(view.yaw); view.pitch = clamp(view.pitch, -PITCH_MAX, PITCH_MAX); view.fov = clamp(view.fov, FOV_MIN, FOV_MAX); }
  function moved() { normalise(); redraw(); onUserMove?.({ ...view }); }

  /* ----- looking around ----- */
  const pointers = new Map();
  let pinch = null;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    if (locked) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: view.fov }; }
    anim = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || locked) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) { view.fov = pinch.fov * (pinch.d / d); moved(); }
      return;
    }
    const k = view.fov / Math.max(1, container.clientHeight);   // degrees per pixel
    view.yaw -= dx * k;
    view.pitch += dy * k;
    moved();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => { if (locked) return; e.preventDefault(); view.fov += e.deltaY * 0.05; moved(); }, { passive: false });
  const keys = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 4], ArrowDown: [0, -4] };
  container.tabIndex = 0;
  container.addEventListener("keydown", (e) => {
    const k = keys[e.key];
    if (k && !locked) { e.preventDefault(); view.yaw += k[0]; view.pitch += k[1]; moved(); }
    else if ((e.key === "+" || e.key === "=") && !locked) { view.fov -= 6; moved(); }
    else if (e.key === "-" && !locked) { view.fov += 6; moved(); }
  });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(redraw) : null;
  ro?.observe(container);

  function frame(now) {
    if (!anim || destroyed) return;
    const k = clamp((now - anim.t0) / anim.ms, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    view.yaw = anim.from.yaw + anim.dyaw * e;
    view.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * e;
    view.fov = anim.from.fov + (anim.to.fov - anim.from.fov) * e;
    normalise(); redraw();
    if (k < 1) (doc.defaultView || window).requestAnimationFrame(frame); else anim = null;
  }

  return {
    supported: !!gl,
    canvas,
    getView: () => ({ ...view }),
    /* Set the view, gliding the short way round if `animate`. */
    setView(v, { animate = false, ms = 700 } = {}) {
      const to = { yaw: wrapYaw(v.yaw ?? view.yaw), pitch: clamp(v.pitch ?? view.pitch, -PITCH_MAX, PITCH_MAX), fov: clamp(v.fov ?? view.fov, FOV_MIN, FOV_MAX) };
      if (!animate) { anim = null; Object.assign(view, to); redraw(); return; }
      anim = { t0: performance.now(), ms, from: { ...view }, to, dyaw: shortest(view.yaw, to.yaw) };
      (doc.defaultView || window).requestAnimationFrame(frame);
    },
    lock(on) { locked = !!on; if (locked) { pointers.clear(); pinch = null; } container.classList.toggle("pano-locked", locked); },
    /* Show a loaded <img>. A picture bigger than the screen can draw is shrunk first. */
    setImage(img) {
      if (flat) { flat.querySelector("img").src = img.src; ready = true; return; }
      let src = img;
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (img.naturalWidth > max || img.naturalHeight > max) {
        const k = Math.min(max / img.naturalWidth, max / img.naturalHeight);
        const c = doc.createElement("canvas");
        c.width = Math.max(1, Math.floor(img.naturalWidth * k)); c.height = Math.max(1, Math.floor(img.naturalHeight * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        src = c;
      }
      if (tex) gl.deleteTexture(tex);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ready = true;
      redraw();
    },
    resize: redraw,
    destroy() {
      destroyed = true;
      ro?.disconnect();
      if (gl) { if (tex) gl.deleteTexture(tex); gl.getExtension("WEBGL_lose_context")?.loseContext(); }
      container.innerHTML = "";
    },
  };
}

/* The full-screen look-around.
   o: { doc, title, load() -> Promise<Blob>, dm, preview,
        shared: { yaw, pitch, fov, follow, t }  (what the DM has chosen to show everyone),
        onPoint(view, { live }), onFollow(on), onShow(), onHide(), onClose() } */
export function openPanoOverlay(o) {
  const doc = o.doc || document;
  const el = doc.createElement("div");
  el.className = "panoov";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `Look around: ${o.title || "panorama"}`);
  el.innerHTML = `<div class="panostage"></div>
    <div class="panobar"><strong class="panotitle"></strong><span class="panomsg" role="status"></span><span class="panoact"></span></div>
    <div class="panohint">Drag to look around. Pinch or scroll to zoom.</div>`;
  doc.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  $(".panotitle").textContent = o.title || "Look around";
  const msg = (t) => { $(".panomsg").textContent = t || ""; };
  let lastLive = 0, lastT = o.shared?.t ?? 0, objectUrl = "", closed = false;
  const viewer = createPanoViewer($(".panostage"), {
    onUserMove: (v) => { if (o.dm && o.follow && Date.now() - lastLive > 500) { lastLive = Date.now(); o.onPoint?.(v, { live: true }); } },
  });
  const btn = (label, cls, fn, extra = "") => {
    const b = doc.createElement("button");
    b.type = "button"; b.className = `btn small ${cls}`; b.textContent = label; if (extra) b.title = extra;
    b.onclick = fn;
    $(".panoact").appendChild(b);
    return b;
  };
  const close = () => { if (closed) return; closed = true; viewer.destroy(); if (objectUrl) URL.revokeObjectURL(objectUrl); el.remove(); doc.removeEventListener("keydown", onKey, true); o.onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  doc.addEventListener("keydown", onKey, true);

  if (o.dm) {
    o.follow = !!o.shared?.follow;
    if (o.preview) btn("Show to players", "primary", () => { o.onShow?.(viewer.getView()); close(); });
    else {
      btn("Point everyone here", "primary", () => { o.onPoint?.(viewer.getView(), { live: false }); msg("Everyone is looking where you're looking."); }, "Turn everyone's view to where you are looking now");
      const f = btn("Lock their view to mine", "", () => { o.follow = !o.follow; f.setAttribute("aria-pressed", o.follow); o.onFollow?.(o.follow); msg(o.follow ? "Players can't look around: they follow you." : ""); }, "Players follow your view and can't look around by themselves");
      f.setAttribute("aria-pressed", o.follow);
      btn("Hide from players", "", () => { o.onHide?.(); close(); });
    }
    btn("Close", "", close);
    $(".panohint").textContent = o.preview ? "Only you can see this until you show it to the players." : "Players see this view. Drag to look around, then Point everyone here.";
  } else {
    btn("Back to the map", "primary", close);
  }
  if (o.shared) viewer.setView(o.shared);

  (async () => {
    try {
      msg("Loading…");
      const blob = await o.load();
      if (closed) return;
      const img = new Image();
      objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
      await img.decode();
      if (closed) return;
      viewer.setImage(img);
      msg(o.dm ? "" : "");
      el.querySelector(".pano-canvas, .pano-flat")?.focus?.();
    } catch (err) { msg(err.message || "That panorama couldn't be loaded."); }
  })();

  const api = {
    el, viewer, close,
    isClosed: () => closed,
    /* What the DM has chosen to show everyone changed: glide to it, and lock the view if they asked. */
    applyShared(p) {
      if (o.dm || !p) return;
      viewer.lock(!!p.follow);
      msg(p.follow ? "You're following your DM's view." : "");
      if (p.t !== lastT) { lastT = p.t; viewer.setView(p, { animate: true }); }
    },
    setTitle(t) { $(".panotitle").textContent = t; },
  };
  el.__pano = api;   // (so a test, or the browser console, can reach the viewer)
  if (!o.dm && o.shared) { viewer.lock(!!o.shared.follow); if (o.shared.follow) msg("You're following your DM's view."); }
  return api;
}

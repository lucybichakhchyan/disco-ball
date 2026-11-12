// Hanging, hover-reactive 3D disco ball — self-contained ES module.
// Drop it on any page with ONE line (it injects its own styles + elements):
//   <script type="module" src="https://<you>.github.io/<repo>/disco-ball.js"></script>
//
// What it does for the host page:
//  - hangs from the top of the screen on a fine line, turning slowly and swaying a little
//  - hangs just above an element marked data-disco-target (if there is one), so it never covers it
//  - drops in on its line once the page is ready (on the 'disco:cue' event, or after 2.5 s)
//  - throws spots of light across the page that sweep as it turns
//  - announces where the light falls ('disco:light' event) so the page can make words catch it
//  - hover spins it faster; a click or tap gives it a push and a short spin
//  - pauses on the 'disco:pause' event (detail: true/false) and while the tab is hidden
//  - waits for the page to load before fetching three.js, and removes itself if WebGL fails
//  - stays still for visitors who ask for reduced motion
//  - is hidden from screen readers (it is decoration)

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// Colours: the ball's coloured reflections and the light spots it throws.
// Lucy Bichakhchyan brand: violet range plus warm white.
const PALETTE = {
  panels: [0x8A2BE2, 0xAB8CF0, 0x9940E6, 0xBEADD6, 0x6E5A9A, 0xE9E7E1],
  lights: [0x8A2BE2, 0xAB8CF0, 0x9940E6, 0xF6F6F4],
  spots:  ['#FFFFFF', '#F6F6F4', '#CDB8FF', '#AB8CF0'],
  // party mode (music on): full colour
  // party lights: a club palette built round the brand violet (magenta, violet, ultraviolet blue,
  // cyan and one warm white)
  party:  ['#FF2E9A', '#A45BFF', '#5B5BFF', '#2EE6FF', '#FFE9D6'],
};

(async function initDiscoBall() {
  if (document.getElementById('disco-rig')) return;          // never double-init

  // ---------- Wait for the page first, so the ball never slows the content down ----------
  if (document.readyState !== 'complete') {
    await new Promise((r) => window.addEventListener('load', r, { once: true }));
  }
  await new Promise((r) =>
    'requestIdleCallback' in window ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 200)
  );

  let THREE;
  try { THREE = await import(THREE_URL); } catch (e) {        // offline or blocked: show nothing
    window.dispatchEvent(new Event('disco:failed'));
    return;
  }

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- Inject styles ----------
  const style = document.createElement('style');
  style.textContent = `
    #disco-rig {
      position: fixed; top: 0; left: 50%;
      width: var(--disco-size, 160px);
      margin-left: calc(var(--disco-size, 160px) / -2);
      z-index: 9999;
      pointer-events: none;
      transform-origin: 50% 0;       /* swings from the top of the screen */
      will-change: transform;
    }
    #disco-drop {
      transform: translateY(calc(-100% - 24px));
      transition: transform 1200ms cubic-bezier(0.34, 1.25, 0.64, 1);
    }
    #disco-drop.is-in { transform: none; }
    #disco-line {
      width: 1px; margin: 0 auto;
      height: var(--disco-line, 120px);
      background: rgba(246, 246, 244, 0.38);
    }
    #disco-floater { width: var(--disco-size, 160px); height: var(--disco-size, 160px); margin-top: -2px; }
    #disco-floater canvas {
      display: block;
      width: 100% !important; height: 100% !important;
      pointer-events: auto;          /* only the round ball takes the pointer... */
      cursor: pointer;
      clip-path: circle(var(--disco-hit, 32%) at 50% 50%);   /* ...not the square around it */
      -webkit-tap-highlight-color: transparent;
    }
    #disco-spots {
      position: fixed; inset: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 9998;
      mix-blend-mode: screen;        /* light adds to whatever it lands on */
    }
    @media (prefers-reduced-motion: reduce) {
      #disco-drop { transition: none; }
    }
  `;
  document.head.appendChild(style);

  // ---------- Elements: rig (swings) > drop (falls in) > line + ball ----------
  const rig = document.createElement('div');
  rig.id = 'disco-rig';
  rig.setAttribute('aria-hidden', 'true');
  const drop = document.createElement('div');
  drop.id = 'disco-drop';
  const line = document.createElement('div');
  line.id = 'disco-line';
  const container = document.createElement('div');
  container.id = 'disco-floater';
  drop.append(line, container);
  rig.appendChild(drop);

  const spotsCanvas = document.createElement('canvas');
  spotsCanvas.id = 'disco-spots';
  spotsCanvas.setAttribute('aria-hidden', 'true');
  document.body.append(spotsCanvas, rig);

  let running = false;
  function removeAll() {
    running = false;
    rig.remove(); spotsCanvas.remove(); style.remove();
    window.dispatchEvent(new Event('disco:failed'));         // the page can give the ball's space back
  }

  // ---------- Renderer (removes everything if WebGL is unavailable) ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    removeAll();
    return;
  }
  window.dispatchEvent(new Event('disco:ready'));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.addEventListener('webglcontextlost', removeAll);
  container.appendChild(renderer.domElement);

  // ---------- Scene & camera ----------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 7);

  // A medium-grey studio with strong white key-lights so the mirror tiles
  // reflect silver with bright/dark contrast, plus small coloured panels.
  function buildEnvScene(panelColors) {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x3a3a40);   // darkest reflection = gunmetal, never black
    const keyLights = [
      { p: [0, 10, 3],  s: 13, c: 0xffffff },
      { p: [8, 3, 6],   s: 8,  c: 0xffffff },
      { p: [-8, 2, 4],  s: 7,  c: 0xf1ecff },
      { p: [0, -9, -4], s: 11, c: 0x6b6870 },     // dim floor bounce
    ];
    keyLights.forEach((L) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(L.s, L.s), new THREE.MeshBasicMaterial({ color: L.c }));
      m.position.set(L.p[0], L.p[1], L.p[2]); m.lookAt(0, 0, 0); env.add(m);
    });
    const panel = new THREE.PlaneGeometry(2.4, 2.4);
    panelColors.forEach((c, i) => {
      const m = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({ color: c }));
      const a = (i / panelColors.length) * Math.PI * 2;
      m.position.set(Math.cos(a) * 5.5, (i % 2 ? 1 : -1) * 2.5, Math.sin(a) * 5.5);
      m.lookAt(0, 0, 0); env.add(m);
    });
    return env;
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const calmEnv = pmrem.fromScene(buildEnvScene(PALETTE.panels), 0.035).texture;
  scene.environment = calmEnv;

  // Party mode: the mirrors see a dark, hazy room. Colour on the ball comes only from the
  // moving lights, at the moments their beams land on it.
  let partyEnv = null;
  function getPartyEnv() {
    if (partyEnv) return partyEnv;
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x1f1b26);
    const key = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0x77727f }));
    key.position.set(-2, 10, 3); key.lookAt(0, 0, 0); env.add(key);
    partyEnv = pmrem.fromScene(env, 0.035).texture;
    return partyEnv;
  }

  // ---------- The disco ball ----------
  const ball = new THREE.Group();
  scene.add(ball);

  const RADIUS = 1.6;

  // Visible ball radius as a fraction of the canvas half-size, used for the
  // round hit area and to start the line at the top of the ball.
  const _worldHalf = Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z;
  const ballFrac = RADIUS / _worldHalf;
  container.style.setProperty('--disco-hit', (ballFrac * 50 + 0.5).toFixed(1) + '%');

  // Dark core so the grout gaps between tiles read as a solid ball.
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 0.965, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.7, metalness: 0.3 })
  );
  ball.add(core);

  // Latitude/longitude tile rings — the classic mirror-ball grid (clean rows).
  const tiles = [];
  const latBands = 26;
  const bandH = (Math.PI * RADIUS) / latBands;
  const tileSize = bandH * 0.9;
  for (let i = 1; i < latBands; i++) {
    const phi = (i / latBands) * Math.PI;
    const y = Math.cos(phi);
    const ringR = Math.sin(phi);
    const lonCount = Math.max(4, Math.round(2 * ringR * latBands));
    for (let j = 0; j < lonCount; j++) {
      const theta = (j / lonCount) * Math.PI * 2;
      tiles.push(new THREE.Vector3(ringR * Math.cos(theta), y, ringR * Math.sin(theta)));
    }
  }

  const tileGeo = new THREE.BoxGeometry(1, 1, 0.06);
  const tileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.04, envMapIntensity: 1.5 });
  const tileMesh = new THREE.InstancedMesh(tileGeo, tileMat, tiles.length);

  const dummy = new THREE.Object3D();
  tiles.forEach((dir, idx) => {
    const pos = dir.clone().multiplyScalar(RADIUS);
    dummy.position.copy(pos);
    dummy.lookAt(pos.clone().multiplyScalar(2));
    dummy.scale.set(tileSize, tileSize, 1);
    dummy.updateMatrix();
    tileMesh.setMatrixAt(idx, dummy.matrix);
  });
  ball.add(tileMesh);

  // ---------- Coloured lights circling the ball ----------
  const movingLights = [];
  PALETTE.lights.forEach((c, i) => {
    const L = new THREE.PointLight(c, 90, 30, 2);
    const a = (i / PALETTE.lights.length) * Math.PI * 2;
    L.position.set(Math.cos(a) * 5, Math.sin(a) * 3, 4);
    scene.add(L);
    movingLights.push({ light: L, base: a, calmColor: new THREE.Color(c) });
  });
  scene.add(new THREE.AmbientLight(0x45404f, 0.6));

  // ---------- How the light works (as in a real room) ----------
  // A mirror ball makes no light. Spotlights ("pin spots") are aimed at it, and each mirror tile
  // reflects the beam that hits it into a small spot on the wall. As the ball turns, every spot
  // sweeps across the room together. A spotlight's colour lights the tiles on its side of the ball,
  // and the spots those tiles throw are that colour. Beams are only visible in haze, so the calm
  // ball (no music) shows its spots but not its spotlight; party mode adds haze, and the four
  // coloured beams converging on the ball become visible.
  //
  // Each spotlight sits at a point on (or just past) the edge of the screen, in front of the wall.
  const CALM_FIXTURE = { ax: -0.12, ay: 0.02 };                         // one white pin spot, up and to the left
  // Party: moving-head lights placed unevenly round the room. Each one swings on its own,
  // at its own speed, to random places: sometimes across the room, sometimes onto the ball.
  // Only when a beam actually lands on the ball does the ball light up in that colour and
  // throw spots of it onto the walls.
  const PARTY_FIXTURES = [
    { ax: -0.04, ay: 0.36, colorAt: 0, width: 0.030, glow: 0.34 },
    { ax: 1.04,  ay: 0.11, colorAt: 2, width: 0.024, glow: 0.28 },
    { ax: 0.27,  ay: 1.05, colorAt: 3, width: 0.040, glow: 0.38 },
    { ax: 0.83,  ay: 1.05, colorAt: 1, width: 0.028, glow: 0.30 },
  ].map((f, i) => Object.assign(f, {
    aimX: 0.2 + 0.2 * i, aimY: 0.3 + 0.1 * (i % 2),   // where the beam points now (fractions of the screen)
    fromX: 0, fromY: 0, goX: 0, goY: 0,                // the swing in progress
    moveStart: 0, moveDur: 0, restUntil: 0,            // timing of the swing, then the rest after it
    onBall: false, offX: 0, offY: 0,                   // aimed at the ball (which moves), with a small offset
    hit: 0,                                            // how squarely the beam is on the ball (0 to 1, smoothed)
    color: PALETTE.party[0],
  }));

  const MAX_ON_BALL = 2;                               // never more than two lights on the ball at once
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  let lastBeatIdx = -1;

  function swing(f, now, cx, cy, W, H, ballR, toBall, dur) {
    f.fromX = f.aimX; f.fromY = f.aimY;
    f.onBall = toBall;
    if (toBall) {
      f.offX = (Math.random() - 0.5) * ballR * 0.5;
      f.offY = (Math.random() - 0.5) * ballR * 0.5;
    } else {
      f.goX = 0.04 + Math.random() * 0.92;
      f.goY = 0.04 + Math.random() * 0.86;
    }
    f.moveStart = now;
    f.moveDur = dur || 600 + Math.random() * 1000;     // 0.6 to 1.6 s
    f.restUntil = now + f.moveDur + 300 + Math.random() * 1500;
  }

  // Moving heads, as a lighting operator would run them: each one glides (easing in and out)
  // to a new place, rests, then moves again, always starting on a beat. Every fourth bar two of
  // them sweep together. At most two are on the ball at any moment.
  function aimFixtures(dt, now, cx, cy, W, H, ballR, beat) {
    const beatIdx = Math.floor(beat);
    if (beatIdx !== lastBeatIdx) {
      lastBeatIdx = beatIdx;
      if (beatIdx % 16 === 0 && beatIdx > 0) {
        // every fourth bar: a pair sweeps across the room in step
        const a = Math.floor(Math.random() * 4), b = (a + 1 + Math.floor(Math.random() * 3)) % 4;
        const y = 0.1 + Math.random() * 0.5, dir = Math.random() < 0.5 ? -1 : 1, x = 0.5 + dir * 0.32;
        [a, b].forEach((n, j) => {
          const f = PARTY_FIXTURES[n];
          swing(f, now, cx, cy, W, H, ballR, false, 1300);
          f.goX = x + (j ? 0.12 : -0.12) * dir; f.goY = y;
        });
      } else {
        PARTY_FIXTURES.forEach((f) => {
          if (now < f.restUntil) return;
          const onBall = PARTY_FIXTURES.filter((o) => o !== f && o.onBall).length;
          swing(f, now, cx, cy, W, H, ballR, onBall < MAX_ON_BALL && Math.random() < 0.35);
        });
      }
    }
    PARTY_FIXTURES.forEach((f) => {
      if (f.onBall) { f.goX = (cx + f.offX) / W; f.goY = (cy + f.offY) / H; }   // keep following the swaying ball
      const p = f.moveDur ? Math.min(1, (now - f.moveStart) / f.moveDur) : 1;
      const e = easeInOut(p);
      f.aimX = f.fromX + (f.goX - f.fromX) * e;
      f.aimY = f.fromY + (f.goY - f.fromY) * e;
      f.color = PALETTE.party[(f.colorAt + Math.floor(partyBar / 2)) % PALETTE.party.length];
      beamGeometry(f, cx, cy, W, H, ballR, dt);
    });
  }

  // Where a beam points, and how squarely it lands on the ball.
  function beamGeometry(f, cx, cy, W, H, ballR, dt) {
    const ax = f.ax * W, ay = f.ay * H;
    let ux = f.aimX * W - ax, uy = f.aimY * H - ay;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const along = (cx - ax) * ux + (cy - ay) * uy;
    const off = Math.abs((cx - ax) * uy - (cy - ay) * ux);
    const raw = along > 0 ? Math.max(0, 1 - off / (ballR * 1.1)) : 0;
    f.hit = dt == null ? raw : f.hit + (raw - f.hit) * Math.min(1, dt * 12);
    f.ux = ux; f.uy = uy; f.along = along;
  }
  const FRONT = 0.9;                                                     // how far in front of the wall the lights stand

  function dirTo(f, cx, cy, W, H) {                                     // unit vector from the ball to a spotlight
    const S = Math.max(W, H) * 0.5;
    const x = (f.ax * W - cx) / S, y = -(f.ay * H - cy) / S, z = FRONT;
    const len = Math.hypot(x, y, z);
    return { x: x / len, y: y / len, z: z / len };
  }
  function fixtureDirs() {
    const W = window.innerWidth, H = window.innerHeight;
    const c = ballCentre();
    return PARTY_FIXTURES.map((f) => dirTo(f, c.x, c.y, W, H));
  }

  const ctx = spotsCanvas.getContext('2d');
  // A sample of the tiles, each with its own reflectivity (some mirrors are cleaner than others).
  const mirrors = [];
  for (let k = 0; k < tiles.length; k += 3) {
    const d = tiles[k];
    mirrors.push({ x: d.x, y: d.y, z: d.z, refl: 0.35 + 0.65 * (((k * 37) % 100) / 100) });
  }

  // One soft light sprite per colour: bright centre fading to nothing.
  const sprites = {};
  ['#FFFFFF', '#F3EEFF'].concat(PALETTE.party).forEach((c) => {
    if (sprites[c]) return;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, c);
    grad.addColorStop(0.35, c);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sprites[c] = cv;
  });

  const litPoints = [];                                       // where bright light lands this frame, for the page
  let spotsDpr = 1;
  let spotsAlpha = 0;                                         // fades the light in after the ball lands
  function sizeSpots() {
    spotsDpr = Math.min(window.devicePixelRatio || 1, 2);
    spotsCanvas.width = Math.round(window.innerWidth * spotsDpr);
    spotsCanvas.height = Math.round(window.innerHeight * spotsDpr);
  }

  function drawSpots(cx, cy) {
    const W = window.innerWidth, H = window.innerHeight;
    ctx.setTransform(spotsDpr, 0, 0, spotsDpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    litPoints.length = 0;
    if (spotsAlpha <= 0) return;

    const ballR = (size / 2) * ballFrac;                      // the ball's radius on screen
    if (partyMix > 0.01) drawBeams(cx, cy, W, H, ballR);

    // the lights shining on the ball right now, with how strongly each one counts
    const lights = [];
    if (partyMix < 0.99) {
      const d = dirTo(CALM_FIXTURE, cx, cy, W, H);
      lights.push({ d, w: (1 - partyMix) * spotsAlpha, colors: ['#FFFFFF', '#F3EEFF'], calm: true });
    }
    if (partyMix > 0.01) {
      PARTY_FIXTURES.forEach((f) => {
        if (f.hit < 0.03) return;                             // this beam is off in the room, not on the ball
        lights.push({ d: dirTo(f, cx, cy, W, H), w: partyMix * spotsAlpha * f.hit,
                      colors: [f.color], calm: false });
      });
    }

    const WALL = Math.max(W, H) * 0.34;                       // the wall's distance behind the ball, in pixels
    const base = 2.6 + 2.6 * (size / 220);
    const ry = ball.rotation.y, rx = ball.rotation.x;
    const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx);
    for (let m = 0; m < mirrors.length; m++) {
      const t = mirrors[m];
      // the tile's facing direction after the ball's turn (Y) and tilt (X)
      const nx = t.x * cY + t.z * sY;
      let nz = -t.x * sY + t.z * cY;
      const ny = t.y * cX - nz * sX;
      nz = t.y * sX + nz * cX;
      if (nz < -0.2) continue;                                // on the far side of the ball

      for (let L = 0; L < lights.length; L++) {
        const li = lights[L], l = li.d;
        const facing = nx * l.x + ny * l.y + nz * l.z;        // how squarely the tile faces this light
        if (facing < 0.08) continue;                          // this light does not reach the tile
        // mirror reflection: r = 2(n·l)n − l
        const rxv = 2 * facing * nx - l.x, ryv = 2 * facing * ny - l.y, rzv = 2 * facing * nz - l.z;
        if (rzv > -0.12) continue;                            // bounces towards the viewer, not onto the wall
        const k = 1 / -rzv;                                   // longer throw = bigger, more stretched spot
        const px = cx + rxv * k * WALL, py = cy - ryv * k * WALL;
        if (px < -40 || px > W + 40 || py < -40 || py > H + 40) continue;
        const ddx = px - cx, ddy = py - cy;
        if (ddx * ddx + ddy * ddy < ballR * ballR) continue; // hidden behind the ball itself
        const glance = Math.min(1, (-rzv - 0.12) / 0.3);      // spots fade as the throw grazes the wall
        const alpha = li.w * t.refl * Math.min(1, facing * 2.2) * glance;
        if (alpha < 0.02) continue;
        const rad = base * (0.6 + 0.4 * Math.min(k, 3));
        const stretch = 1 + 0.55 * (Math.min(k, 3.5) - 1);    // oblique throws stretch away from the ball
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha * (li.calm ? 0.95 : 1));
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(ddy, ddx));
        ctx.scale(rad * 2.2 * stretch, rad * 2.2);
        ctx.drawImage(sprites[li.colors[m % li.colors.length]], -1, -1, 2, 2);
        ctx.restore();
        if (alpha > 0.55) litPoints.push(px, py);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Party haze: each moving light's beam, wherever it is pointing ----------
  // A beam in haze has a bright core and soft glowing edges, so each one is drawn in three
  // layers. Where a beam lands on the ball, the ball blocks it: the part beyond the ball fades
  // as the beam settles onto it, rather than cutting off at once.
  const BEAM_LAYERS = [
    { w: 2.4, a: 0.18 },   // the soft glow round the beam
    { w: 1.0, a: 0.42 },   // the beam
    { w: 0.3, a: 0.85 },   // its bright core
  ];
  const hex2 = (a) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  // One continuous cone per layer; its brightness along the beam is set by gradient stops, so
  // there is never a hard edge anywhere along it.
  function cone(ax, ay, ux, uy, len, w0, w1, stops, color) {
    const ex = ax + ux * len, ey = ay + uy * len;
    const px = -uy, py = ux;
    const grad = ctx.createLinearGradient(ax, ay, ex, ey);
    stops.forEach(([at, a]) => grad.addColorStop(Math.max(0, Math.min(1, at)), color + hex2(a)));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(ax + px * w0, ay + py * w0);
    ctx.lineTo(ex + px * w1, ey + py * w1);
    ctx.lineTo(ex - px * w1, ey - py * w1);
    ctx.lineTo(ax - px * w0, ay - py * w0);
    ctx.closePath();
    ctx.fill();
  }
  function drawBeams(cx, cy, W, H, ballR) {
    const far = Math.hypot(W, H) * 1.3;
    ctx.save();
    PARTY_FIXTURES.forEach((f) => {
      if (f.ux === undefined) return;
      const ax = f.ax * W, ay = f.ay * H;
      const strength = f.glow * 0.7 * partyMix * (1 + 0.5 * beatPulse);   // brighter on the claps
      // Where the beam meets the ball, the ball takes the light: the beam dims smoothly through
      // the ball and beyond it, rather than stopping on a line. How much it dims depends on how
      // squarely the beam is on the ball.
      const at = f.along > 0 ? f.along / far : 2;            // where the ball sits along the beam (0 to 1)
      const soft = (ballR * 1.6) / far;                      // the length of the fade, about a ball and a half
      const after = 1 - 0.85 * f.hit;                        // what is left of the beam beyond the ball
      const stops = at < 1
        ? [[0, 0.75], [at - soft, 0.62], [at + soft, 0.62 * after], [Math.min(1, at + soft + 0.35), 0.25 * after], [1, 0]]
        : [[0, 0.75], [0.6, 0.3], [1, 0]];
      BEAM_LAYERS.forEach((L) => {
        ctx.globalAlpha = Math.min(1, strength * L.a * 2);
        cone(ax, ay, f.ux, f.uy, far, 3 * L.w, (3 + far * f.width) * L.w, stops, f.color);
      });
    });
    ctx.restore();
  }

  // ---------- Hanging position and size ----------
  let size = 160, lineLen = 120;
  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    size = Math.round(Math.min(220, Math.max(96, Math.min(W, H) * 0.34)));
    const target = document.querySelector('[data-disco-target]');
    if (target) {
      const top = target.getBoundingClientRect().top;
      const gap = Math.max(16, size * 0.12);
      size = Math.round(Math.min(size, Math.max(64, top - gap - 24)));   // never reaches the words
      lineLen = Math.max(24, Math.round(top - gap - size));
    } else {
      lineLen = Math.round(H * 0.16);
    }
    // the line meets the top of the ball, not the top of its square canvas
    const inset = Math.round((size / 2) * (1 - ballFrac));
    rig.style.setProperty('--disco-size', size + 'px');
    rig.style.setProperty('--disco-line', (lineLen + inset) + 'px');
    container.style.marginTop = -inset + 'px';
    renderer.setSize(size, size, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    sizeSpots();
  }
  layout();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); if (!running) renderFrame(); });

  // ---------- Swing: a damped pendulum with a gentle idle sway ----------
  let angle = 0, angVel = 0;
  const SWAY = 0.03, STIFF = 9, DAMP = 1.1, MAX_ANGLE = 0.38;
  function push(strength, dir) {
    angVel += strength * (dir || (Math.random() < 0.5 ? -1 : 1));
  }

  // ---------- Interaction: hover spins it faster; a click or tap gives it a push ----------
  // Real mirror balls turn slowly, about 1 to 3 times a minute; the spots on the walls move
  // twice as fast as the ball turns, so slow is what looks right.
  const SPIN_IDLE = 0.16;     // about 1.5 turns a minute
  const SPIN_FAST = 0.55;     // a gentle push on hover or tap
  const SPIN_PARTY = 0.32;    // about 3 turns a minute while the music plays
  let spinSpeed = SPIN_IDLE;
  let targetSpeed = SPIN_IDLE;
  let burstTimer = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    targetSpeed = SPIN_FAST;
    push(0.15, e.movementX > 0 ? -1 : 1);
  });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') targetSpeed = SPIN_IDLE; });
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    push(0.45, e.clientX < r.left + r.width / 2 ? -1 : 1);    // pushed away from where you touched
    targetSpeed = SPIN_FAST;
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => { if (!el.matches(':hover')) targetSpeed = SPIN_IDLE; }, 1400);
  });

  // ---------- Frame ----------
  function ballCentre() {
    const R = lineLen + size / 2;
    return { x: window.innerWidth / 2 - R * Math.sin(angle), y: R * Math.cos(angle) };
  }
  function renderFrame() {
    rig.style.transform = `rotate(${angle}rad)`;
    renderer.render(scene, camera);
    const c = ballCentre();
    drawSpots(c.x, c.y);
  }

  // ---------- Animate ----------
  const clock = new THREE.Clock();
  let landed = false;
  let paused = document.documentElement.hasAttribute('data-paused');
  if (paused) drop.style.transition = 'none';                 // a saved pause skips the drop-in

  // Settling: after 30 s with no pointer, touch, key or scroll, the party calms down.
  const CALM_AFTER = 30000;
  let lastActivity = performance.now();
  let calm = false, calmMix = 0;

  // ---------- Party mode: the page sends 'disco:party' with on/off and a beat clock ----------
  let partyClock = null;                                      // function returning the music's beat (float)
  let partyMix = 0, beatPulse = 0, partyBar = 0;
  const partyColor = new THREE.Color();
  window.addEventListener('disco:party', (e) => {
    const d = e.detail || {};
    partyClock = d.on && typeof d.getBeat === 'function' ? d.getBeat : null;
    lastActivity = performance.now();
    if (motionQuery.matches) {                                // reduced motion: colour on or off, no movement
      partyMix = partyClock ? 1 : 0; beatPulse = 0.5;
      tileMat.envMapIntensity = partyClock ? 1.5 * 0.38 : 1.5;
      tileMat.roughness = partyClock ? 0.22 : 0.04;
      if (partyClock) {                                    // still: uneven, with one light on the ball
        const W = window.innerWidth, H = window.innerHeight, c = ballCentre();
        const STILL = [null, [0.16, 0.6], [0.66, 0.16], [0.44, 0.7]];
        PARTY_FIXTURES.forEach((f, i) => {
          f.aimX = STILL[i] ? STILL[i][0] : c.x / W;
          f.aimY = STILL[i] ? STILL[i][1] : c.y / H;
          f.color = PALETTE.party[f.colorAt];
          beamGeometry(f, c.x, c.y, W, H, (size / 2) * ballFrac, null);
        });
      }
      movingLights.forEach(({ light, calmColor }, i) => {
        light.color.copy(calmColor);
        if (partyClock) light.color.set(PALETTE.party[i % PALETTE.party.length]);
      });
      renderFrame();
    } else {
      start();
    }
  });
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((type) =>
    window.addEventListener(type, () => { lastActivity = performance.now(); }, { passive: true })
  );

  function animate() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();

    // party: follow the music's beat
    // the party fades in (and out) gently, over about two seconds
    partyMix += ((partyClock ? 1 : 0) - partyMix) * Math.min(dt / 0.75, 1);
    if (partyClock) {
      const beat = partyClock();
      // the beams brighten on the claps (beats 2 and 4) and settle in between
      beatPulse = Math.floor(beat) % 2 === 1 ? Math.exp(-(beat % 1) * 5) : beatPulse * 0.85;
      partyBar = Math.floor(beat / 4);
      lastActivity = now;                                     // a party never calms down
    } else {
      beatPulse *= 0.9;
    }

    // The room darkens for the party by dimming what the mirrors reflect, gradually, in step with
    // the lights coming up, so the ball never snaps to black.
    const dim = partyMix * partyMix * (3 - 2 * partyMix);    // eased 0 to 1
    tileMat.envMapIntensity = 1.5 * (1 - 0.62 * dim);
    tileMat.roughness = 0.04 + 0.18 * dim;                   // a little spread so a light's colour fills the tiles it hits
    if (partyMix > 0.01) {
      const c = ballCentre();
      aimFixtures(dt, now, c.x, c.y, window.innerWidth, window.innerHeight, (size / 2) * ballFrac,
                  partyClock ? partyClock() : lastBeatIdx);
    }
    const baseSpin = partyClock ? Math.max(targetSpeed, SPIN_PARTY) : targetSpeed;
    spinSpeed += (baseSpin * (1 - 0.65 * calmMix) - spinSpeed) * Math.min(dt * 4, 1);
    ball.rotation.y += spinSpeed * dt;
    ball.rotation.x = Math.sin(now * 0.0002) * 0.12;

    const t = now * 0.0009;
    const dirs = partyMix > 0.01 ? fixtureDirs() : null;
    movingLights.forEach(({ light, base }, i) => {
      // calm: soft lights drifting round the ball; party: each one becomes a spotlight's glow on the tiles
      const a = base + t * (i % 2 ? 1 : -1);
      let x = Math.cos(a) * 5.5, y = Math.sin(a * 1.3) * 3.5, z = 4;
      if (dirs) {
        const d = dirs[i % dirs.length];
        x += (d.x * 6 - x) * partyMix; y += (d.y * 6 - y) * partyMix; z += (d.z * 6 - z) * partyMix;
      }
      light.position.set(x, y, z);
      const f = PARTY_FIXTURES[i % PARTY_FIXTURES.length];
      partyColor.set(f.color);
      light.color.copy(movingLights[i].calmColor).lerp(partyColor, partyMix);
      light.intensity = 90 * (1 - partyMix) + partyMix * (20 + 420 * f.hit);
    });

    // settle when nobody has moved for a while: slower turn, softer sway, dimmer light
    const wantCalm = now - lastActivity > CALM_AFTER;
    if (wantCalm !== calm) {
      calm = wantCalm;
      window.dispatchEvent(new CustomEvent('disco:calm', { detail: calm }));
    }
    calmMix += ((calm ? 1 : 0) - calmMix) * Math.min(dt / 2.5, 1);   // eases over a few seconds

    // pendulum
    const sway = SWAY * (1 - 0.6 * calmMix) * Math.sin(now * 0.0011);
    angVel += (-STIFF * (angle - sway) - DAMP * angVel) * dt;
    angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle + angVel * dt));

    const lightTarget = 1 - 0.6 * calmMix;                    // dims to 40% when calm
    if (landed) spotsAlpha += (lightTarget - spotsAlpha) * Math.min(dt / 0.8, 1);

    renderFrame();
    if (litPoints.length) window.dispatchEvent(new CustomEvent('disco:light', { detail: litPoints }));
    requestAnimationFrame(animate);
  }

  function start() {
    if (running || paused || document.hidden || motionQuery.matches) return;
    running = true;
    clock.getDelta();                                         // no jump after a pause
    requestAnimationFrame(animate);
  }
  function stop() { running = false; }

  // Reduced motion: hang still, lit, with no drop, swing or turning.
  function applyMotionPreference() {
    if (motionQuery.matches) {
      stop();
      angle = 0; angVel = 0;
      ball.rotation.set(0.12, 0.6, 0);
      drop.classList.add('is-in');
      landed = true; spotsAlpha = 1;
      renderFrame();
    } else {
      start();
    }
  }
  motionQuery.addEventListener('change', applyMotionPreference);

  window.addEventListener('disco:pause', (e) => {
    paused = !!e.detail;
    if (paused) stop(); else start();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

  window.addEventListener('resize', () => { layout(); if (!running) renderFrame(); });

  // ---------- Entrance: drop in on the page's cue ----------
  function dropIn() {
    if (drop.classList.contains('is-in')) return;
    drop.classList.add('is-in');
    const settle = () => {
      landed = true;
      push(0.18);
      if (!running) { spotsAlpha = 1; renderFrame(); }        // paused from a saved setting: hang still, lit
    };
    if (motionQuery.matches) { settle(); return; }
    setTimeout(settle, 900);                                  // light comes on as the line goes taut
  }
  if (window.__discoCue) dropIn();
  else {
    window.addEventListener('disco:cue', dropIn, { once: true });
    setTimeout(dropIn, 2500);                                 // pages that never cue still get the ball
  }

  renderFrame();
  applyMotionPreference();
})();

// Roaming, hover-reactive 3D disco ball — self-contained ES module.
// Drop it on any page with ONE line (it injects its own styles + element):
//   <script type="module" src="https://<you>.github.io/<repo>/disco-ball.js"></script>
//
// Why a script and not an iframe: this runs inside the host page's DOM, so the
// ball can roam the whole viewport and let clicks pass through to your content.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

(function initDiscoBall() {
  if (document.getElementById('disco-floater')) return;      // never double-init

  // ---------- Inject styles ----------
  const style = document.createElement('style');
  style.textContent = `
    #disco-floater {
      position: fixed; top: 0; left: 0;
      width: 220px; height: 220px;
      pointer-events: none;          /* whole square is click-through */
      z-index: 9999;
      will-change: transform;
    }
    #disco-floater canvas {
      display: block;
      width: 100% !important; height: 100% !important;
      pointer-events: auto;          /* but interaction is re-enabled... */
      cursor: pointer;
      clip-path: circle(33% at 50% 50%);   /* ...only over the circular ball */
    }
  `;
  document.head.appendChild(style);

  // ---------- Create the roaming container ----------
  const container = document.createElement('div');
  container.id = 'disco-floater';
  document.body.appendChild(container);

  // ---------- Renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  container.appendChild(renderer.domElement);

  // ---------- Scene & camera ----------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 7);

  // Custom disco "room": a medium-grey studio with strong white key-lights so
  // the mirror tiles reflect silver with bright/dark contrast, plus small
  // saturated panels for coloured sparkle accents.
  const discoColors = [0xff2d75, 0x2d7bff, 0x35ffba, 0xffd23f, 0xb14dff, 0xff7b2d];
  function buildEnvScene() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x3a3d47);   // darkest reflection = gunmetal, never black
    const keyLights = [
      { p: [0, 10, 3],  s: 13, c: 0xffffff },
      { p: [8, 3, 6],   s: 8,  c: 0xffffff },
      { p: [-8, 2, 4],  s: 7,  c: 0xdfe6ff },
      { p: [0, -9, -4], s: 11, c: 0x676b78 },     // dim floor bounce
    ];
    keyLights.forEach((L) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(L.s, L.s), new THREE.MeshBasicMaterial({ color: L.c }));
      m.position.set(L.p[0], L.p[1], L.p[2]); m.lookAt(0, 0, 0); env.add(m);
    });
    const panel = new THREE.PlaneGeometry(2.4, 2.4);
    discoColors.forEach((c, i) => {
      const m = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({ color: c }));
      const a = (i / discoColors.length) * Math.PI * 2;
      m.position.set(Math.cos(a) * 5.5, (i % 2 ? 1 : -1) * 2.5, Math.sin(a) * 5.5);
      m.lookAt(0, 0, 0); env.add(m);
    });
    return env;
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(buildEnvScene(), 0.035).texture;

  // ---------- The disco ball ----------
  const ball = new THREE.Group();
  scene.add(ball);

  const RADIUS = 1.6;

  // Visible ball radius as a fraction of the canvas half-size, so the ball
  // bounces off its own edge rather than the invisible square canvas.
  const _worldHalf = Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z;
  const ballFrac = RADIUS / _worldHalf;

  // Dark core so the grout gaps between tiles read as a solid ball.
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 0.965, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a2c38, roughness: 0.7, metalness: 0.3 })
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

  // ---------- Coloured spotlights (the "dance floor" lights) ----------
  const lightColors = [0xff2d75, 0x2d7bff, 0x35ffba, 0xffd23f];
  const movingLights = [];
  lightColors.forEach((c, i) => {
    const L = new THREE.PointLight(c, 90, 30, 2);
    const a = (i / lightColors.length) * Math.PI * 2;
    L.position.set(Math.cos(a) * 5, Math.sin(a) * 3, 4);
    scene.add(L);
    movingLights.push({ light: L, base: a });
  });
  scene.add(new THREE.AmbientLight(0x404060, 0.6));

  // ---------- Interaction: hover spins it faster ----------
  let spinSpeed = 0.25;
  const SPIN_IDLE = 0.25;
  const SPIN_HOVER = 2.4;
  let targetSpeed = SPIN_IDLE;
  renderer.domElement.addEventListener('pointerenter', () => { targetSpeed = SPIN_HOVER; });
  renderer.domElement.addEventListener('pointerleave', () => { targetSpeed = SPIN_IDLE; });

  // ---------- Roaming motion ----------
  const floater = { x: 40, y: 40, vx: 90, vy: 70 };   // px and px/sec

  // ---------- Resize ----------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Animate ----------
  const clock = new THREE.Clock();
  function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);

    spinSpeed += (targetSpeed - spinSpeed) * Math.min(dt * 4, 1);
    ball.rotation.y += spinSpeed * dt;
    ball.rotation.x = Math.sin(performance.now() * 0.0002) * 0.15;

    const t = performance.now() * 0.0009;
    movingLights.forEach(({ light, base }, i) => {
      const a = base + t * (i % 2 ? 1 : -1);
      light.position.x = Math.cos(a) * 5.5;
      light.position.y = Math.sin(a * 1.3) * 3.5;
    });

    // roam, bouncing off the BALL's edge (let transparent padding slide off-screen)
    const w = container.clientWidth, h = container.clientHeight;
    const mX = (w / 2) * (1 - ballFrac);
    const mY = (h / 2) * (1 - ballFrac);
    const minX = -mX, maxX = window.innerWidth - w + mX;
    const minY = -mY, maxY = window.innerHeight - h + mY;
    floater.x += floater.vx * dt;
    floater.y += floater.vy * dt;
    if (floater.x <= minX) { floater.x = minX; floater.vx *= -1; }
    if (floater.x >= maxX) { floater.x = maxX; floater.vx *= -1; }
    if (floater.y <= minY) { floater.y = minY; floater.vy *= -1; }
    if (floater.y >= maxY) { floater.y = maxY; floater.vy *= -1; }
    container.style.transform = `translate(${floater.x}px, ${floater.y}px)`;

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
})();

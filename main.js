import * as THREE from 'three';

// ---------- Block ids ----------
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, LOG = 4, LEAVES = 5, SAND = 6, PLANK = 7;
const BLOCKS = {
  [GRASS]:  { name: 'Grass',  css: '#6abe30' },
  [DIRT]:   { name: 'Dirt',   css: '#8a5f3c' },
  [STONE]:  { name: 'Stone',  css: '#8d8d8d' },
  [LOG]:    { name: 'Wood',   css: '#6b4e2e' },
  [LEAVES]: { name: 'Leaves', css: '#2f9e44' },
  [SAND]:   { name: 'Sand',   css: '#e3d79b' },
  [PLANK]:  { name: 'Plank',  css: '#c19a5b' },
};
const HOTBAR = [GRASS, DIRT, STONE, LOG, LEAVES, SAND, PLANK];

// Per-block, per-face colors: [top, bottom, +x, -x, +z, -z]
function faceColor(id, face) {
  switch (id) {
    case GRASS:
      if (face === 0) return [0.42, 0.75, 0.19];
      if (face === 1) return [0.54, 0.37, 0.24];
      return [0.45, 0.55, 0.22];
    case DIRT:  return [0.54, 0.37, 0.24];
    case STONE: return [0.55, 0.55, 0.57];
    case LOG:
      if (face === 0 || face === 1) return [0.55, 0.42, 0.26];
      return [0.36, 0.25, 0.15];
    case LEAVES: return [0.16, 0.55, 0.24];
    case SAND:  return [0.89, 0.84, 0.61];
    case PLANK: return [0.76, 0.60, 0.36];
    default: return [1, 1, 1];
  }
}
const SHADE = [1.0, 0.55, 0.8, 0.8, 0.68, 0.68]; // top,bottom,±x,±z

// ---------- World ----------
const SX = 48, SY = 32, SZ = 48;
let world = new Uint8Array(SX * SY * SZ);
const idx = (x, y, z) => (y * SZ + z) * SX + x;
const inBounds = (x, y, z) => x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ;
const getBlock = (x, y, z) => inBounds(x, y, z) ? world[idx(x, y, z)] : AIR;
function setBlock(x, y, z, v) { if (inBounds(x, y, z)) world[idx(x, y, z)] = v; }

// Deterministic pseudo-noise terrain
function hash2(x, z) {
  let h = x * 374761393 + z * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function smoothNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function heightAt(x, z) {
  const n = smoothNoise(x * 0.08, z * 0.08) * 0.65 + smoothNoise(x * 0.2, z * 0.2) * 0.35;
  return 4 + Math.floor(n * 6);
}

function generateWorld() {
  world = new Uint8Array(SX * SY * SZ);
  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      const h = heightAt(x, z);
      const beach = h <= 4;
      for (let y = 0; y <= h; y++) {
        let b = STONE;
        if (y === h) b = beach ? SAND : GRASS;
        else if (y >= h - 2) b = beach ? SAND : DIRT;
        setBlock(x, y, z, b);
      }
    }
  }
  // Trees (deterministic)
  let seed = 12345;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const x = 3 + Math.floor(rand() * (SX - 6));
    const z = 3 + Math.floor(rand() * (SZ - 6));
    const h = heightAt(x, z);
    if (h <= 4 || getBlock(x, h, z) !== GRASS) continue;
    const th = 4 + Math.floor(rand() * 2);
    for (let y = h + 1; y <= h + th; y++) setBlock(x, y, z, LOG);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 2; dy++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      const bx = x + dx, by = h + th - 2 + dy, bz = z + dz;
      if (getBlock(bx, by, bz) === AIR) setBlock(bx, by, bz, LEAVES);
    }
    setBlock(x, h + th + 1, z, LEAVES);
  }
}

// ---------- Renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 90);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 300);

scene.add(new THREE.HemisphereLight(0xcfefff, 0x7a5c3e, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(30, 50, 20);
scene.add(sun);

// World mesh (rebuilt on edit)
const worldMat = new THREE.MeshLambertMaterial({ vertexColors: true });
let worldMesh = null;

function buildWorldMesh() {
  const pos = [], norm = [], col = [];
  const push = (p, n, c) => { pos.push(...p); norm.push(...n); col.push(...c); };
  // faces: dir, corners (4), normal index
  const FACES = [
    { d: [0, 1, 0],  corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], shade: 0 }, // top
    { d: [0,-1, 0],  corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], shade: 1 }, // bottom
    { d: [1, 0, 0],  corners: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], shade: 2 }, // +x
    { d: [-1,0, 0],  corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], shade: 3 }, // -x
    { d: [0, 0, 1],  corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], shade: 4 }, // +z
    { d: [0, 0,-1],  corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], shade: 5 }, // -z
  ];
  for (let x = 0; x < SX; x++) for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) {
    const id = getBlock(x, y, z);
    if (!id) continue;
    for (const f of FACES) {
      if (getBlock(x + f.d[0], y + f.d[1], z + f.d[2])) continue; // hidden
      const base = faceColor(id, f.shade);
      const s = SHADE[f.shade];
      // slight per-block variation (deterministic)
      const v = 0.94 + 0.06 * hash2(x * 7 + y * 13, z * 11 + y * 5);
      const c = [base[0] * s * v, base[1] * s * v, base[2] * s * v];
      const [a, b, cc, d] = f.corners;
      const P = (cn) => [x + cn[0], y + cn[1], z + cn[2]];
      const N = f.d;
      push(P(a), N, c); push(P(b), N, c); push(P(cc), N, c);
      push(P(a), N, c); push(P(cc), N, c); push(P(d), N, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (worldMesh) { scene.remove(worldMesh); worldMesh.geometry.dispose(); }
  worldMesh = new THREE.Mesh(g, worldMat);
  worldMesh.matrixAutoUpdate = false;
  scene.add(worldMesh);
  window.__sceneReady = true;
}

// Block highlight
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
);
highlight.visible = false;
scene.add(highlight);

// ---------- Player ----------
const player = {
  pos: new THREE.Vector3(SX / 2 + 0.5, 12, SZ / 2 + 0.5),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  onGround: false, fly: false,
  w: 0.3, h: 1.8, eye: 1.62,
};
const keys = {};
let selected = 0;

function spawn() {
  const x = SX / 2, z = SZ / 2;
  player.pos.set(x + 0.5, heightAt(x, z) + 3, z + 0.5);
  player.vel.set(0, 0, 0);
}

function isSolid(x, y, z) { return !!getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); }
function collides(px, py, pz) {
  const w = player.w, h = player.h;
  const minX = px - w, maxX = px + w, minY = py, maxY = py + h, minZ = pz - w, maxZ = pz + w;
  for (let x = Math.floor(minX); x <= Math.floor(maxX); x++)
    for (let y = Math.floor(minY); y <= Math.floor(maxY); y++)
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++)
        if (getBlock(x, y, z)) {
          if (maxX > x && minX < x + 1 && maxY > y && minY < y + 1 && maxZ > z && minZ < z + 1) return true;
        }
  return false;
}

function movePlayer(dt) {
  const speed = player.fly ? 10 : (keys['shift'] ? 6.5 : 4.4);
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  let f = 0, s = 0;
  if (keys['keyw']) f += 1;
  if (keys['keys']) f -= 1;
  if (keys['keya']) s -= 1;
  if (keys['keyd']) s += 1;
  // forward is -z rotated by yaw
  let dx = (-sin * f + cos * s) * speed;
  let dz = (-cos * f - sin * s) * speed;

  if (player.fly) {
    let dy = 0;
    if (keys['space']) dy += speed;
    if (keys['shift']) dy -= speed;
    // shift doubles as sprint on ground but descend in fly; use Control/C for down too
    if (keys['keyc'] || keys['controlleft']) dy -= speed;
    tryAxis(dx * dt, 0, 0); tryAxis(0, dy * dt, 0); tryAxis(0, 0, dz * dt);
    player.vel.set(0, 0, 0);
  } else {
    player.vel.y -= 26 * dt;
    if (player.vel.y < -30) player.vel.y = -30;
    if (keys['space'] && player.onGround) { player.vel.y = 8.4; player.onGround = false; }
    tryAxis(dx * dt, 0, 0);
    tryAxis(0, player.vel.y * dt, 0, true);
    tryAxis(0, 0, dz * dt);
  }
}

function tryAxis(dx, dy, dz, isY = false) {
  const np = player.pos.clone(); np.x += dx; np.y += dy; np.z += dz;
  if (!collides(np.x, np.y, np.z)) {
    player.pos.copy(np);
    if (isY && dy < 0) { /* falling */ }
    if (isY) player.onGround = false;
  } else if (isY) {
    if (dy < 0) { player.onGround = true; player.vel.y = 0; }
    else if (dy > 0) { player.vel.y = 0; }
  }
}

// ---------- Voxel raycast (DDA) ----------
function raycastVoxel(origin, dir, maxDist = 7) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ ? Math.abs(1 / dir.z) : Infinity;
  const frac = (o, s) => s > 0 ? (Math.ceil(o) - o || 1) : (o - Math.floor(o) || 1);
  let tMaxX = stepX ? tDeltaX * (stepX > 0 ? ((x + 1 - origin.x)) : (origin.x - x)) : Infinity;
  let tMaxY = stepY ? tDeltaY * (stepY > 0 ? ((y + 1 - origin.y)) : (origin.y - y)) : Infinity;
  let tMaxZ = stepZ ? tDeltaZ * (stepZ > 0 ? ((z + 1 - origin.z)) : (origin.z - z)) : Infinity;
  void frac;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 128; i++) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    if (t > maxDist) return null;
    const id = getBlock(x, y, z);
    if (id) return { x, y, z, nx, ny, nz, id };
  }
  return null;
}

function eyePos() {
  return new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);
}
function lookDir() {
  const d = new THREE.Vector3(0, 0, -1);
  d.applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  return d;
}

function breakBlock() {
  const hit = raycastVoxel(eyePos(), lookDir());
  if (!hit) return;
  if (hit.y === 0) { toast('Bedrock layer is unbreakable'); return; }
  setBlock(hit.x, hit.y, hit.z, AIR);
  buildWorldMesh();
}
function placeBlock() {
  const hit = raycastVoxel(eyePos(), lookDir());
  if (!hit) return;
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (!inBounds(x, y, z) || getBlock(x, y, z)) return;
  // don't place inside player
  const p = player.pos;
  if (x === Math.floor(p.x) || true) {
    // AABB overlap test with player box
    const w = player.w;
    if (p.x + w > x && p.x - w < x + 1 && p.y + player.h > y && p.y < y + 1 && p.z + w > z && p.z - w < z + 1) return;
  }
  setBlock(x, y, z, HOTBAR[selected]);
  buildWorldMesh();
}

// ---------- Input ----------
const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('playBtn');
const isLocked = () => document.pointerLockElement === canvas;
let dragMode = false; // fallback when pointer lock is unavailable (iframes, automation)
function setPlaying(on) { overlay.classList.toggle('hidden', on); }
function enableDragMode() {
  if (isLocked() || dragMode) return;
  dragMode = true;
  setPlaying(true);
  toast('Pointer lock unavailable — drag to look');
}
playBtn.onclick = () => {
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => enableDragMode());
  } catch { enableDragMode(); }
};
document.addEventListener('pointerlockchange', () => setPlaying(isLocked() || dragMode));
document.addEventListener('pointerlockerror', () => enableDragMode());
overlay.classList.remove('hidden');

let dragging = false, dragged = false, lastX = 0, lastY = 0;
function rotate(mx, my) {
  player.yaw -= mx * 0.0025;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - my * 0.0025));
}
document.addEventListener('mousemove', (e) => {
  if (isLocked()) { rotate(e.movementX, e.movementY); return; }
  if (dragMode && dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.hypot(dx, dy) > 2) dragged = true;
    rotate(dx, dy);
    lastX = e.clientX; lastY = e.clientY;
  }
});
document.addEventListener('keydown', (e) => {
  keys[e.code.toLowerCase()] = true;
  if (e.code === 'Space') e.preventDefault();
  const n = parseInt(e.key);
  if (n >= 1 && n <= HOTBAR.length) selectSlot(n - 1);
  if (e.code === 'KeyF') {
    player.fly = !player.fly;
    player.vel.y = 0;
    document.getElementById('mode').textContent = player.fly ? 'fly' : 'walk';
    toast(player.fly ? 'Fly mode ON' : 'Walk mode');
  }
  if (e.code === 'KeyR') { generateWorld(); buildWorldMesh(); spawn(); toast('World reset'); }
});
document.addEventListener('keyup', (e) => { keys[e.code.toLowerCase()] = false; });
document.addEventListener('mousedown', (e) => {
  if (e.target.closest && e.target.closest('#hotbar')) return;
  if (dragMode && !isLocked()) {
    if (e.button === 0) { dragging = true; dragged = false; lastX = e.clientX; lastY = e.clientY; }
    if (e.button === 2) placeBlock();
    return;
  }
  if (!isLocked()) return;
  if (e.button === 0) breakBlock();
  if (e.button === 2) placeBlock();
});
document.addEventListener('mouseup', (e) => {
  if (dragMode && !isLocked() && e.button === 0 && dragging) {
    dragging = false;
    if (!dragged) breakBlock();
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  selectSlot((selected + (e.deltaY > 0 ? 1 : HOTBAR.length - 1)) % HOTBAR.length);
});

// ---------- Hotbar UI ----------
const hotbarEl = document.getElementById('hotbar');
function renderHotbar() {
  hotbarEl.innerHTML = '';
  HOTBAR.forEach((id, i) => {
    const d = document.createElement('div');
    d.className = 'slot' + (i === selected ? ' selected' : '');
    d.innerHTML = `<div class="key">${i + 1}</div><div class="cube" style="background:${BLOCKS[id].css}"></div><div class="name">${BLOCKS[id].name}</div>`;
    d.onclick = () => selectSlot(i);
    hotbarEl.appendChild(d);
  });
}
function selectSlot(i) { selected = i; renderHotbar(); }

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.opacity = 0), 1500);
}

// ---------- Loop ----------
const clock = new THREE.Clock();
let frames = 0, fpsT = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (isLocked() || dragMode) movePlayer(dt);

  camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // highlight
  const hit = raycastVoxel(eyePos(), lookDir());
  if (hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else highlight.visible = false;

  document.getElementById('pos').textContent =
    `${player.pos.x.toFixed(1)}, ${player.pos.y.toFixed(1)}, ${player.pos.z.toFixed(1)}`;

  frames++; fpsT += dt;
  if (fpsT >= 0.5) {
    document.getElementById('fps').textContent = `${Math.round(frames / fpsT)} fps`;
    frames = 0; fpsT = 0;
  }
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Boot ----------
generateWorld();
buildWorldMesh();
spawn();
renderHotbar();
selectSlot(0);
animate();

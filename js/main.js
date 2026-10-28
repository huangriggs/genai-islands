/**
 * 生成式 AI 探索群島 - 核心邏輯
 * 包含 Three.js 3D 群島建模、小人物巡邏、標籤投射、主題切換、晝夜切換、探索護照與小嚮導問答
 */

import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

// ============================================================================
// 1. 全域狀態與設定
// ============================================================================
const STATE = {
  content: null,
  currentIslandIndex: -1,
  visitedIslands: new Set(),
  answeredQuizzes: {}, // { islandId: selectedOptionIndex }
  theme: localStorage.getItem('genai_island_theme') || 'mint',
  timeOfDay: 'day', // 'day' | 'dusk' | 'night'
  reducedMotion: localStorage.getItem('genai_island_reduced_motion') === 'true',
  isFlyingCamera: false,
  targetCameraPos: null,
  targetLookAt: null,
  walkingPeople: []
};

// 6 座島在 3D 空間中的坐標配置（中央島 + 環狀 5 座島）
const ISLAND_COORDS = [
  { id: 'island-center', x: 0, z: 0, radius: 2.8, color: 0x2a8a74 },
  { id: 'island-01', x: 8.5, z: 0, radius: 2.0, color: 0x3a9d82 },
  { id: 'island-02', x: 2.6, z: 8.1, radius: 2.0, color: 0x48a892 },
  { id: 'island-03', x: -6.9, z: 5.0, radius: 2.0, color: 0x2a7a94 },
  { id: 'island-04', x: -6.9, z: -5.0, radius: 2.0, color: 0x8a5e94 },
  { id: 'island-05', x: 2.6, z: -8.1, radius: 2.0, color: 0xb46850 }
];

const DEFAULT_CAM_POS = new THREE.Vector3(16, 18, 22);
const DEFAULT_CAM_LOOKAT = new THREE.Vector3(0, 0, 0);

// ============================================================================
// 2. 初始化流程
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    loadSavedProgress();
    applyTheme(STATE.theme);
    applyReducedMotion(STATE.reducedMotion);
    initClock();

    // 載入 JSON 資料
    const res = await fetch('./data/content.json');
    if (!res.ok) throw new Error('無法讀取 content.json');
    STATE.content = await res.json();

    // 建立 3D 場景
    initThreeScene();
    buildArchipelago();
    setupEventListeners();
    updateProgressUI();
    initGuideFAQ();
    initLocationList();

    // 支援 URL Hash 深層連結（例如 #island-01、#modal-passport、#theme-ink）
    handleInitialHash();

  } catch (err) {
    console.error('初始化失敗:', err);
    showWebGLFallback();
  }
});

// ============================================================================
// 3. Three.js 3D 場景建置
// ============================================================================
let scene, camera, renderer, controls, clock;
let hemisphereLight, sunLight, ambientLight, duskLight, nightGlowGroup;
let oceanMesh, worldGroup, islandsGroup, bridgeGroup, peopleGroup;
let raycaster, mouse;
let tagElements = [];

function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

function showWebGLFallback() {
  const banner = document.getElementById('webgl-fallback-banner');
  if (banner) banner.style.display = 'block';
  openModal('modal-list');
}

function initThreeScene() {
  if (!isWebGLAvailable()) {
    showWebGLFallback();
    throw new Error('WebGL not supported');
  }

  const container = document.getElementById('webgl-container');
  const canvas = document.getElementById('webgl-canvas');

  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.copy(DEFAULT_CAM_POS);
  camera.lookAt(DEFAULT_CAM_LOOKAT);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // 軌道控制器
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2.15; // 不穿入海平面下
  controls.minDistance = 6;
  controls.maxDistance = 50;
  controls.target.copy(DEFAULT_CAM_LOOKAT);

  // 燈光系統
  hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x446655, 1.2);
  scene.add(hemisphereLight);

  sunLight = new THREE.DirectionalLight(0xfffaed, 2.4);
  sunLight.position.set(20, 30, 15);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 80;
  const d = 20;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  duskLight = new THREE.DirectionalLight(0xff7744, 0);
  duskLight.position.set(-25, 12, -20);
  scene.add(duskLight);

  nightGlowGroup = new THREE.Group();
  scene.add(nightGlowGroup);

  // 世界總群組
  worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // 海洋平面
  const oceanGeo = new THREE.CircleGeometry(38, 64);
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x6bbfa9,
    roughness: 0.15,
    metalness: 0.1,
    flatShading: true
  });
  oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.rotation.x = -Math.PI / 2;
  oceanMesh.position.y = -0.3;
  oceanMesh.receiveShadow = true;
  worldGroup.add(oceanMesh);

  // 海面裝飾光環
  for (let r = 12; r <= 32; r += 6) {
    const ringGeo = new THREE.RingGeometry(r - 0.05, r + 0.05, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.28;
    worldGroup.add(ring);
  }

  islandsGroup = new THREE.Group();
  worldGroup.add(islandsGroup);

  bridgeGroup = new THREE.Group();
  worldGroup.add(bridgeGroup);

  peopleGroup = new THREE.Group();
  worldGroup.add(peopleGroup);

  updateDayNightLighting(STATE.timeOfDay);
  updateThemeColors(STATE.theme);

  // 視窗縮放自適應
  window.addEventListener('resize', onWindowResize);

  // 啟動渲染動畫迴圈
  requestAnimationFrame(animate);
}

function onWindowResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// ============================================================================
// 4. 島嶼建築與原創地標建模 (Low-Poly 原創)
// ============================================================================
let islandMeshes = [];
let crystalMesh, quillGroup, paletteGroup, lighthouseGroup, projectorGroup, shieldGroup;

function buildArchipelago() {
  ISLAND_COORDS.forEach((cfg, idx) => {
    const isCenter = idx === 0;
    const g = new THREE.Group();
    g.position.set(cfg.x, 0, cfg.z);
    g.userData = { index: idx, id: cfg.id };
    islandsGroup.add(g);

    // 1. 基底六角形岩層
    const baseHeight = isCenter ? 0.9 : 0.7;
    const baseGeo = new THREE.CylinderGeometry(cfg.radius * 0.96, cfg.radius * 1.05, baseHeight, 6);
    const baseMat = new THREE.MeshStandardMaterial({
      color: isCenter ? 0x475b56 : 0x566562,
      roughness: 0.9,
      flatShading: true
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = baseHeight / 2 - 0.3;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    baseMesh.userData = { index: idx, id: cfg.id };
    g.add(baseMesh);

    // 2. 綠色/彩色島面草皮
    const topGeo = new THREE.CylinderGeometry(cfg.radius * 0.95, cfg.radius * 0.96, 0.15, 6);
    const topMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      roughness: 0.7,
      flatShading: true
    });
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.position.y = baseHeight - 0.22;
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    topMesh.userData = { index: idx, id: cfg.id };
    g.add(topMesh);
    islandMeshes.push(topMesh);

    // 3. 特色地標建築
    if (idx === 0) {
      buildCenterLandmark(g);
    } else if (idx === 1) {
      buildQuillLandmark(g);
    } else if (idx === 2) {
      buildPaletteLandmark(g);
    } else if (idx === 3) {
      buildLighthouseLandmark(g);
    } else if (idx === 4) {
      buildProjectorLandmark(g);
    } else if (idx === 5) {
      buildShieldLandmark(g);
    }

    // 4. 島上道路與景觀綠樹
    addIslandVegetation(g, cfg.radius, isCenter);

    // 5. 建立島嶼 2D HTML 標籤
    createIslandTag(idx, cfg);
  });

  // 6. 島際連接橋樑
  buildBridges();

  // 7. 生成走動的小人物
  spawnWalkingPeople();
}

// 中央島地標：星芒水晶球與遊客服務中心
function buildCenterLandmark(parent) {
  const hallGeo = new THREE.CylinderGeometry(1.4, 1.5, 0.45, 8);
  const hallMat = new THREE.MeshStandardMaterial({ color: 0xe8e2cc, roughness: 0.5, flatShading: true });
  const hall = new THREE.Mesh(hallGeo, hallMat);
  hall.position.y = 0.8;
  hall.castShadow = true;
  parent.add(hall);

  // 頂部台階
  const pedGeo = new THREE.CylinderGeometry(0.7, 0.8, 0.35, 6);
  const pedMat = new THREE.MeshStandardMaterial({ color: 0x2a8a74, roughness: 0.4 });
  const ped = new THREE.Mesh(pedGeo, pedMat);
  ped.position.y = 1.15;
  parent.add(ped);

  // 水晶球
  const sphereGeo = new THREE.IcosahedronGeometry(0.55, 2);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0x5ce6cf,
    emissive: 0x2a8a74,
    emissiveIntensity: 0.4,
    roughness: 0.2,
    metalness: 0.3,
    transparent: true,
    opacity: 0.92
  });
  crystalMesh = new THREE.Mesh(sphereGeo, sphereMat);
  crystalMesh.position.y = 1.85;
  parent.add(crystalMesh);

  // 水晶球環繞光環
  const ringGeo = new THREE.TorusGeometry(0.78, 0.035, 8, 32);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.3, metalness: 0.8 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 3;
  ring.position.y = 1.85;
  parent.add(ring);
  crystalMesh.userData.ring = ring;
}

// 島 1 地標：魔法羽毛筆與咒語卷軸圖書館
function buildQuillLandmark(parent) {
  quillGroup = new THREE.Group();
  quillGroup.position.y = 0.65;
  parent.add(quillGroup);

  // 卷軸台
  const deskGeo = new THREE.BoxGeometry(1.2, 0.3, 0.8);
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x7c5e42, roughness: 0.7, flatShading: true });
  const desk = new THREE.Mesh(deskGeo, deskMat);
  desk.position.y = 0.15;
  quillGroup.add(desk);

  // 攤開的魔法書卷
  const bookGeo = new THREE.BoxGeometry(0.9, 0.08, 0.6);
  const bookMat = new THREE.MeshStandardMaterial({ color: 0xf4ecd8 });
  const book = new THREE.Mesh(bookGeo, bookMat);
  book.position.y = 0.33;
  quillGroup.add(book);

  // 懸浮羽毛筆
  const quillMeshGroup = new THREE.Group();
  const shaftGeo = new THREE.CylinderGeometry(0.02, 0.04, 0.9, 6);
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8 });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.rotation.z = -Math.PI / 4;
  quillMeshGroup.add(shaft);

  const featherGeo = new THREE.ConeGeometry(0.14, 0.6, 4);
  const featherMat = new THREE.MeshStandardMaterial({ color: 0x2a8a74, roughness: 0.3, flatShading: true });
  const feather = new THREE.Mesh(featherGeo, featherMat);
  feather.position.set(-0.25, 0.25, 0);
  feather.rotation.z = -Math.PI / 4;
  quillMeshGroup.add(feather);

  quillMeshGroup.position.set(0.1, 0.85, 0);
  quillGroup.add(quillMeshGroup);
  quillGroup.userData.pen = quillMeshGroup;
}

// 島 2 地標：彩虹調色盤與立體像素畫布
function buildPaletteLandmark(parent) {
  paletteGroup = new THREE.Group();
  paletteGroup.position.y = 0.65;
  parent.add(paletteGroup);

  // 調色盤（扁平橢圓）
  const palGeo = new THREE.CylinderGeometry(0.7, 0.75, 0.08, 16);
  const palMat = new THREE.MeshStandardMaterial({ color: 0xd7b98e, roughness: 0.6, flatShading: true });
  const pal = new THREE.Mesh(palGeo, palMat);
  pal.position.set(-0.2, 0.3, 0.2);
  pal.rotation.z = 0.2;
  paletteGroup.add(pal);

  // 顏料球 (紅黃藍綠)
  const colors = [0xe74c3c, 0xf1c40f, 0x3498db, 0x2ecc71];
  colors.forEach((col, cIdx) => {
    const ang = (cIdx * Math.PI) / 2.2;
    const blobGeo = new THREE.SphereGeometry(0.1, 6, 6);
    const blobMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.2 });
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.position.set(Math.cos(ang) * 0.4 - 0.2, 0.36, Math.sin(ang) * 0.4 + 0.2);
    paletteGroup.add(blob);
  });

  // 畫架與畫布
  const easelGeo = new THREE.BoxGeometry(0.1, 0.9, 0.1);
  const easelMat = new THREE.MeshStandardMaterial({ color: 0x5a4128 });
  const leg1 = new THREE.Mesh(easelGeo, easelMat);
  leg1.position.set(0.4, 0.45, -0.2);
  paletteGroup.add(leg1);

  const canvasGeo = new THREE.BoxGeometry(0.8, 0.65, 0.06);
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const canvasMesh = new THREE.Mesh(canvasGeo, canvasMat);
  canvasMesh.position.set(0.4, 0.6, -0.15);
  canvasMesh.rotation.y = -0.3;
  paletteGroup.add(canvasMesh);
}

// 島 3 地標：查證燈塔與金色放大鏡
function buildLighthouseLandmark(parent) {
  lighthouseGroup = new THREE.Group();
  lighthouseGroup.position.y = 0.6;
  parent.add(lighthouseGroup);

  // 燈塔底座岩石
  const rockGeo = new THREE.CylinderGeometry(0.7, 0.9, 0.4, 6);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e7f80, roughness: 0.9, flatShading: true });
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.position.y = 0.2;
  lighthouseGroup.add(rock);

  // 燈塔主塔身
  const towerGeo = new THREE.CylinderGeometry(0.3, 0.45, 1.4, 8);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xedf2f4, roughness: 0.4 });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.y = 1.0;
  lighthouseGroup.add(tower);

  // 塔身紅色環條紋
  const stripeGeo = new THREE.CylinderGeometry(0.36, 0.4, 0.25, 8);
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe46a5e });
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  stripe.position.y = 0.95;
  lighthouseGroup.add(stripe);

  // 塔頂燈室
  const topGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.35, 8);
  const topMat = new THREE.MeshStandardMaterial({
    color: 0xfff275,
    emissive: 0xffdc00,
    emissiveIntensity: 0.7,
    roughness: 0.2
  });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.y = 1.85;
  lighthouseGroup.add(top);

  // 旋轉探照光錐
  const beamGeo = new THREE.ConeGeometry(1.2, 4.5, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfffa65,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, 1.85, 2.3);
  const beamPivot = new THREE.Group();
  beamPivot.position.set(0, 1.85, 0);
  beam.position.y = 0;
  beamPivot.add(beam);
  lighthouseGroup.add(beamPivot);
  lighthouseGroup.userData.beam = beamPivot;
}

// 島 4 地標：復古膠捲放映機與收音麥克風片場
function buildProjectorLandmark(parent) {
  projectorGroup = new THREE.Group();
  projectorGroup.position.y = 0.65;
  parent.add(projectorGroup);

  // 放映機機身
  const bodyGeo = new THREE.BoxGeometry(0.65, 0.5, 0.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3d405b, roughness: 0.5, metalness: 0.3, flatShading: true });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.45;
  projectorGroup.add(body);

  // 雙膠捲圓盤
  const reelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.05, 12);
  const reelMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8 });
  const reel1 = new THREE.Mesh(reelGeo, reelMat);
  reel1.rotation.z = Math.PI / 2;
  reel1.position.set(0.35, 0.75, -0.2);
  projectorGroup.add(reel1);

  const reel2 = new THREE.Mesh(reelGeo, reelMat);
  reel2.rotation.z = Math.PI / 2;
  reel2.position.set(0.35, 0.75, 0.2);
  projectorGroup.add(reel2);

  // 放映鏡頭
  const lensGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.35, 8);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0.45, 0.5);
  projectorGroup.add(lens);

  // 拍立得場記板雕塑
  const boardGeo = new THREE.BoxGeometry(0.5, 0.4, 0.05);
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const board = new THREE.Mesh(boardGeo, boardMat);
  board.position.set(-0.6, 0.3, 0);
  board.rotation.y = 0.4;
  projectorGroup.add(board);
}

// 島 5 地標：數位加密盾牌與金色密碼金庫
function buildShieldLandmark(parent) {
  shieldGroup = new THREE.Group();
  shieldGroup.position.y = 0.65;
  parent.add(shieldGroup);

  // 金庫方形石基
  const vaultGeo = new THREE.BoxGeometry(0.9, 0.8, 0.9);
  const vaultMat = new THREE.MeshStandardMaterial({ color: 0x2f3e46, metalness: 0.4, roughness: 0.5, flatShading: true });
  const vault = new THREE.Mesh(vaultGeo, vaultMat);
  vault.position.y = 0.4;
  shieldGroup.add(vault);

  // 金色金庫門與轉輪
  const wheelGeo = new THREE.TorusGeometry(0.18, 0.035, 6, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0xf4a261, metalness: 0.8 });
  const wheel = new THREE.Mesh(wheelGeo, wheelMat);
  wheel.position.set(0, 0.4, 0.47);
  shieldGroup.add(wheel);

  // 守護大盾牌 (立在金庫前)
  const shieldGeo = new THREE.CylinderGeometry(0.45, 0.35, 0.06, 6);
  const shieldMat = new THREE.MeshStandardMaterial({
    color: 0x3a86ff,
    emissive: 0x1d3557,
    emissiveIntensity: 0.5,
    metalness: 0.7,
    roughness: 0.2
  });
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  shield.rotation.x = Math.PI / 2;
  shield.position.set(-0.5, 0.5, 0.3);
  shield.rotation.z = 0.2;
  shieldGroup.add(shield);
}

// 島上隨機低多邊形樹木與景觀
function addIslandVegetation(parent, radius, isCenter) {
  const treeCount = isCenter ? 6 : 4;
  const treeWoodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
  const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.8, flatShading: true });

  for (let i = 0; i < treeCount; i++) {
    const angle = (i * Math.PI * 2) / treeCount + 0.3;
    const dist = radius * 0.65;
    const tx = Math.cos(angle) * dist;
    const tz = Math.sin(angle) * dist;

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.3, 5), treeWoodMat);
    trunk.position.set(tx, 0.6, tz);
    parent.add(trunk);

    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 5), treeLeafMat);
    leaves.position.set(tx, 0.88, tz);
    parent.add(leaves);
  }
}

// 連接島嶼的跨海木橋
function buildBridges() {
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8, flatShading: true });
  for (let i = 1; i <= 5; i++) {
    const c = ISLAND_COORDS[i];
    const dx = c.x;
    const dz = c.z;
    const dist = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);

    const bridgeGeo = new THREE.BoxGeometry(dist - 3.8, 0.1, 0.45);
    const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
    bridge.position.set(dx * 0.5, 0.15, dz * 0.5);
    bridge.rotation.y = -angle;
    bridgeGroup.add(bridge);
  }
}

// 走動的小人物 (Little figurines walking on islands)
function spawnWalkingPeople() {
  const isMobile = window.innerWidth <= 768;
  const totalPeople = isMobile ? 6 : 12;

  const bodyMatList = [
    new THREE.MeshStandardMaterial({ color: 0xe63946 }),
    new THREE.MeshStandardMaterial({ color: 0x457b9d }),
    new THREE.MeshStandardMaterial({ color: 0x2a9d8f }),
    new THREE.MeshStandardMaterial({ color: 0xe76f51 }),
    new THREE.MeshStandardMaterial({ color: 0x9b5de5 })
  ];
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.5 });

  for (let i = 0; i < totalPeople; i++) {
    const person = new THREE.Group();
    // 身體
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.18, 5), bodyMatList[i % bodyMatList.length]);
    body.position.y = 0.09;
    person.add(body);
    // 頭部
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), headMat);
    head.position.y = 0.22;
    person.add(head);

    // 巡邏參數
    const islandIdx = i % ISLAND_COORDS.length;
    const islandCfg = ISLAND_COORDS[islandIdx];
    const patrolRadius = islandCfg.radius * 0.55;
    const speed = 0.4 + (i % 3) * 0.15;
    const phase = i * 1.2;

    person.userData = {
      centerX: islandCfg.x,
      centerZ: islandCfg.z,
      radius: patrolRadius,
      speed,
      phase,
      baseY: islandIdx === 0 ? 0.72 : 0.52
    };

    peopleGroup.add(person);
    STATE.walkingPeople.push(person);
  }
}

// ============================================================================
// 5. 2D 浮動島嶼名稱標籤層
// ============================================================================
function createIslandTag(idx, cfg) {
  const container = document.getElementById('island-labels-layer');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'island-3d-tag';
  el.id = `tag-${cfg.id}`;
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');

  const islandName = idx === 0 ? 'AI 總複習大島' : STATE.content.islands[idx - 1]?.name || '未知島';
  const badgeNum = idx === 0 ? '★' : `0${idx}`;

  el.innerHTML = `
    <span class="tag-badge">${badgeNum}</span>
    <span class="tag-name">${islandName}</span>
  `;

  // 點擊標籤飛近島嶼
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    selectIsland(idx);
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectIsland(idx);
    }
  });

  container.appendChild(el);
  tagElements.push({ el, coord: new THREE.Vector3(cfg.x, 1.2, cfg.z) });
}

function updateTagPositions() {
  if (!camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const v = new THREE.Vector3();

  tagElements.forEach(({ el, coord }) => {
    v.copy(coord);
    v.project(camera);

    // 視錐外或鏡頭背後則隱藏
    if (v.z > 1) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }

    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-(v.y * 0.5) + 0.5) * h;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
  });
}

// ============================================================================
// 6. 3D 動畫循環與互動
// ============================================================================
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const time = clock.getElapsedTime();

  // 控制器阻尼更新
  if (controls) controls.update();

  // 若未開啟「減少動態」，執行平滑微動態
  if (!STATE.reducedMotion) {
    // 1. 水晶球自轉與光環公轉
    if (crystalMesh) {
      crystalMesh.rotation.y += 0.015;
      if (crystalMesh.userData.ring) {
        crystalMesh.userData.ring.rotation.z += 0.01;
      }
    }
    // 2. 懸浮羽毛筆擺動
    if (quillGroup && quillGroup.userData.pen) {
      quillGroup.userData.pen.position.y = 0.85 + Math.sin(time * 2) * 0.04;
    }
    // 3. 查證燈塔探照光束旋轉
    if (lighthouseGroup && lighthouseGroup.userData.beam) {
      lighthouseGroup.userData.beam.rotation.y += 0.025;
    }
    // 4. 小人物沿著島嶼步道走動
    STATE.walkingPeople.forEach(p => {
      const u = p.userData;
      u.phase += delta * u.speed;
      const px = u.centerX + Math.cos(u.phase) * u.radius;
      const pz = u.centerZ + Math.sin(u.phase) * u.radius;
      p.position.set(px, u.baseY, pz);
      // 小人物朝向走動切線方向
      p.rotation.y = -u.phase + Math.PI / 2;
    });

    // 5. 世界整體極緩慢微旋轉（未拖曳且未開啟面板時）
    if (worldGroup && !controls.state === -1 && STATE.currentIslandIndex === -1) {
      worldGroup.rotation.y += 0.0003;
    }
  }

  // 鏡頭飛近補間平滑過渡
  if (STATE.isFlyingCamera && STATE.targetCameraPos && STATE.targetLookAt) {
    camera.position.lerp(STATE.targetCameraPos, 0.06);
    controls.target.lerp(STATE.targetLookAt, 0.06);

    if (camera.position.distanceTo(STATE.targetCameraPos) < 0.1) {
      STATE.isFlyingCamera = false;
    }
  }

  // 渲染
  renderer.render(scene, camera);

  // 更新 2D 浮動標籤屏幕投影位置
  updateTagPositions();
}

// ============================================================================
// 7. 選取島嶼與鏡頭巡航
// ============================================================================
function selectIsland(index) {
  if (index < 0 || index >= ISLAND_COORDS.length) return;
  STATE.currentIslandIndex = index;
  const cfg = ISLAND_COORDS[index];

  // 記錄造訪狀態
  STATE.visitedIslands.add(cfg.id);
  saveProgress();
  updateProgressUI();

  // 更新標籤 active 樣式
  document.querySelectorAll('.island-3d-tag').forEach((tag, tIdx) => {
    tag.classList.toggle('active', tIdx === index);
    if (STATE.visitedIslands.has(ISLAND_COORDS[tIdx].id)) {
      tag.classList.add('visited');
    }
  });

  // 計算飛近視角
  STATE.isFlyingCamera = true;
  STATE.targetLookAt = new THREE.Vector3(cfg.x, 0.5, cfg.z);
  // 相機位於島嶼正前斜上方
  STATE.targetCameraPos = new THREE.Vector3(cfg.x + 3.8, 4.2, cfg.z + 5.2);

  // 開啟詳細內容面板
  openIslandPanel(index);
}

function resetToOverview() {
  STATE.currentIslandIndex = -1;
  STATE.isFlyingCamera = true;
  STATE.targetCameraPos = DEFAULT_CAM_POS.clone();
  STATE.targetLookAt = DEFAULT_CAM_LOOKAT.clone();

  document.querySelectorAll('.island-3d-tag').forEach(tag => tag.classList.remove('active'));
  closeIslandPanel();
}

// ============================================================================
// 8. 島嶼詳細面板與互動分頁
// ============================================================================
function openIslandPanel(index) {
  const panel = document.getElementById('island-panel');
  if (!panel || !STATE.content) return;

  const isCenter = index === 0;
  const data = isCenter ? STATE.content.centerIsland : STATE.content.islands[index - 1];
  if (!data) return;

  // 設定面板頭部
  document.getElementById('panel-kicker').textContent = isCenter ? '核心樞紐 · 旅客中心' : `ISLAND 0${index} · ${data.group}類`;
  document.getElementById('panel-title').textContent = data.name;
  document.getElementById('panel-subtitle').textContent = data.intro;
  document.getElementById('panel-island-indicator').textContent = `${index + 1} / 6`;

  // 填寫分頁 1：學習概覽
  const overviewText = isCenter ? data.tabs.overview.description : data.tabs.overview.content;
  document.getElementById('overview-content').textContent = overviewText;

  // 填寫分頁 2：核心技巧卡片
  const skillsContainer = document.getElementById('skills-list-container');
  skillsContainer.innerHTML = '';
  const skills = isCenter ? data.tabs.skills.items : data.tabs.skills.items;
  skills.forEach((sk, i) => {
    const card = document.createElement('div');
    card.className = 'skill-card';
    card.innerHTML = `
      <div class="skill-card-head">
        <span class="skill-num">${i + 1}</span>
        <h4>${sk.label || sk.title}</h4>
      </div>
      <p>${sk.detail || sk.desc}</p>
    `;
    skillsContainer.appendChild(card);
  });

  // 填寫分頁 3：特色地標與任務
  document.getElementById('landmark-icon').textContent = isCenter ? '🏛️' : ['📜', '🎨', '🔍', '🎬', '🛡️'][index - 1] || '🏛️';
  document.getElementById('landmark-name').textContent = data.tabs.landmark.name;
  document.getElementById('landmark-desc').textContent = data.tabs.landmark.description;
  document.getElementById('landmark-task-text').textContent = data.extra;

  // 填寫分頁 4：挑戰測驗
  renderChallengeTab(index, data);

  // 切換到第一個分頁
  switchTab('overview');

  // 開啟抽屜
  panel.classList.add('open');
}

function closeIslandPanel() {
  const panel = document.getElementById('island-panel');
  if (panel) panel.classList.remove('open');
}

function renderChallengeTab(index, data) {
  const container = document.getElementById('tab-challenge');
  if (!container) return;

  const isCenter = index === 0;
  const qText = document.getElementById('quiz-question-text');
  const optContainer = document.getElementById('quiz-options-container');
  const feedbackBox = document.getElementById('quiz-feedback-box');

  feedbackBox.className = 'quiz-feedback';
  feedbackBox.style.display = 'none';
  optContainer.innerHTML = '';

  if (isCenter) {
    qText.textContent = '🌟 探索護照集章領取處';
    optContainer.innerHTML = `
      <p style="font-size:13px; line-height:1.7; color:var(--ink-secondary);">
        總複習大島是探險家榮譽的發源地！完成周圍 5 座島嶼的學習挑戰並蓋章，集滿後回到這裡即可換發金色領航員大章。
      </p>
      <button class="btn-tool" id="btn-passport-from-panel" style="width:100%; margin-top:12px;">
        📖 開啟我的探索護照
      </button>
    `;
    document.getElementById('btn-passport-from-panel').onclick = () => openModal('modal-passport');
    return;
  }

  const ch = data.tabs.challenge;
  qText.textContent = `🎯 【${ch.title}】：${ch.question}`;

  const savedAnswer = STATE.answeredQuizzes[data.id];

  ch.options.forEach((opt, optIdx) => {
    const btn = document.createElement('button');
    btn.className = 'btn-option';
    btn.innerHTML = `<span style="font-weight:800; color:var(--primary);">(${String.fromCharCode(65 + optIdx)})</span> ${opt}`;

    if (savedAnswer !== undefined) {
      btn.disabled = true;
      if (optIdx === ch.answerIndex) btn.classList.add('correct');
      if (optIdx === savedAnswer && savedAnswer !== ch.answerIndex) btn.classList.add('wrong');
    } else {
      btn.onclick = () => handleQuizAnswer(data.id, optIdx, ch.answerIndex, ch.explanation);
    }

    optContainer.appendChild(btn);
  });

  if (savedAnswer !== undefined) {
    feedbackBox.style.display = 'block';
    if (savedAnswer === ch.answerIndex) {
      feedbackBox.className = 'quiz-feedback success show';
      feedbackBox.innerHTML = `✅ <strong>答對了！已蓋上金色榮譽印章！</strong><br>${ch.explanation}`;
    } else {
      feedbackBox.className = 'quiz-feedback error show';
      feedbackBox.innerHTML = `❌ <strong>答案不完全正確喔！</strong><br>${ch.explanation}`;
    }
  }
}

function handleQuizAnswer(islandId, selectedIdx, correctIdx, explanation) {
  STATE.answeredQuizzes[islandId] = selectedIdx;
  saveProgress();
  updateProgressUI();

  // 重新渲染該分頁顯示結果
  const islandIdx = ISLAND_COORDS.findIndex(c => c.id === islandId);
  if (islandIdx !== -1) {
    const data = STATE.content.islands[islandIdx - 1];
    renderChallengeTab(islandIdx, data);
  }
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
    btn.setAttribute('aria-selected', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabName}`);
  });
}

// ============================================================================
// 9. 主題切換（薄荷、米紙、墨色）
// ============================================================================
function applyTheme(themeName) {
  STATE.theme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('genai_island_theme', themeName);

  document.querySelectorAll('.theme-pill-btn').forEach(btn => {
    const isActive = btn.dataset.themeVal === themeName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive);
  });

  if (scene) updateThemeColors(themeName);
}

function updateThemeColors(themeName) {
  let fogHex = 0xc4e4da;
  let seaHex = 0x6bbfa9;

  if (themeName === 'rice') {
    fogHex = 0xe5dcbe;
    seaHex = 0x82b4a5;
  } else if (themeName === 'ink') {
    fogHex = 0x0f1517;
    seaHex = 0x16383b;
  }

  scene.fog = new THREE.FogExp2(fogHex, 0.022);
  if (oceanMesh) oceanMesh.material.color.setHex(seaHex);
}

// ============================================================================
// 10. 晝夜光影切換（白天 / 黃昏 / 夜晚）
// ============================================================================
function cycleDayNight() {
  const order = ['day', 'dusk', 'night'];
  const nextIdx = (order.indexOf(STATE.timeOfDay) + 1) % order.length;
  STATE.timeOfDay = order[nextIdx];
  updateDayNightLighting(STATE.timeOfDay);
}

function updateDayNightLighting(mode) {
  const iconEl = document.getElementById('day-night-icon');
  const textEl = document.getElementById('day-night-text');

  if (mode === 'day') {
    if (iconEl) iconEl.textContent = '☀️';
    if (textEl) textEl.textContent = '白天';
    sunLight.intensity = 2.4;
    sunLight.color.setHex(0xfffaed);
    duskLight.intensity = 0;
    hemisphereLight.intensity = 1.2;
    ambientLight.intensity = 0.8;
  } else if (mode === 'dusk') {
    if (iconEl) iconEl.textContent = '🌆';
    if (textEl) textEl.textContent = '黃昏';
    sunLight.intensity = 1.0;
    sunLight.color.setHex(0xffaa5e);
    duskLight.intensity = 2.2;
    duskLight.color.setHex(0xff6036);
    hemisphereLight.intensity = 0.8;
    ambientLight.intensity = 0.6;
  } else if (mode === 'night') {
    if (iconEl) iconEl.textContent = '🌙';
    if (textEl) textEl.textContent = '夜晚';
    sunLight.intensity = 0.3;
    sunLight.color.setHex(0x5588cc);
    duskLight.intensity = 0;
    hemisphereLight.intensity = 0.4;
    ambientLight.intensity = 0.3;
  }
}

// ============================================================================
// 11. 減少動態 (Reduced Motion)
// ============================================================================
function toggleReducedMotion() {
  STATE.reducedMotion = !STATE.reducedMotion;
  applyReducedMotion(STATE.reducedMotion);
}

function applyReducedMotion(enabled) {
  STATE.reducedMotion = enabled;
  localStorage.setItem('genai_island_reduced_motion', enabled);
  const btn = document.getElementById('btn-reduced-motion');
  if (btn) {
    btn.style.borderColor = enabled ? 'var(--accent)' : 'var(--surface-border)';
    btn.style.color = enabled ? 'var(--accent)' : 'var(--ink)';
  }
}

// ============================================================================
// 12. 即時時鐘與天色
// ============================================================================
function initClock() {
  const clockEl = document.getElementById('clock-time');
  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ============================================================================
// 13. 探索護照、蓋章與接關碼 (Passport & Codes)
// ============================================================================
function loadSavedProgress() {
  try {
    const raw = localStorage.getItem('genai_islands_save_v1');
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.visited)) STATE.visitedIslands = new Set(data.visited);
      if (data.quizzes) STATE.answeredQuizzes = data.quizzes;
    }
  } catch (e) {
    console.warn('載入進度失敗:', e);
  }
}

function saveProgress() {
  try {
    const data = {
      visited: Array.from(STATE.visitedIslands),
      quizzes: STATE.answeredQuizzes,
      updatedAt: Date.now()
    };
    localStorage.setItem('genai_islands_save_v1', JSON.stringify(data));
  } catch (e) {
    console.warn('儲存進度失敗:', e);
  }
}

function updateProgressUI() {
  const totalPlayableIslands = 5;
  let correctCount = 0;

  STATE.content?.islands.forEach(isl => {
    if (STATE.answeredQuizzes[isl.id] === isl.tabs.challenge.answerIndex) {
      correctCount++;
    }
  });

  const percent = Math.round((correctCount / totalPlayableIslands) * 100);
  const pctEl = document.getElementById('progress-percent');
  const countEl = document.getElementById('visited-count');
  const fillEl = document.getElementById('progress-fill-bar');

  if (pctEl) pctEl.textContent = `${percent}%`;
  if (countEl) countEl.textContent = `${correctCount}`;
  if (fillEl) fillEl.style.width = `${percent}%`;

  renderPassportModal();
}

function renderPassportModal() {
  const grid = document.getElementById('passport-stamps-grid');
  if (!grid || !STATE.content) return;

  grid.innerHTML = '';
  STATE.content.islands.forEach((isl, i) => {
    const isCorrect = STATE.answeredQuizzes[isl.id] === isl.tabs.challenge.answerIndex;
    const icons = ['📜', '🎨', '🔍', '🎬', '🛡️'];

    const slot = document.createElement('div');
    slot.className = `stamp-slot ${isCorrect ? 'collected' : ''}`;
    slot.innerHTML = `
      <div class="stamp-icon">${icons[i]}</div>
      <div class="stamp-name">${isl.name}</div>
      <div class="stamp-badge">${isCorrect ? '★ 已通關' : '未蓋章'}</div>
    `;
    grid.appendChild(slot);
  });

  // 產生接關碼 (Base64)
  const codeInput = document.getElementById('passport-code-input');
  if (codeInput) {
    const payload = {
      v: Array.from(STATE.visitedIslands),
      q: STATE.answeredQuizzes
    };
    codeInput.value = btoa(encodeURIComponent(JSON.stringify(payload)));
  }
}

function importProgressCode(base64Str) {
  try {
    const jsonStr = decodeURIComponent(atob(base64Str.trim()));
    const payload = JSON.parse(jsonStr);
    if (payload.v && payload.q) {
      STATE.visitedIslands = new Set(payload.v);
      STATE.answeredQuizzes = payload.q;
      saveProgress();
      updateProgressUI();
      alert('🎉 成功載入接關碼！進度已完全同步！');
    } else {
      throw new Error('格式錯誤');
    }
  } catch (e) {
    alert('⚠️ 接關碼無效或已損壞，請檢查是否複製完整！');
  }
}

function resetAllProgress() {
  if (confirm('確定要清除所有探索蓋章與挑戰紀錄嗎？此動作無法復原！')) {
    STATE.visitedIslands.clear();
    STATE.answeredQuizzes = {};
    saveProgress();
    updateProgressUI();
    document.querySelectorAll('.island-3d-tag').forEach(tag => tag.classList.remove('visited'));
    alert('已成功重置探索進度！');
  }
}

// ============================================================================
// 14. 關鍵字搜尋與地點清單 (Search & Location List)
// ============================================================================
function handleSearch(keyword) {
  const container = document.getElementById('search-results-container');
  if (!container || !STATE.content) return;

  const kw = keyword.trim().toLowerCase();
  if (!kw) {
    container.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 20px;">請輸入關鍵字開始檢索...</p>';
    return;
  }

  const matches = [];

  // 搜尋中央島
  const c = STATE.content.centerIsland;
  if (c.name.toLowerCase().includes(kw) || c.intro.toLowerCase().includes(kw)) {
    matches.push({ title: c.name, desc: c.intro, islandIdx: 0 });
  }

  // 搜尋 5 座島
  STATE.content.islands.forEach((isl, idx) => {
    const hasName = isl.name.toLowerCase().includes(kw);
    const hasIntro = isl.intro.toLowerCase().includes(kw);
    const hasPoint = isl.points.some(p => p.toLowerCase().includes(kw));

    if (hasName || hasIntro || hasPoint) {
      matches.push({
        title: `ISLAND 0${idx + 1} · ${isl.name}`,
        desc: isl.intro,
        islandIdx: idx + 1
      });
    }
  });

  // 搜尋 FAQ
  STATE.content.faq.forEach(f => {
    if (f.q.toLowerCase().includes(kw) || f.a.toLowerCase().includes(kw)) {
      const targetIslIdx = ISLAND_COORDS.findIndex(cfg => {
        const isl = STATE.content.islands.find(item => item.name === f.source);
        return isl && cfg.id === isl.id;
      });
      matches.push({
        title: `💡 問答：${f.q}`,
        desc: `${f.a}（出自：${f.source}）`,
        islandIdx: targetIslIdx !== -1 ? targetIslIdx : 0
      });
    }
  });

  if (matches.length === 0) {
    container.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 20px;">找不到與「${keyword}」相關的內容，換個詞試試看！</p>`;
    return;
  }

  container.innerHTML = '';
  matches.forEach(item => {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    div.innerHTML = `<h4>${item.title}</h4><p>${item.desc}</p>`;
    div.onclick = () => {
      closeAllModals();
      selectIsland(item.islandIdx);
    };
    container.appendChild(div);
  });
}

function initLocationList() {
  const container = document.getElementById('island-list-cards-container');
  if (!container || !STATE.content) return;

  container.innerHTML = '';

  // 包含中央島共 6 個卡片
  const allIslands = [STATE.content.centerIsland, ...STATE.content.islands];
  allIslands.forEach((isl, i) => {
    const card = document.createElement('div');
    card.className = 'island-list-card';
    card.innerHTML = `
      <div class="island-list-meta">
        <h4>
          ${isl.name}
          <span style="font-size:11px; padding:2px 6px; background:var(--primary-light); color:var(--primary); border-radius:4px;">
            ${isl.category || isl.group}
          </span>
        </h4>
        <p>${isl.intro}</p>
      </div>
      <button class="btn-tool" style="pointer-events:none;">進入 →</button>
    `;
    card.onclick = () => {
      closeAllModals();
      selectIsland(i);
    };
    container.appendChild(card);
  });
}

// ============================================================================
// 15. 小嚮導問答諮詢台 (小彬老師)
// ============================================================================
function initGuideFAQ() {
  const pillsContainer = document.getElementById('guide-pills-container');
  if (!pillsContainer || !STATE.content) return;

  pillsContainer.innerHTML = '';
  STATE.content.faq.slice(0, 5).forEach((item) => {
    const pill = document.createElement('button');
    pill.className = 'pill-question';
    pill.textContent = item.q;
    pill.onclick = () => showGuideAnswer(item);
    pillsContainer.appendChild(pill);
  });

  const guideInput = document.getElementById('guide-question-input');
  if (guideInput) {
    guideInput.addEventListener('input', (e) => {
      const kw = e.target.value.trim().toLowerCase();
      if (!kw) return;
      const found = STATE.content.faq.find(f => f.q.toLowerCase().includes(kw) || f.a.toLowerCase().includes(kw));
      if (found) {
        showGuideAnswer(found);
      }
    });
  }
}

function showGuideAnswer(item) {
  const card = document.getElementById('guide-answer-card');
  const title = document.getElementById('guide-answer-title');
  const text = document.getElementById('guide-answer-text');
  const source = document.getElementById('guide-answer-source');

  title.textContent = item.q;
  text.textContent = item.a;
  source.textContent = `📍 出處：${item.source}`;
  source.onclick = () => {
    closeAllModals();
    const islIdx = ISLAND_COORDS.findIndex(cfg => {
      const isl = STATE.content.islands.find(x => x.name === item.source);
      return isl && cfg.id === isl.id;
    });
    if (islIdx !== -1) selectIsland(islIdx);
  };

  card.classList.add('show');
}

// ============================================================================
// 16. 通用 Modal 控制與鍵盤快捷鍵 (Esc 支援)
// ============================================================================
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('open');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
}

function setupEventListeners() {
  // 晝夜按鈕
  document.getElementById('btn-day-night').onclick = cycleDayNight;

  // 三主題按鈕
  document.querySelectorAll('.theme-pill-btn').forEach(btn => {
    btn.onclick = () => applyTheme(btn.dataset.themeVal);
  });

  // 減少動態按鈕
  document.getElementById('btn-reduced-motion').onclick = toggleReducedMotion;

  // 視角控制按鈕
  document.getElementById('btn-zoom-in').onclick = () => {
    if (controls) controls.dollyIn(1.2);
  };
  document.getElementById('btn-zoom-out').onclick = () => {
    if (controls) controls.dollyOut(1.2);
  };
  document.getElementById('btn-reset-view').onclick = resetToOverview;
  document.getElementById('btn-open-help').onclick = () => openModal('modal-help');

  // 頂部導覽列按鈕
  document.getElementById('btn-open-search').onclick = () => openModal('modal-search');
  document.getElementById('btn-open-list').onclick = () => openModal('modal-list');
  document.getElementById('btn-open-passport').onclick = () => openModal('modal-passport');
  document.getElementById('btn-open-guide').onclick = () => openModal('modal-guide');

  // 搜尋即時輸入
  const searchInput = document.getElementById('search-keyword-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  }

  // 複製與載入接關碼
  document.getElementById('btn-copy-code').onclick = () => {
    const input = document.getElementById('passport-code-input');
    input.select();
    navigator.clipboard.writeText(input.value);
    alert('已複製接關碼至剪貼簿！');
  };
  document.getElementById('btn-import-code').onclick = () => {
    const input = document.getElementById('passport-import-input');
    importProgressCode(input.value);
  };
  document.getElementById('btn-reset-progress').onclick = resetAllProgress;

  // 面板關閉與島嶼切換
  document.getElementById('btn-close-panel').onclick = closeIslandPanel;
  document.getElementById('btn-prev-island').onclick = () => {
    const prev = (STATE.currentIslandIndex - 1 + ISLAND_COORDS.length) % ISLAND_COORDS.length;
    selectIsland(prev);
  };
  document.getElementById('btn-next-island').onclick = () => {
    const next = (STATE.currentIslandIndex + 1) % ISLAND_COORDS.length;
    selectIsland(next);
  };

  // 面板分頁按鈕
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  // Modal 關閉按鈕
  document.querySelectorAll('.btn-modal-close').forEach(btn => {
    btn.onclick = () => {
      const modalId = btn.dataset.close;
      if (modalId) document.getElementById(modalId)?.classList.remove('open');
    };
  });

  // 點擊 Modal 遮罩外層關閉
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // 鍵盤 Esc 關閉
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
      closeIslandPanel();
    }
  });

  // 3D 畫布射線拾取（點擊島嶼直接開啟）
  const canvas = document.getElementById('webgl-canvas');
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(islandMeshes, false);

    if (intersects.length > 0) {
      const clickedIdx = intersects[0].object.userData.index;
      if (clickedIdx !== undefined) {
        selectIsland(clickedIdx);
      }
    }
  });
}

function handleInitialHash() {
  const hash = window.location.hash.replace('#', '');
  if (!hash) return;

  if (hash.startsWith('modal-')) {
    openModal(hash);
  } else if (hash.startsWith('theme-')) {
    applyTheme(hash.replace('theme-', ''));
  } else {
    const idx = ISLAND_COORDS.findIndex(c => c.id === hash);
    if (idx !== -1) {
      setTimeout(() => selectIsland(idx), 300);
    }
  }
}


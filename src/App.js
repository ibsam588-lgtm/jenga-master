import React, { useState, useRef, useEffect, useCallback, Component } from 'react';
import * as THREE from 'three';
import Peer from 'peerjs';
import './App.css';

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info.componentStack); }
  render() {
    if (this.state.hasError) return (
      <div className="error-screen">
        <h2>Something went wrong</h2>
        <p>{this.state.error?.message}</p>
        <button onClick={() => this.setState({ hasError: false, error: null })}>Try Again</button>
      </div>
    );
    return this.props.children;
  }
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const BLOCKS_PER_ROW = 3;
const INITIAL_ROWS = 18;
const STORAGE_KEY = 'jenga_profile';

// Block 3D dimensions (Jenga ratio ~1:0.33:3)
const BL = 4.2;   // long axis
const BW = 1.35;  // short axis
const BH = 0.88;  // height
const BGAP = 0.06; // gap between blocks in a row

const AI_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

const RANKS = [
  { name: 'ROOKIE',      xp: 0,     icon: '🪵' },
  { name: 'STACKER',     xp: 100,   icon: '🧱' },
  { name: 'BUILDER',     xp: 300,   icon: '🔨' },
  { name: 'ARCHITECT',   xp: 600,   icon: '📐' },
  { name: 'ENGINEER',    xp: 1000,  icon: '⚙️' },
  { name: 'MASTER',      xp: 1600,  icon: '🏗️' },
  { name: 'GRANDMASTER', xp: 2500,  icon: '🏛️' },
  { name: 'CHAMPION',    xp: 4000,  icon: '🏆' },
  { name: 'LEGEND',      xp: 6000,  icon: '👑' },
  { name: 'IMMORTAL',    xp: 10000, icon: '⭐' },
];

const COUNTRIES = [
  '🇺🇸 USA','🇬🇧 UK','🇩🇪 Germany','🇫🇷 France','🇷🇺 Russia',
  '🇨🇳 China','🇯🇵 Japan','🇰🇷 S. Korea','🇮🇳 India','🇧🇷 Brazil',
  '🇦🇺 Australia','🇨🇦 Canada','🇵🇰 Pakistan','🇿🇦 S. Africa',
  '🇲🇽 Mexico','🇸🇦 Saudi Arabia','🇪🇬 Egypt','🇳🇬 Nigeria',
  '🇮🇩 Indonesia','🇵🇭 Philippines','🇹🇷 Turkey','🇮🇹 Italy',
  '🇪🇸 Spain','🇦🇷 Argentina','🇨🇴 Colombia',
];

const AVATARS = ['🪵','🏗️','🧱','🔨','📐','⚙️','🏛️','🏆','👑','⭐'];

const REWARD_WIN  = { xp: 50,  coins: 25 };
const REWARD_LOSS = { xp: 15,  coins: 5  };

const BLOCK_SKINS = [
  { id: 'default',  name: 'Natural Oak',  color: '#c8a060', grain: '#8a6030', cost: 0   },
  { id: 'mahogany', name: 'Mahogany',     color: '#8b3a2f', grain: '#5b1a0f', cost: 100 },
  { id: 'ebony',    name: 'Dark Ebony',   color: '#2c1810', grain: '#1c0808', cost: 150 },
  { id: 'pine',     name: 'White Pine',   color: '#e8d4a0', grain: '#b8a470', cost: 100 },
  { id: 'golden',   name: 'Golden Oak',   color: '#d48010', grain: '#a45000', cost: 200 },
  { id: 'carbon',   name: 'Carbon',       color: '#1a1a2e', grain: '#3a3a5e', cost: 300 },
];

const TABLE_THEMES = [
  { id: 'wood',   name: 'Dark Wood',   tableColor: 0x3d1f0a, bgColor: 0x1a0e05, cost: 0   },
  { id: 'felt',   name: 'Green Felt',  tableColor: 0x1a5c2a, bgColor: 0x091209, cost: 150 },
  { id: 'marble', name: 'Marble',      tableColor: 0xc8c8d0, bgColor: 0x1a1a2e, cost: 200 },
  { id: 'stone',  name: 'Dark Stone',  tableColor: 0x2a2a3a, bgColor: 0x0a0a14, cost: 250 },
];

// ─── SOUND EFFECTS ────────────────────────────────────────────────────────────
function sfx(type) {
  try {
    if (document.hidden) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const mg = ctx.createGain(); mg.gain.value = 0.28; mg.connect(ctx.destination);
    const T = ctx.currentTime;
    const osc = (f, t, d, tp, v, atk) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(mg); o.type = tp || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + (atk || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.start(t); o.stop(t + d + 0.05);
    };
    const noise = (t, d, v, freq) => {
      try {
        const len = Math.floor(ctx.sampleRate * d);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const da = buf.getChannelData(0);
        for (let i = 0; i < len; i++) da[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 0.4);
        const src = ctx.createBufferSource(), f2 = ctx.createBiquadFilter(), g2 = ctx.createGain();
        src.buffer = buf; src.connect(f2); f2.connect(g2); g2.connect(mg);
        f2.type = 'bandpass'; f2.frequency.value = freq || 800; f2.Q.value = 0.6;
        g2.gain.setValueAtTime(v, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + d);
        src.start(t);
      } catch(e) {}
    };
    const kick = (t, v) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(mg); o.type = 'sine';
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(0.001, t + 0.35);
      g.gain.setValueAtTime(v || 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t); o.stop(t + 0.4);
    };
    if (type === 'select') {
      osc(520, T, 0.07, 'sine', 0.12); osc(720, T+0.03, 0.05, 'sine', 0.07);
      setTimeout(() => ctx.close(), 400);
    } else if (type === 'remove') {
      noise(T, 0.12, 0.3, 500); osc(180, T+0.02, 0.14, 'sine', 0.18); osc(130, T+0.06, 0.1, 'sine', 0.12);
      setTimeout(() => ctx.close(), 500);
    } else if (type === 'place') {
      kick(T, 0.35); noise(T, 0.07, 0.18, 350); osc(140, T+0.04, 0.08, 'sine', 0.16);
      setTimeout(() => ctx.close(), 400);
    } else if (type === 'fall') {
      noise(T, 0.55, 0.9, 200); noise(T+0.05, 0.45, 0.65, 100);
      kick(T, 0.55); kick(T+0.08, 0.4); kick(T+0.18, 0.3);
      osc(80, T, 0.5, 'sine', 0.45); osc(55, T+0.12, 0.7, 'sine', 0.32);
      for (let i = 0; i < 10; i++) noise(T+i*0.09, 0.12, 0.22, 200+Math.random()*600);
      setTimeout(() => ctx.close(), 2500);
    } else if (type === 'win') {
      [392,523,659,784,1047].forEach((f,i) => osc(f, T+i*0.1, 0.35, 'triangle', 0.14));
      osc(1568, T+0.6, 0.5, 'triangle', 0.1);
      setTimeout(() => ctx.close(), 2000);
    } else if (type === 'lose') {
      [392,349,330,294,262,220].forEach((f,i) => osc(f, T+i*0.14, 0.28, 'sawtooth', 0.09, 0.02));
      setTimeout(() => ctx.close(), 2000);
    } else if (type === 'levelup') {
      [392,494,587,740,880,1174].forEach((f,i) => osc(f, T+i*0.07, 0.22, 'triangle', 0.14));
      setTimeout(() => ctx.close(), 1500);
    } else if (type === 'coins') {
      [523,784,1047,1319].forEach((f,i) => osc(f, T+i*0.09, 0.2, 'triangle', 0.11));
      setTimeout(() => ctx.close(), 1200);
    } else { setTimeout(() => { try { ctx.close(); } catch(e) {} }, 200); }
  } catch(e) {}
}

// ─── WOOD TEXTURE FACTORY ─────────────────────────────────────────────────────
const _texCache = {};
function getWoodTexture(skinId) {
  if (_texCache[skinId]) return _texCache[skinId];
  const skin = BLOCK_SKINS.find(s => s.id === skinId) || BLOCK_SKINS[0];
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = skin.color; ctx2.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 24; i++) {
    const y = Math.random() * 128;
    ctx2.strokeStyle = skin.grain; ctx2.globalAlpha = 0.07 + Math.random() * 0.13;
    ctx2.lineWidth = 0.4 + Math.random() * 1.4; ctx2.beginPath(); ctx2.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) ctx2.lineTo(x, y + (Math.random()-0.5)*7);
    ctx2.stroke();
  }
  ctx2.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); _texCache[skinId] = t; return t;
}
const _endTexCache = {};
function getEndTexture(skinId) {
  if (_endTexCache[skinId]) return _endTexCache[skinId];
  const skin = BLOCK_SKINS.find(s => s.id === skinId) || BLOCK_SKINS[0];
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = skin.grain; ctx2.fillRect(0, 0, 64, 64);
  for (let r = 1; r < 7; r++) {
    ctx2.strokeStyle = skin.color; ctx2.globalAlpha = 0.1 + Math.random()*0.1;
    ctx2.lineWidth = 0.8; ctx2.beginPath(); ctx2.arc(32, 32, r*5, 0, Math.PI*2); ctx2.stroke();
  }
  ctx2.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); _endTexCache[skinId] = t; return t;
}

// ─── PROFILE HELPERS ─────────────────────────────────────────────────────────
function loadProfile() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveProfile(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }
function createProfile(name, country, avatar) {
  return {
    name, country, avatar, xp: 0, coins: 50, score: 0,
    wins: 0, losses: 0, streak: 0, bestStreak: 0, gamesPlayed: 0,
    created: Date.now(), unlockedSkins: ['default'], unlockedTables: ['wood'],
    activeSkin: 'default', activeTable: 'wood', lastDailyClaim: null, dailyStreak: 0,
  };
}
function getRank(xp) { let r = RANKS[0]; for (const rank of RANKS) { if (xp >= rank.xp) r = rank; } return r; }
function getNextRank(xp) { for (const rank of RANKS) { if (xp < rank.xp) return rank; } return null; }
function getRankProgress(xp) {
  const cur = getRank(xp), nxt = getNextRank(xp);
  if (!nxt) return 1;
  return Math.min(1, (xp - cur.xp) / (nxt.xp - cur.xp));
}

// ─── DAILY REWARD ─────────────────────────────────────────────────────────────
function checkDailyReward(profile) {
  const today = new Date().toDateString();
  if (!profile || profile.lastDailyClaim === today) return null;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const isStreak = profile.lastDailyClaim === yesterday;
  const streakDay = isStreak ? (profile.dailyStreak || 0) + 1 : 1;
  const coins = 20 + Math.min(streakDay * 5, 30);
  const xp = 10 + Math.min(streakDay * 3, 20);
  return { coins, xp, streakDay, today };
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
const BOT_NAMES = [
  'BlockMaster','TowerKing','WoodChuck','StackQueen','JengaPro',
  'SteadyHand','TopStacker','WoodNinja','TowerBoss','BlockAce',
  'PullKing','StackLord','TowerGod','WoodSage','BlockWiz',
  'JengaKid','TowerNerd','WoodPunk','StackBro','PullMaster',
];
function generateLeaderboard(profile) {
  const LB_KEY = 'jenga_leaderboard'; let lb;
  try { lb = JSON.parse(localStorage.getItem(LB_KEY)); } catch { lb = null; }
  if (!lb || !Array.isArray(lb) || lb.length < 15) {
    lb = BOT_NAMES.map((n, i) => ({
      name: n, country: COUNTRIES[Math.floor(Math.random()*COUNTRIES.length)],
      score: Math.max(0, 2000 - i*80 + Math.floor(Math.random()*100)),
      avatar: AVATARS[Math.floor(Math.random()*AVATARS.length)], isBot: true,
    }));
    localStorage.setItem(LB_KEY, JSON.stringify(lb));
  }
  if (profile) {
    const idx = lb.findIndex(e => !e.isBot);
    const entry = { name: profile.name, country: profile.country, score: profile.score, avatar: profile.avatar, isBot: false };
    if (idx >= 0) lb[idx] = entry; else lb.push(entry);
  }
  lb.sort((a, b) => b.score - a.score);
  return lb.slice(0, 25);
}

// ─── GAME LOGIC ───────────────────────────────────────────────────────────────
function createInitialTower() {
  return Array.from({ length: INITIAL_ROWS }, () => Array(BLOCKS_PER_ROW).fill(true));
}
function getTopRow(tower) {
  for (let r = tower.length - 1; r >= 0; r--) { if (tower[r].some(b => b)) return r; }
  return -1;
}
function getPlacementRow(tower) {
  const top = getTopRow(tower); if (top < 0) return 0;
  return tower[top].every(b => b) ? top + 1 : top;
}
function isStable(tower) {
  const top = getTopRow(tower); if (top < 0) return true;
  let hadEmpty = false;
  for (let r = 0; r <= top; r++) {
    const empty = tower[r].every(b => !b);
    if (empty) hadEmpty = true; else if (hadEmpty) return false;
  }
  return true;
}
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}
function getAIMoves(tower, topRow, difficulty) {
  const safe = [], any = [];
  for (let row = 0; row < tower.length; row++) {
    if (row === topRow) continue;
    for (let col = 0; col < BLOCKS_PER_ROW; col++) {
      if (!tower[row][col]) continue;
      any.push({ row, col });
      const next = tower.map((r, ri) => r.map((b, ci) => ri===row && ci===col ? false : b));
      if (isStable(next)) safe.push({ row, col });
    }
  }
  const pool = safe.length > 0 ? safe : any;
  if (!pool.length) return [];

  if (difficulty === 'Easy') {
    const src = Math.random() < 0.55 ? (any.length ? any : pool) : pool;
    return [src[Math.floor(Math.random()*src.length)]];
  }
  if (difficulty === 'Medium') {
    const withSib = pool.filter(m => tower[m.row].filter(b => b).length > 1);
    const p = withSib.length > 0 ? withSib : pool;
    return [p[Math.floor(Math.random()*p.length)]];
  }
  // Hard: pick move that leaves most safe moves after it
  const withSib = pool.filter(m => tower[m.row].filter(b => b).length > 1);
  const hp = withSib.length > 0 ? withSib : pool;
  const scored = hp.map(m => {
    const next = tower.map((r, ri) => r.map((b, ci) => ri===m.row && ci===m.col ? false : b));
    const nt = getTopRow(next);
    let count = 0;
    for (let row = 0; row < next.length; row++) {
      if (row === nt) continue;
      for (let col = 0; col < BLOCKS_PER_ROW; col++) {
        if (!next[row][col]) continue;
        const nn = next.map((r, ri) => r.map((b, ci) => ri===row && ci===col ? false : b));
        if (isStable(nn)) count++;
      }
    }
    return { ...m, score: count };
  });
  scored.sort((a, b) => b.score - a.score);
  const top3 = scored.slice(0, Math.min(3, scored.length));
  return [top3[Math.floor(Math.random()*top3.length)]];
}

// ─── THREE.JS JENGA TOWER COMPONENT ──────────────────────────────────────────
function JengaTower3D({ tower, selected, topRow, phase, isMyTurn, onBlockClick, skinId, tableId, collapsing, onCollapseEnd }) {
  const mountRef = useRef(null);
  const threeRef = useRef({});
  const blockMapRef = useRef(new Map());
  const collapsingRef = useRef(false);
  const physicsRef = useRef(new Map());
  const orbitRef = useRef({ theta: 0, phi: 0.52, radius: 16, isDragging: false, lastX: 0, lastY: 0, dragDist: 0 });
  const clickHandlerRef = useRef(onBlockClick);
  useEffect(() => { clickHandlerRef.current = onBlockClick; }, [onBlockClick]);

  // ── Scene setup (once on mount) ──
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const W = mount.clientWidth || 400, H = mount.clientHeight || 600;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W/H, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffeedd, 0.72);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xfff5e0, 1.4);
    dirLight.position.set(6, 18, 8); dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5; dirLight.shadow.camera.far = 60;
    dirLight.shadow.camera.left = -15; dirLight.shadow.camera.right = 15;
    dirLight.shadow.camera.top = 28; dirLight.shadow.camera.bottom = -5;
    scene.add(dirLight);
    const fill = new THREE.DirectionalLight(0x6070ff, 0.22);
    fill.position.set(-6, 4, -6); scene.add(fill);
    const backLight = new THREE.DirectionalLight(0xffc080, 0.18);
    backLight.position.set(0, 10, -12); scene.add(backLight);

    threeRef.current = { scene, camera, renderer };

    // Camera orbit
    const applyOrbit = () => {
      const { theta, phi, radius } = orbitRef.current;
      camera.position.x = radius * Math.sin(theta) * Math.cos(phi);
      camera.position.y = radius * Math.sin(phi) + 2;
      camera.position.z = radius * Math.cos(theta) * Math.cos(phi);
      camera.lookAt(0, 9, 0);
    };
    applyOrbit();
    threeRef.current.applyOrbit = applyOrbit;

    // Animation loop
    let animId;
    function animate() {
      animId = requestAnimationFrame(animate);
      if (collapsingRef.current) {
        blockMapRef.current.forEach((mesh, key) => {
          const p = physicsRef.current.get(key); if (!p) return;
          p.vy -= 0.013;
          mesh.position.x += p.vx; mesh.position.y += p.vy; mesh.position.z += p.vz;
          mesh.rotation.x += p.rx; mesh.rotation.y += p.ry; mesh.rotation.z += p.rz;
        });
      }
      renderer.render(scene, camera);
    }
    animate();

    // Resize
    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // Pointer orbit + click
    const el = renderer.domElement;
    const onPD = e => {
      orbitRef.current.isDragging = true; orbitRef.current.dragDist = 0;
      orbitRef.current.lastX = e.clientX; orbitRef.current.lastY = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch(err) {}
    };
    const onPM = e => {
      if (!orbitRef.current.isDragging) return;
      const dx = e.clientX - orbitRef.current.lastX;
      const dy = e.clientY - orbitRef.current.lastY;
      orbitRef.current.dragDist += Math.abs(dx) + Math.abs(dy);
      orbitRef.current.theta -= dx * 0.009;
      orbitRef.current.theta = Math.max(-2.2, Math.min(2.2, orbitRef.current.theta));
      orbitRef.current.phi = Math.max(0.18, Math.min(1.2, orbitRef.current.phi - dy*0.005));
      orbitRef.current.lastX = e.clientX; orbitRef.current.lastY = e.clientY;
      applyOrbit();
    };
    const onPU = e => {
      orbitRef.current.isDragging = false;
      if (orbitRef.current.dragDist < 8) doRaycast(e);
    };
    const doRaycast = e => {
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const rc = new THREE.Raycaster();
      rc.setFromCamera({ x: nx, y: ny }, camera);
      const meshes = []; blockMapRef.current.forEach(m => meshes.push(m));
      const hits = rc.intersectObjects(meshes);
      if (hits.length > 0) {
        const { row, col } = hits[0].object.userData;
        clickHandlerRef.current?.(row, col);
      }
    };
    el.addEventListener('pointerdown', onPD);
    el.addEventListener('pointermove', onPM);
    el.addEventListener('pointerup', onPU);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      el.removeEventListener('pointerdown', onPD);
      el.removeEventListener('pointermove', onPM);
      el.removeEventListener('pointerup', onPU);
      try { mount.removeChild(renderer.domElement); } catch(err) {}
      renderer.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Table theme update ──
  useEffect(() => {
    const { scene } = threeRef.current; if (!scene) return;
    const theme = TABLE_THEMES.find(t => t.id === tableId) || TABLE_THEMES[0];
    scene.background = new THREE.Color(theme.bgColor);
    scene.fog = new THREE.FogExp2(theme.bgColor, 0.02);
    const old = scene.getObjectByName('table');
    if (old) { old.geometry.dispose(); old.material.dispose(); scene.remove(old); }
    const geo = new THREE.BoxGeometry(20, 0.6, 20);
    const mat = new THREE.MeshLambertMaterial({ color: theme.tableColor });
    const table = new THREE.Mesh(geo, mat); table.name = 'table';
    table.position.y = -0.3; table.receiveShadow = true; scene.add(table);
  }, [tableId]);

  // ── Tower rebuild ──
  useEffect(() => {
    const { scene } = threeRef.current; if (!scene) return;
    if (collapsingRef.current) return;

    // Dispose & remove old blocks
    blockMapRef.current.forEach(mesh => {
      scene.remove(mesh); mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
      else mesh.material?.dispose();
    });
    blockMapRef.current.clear();

    const woodTex = getWoodTexture(skinId || 'default');
    const endTex = getEndTexture(skinId || 'default');

    tower.forEach((row, rowIdx) => {
      const isHoriz = rowIdx % 2 === 0;
      const yBase = rowIdx * (BH + 0.02);
      row.forEach((present, col) => {
        if (!present) return;
        const geo = new THREE.BoxGeometry(
          isHoriz ? BW : BL, BH, isHoriz ? BL : BW
        );
        const isSel = selected?.row === rowIdx && selected?.col === col;
        const isTop = rowIdx === topRow;

        // 6-face materials: different texture on end faces
        const mkMat = (isEnd) => new THREE.MeshLambertMaterial({
          map: isEnd ? endTex : woodTex,
          emissive: isSel ? new THREE.Color(0.55, 0.22, 0) : new THREE.Color(0, 0, 0),
          emissiveIntensity: isSel ? 0.55 : (isTop ? 0 : 0),
          color: isTop ? new THREE.Color(0.75, 0.75, 0.75) : new THREE.Color(1, 1, 1),
        });
        // +x,-x,+y,-y,+z,-z
        const mats = isHoriz
          ? [mkMat(true), mkMat(true), mkMat(false), mkMat(false), mkMat(false), mkMat(false)]
          : [mkMat(false), mkMat(false), mkMat(false), mkMat(false), mkMat(true), mkMat(true)];

        const mesh = new THREE.Mesh(geo, mats);
        const off = BW + BGAP;
        mesh.position.y = yBase + BH/2;
        if (isHoriz) { mesh.position.x = (col-1)*off; mesh.position.z = 0; }
        else         { mesh.position.x = 0;            mesh.position.z = (col-1)*off; }
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { isBlock: true, row: rowIdx, col };
        scene.add(mesh);
        blockMapRef.current.set(`${rowIdx}-${col}`, mesh);
      });
    });
  }, [tower, selected, topRow, phase, isMyTurn, skinId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Collapse animation trigger ──
  useEffect(() => {
    if (!collapsing || collapsingRef.current) return;
    collapsingRef.current = true;
    physicsRef.current.clear();
    blockMapRef.current.forEach((mesh, key) => {
      physicsRef.current.set(key, {
        vx: (Math.random()-0.5)*0.14, vy: 0.05+Math.random()*0.1, vz: (Math.random()-0.5)*0.14,
        rx: (Math.random()-0.5)*0.07, ry: (Math.random()-0.5)*0.07, rz: (Math.random()-0.5)*0.07,
      });
    });
    const tid = setTimeout(() => {
      collapsingRef.current = false; physicsRef.current.clear();
      onCollapseEnd?.();
    }, 2200);
    return () => clearTimeout(tid);
  }, [collapsing]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mountRef} className="jenga-3d-mount" />;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(() => loadProfile());
  const [regName, setRegName] = useState('');
  const [regCountry, setRegCountry] = useState('');
  const [regAvatar, setRegAvatar] = useState('🪵');
  const [screen, setScreen] = useState(() => loadProfile() ? 'hq' : 'splash');
  const [mode, setMode] = useState(null);      // 'local'|'ai'|'online'
  const [role, setRole] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState('');
  const [copied, setCopied] = useState(false);
  const [aiDifficulty, setAiDifficulty] = useState('Medium');
  const [soundOn, setSoundOn] = useState(true);

  const peerRef = useRef(null);
  const connRef = useRef(null);

  // Game state
  const [tower, setTower] = useState(createInitialTower);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [selected, setSelected] = useState(null);
  const [phase, setPhase] = useState('remove');
  const [loser, setLoser] = useState(null);
  const [hint, setHint] = useState('');
  const [myPlayer, setMyPlayer] = useState(null);
  const [movesThisGame, setMovesThisGame] = useState(0);
  const [rewardShown, setRewardShown] = useState(null);
  const [collapsing, setCollapsing] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [dailyReward, setDailyReward] = useState(null);

  const screenRef = useRef(screen); screenRef.current = screen;
  const goHomeRef = useRef(null);

  const topRow = getTopRow(tower);
  const placementRow = getPlacementRow(tower);
  const isMyTurn = mode === 'local' || currentPlayer === myPlayer;

  const play = useCallback((type) => { if (soundOn) sfx(type); }, [soundOn]);

  // Persist profile
  useEffect(() => { if (profile) saveProfile(profile); }, [profile]);

  // Splash timer
  useEffect(() => {
    if (screen !== 'splash') return;
    const t = setTimeout(() => setScreen(profile ? 'hq' : 'register'), 2200);
    return () => clearTimeout(t);
  }, [screen, profile]);

  // Check daily reward when reaching HQ
  useEffect(() => {
    if (screen === 'hq' && profile) {
      const reward = checkDailyReward(profile);
      if (reward) setDailyReward(reward);
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup peer on unmount
  useEffect(() => () => { connRef.current?.close(); peerRef.current?.destroy(); }, []);

  // Android back button
  useEffect(() => {
    const handler = ev => {
      try { ev.detail.register(10, () => {
        if (!['hq','splash','register'].includes(screenRef.current)) goHomeRef.current?.();
      }); } catch {}
    };
    document.addEventListener('ionBackButton', handler);
    return () => document.removeEventListener('ionBackButton', handler);
  }, []);

  // AI turn logic
  useEffect(() => {
    if (mode !== 'ai' || currentPlayer !== 2 || phase === 'gameover') return;
    let t1, t2;
    const thinkMs = 900 + Math.random() * 900;
    if (phase === 'remove') {
      t1 = setTimeout(() => {
        const top = getTopRow(tower);
        const moves = getAIMoves(tower, top, aiDifficulty);
        if (!moves.length) return;
        const move = moves[0];
        setSelected({ row: move.row, col: move.col });
        setHint(`AI (${aiDifficulty}) is thinking...`);
        t2 = setTimeout(() => {
          const nt = tower.map((r, ri) => r.map((b, ci) => ri===move.row && ci===move.col ? false : b));
          setSelected(null);
          if (!isStable(nt)) {
            setTower(nt); setLoser(2); setPhase('gameover'); setHint('');
            applyReward(2); play('fall');
            setCollapsing(true);
            setTimeout(() => setShowGameOver(true), 1800);
          } else { setTower(nt); setPhase('place'); setHint('AI is placing...'); play('remove'); }
        }, 650);
      }, thinkMs);
    } else if (phase === 'place') {
      t1 = setTimeout(() => {
        const pr = getPlacementRow(tower);
        const avail = [];
        for (let c = 0; c < BLOCKS_PER_ROW; c++) {
          if (!(pr < tower.length && tower[pr][c])) avail.push(c);
        }
        if (!avail.length) return;
        const col = avail.includes(1) ? 1 : avail[Math.floor(Math.random()*avail.length)];
        let nt;
        if (pr >= tower.length) { const nr = Array(BLOCKS_PER_ROW).fill(false); nr[col] = true; nt = [...tower, nr]; }
        else { nt = tower.map((r, ri) => r.map((b, ci) => ri===pr && ci===col ? true : b)); }
        setTower(nt); setPhase('remove'); setCurrentPlayer(1); setHint('Your turn!');
        play('place');
      }, 550 + Math.random()*550);
    }
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase, currentPlayer, tower, aiDifficulty]);

  function applyReward(losingPlayer) {
    if (!profile) return;
    const isWin = (mode==='ai' && losingPlayer===2) ||
                  (mode==='online' && losingPlayer!==myPlayer) ||
                  (mode==='local' && losingPlayer===2);
    const reward = isWin ? REWARD_WIN : REWARD_LOSS;
    const bonus = Math.min(movesThisGame * 2, 30);
    const totalXP = reward.xp + bonus;
    const totalCoins = reward.coins + Math.floor(bonus/2);
    const scoreGain = isWin ? 50 + bonus : Math.max(0, bonus - 10);
    const prevXP = profile.xp;
    setProfile(prev => {
      const ns = isWin ? prev.streak+1 : 0;
      const newXP = prev.xp + totalXP;
      const leveled = getRank(newXP).name !== getRank(prevXP).name;
      if (leveled) setTimeout(() => play('levelup'), 800);
      return { ...prev, xp: newXP, coins: prev.coins+totalCoins, score: prev.score+scoreGain,
        wins: prev.wins+(isWin?1:0), losses: prev.losses+(isWin?0:1),
        streak: ns, bestStreak: Math.max(prev.bestStreak, ns), gamesPlayed: prev.gamesPlayed+1 };
    });
    setRewardShown({ xp: totalXP, coins: totalCoins, score: scoreGain, isWin });
    if (isWin) play('win'); else play('lose');
  }

  function claimDaily() {
    if (!dailyReward) return;
    setProfile(prev => ({
      ...prev, coins: prev.coins + dailyReward.coins, xp: prev.xp + dailyReward.xp,
      lastDailyClaim: dailyReward.today, dailyStreak: dailyReward.streakDay,
    }));
    play('coins');
    setDailyReward(null);
  }

  function register() {
    if (!regName.trim() || !regCountry) return;
    const p = createProfile(regName.trim(), regCountry, regAvatar);
    setProfile(p); saveProfile(p); setScreen('hq');
  }

  const resetGameState = useCallback(() => {
    setTower(createInitialTower()); setCurrentPlayer(1); setPhase('remove');
    setLoser(null); setSelected(null); setHint(''); setMovesThisGame(0);
    setRewardShown(null); setCollapsing(false); setShowGameOver(false);
  }, []);

  const handleMessage = useCallback((data) => {
    if (data.type === 'state') {
      setTower(data.tower); setCurrentPlayer(data.currentPlayer);
      setPhase(data.phase); setLoser(data.loser); setSelected(null); setHint('');
      if (data.loser) { applyReward(data.loser); play('fall'); setCollapsing(true); setTimeout(() => setShowGameOver(true), 1800); }
    } else if (data.type === 'restart') resetGameState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetGameState]);

  const sendState = useCallback((t, cp, ph, l) => {
    if (connRef.current?.open) connRef.current.send({ type:'state', tower:t, currentPlayer:cp, phase:ph, loser:l });
  }, []);

  function setupConn(conn, isHost) {
    connRef.current = conn;
    conn.on('open', () => {
      setConnected(true); setScreen('game');
      if (isHost) {
        const t = createInitialTower(); setTower(t); setCurrentPlayer(1); setPhase('remove'); setLoser(null);
        conn.send({ type:'state', tower:t, currentPlayer:1, phase:'remove', loser:null });
      }
    });
    conn.on('data', handleMessage);
    conn.on('close', () => { setConnected(false); setHint('Opponent disconnected'); });
  }

  function createRoom() {
    const code = generateRoomCode(); setRoomCode(code); setRole('host'); setMode('online');
    setMyPlayer(1); setScreen('lobby'); setConnError('');
    const peer = new Peer(`jenga-${code}`, { debug: 0 }); peerRef.current = peer;
    peer.on('error', err => { if (err.type==='unavailable-id') { peer.destroy(); createRoom(); } else setConnError('Connection error.'); });
    peer.on('connection', conn => setupConn(conn, true));
  }

  function joinRoom() {
    const code = joinInput.toUpperCase().trim();
    if (code.length < 4) { setConnError('Enter a valid room code'); return; }
    setRoomCode(code); setRole('guest'); setMode('online'); setMyPlayer(2); setScreen('lobby'); setConnError('');
    const peer = new Peer(undefined, { debug: 0 }); peerRef.current = peer;
    peer.on('open', () => {
      const conn = peer.connect(`jenga-${code}`, { reliable: true }); setupConn(conn, false);
      setTimeout(() => { if (!connRef.current?.open) setConnError('Could not find room.'); }, 10000);
    });
    peer.on('error', () => setConnError('Connection failed.'));
  }

  function startLocal() { setMode('local'); setMyPlayer(1); resetGameState(); setScreen('game'); }
  function startAI()    { setMode('ai');    setMyPlayer(1); resetGameState(); setScreen('game'); }

  function handleBlockClick(row, col) {
    if (phase !== 'remove' || !isMyTurn || !tower[row][col]) return;
    if (row === topRow) { setHint("Can't remove from the top row!"); return; }

    if (selected?.row === row && selected?.col === col) {
      const nt = tower.map((r, ri) => r.map((b, ci) => ri===row && ci===col ? false : b));
      if (!isStable(nt)) {
        setTower(nt); setLoser(currentPlayer); setPhase('gameover');
        setSelected(null); setHint('');
        sendState(nt, currentPlayer, 'gameover', currentPlayer);
        applyReward(currentPlayer); play('fall');
        setCollapsing(true);
        setTimeout(() => setShowGameOver(true), 1800);
        return;
      }
      setTower(nt); setSelected(null); setPhase('place');
      setHint('Now place your block on top'); setMovesThisGame(m => m+1);
      sendState(nt, currentPlayer, 'place', null); play('remove');
    } else {
      setSelected({ row, col }); setHint('Tap again to confirm removal'); play('select');
    }
  }

  function handlePlaceClick(col) {
    if (phase !== 'place' || !isMyTurn) return;
    if (placementRow < tower.length && tower[placementRow][col]) { setHint('Spot taken!'); return; }
    let nt;
    if (placementRow >= tower.length) { const nr = Array(BLOCKS_PER_ROW).fill(false); nr[col] = true; nt = [...tower, nr]; }
    else { nt = tower.map((r, ri) => r.map((b, ci) => ri===placementRow && ci===col ? true : b)); }
    const next = currentPlayer === 1 ? 2 : 1;
    setTower(nt); setPhase('remove'); setCurrentPlayer(next); setHint('');
    sendState(nt, next, 'remove', null); play('place');
  }

  function handleCollapseEnd() { setCollapsing(false); }

  function resetGame() { resetGameState(); if (mode==='online' && connRef.current?.open) connRef.current.send({ type:'restart' }); }

  const goHome = useCallback(() => {
    connRef.current?.close(); peerRef.current?.destroy(); peerRef.current = null; connRef.current = null;
    setScreen('hq'); setMode(null); setRole(null); setRoomCode(''); setJoinInput('');
    setConnected(false); setConnError(''); setMyPlayer(null); setCopied(false); resetGameState();
  }, [resetGameState]);
  goHomeRef.current = goHome;

  function copyCode() { navigator.clipboard?.writeText(roomCode).catch(()=>{}); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  // ── Buy store item ──
  function buyItem(type, id, cost) {
    if (!profile || profile.coins < cost) return;
    setProfile(prev => {
      const updated = { ...prev, coins: prev.coins - cost };
      if (type === 'skin') { updated.unlockedSkins = [...new Set([...(prev.unlockedSkins||[]), id])]; updated.activeSkin = id; }
      if (type === 'table') { updated.unlockedTables = [...new Set([...(prev.unlockedTables||[]), id])]; updated.activeTable = id; }
      return updated;
    });
    play('coins');
  }
  function equipItem(type, id) {
    setProfile(prev => ({
      ...prev,
      ...(type==='skin' ? { activeSkin: id } : { activeTable: id }),
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  // SPLASH
  if (screen === 'splash') return (
    <div className="app screen-splash">
      <div className="splash-tower">
        {[...Array(6)].map((_, i) => (
          <div key={i} className={`splash-row ${i%2===0 ? 'splash-row--h' : 'splash-row--v'}`} style={{ animationDelay:`${i*0.12}s` }}>
            <div className="splash-block"/><div className="splash-block"/><div className="splash-block"/>
          </div>
        ))}
      </div>
      <h1 className="splash-title">JENGA</h1>
      <p className="splash-sub">TOWER MASTER 3D</p>
      <div className="splash-loader"><div className="splash-loader-bar"/></div>
    </div>
  );

  // REGISTER
  if (screen === 'register') return (
    <div className="app screen-register">
      <div className="reg-content">
        <h1 className="reg-title">JOIN THE TOWER</h1>
        <p className="reg-sub">Set up your profile to start stacking!</p>
        <label className="field-label">YOUR NAME</label>
        <input className="field-input" type="text" placeholder="TowerMaster" value={regName}
          onChange={e => setRegName(e.target.value.slice(0,16))} maxLength={16}/>
        <label className="field-label">YOUR COUNTRY</label>
        <select className="field-select" value={regCountry} onChange={e => setRegCountry(e.target.value)}>
          <option value="">— Pick Country —</option>
          {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="field-label">PICK YOUR ICON</label>
        <div className="avatar-grid">
          {AVATARS.map(a => (
            <div key={a} className={`av-opt ${regAvatar===a ? 'av-opt--active' : ''}`} onClick={() => setRegAvatar(a)}>{a}</div>
          ))}
        </div>
        <button className="btn btn-accent btn-lg" onClick={register} disabled={!regName.trim()||!regCountry}>
          START STACKING!
        </button>
      </div>
    </div>
  );

  // HQ
  if (screen === 'hq' && profile) {
    const rank = getRank(profile.xp);
    const nextRank = getNextRank(profile.xp);
    const progress = getRankProgress(profile.xp);
    const winRate = profile.gamesPlayed > 0 ? Math.round((profile.wins/profile.gamesPlayed)*100) : 0;
    return (
      <div className="app screen-hq">
        {/* Daily reward popup */}
        {dailyReward && (
          <div className="daily-overlay">
            <div className="daily-card">
              <div className="daily-icon">🎁</div>
              <h3>Daily Reward!</h3>
              <p className="daily-streak">Day {dailyReward.streakDay} streak</p>
              <div className="daily-rewards">
                <span>+{dailyReward.coins} 🪙</span>
                <span>+{dailyReward.xp} XP</span>
              </div>
              <button className="btn btn-accent" onClick={claimDaily}>CLAIM!</button>
            </div>
          </div>
        )}
        <div className="hq-card">
          <div className="hq-avatar">{profile.avatar}</div>
          <div className="hq-info">
            <div className="hq-name">{profile.name}</div>
            <div className="hq-country">{profile.country}</div>
          </div>
          <div className="hq-rank-pill">{rank.icon} {rank.name}</div>
        </div>
        <div className="xp-strip">
          <div className="xp-row"><span className="xp-label">XP</span><span className="xp-val">{profile.xp}{nextRank ? ` / ${nextRank.xp}` : ' MAX'}</span></div>
          <div className="xp-bar"><div className="xp-fill" style={{ width:`${progress*100}%` }}/></div>
          {nextRank && <div className="xp-next">Next: {nextRank.icon} {nextRank.name}</div>}
        </div>
        <div className="stats-strip">
          <div className="stat-box"><div className="stat-n">{profile.wins}</div><div className="stat-l">WINS</div></div>
          <div className="stat-box"><div className="stat-n">{profile.losses}</div><div className="stat-l">LOSSES</div></div>
          <div className="stat-box"><div className="stat-n">{profile.streak>0?`${profile.streak}🔥`:'0'}</div><div className="stat-l">STREAK</div></div>
          <div className="stat-box"><div className="stat-n">{winRate}%</div><div className="stat-l">WIN %</div></div>
        </div>
        <div className="currency-strip">
          <div className="currency-box"><span className="currency-icon">🪙</span><span className="currency-val">{profile.coins}</span><span className="currency-label">COINS</span></div>
          <div className="currency-box"><span className="currency-icon">⭐</span><span className="currency-val">{profile.score}</span><span className="currency-label">SCORE</span></div>
        </div>
        <div className="hq-actions">
          <div className="diff-row">
            <span className="diff-label">AI Difficulty:</span>
            {AI_DIFFICULTIES.map(d => (
              <button key={d} className={`diff-btn ${aiDifficulty===d?'diff-btn--active':''}`} onClick={() => setAiDifficulty(d)}>{d}</button>
            ))}
          </div>
          <button className="btn btn-accent btn-lg" onClick={startAI}>⚔️ vs COMPUTER</button>
          <button className="btn btn-wood btn-lg" onClick={() => setScreen('online-menu')}>🌐 PLAY ONLINE</button>
          <button className="btn btn-ghost" onClick={startLocal}>👥 LOCAL 2 PLAYERS</button>
        </div>
        <div className="hq-nav">
          <button className="hq-nav-btn" onClick={() => setScreen('leaderboard')}><span className="hq-nav-icon">🏆</span><span>Leaderboard</span></button>
          <button className="hq-nav-btn" onClick={() => setScreen('store')}><span className="hq-nav-icon">🛍️</span><span>Store</span></button>
          <button className="hq-nav-btn" onClick={() => setScreen('stats')}><span className="hq-nav-icon">📊</span><span>Stats</span></button>
          <button className="hq-nav-btn" onClick={() => setSoundOn(s => !s)}><span className="hq-nav-icon">{soundOn?'🔊':'🔇'}</span><span>Sound</span></button>
        </div>
      </div>
    );
  }

  // LEADERBOARD
  if (screen === 'leaderboard') {
    const lb = generateLeaderboard(profile);
    return (
      <div className="app screen-lb">
        <button className="nav-back" onClick={goHome}>&larr; Back</button>
        <h2 className="lb-title">🏆 LEADERBOARD</h2>
        <div className="lb-list">
          {lb.map((entry, i) => (
            <div key={i} className={`lb-row ${!entry.isBot?'lb-row--me':''}`}>
              <span className="lb-pos">#{i+1}</span>
              <span className="lb-avatar">{entry.avatar}</span>
              <div className="lb-info"><span className="lb-name">{entry.name}</span><span className="lb-country">{entry.country}</span></div>
              <span className="lb-score">{entry.score}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // STATS
  if (screen === 'stats' && profile) {
    const rank = getRank(profile.xp);
    return (
      <div className="app screen-stats">
        <button className="nav-back" onClick={goHome}>&larr; Back</button>
        <h2 className="stats-title">📊 YOUR STATS</h2>
        <div className="stats-card">
          <div className="stats-avatar">{profile.avatar}</div>
          <div className="stats-name">{profile.name}</div>
          <div className="stats-rank">{rank.icon} {rank.name}</div>
        </div>
        <div className="stats-grid">
          {[
            [profile.gamesPlayed,'Games Played'],[profile.wins,'Wins'],[profile.losses,'Losses'],
            [profile.bestStreak,'Best Streak'],[profile.xp,'Total XP'],[profile.coins,'Total Coins'],
            [profile.score,'Score'],[profile.gamesPlayed>0?Math.round((profile.wins/profile.gamesPlayed)*100):0+'%','Win Rate'],
          ].map(([n,l]) => (
            <div key={l} className="sg-item"><div className="sg-n">{n}</div><div className="sg-l">{l}</div></div>
          ))}
        </div>
      </div>
    );
  }

  // STORE
  if (screen === 'store' && profile) {
    const unlockedSkins = new Set(profile.unlockedSkins || ['default']);
    const unlockedTables = new Set(profile.unlockedTables || ['wood']);
    return (
      <div className="app screen-store">
        <button className="nav-back" onClick={goHome}>&larr; Back</button>
        <h2 className="store-title">🛍️ SHOP</h2>
        <div className="store-coins"><span>🪙 {profile.coins} coins</span></div>

        <div className="store-section-label">BLOCK SKINS</div>
        <div className="store-grid">
          {BLOCK_SKINS.map(skin => {
            const owned = unlockedSkins.has(skin.id);
            const active = profile.activeSkin === skin.id;
            return (
              <div key={skin.id} className={`store-item ${active?'store-item--active':''}`}>
                <div className="store-preview" style={{ background: skin.color }}>
                  <div className="store-block-preview" style={{ background: `linear-gradient(135deg, ${skin.color}, ${skin.grain})` }}/>
                </div>
                <div className="store-item-name">{skin.name}</div>
                {owned ? (
                  <button className={`store-btn ${active?'store-btn--equipped':'store-btn--equip'}`}
                    onClick={() => equipItem('skin', skin.id)}>
                    {active ? '✓ ON' : 'EQUIP'}
                  </button>
                ) : (
                  <button className={`store-btn store-btn--buy ${profile.coins<skin.cost?'store-btn--poor':''}`}
                    onClick={() => buyItem('skin', skin.id, skin.cost)}
                    disabled={profile.coins < skin.cost || skin.cost===0}>
                    {skin.cost===0 ? 'FREE' : `🪙 ${skin.cost}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="store-section-label" style={{ marginTop: 24 }}>TABLE THEMES</div>
        <div className="store-grid">
          {TABLE_THEMES.map(theme => {
            const owned = unlockedTables.has(theme.id);
            const active = profile.activeTable === theme.id;
            const hex = '#' + theme.tableColor.toString(16).padStart(6,'0');
            return (
              <div key={theme.id} className={`store-item ${active?'store-item--active':''}`}>
                <div className="store-preview" style={{ background: '#'+theme.bgColor.toString(16).padStart(6,'0') }}>
                  <div style={{ width:'90%', height:'40%', background: hex, borderRadius: 4, margin:'auto', marginTop: 'auto', alignSelf:'flex-end' }}/>
                </div>
                <div className="store-item-name">{theme.name}</div>
                {owned ? (
                  <button className={`store-btn ${active?'store-btn--equipped':'store-btn--equip'}`}
                    onClick={() => equipItem('table', theme.id)}>
                    {active ? '✓ ON' : 'EQUIP'}
                  </button>
                ) : (
                  <button className={`store-btn store-btn--buy ${profile.coins<theme.cost?'store-btn--poor':''}`}
                    onClick={() => buyItem('table', theme.id, theme.cost)}
                    disabled={profile.coins < theme.cost || theme.cost===0}>
                    {theme.cost===0 ? 'FREE' : `🪙 ${theme.cost}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ONLINE MENU
  if (screen === 'online-menu') return (
    <div className="app screen-online">
      <button className="nav-back" onClick={goHome}>&larr; Back</button>
      <div className="online-content">
        <h2>Play Online</h2>
        <button className="btn btn-accent btn-lg" onClick={createRoom}>Create Game</button>
        <div className="divider"><span>or join a friend</span></div>
        <input className="code-input" type="text" placeholder="ROOM CODE" value={joinInput}
          onChange={e => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} maxLength={5}/>
        <button className="btn btn-wood btn-lg" onClick={joinRoom} disabled={joinInput.length<4}>Join Game</button>
        {connError && <p className="error-msg">{connError}</p>}
      </div>
    </div>
  );

  // LOBBY
  if (screen === 'lobby') return (
    <div className="app screen-lobby">
      <button className="nav-back" onClick={goHome}>&larr; Back</button>
      <div className="lobby-content">
        {role==='host' ? (<>
          <p className="lobby-label">Share this code with your friend</p>
          <div className="room-code-display" onClick={copyCode}>{roomCode}</div>
          <p className="copy-hint">{copied ? 'Copied!' : 'Tap code to copy'}</p>
          <div className="waiting"><div className="pulse-dot"/><span>Waiting for opponent...</span></div>
        </>) : (<>
          <p className="lobby-label">Joining room</p>
          <div className="room-code-display">{roomCode}</div>
          <div className="waiting"><div className="pulse-dot"/><span>Connecting...</span></div>
        </>)}
        {connError && <p className="error-msg">{connError}</p>}
      </div>
    </div>
  );

  // GAME SCREEN
  if (screen !== 'game') return null;
  const P1 = '#E8584A', P2 = '#4A90BF';
  const skinId = profile?.activeSkin || 'default';
  const tableId = profile?.activeTable || 'wood';

  return (
    <div className="app screen-game">
      <header className="game-header">
        <div className="header-row">
          <button className="nav-exit" onClick={goHome}>Exit</button>
          <span className="game-logo">JENGA 3D</span>
          <div className="header-right">
            {profile && <span className="hdr-coin">🪙 {profile.coins}</span>}
            <span className={`conn-badge ${mode==='online'?(connected?'':'offline'):''}`}>
              {mode==='online'?(connected?'Online':'Offline'):mode==='ai'?`AI·${aiDifficulty}`:'Local'}
            </span>
          </div>
        </div>
        <div className="player-bar">
          <div className={`player-tag ${currentPlayer===1?'active':''}`}>
            <span className="player-dot" style={{ background: P1 }}/>
            <span>{mode==='local'?'Player 1':mode==='ai'?(profile?.name||'You'):myPlayer===1?'You':'Opp'}</span>
          </div>
          <div className="turn-indicator">
            {phase==='gameover' ? 'Game Over' : isMyTurn ? (phase==='remove'?'Remove a block':'Place on top') : mode==='ai'?'AI thinking...':"Opponent's turn..."}
          </div>
          <div className={`player-tag ${currentPlayer===2?'active':''}`}>
            <span>{mode==='local'?'Player 2':mode==='ai'?`AI·${aiDifficulty}`:myPlayer===2?'You':'Opp'}</span>
            <span className="player-dot" style={{ background: P2 }}/>
          </div>
        </div>
        {hint && <p className="game-hint">{hint}</p>}
      </header>

      {/* Place overlay */}
      {phase==='place' && isMyTurn && (
        <div className="place-zone">
          <p className="place-label">Place your block in a slot</p>
          <div className="place-slots">
            {Array(BLOCKS_PER_ROW).fill(null).map((_, col) => {
              const taken = placementRow < tower.length && tower[placementRow][col];
              return (
                <button key={col} className={`place-slot ${taken?'taken':''}`}
                  onClick={() => handlePlaceClick(col)} disabled={!!taken}>
                  {taken ? '' : '+'}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {phase==='place' && !isMyTurn && (
        <div className="waiting-bar"><span>{mode==='ai'?'AI is placing a block...':'Opponent is placing...'}</span></div>
      )}

      {/* 3D Tower */}
      <div className="game-3d-container">
        <JengaTower3D
          tower={tower}
          selected={selected}
          topRow={topRow}
          phase={phase}
          isMyTurn={isMyTurn}
          onBlockClick={handleBlockClick}
          skinId={skinId}
          tableId={tableId}
          collapsing={collapsing}
          onCollapseEnd={handleCollapseEnd}
        />
        {/* Drag hint */}
        <div className="drag-hint">↔ drag to rotate</div>
      </div>

      {/* Game Over overlay */}
      {showGameOver && (
        <div className="gameover-overlay">
          <div className="gameover-card">
            <div className="crash-text">CRASH!</div>
            <h2>Tower Collapsed!</h2>
            <p className="go-detail">
              {mode==='local' ? `Player ${loser} knocked it over`
                : mode==='ai' ? (loser===1?'You knocked it over!':'AI knocked it over!')
                : (loser===myPlayer?'You knocked it over!':'Opponent knocked it over!')}
            </p>
            <p className="go-winner">
              {mode==='local' ? `Player ${loser===1?2:1} Wins!`
                : mode==='ai' ? (loser===1?'AI Wins!':'You Win!')
                : (loser===myPlayer?'You Lose!':'You Win!')}
            </p>
            {rewardShown && (
              <div className="reward-strip">
                <div className="reward-item"><span className="reward-icon">⚡</span><span className="reward-val">+{rewardShown.xp} XP</span></div>
                <div className="reward-item"><span className="reward-icon">🪙</span><span className="reward-val">+{rewardShown.coins}</span></div>
                <div className="reward-item"><span className="reward-icon">⭐</span><span className="reward-val">+{rewardShown.score}</span></div>
              </div>
            )}
            <button className="btn btn-accent" onClick={resetGame}>Play Again</button>
            <button className="btn btn-ghost" onClick={goHome} style={{ marginTop:10 }}>Home</button>
          </div>
        </div>
      )}
    </div>
  );
}

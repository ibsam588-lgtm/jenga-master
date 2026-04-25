import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import './App.css';

// --- Jenga constants ---
const BLOCK_W = 1.5;
const BLOCK_H = 0.3;
const BLOCK_D = 0.5;
const GAP = 0.02;
const ROW_COUNT = 18;

function buildInitialBlocks() {
  const blocks = [];
  for (let row = 0; row < ROW_COUNT; row++) {
    const rotated = row % 2 === 1;
    for (let pos = 0; pos < 3; pos++) {
      const x = rotated ? 0 : (pos - 1) * (BLOCK_D + GAP);
      const z = rotated ? (pos - 1) * (BLOCK_D + GAP) : 0;
      const y = row * (BLOCK_H + GAP) + BLOCK_H / 2;
      blocks.push({ id: `${row}-${pos}`, row, pos, x, y, z, rotated, removed: false });
    }
  }
  return blocks;
}

// --- Physics helpers ---
function computeTowerLean(blocks) {
  const active = blocks.filter(b => !b.removed);
  if (active.length === 0) return 0;

  let totalX = 0, totalZ = 0;
  active.forEach(b => { totalX += b.x; totalZ += b.z; });
  const cx = totalX / active.length;
  const cz = totalZ / active.length;

  // Max theoretical offset
  const maxOffset = BLOCK_W / 2;
  const lean = Math.min(1, Math.sqrt(cx * cx + cz * cz) / maxOffset);
  return lean;
}

function checkCollapseConditions(blocks, towerLean) {
  if (towerLean > 0.85) return true;

  // Check for gap row (row with 0 blocks that isn't the top)
  const rowCounts = {};
  blocks.forEach(b => {
    if (!b.removed) rowCounts[b.row] = (rowCounts[b.row] || 0) + 1;
  });

  const occupiedRows = Object.keys(rowCounts).map(Number).sort((a, b) => a - b);
  if (occupiedRows.length < 2) return false;

  const minRow = occupiedRows[0];
  const maxRow = occupiedRows[occupiedRows.length - 1];

  for (let r = minRow; r < maxRow; r++) {
    if (!rowCounts[r]) return true; // gap
  }

  // Bottom half has only 1 block total
  const midRow = Math.floor((minRow + maxRow) / 2);
  const bottomCount = blocks.filter(b => !b.removed && b.row <= midRow).length;
  if (bottomCount <= 1) return true;

  return false;
}

// --- Main App ---
export default function App() {
  const [screen, setScreen] = useState('home'); // 'home' | 'game'
  const mountRef = useRef(null);
  const gameRef = useRef(null);

  const startGame = useCallback(() => {
    setScreen('game');
  }, []);

  const goHome = useCallback(() => {
    if (gameRef.current) {
      gameRef.current.destroy();
      gameRef.current = null;
    }
    setScreen('home');
  }, []);

  useEffect(() => {
    if (screen !== 'game' || !mountRef.current) return;
    const game = new JengaGame(mountRef.current, goHome);
    gameRef.current = game;
    return () => { game.destroy(); };
  }, [screen, goHome]);

  if (screen === 'home') return <HomeScreen onStart={startGame} />;

  return (
    <div className="game-screen">
      <button className="back-btn" onClick={goHome}>← Menu</button>
      <div ref={mountRef} className="game-canvas-wrapper" />
    </div>
  );
}

// --- Home Screen Component ---
function HomeScreen({ onStart }) {
  const [soundOn, setSoundOn] = useState(true);

  return (
    <div className="home-screen">
      <div className="falling-block-bg">
        {[...Array(6)].map((_, i) => (
          <div key={i} className={`falling-block fb-${i}`} />
        ))}
      </div>

      <div className="home-content slide-in">
        {/* Logo */}
        <div className="jenga-logo">
          {[0,1,2].map(row => (
            <div key={row} className={`logo-row ${row % 2 === 1 ? 'rotated' : ''}`}>
              {[0,1,2].map(col => <div key={col} className="logo-block" />)}
            </div>
          ))}
        </div>

        <h1 className="game-title">JENGA MASTER</h1>
        <p className="game-tagline">Stack. Pull. Survive.</p>

        <div className="menu-buttons">
          <button className="menu-btn primary" onClick={() => onStart('solo')}>
            ▶ Play vs Opponent
          </button>
          <button className="menu-btn" onClick={() => onStart('quick')}>
            ⚡ Quick Match
          </button>
          <button className="menu-btn" onClick={() => onStart('create')}>
            🚪 Create Room
          </button>
          <button className="menu-btn" onClick={() => onStart('join')}>
            🔗 Join Room
          </button>
        </div>

        <div className="icon-buttons">
          <button className="icon-btn" title="Leaderboard">🏆</button>
          <button className="icon-btn" title="Store">🛒</button>
          <button className="icon-btn" title="Daily Reward">🎁</button>
          <button className="icon-btn" title="Sound" onClick={() => setSoundOn(s => !s)}>
            {soundOn ? '🔊' : '🔇'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Three.js Jenga Game Class ---
class JengaGame {
  constructor(container, onBack) {
    this.container = container;
    this.onBack = onBack;
    this.blocks = buildInitialBlocks();
    this.meshes = {};
    this.towerLean = 0;
    this.wobbleTime = 0;
    this.collapsed = false;
    this.collapsingMeshes = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredMesh = null;
    this.selectedMesh = null;
    this.animFrame = null;
    this.statusEl = null;
    this.warningEl = null;

    this._init();
    this._buildTower();
    this._setupInteraction();
    this._createUI();
    this._animate();
  }

  _init() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x1a1a2e);
    this.container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a1a2e, 20, 60);

    // Tower group (for wobble)
    this.towerGroup = new THREE.Group();
    this.scene.add(this.towerGroup);

    // Camera — perspective, positioned to see full tower
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this._fitCamera();

    // Lights
    this.ambientLight = new THREE.AmbientLight(0xfff5e0, 0.7);
    this.scene.add(this.ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 12, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xffd090, 0.3);
    fillLight.position.set(-4, 6, -4);
    this.scene.add(fillLight);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x2d1b00 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Resize handler
    this._onResize = () => this._handleResize();
    window.addEventListener('resize', this._onResize);
  }

  _fitCamera() {
    const towerHeight = ROW_COUNT * (BLOCK_H + GAP);
    const midY = towerHeight / 2;
    // Position camera to see full tower with margin
    this.camera.position.set(0, midY + 1, towerHeight * 1.1);
    this.camera.lookAt(0, midY, 0);
    this.camera.updateProjectionMatrix();
  }

  _fitCameraToCurrentHeight() {
    const activeBlocks = this.blocks.filter(b => !b.removed);
    if (activeBlocks.length === 0) return;
    const maxY = Math.max(...activeBlocks.map(b => b.y)) + BLOCK_H;
    const midY = maxY / 2;
    const dist = Math.max(maxY * 1.2, 6);
    this.camera.position.set(0, midY + 0.5, dist);
    this.camera.lookAt(0, midY, 0);
    this.camera.updateProjectionMatrix();
  }

  _buildTower() {
    const geo = new THREE.BoxGeometry(BLOCK_W, BLOCK_H, BLOCK_D);

    this.blocks.forEach(block => {
      const mat = new THREE.MeshPhongMaterial({
        color: 0xd4a96a,
        specular: 0x331100,
        shininess: 20,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(block.x, block.y, block.z);
      if (block.rotated) mesh.rotation.y = Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.blockId = block.id;
      this.towerGroup.add(mesh);
      this.meshes[block.id] = mesh;
    });
  }

  _setupInteraction() {
    const canvas = this.renderer.domElement;

    this._onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    this._onTouchMove = (e) => {
      const t = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((t.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((t.clientY - rect.top) / rect.height) * 2 + 1;
    };

    this._onClick = () => {
      if (this.collapsed) return;
      if (this.hoveredMesh) {
        const id = this.hoveredMesh.userData.blockId;
        const block = this.blocks.find(b => b.id === id);
        if (block && !block.removed) this._removeBlock(block);
      }
    };

    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: true });
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('touchend', this._onClick);
  }

  _createUI() {
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'game-status';
    this.container.appendChild(this.statusEl);

    this.warningEl = document.createElement('div');
    this.warningEl.className = 'game-warning hidden';
    this.warningEl.textContent = '⚠️ Unstable!';
    this.container.appendChild(this.warningEl);
  }

  _removeBlock(block) {
    block.removed = true;
    const mesh = this.meshes[block.id];

    // Animate block sliding out
    const dir = block.rotated ? new THREE.Vector3(0, 0, 3) : new THREE.Vector3(3, 0, 0);
    const startPos = mesh.position.clone();
    const endPos = startPos.clone().add(dir);
    let t = 0;
    const slide = () => {
      t += 0.05;
      mesh.position.lerpVectors(startPos, endPos, Math.min(t, 1));
      if (t < 1) requestAnimationFrame(slide);
      else {
        this.towerGroup.remove(mesh);
        delete this.meshes[block.id];
      }
    };
    slide();

    this.towerLean = computeTowerLean(this.blocks);
    this._updateInstability();
    this._fitCameraToCurrentHeight();

    if (checkCollapseConditions(this.blocks, this.towerLean)) {
      setTimeout(() => this._triggerCollapse(), 400);
    }
  }

  _updateInstability() {
    const lean = this.towerLean;

    if (lean > 0.3) {
      const r = Math.floor(lean * 80);
      this.ambientLight.color.setRGB((r + 180) / 255, 0.96, 0.88);
      this.warningEl.classList.remove('hidden');
    } else {
      this.ambientLight.color.set(0xfff5e0);
      this.warningEl.classList.add('hidden');
    }

    if (lean > 0.6) {
      this.warningEl.classList.add('critical');
    } else {
      this.warningEl.classList.remove('critical');
    }
  }

  _triggerCollapse() {
    if (this.collapsed) return;
    this.collapsed = true;
    this.warningEl.textContent = '💥 Tower Collapsed!';
    this.warningEl.classList.remove('hidden');
    this.warningEl.classList.add('critical');

    // Camera shake
    const startPos = this.camera.position.clone();
    let shakeT = 0;
    const shake = () => {
      shakeT += 0.1;
      this.camera.position.x = startPos.x + Math.sin(shakeT * 20) * 0.15 * (1 - shakeT);
      this.camera.position.y = startPos.y + Math.cos(shakeT * 18) * 0.1 * (1 - shakeT);
      if (shakeT < 1) requestAnimationFrame(shake);
      else this.camera.position.copy(startPos);
    };
    shake();

    // Scatter remaining blocks
    Object.values(this.meshes).forEach(mesh => {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.15,
        Math.random() * 0.1 + 0.05,
        (Math.random() - 0.5) * 0.15
      );
      const rot = new THREE.Vector3(
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1
      );
      this.collapsingMeshes.push({ mesh, vel, rot, gravity: -0.008 });
    });
    this.meshes = {};
  }

  _animate() {
    this.animFrame = requestAnimationFrame(() => this._animate());
    this.wobbleTime += 0.016;

    const lean = this.towerLean;

    // Wobble tower group
    if (!this.collapsed && lean > 0.3) {
      const factor = (lean - 0.3) / 0.7;
      const wobble = Math.sin(this.wobbleTime * 2) * 0.02 * factor * (1 + lean);
      this.towerGroup.rotation.x = wobble;
      this.towerGroup.rotation.z = Math.cos(this.wobbleTime * 1.7) * 0.015 * factor;
    } else if (!this.collapsed) {
      this.towerGroup.rotation.x = 0;
      this.towerGroup.rotation.z = 0;
    }

    // Hover highlight
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshList = Object.values(this.meshes);
    const hits = this.raycaster.intersectObjects(meshList);

    if (this.hoveredMesh && this.hoveredMesh.material) {
      const id = this.hoveredMesh.userData.blockId;
      const block = this.blocks.find(b => b.id === id);
      if (block && !block.removed) {
        this.hoveredMesh.material.color.set(0xd4a96a);
        this.hoveredMesh.material.emissive.set(0x000000);
      }
    }

    this.hoveredMesh = hits.length > 0 ? hits[0].object : null;

    if (this.hoveredMesh && this.hoveredMesh.material) {
      this.hoveredMesh.material.color.set(0xffcc80);
      this.hoveredMesh.material.emissive.set(0x221100);
    }

    // Collapse physics
    this.collapsingMeshes.forEach(item => {
      item.vel.y += item.gravity;
      item.mesh.position.add(item.vel);
      item.mesh.rotation.x += item.rot.x;
      item.mesh.rotation.y += item.rot.y;
      item.mesh.rotation.z += item.rot.z;
      if (item.mesh.position.y < -2) {
        item.mesh.visible = false;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  _handleResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  destroy() {
    cancelAnimationFrame(this.animFrame);
    window.removeEventListener('resize', this._onResize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousemove', this._onMouseMove);
    canvas.removeEventListener('touchmove', this._onTouchMove);
    canvas.removeEventListener('click', this._onClick);
    canvas.removeEventListener('touchend', this._onClick);
    this.renderer.dispose();
    if (this.container.contains(canvas)) this.container.removeChild(canvas);
    if (this.statusEl && this.container.contains(this.statusEl)) this.container.removeChild(this.statusEl);
    if (this.warningEl && this.container.contains(this.warningEl)) this.container.removeChild(this.warningEl);
  }
}

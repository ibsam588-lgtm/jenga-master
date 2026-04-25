import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import './App.css';

// ─── Tower constants ───────────────────────────────────────────────────────────
const BLOCK_LONG  = 1.5;
const BLOCK_SHORT = 0.5;
const BLOCK_H     = 0.27;
const BLOCK_GAP   = 0.03;
const INITIAL_ROWS = 18;
const WOOD_COLORS  = [0xC8A96E, 0xD4AF7A, 0xBE9960, 0xCFB485];

function woodColor(r, c) {
  return WOOD_COLORS[(r * 3 + c) % WOOD_COLORS.length];
}

// even rows: long axis = X, three blocks spaced along Z
// odd  rows: long axis = Z, three blocks spaced along X
function blockPos(r, c) {
  const isEven = r % 2 === 0;
  const y      = r * (BLOCK_H + 0.01);
  const offset = (c - 1) * (BLOCK_SHORT + BLOCK_GAP);
  return isEven ? [0, y, offset] : [offset, y, 0];
}

function makeBlockGeo(r) {
  const isEven = r % 2 === 0;
  return new THREE.BoxGeometry(
    isEven ? BLOCK_LONG  : BLOCK_SHORT,
    BLOCK_H,
    isEven ? BLOCK_SHORT : BLOCK_LONG
  );
}

function buildRows(n) {
  return Array.from({ length: n }, () => [
    { removed: false },
    { removed: false },
    { removed: false },
  ]);
}

// ─── Physics helpers ───────────────────────────────────────────────────────────
function computeLean(rows) {
  let lean = 0;
  const top = rows.length - 1;

  for (let r = 0; r < top; r++) {
    const a     = [0, 1, 2].map(c => !rows[r][c].removed);
    const count = a.filter(Boolean).length;
    if (count === 0) continue;

    // No center block → unstable row
    if (!a[1]) lean += 0.15;

    // Fewer blocks than the row directly above (insufficient support)
    if (r < top - 1) {
      const above = [0, 1, 2].filter(c => !rows[r + 1][c].removed).length;
      if (count < above) lean += 0.25;
    }
  }

  return Math.min(1.0, lean);
}

function shouldCollapse(rows, lean) {
  if (lean > 0.85) return true;

  const top = rows.length - 1;
  // Any non-top row with a complete gap
  for (let r = 0; r < top - 1; r++) {
    if ([0, 1, 2].every(c => rows[r][c].removed)) return true;
  }

  // Only 1 block left across the bottom 6 rows
  const bottom6 = rows.slice(0, Math.min(6, top));
  const total   = bottom6.reduce(
    (s, row) => s + [0, 1, 2].filter(c => !row[c].removed).length,
    0
  );
  return total <= 1;
}

// ─── GameScreen ────────────────────────────────────────────────────────────────
function GameScreen({ onExit }) {
  const mountRef = useRef(null);
  const apiRef   = useRef(null);

  const [ui, setUi] = useState({
    player:    1,
    lean:      0,
    unstable:  false,
    collapsed: false,
    winner:    0,
    selected:  false,
    msg:       "Player 1's Turn — tap a block",
  });

  useEffect(() => {
    const el = mountRef.current;
    const W  = window.innerWidth;
    const H  = window.innerHeight;

    // ── Scene ────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0e1c);

    // ── Camera ───────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    let basePos   = { x: 0, y: 2.5, z: 9 };
    let baseLookY = 2.5;
    camera.position.set(basePos.x, basePos.y, basePos.z);
    camera.lookAt(0, baseLookY, 0);

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    // ── Lights ───────────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xfff5dc, 0.7);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffd080, 1.3);
    sun.position.set(4, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const redGlow = new THREE.PointLight(0xff2200, 0, 12);
    redGlow.position.set(0, 3, 2);
    scene.add(redGlow);

    // ── Floor ────────────────────────────────────────────────────────────────
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(2.8, 2.8, 0.14, 40),
      new THREE.MeshLambertMaterial({ color: 0x3a1a06 })
    );
    floor.position.y = -0.07;
    floor.receiveShadow = true;
    scene.add(floor);

    // ── Tower ────────────────────────────────────────────────────────────────
    const towerGroup = new THREE.Group();
    scene.add(towerGroup);

    const rows = buildRows(INITIAL_ROWS);
    // bm[row][col] = THREE.Mesh
    const bm = rows.map((_, r) =>
      [0, 1, 2].map(c => {
        const mat  = new THREE.MeshLambertMaterial({ color: woodColor(r, c) });
        const mesh = new THREE.Mesh(makeBlockGeo(r), mat);
        const [px, py, pz] = blockPos(r, c);
        mesh.position.set(px, py, pz);
        mesh.castShadow    = true;
        mesh.receiveShadow = true;
        mesh.userData      = { row: r, col: c };
        towerGroup.add(mesh);
        return mesh;
      })
    );

    // ── fitCameraToTower ─────────────────────────────────────────────────────
    function fitCameraToTower() {
      const topY  = (rows.length - 1) * (BLOCK_H + 0.01) + BLOCK_H;
      const mid   = topY / 2;
      const dist  = Math.max(9, topY * 1.6 + 4);
      basePos     = { x: 0, y: mid + 0.5, z: dist };
      baseLookY   = mid;
      camera.position.set(basePos.x, basePos.y, basePos.z);
      camera.lookAt(0, baseLookY, 0);
      camera.aspect = el.clientWidth / el.clientHeight || W / H;
      camera.updateProjectionMatrix();
    }

    // ── addRowToTop ──────────────────────────────────────────────────────────
    function addRowToTop() {
      const r = rows.length;
      rows.push([{ removed: false }, { removed: false }, { removed: false }]);
      bm.push(
        [0, 1, 2].map(c => {
          const mat  = new THREE.MeshLambertMaterial({ color: woodColor(r, c) });
          const mesh = new THREE.Mesh(makeBlockGeo(r), mat);
          const [px, py, pz] = blockPos(r, c);
          mesh.position.set(px, py, pz);
          mesh.castShadow    = true;
          mesh.receiveShadow = true;
          mesh.userData      = { row: r, col: c };
          towerGroup.add(mesh);
          return mesh;
        })
      );
      fitCameraToTower();
    }

    // ── State ────────────────────────────────────────────────────────────────
    let selMesh   = null;
    let leanVal   = 0;
    let over      = false;
    let curPlayer = 1;

    function resetColor(mesh) {
      const { row, col } = mesh.userData;
      mesh.material.color.setHex(woodColor(row, col));
      mesh.material.emissive.setHex(0x000000);
    }

    function triggerCollapse() {
      over = true;
      const winner = curPlayer === 1 ? 2 : 1;
      setUi(u => ({ ...u, collapsed: true, winner, selected: false }));
      // Scatter all visible blocks
      bm.flat().filter(m => m.visible).forEach((mesh, i) => {
        setTimeout(() => {
          mesh.userData.falling = true;
          mesh.userData.fv = new THREE.Vector3(
            (Math.random() - 0.5) * 5,
            Math.random() * 4 + 1,
            (Math.random() - 0.5) * 5
          );
          mesh.userData.av = new THREE.Vector3(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10
          );
        }, i * 28);
      });
    }

    function doRemove(r, c) {
      if (over) return;
      rows[r][c].removed = true;
      bm[r][c].visible   = false;

      addRowToTop();

      leanVal = computeLean(rows);
      const unstable = leanVal > 0.6;

      if (shouldCollapse(rows, leanVal)) {
        triggerCollapse();
        return;
      }

      curPlayer = curPlayer === 1 ? 2 : 1;
      setUi(u => ({
        ...u,
        lean:     leanVal,
        unstable,
        player:   curPlayer,
        selected: false,
        msg:      `Player ${curPlayer}'s Turn — tap a block`,
      }));
    }

    // ── Pointer handler ──────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();

    function handlePointer(cx, cy) {
      if (over) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x =  ((cx - rect.left) / rect.width)  * 2 - 1;
      mouse.y = -((cy - rect.top)  / rect.height)  * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const visible = bm.flat().filter(m => m.visible);
      const hits    = raycaster.intersectObjects(visible);

      if (!hits.length) {
        if (selMesh) { resetColor(selMesh); selMesh = null; }
        setUi(u => ({ ...u, selected: false, msg: `Player ${curPlayer}'s Turn — tap a block` }));
        return;
      }

      const hit          = hits[0].object;
      const { row, col } = hit.userData;
      const topRow       = rows.length - 1;

      if (row >= topRow) return; // top row is off-limits

      if (selMesh === hit) {
        // Second tap = pull
        const m = selMesh;
        selMesh = null;
        resetColor(m);
        doRemove(row, col);
      } else {
        if (selMesh) resetColor(selMesh);
        selMesh = hit;
        hit.material = hit.material.clone();
        hit.material.color.setHex(0xffee44);
        hit.material.emissive.setHex(0x443300);
        setUi(u => ({ ...u, selected: true, msg: 'Tap again or press Pull to remove' }));
      }
    }

    function onClick(e)  { handlePointer(e.clientX, e.clientY); }
    function onTouch(e)  {
      e.preventDefault();
      const t = e.changedTouches[0];
      handlePointer(t.clientX, t.clientY);
    }
    el.addEventListener('click', onClick);
    el.addEventListener('touchend', onTouch, { passive: false });

    function onResize() {
      const nW = window.innerWidth;
      const nH = window.innerHeight;
      camera.aspect = nW / nH;
      camera.updateProjectionMatrix();
      renderer.setSize(nW, nH);
    }
    window.addEventListener('resize', onResize);

    // ── Animate ──────────────────────────────────────────────────────────────
    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      const t = Date.now();

      if (!over) {
        // Wobble tilt
        if (leanVal > 0.3) {
          towerGroup.rotation.z = Math.sin(t * 0.002) * 0.015 * leanVal;
        } else {
          towerGroup.rotation.z *= 0.93;
        }

        if (leanVal > 0.6) {
          // Stronger wobble on X too
          towerGroup.rotation.x = Math.sin(t * 0.0026 + 1.2) * 0.012 * leanVal;
          // Red ambient tint
          redGlow.intensity = leanVal * 2.8;
          ambient.color.setRGB(
            0.9 + leanVal * 0.25,
            0.85 - leanVal * 0.35,
            0.72 - leanVal * 0.5
          );
        } else {
          towerGroup.rotation.x *= 0.93;
          redGlow.intensity = redGlow.intensity * 0.95;
          if (redGlow.intensity < 0.01) redGlow.intensity = 0;
        }

        // Camera shake at critical lean
        if (leanVal > 0.85) {
          camera.position.x = basePos.x + Math.sin(t * 0.032) * 0.07;
          camera.position.y = basePos.y + Math.sin(t * 0.021) * 0.045;
        } else {
          // Smoothly return
          camera.position.x += (basePos.x - camera.position.x) * 0.08;
          camera.position.y += (basePos.y - camera.position.y) * 0.08;
        }
      } else {
        // Falling physics
        bm.flat().forEach(m => {
          if (!m.userData.falling) return;
          const dt = 0.016;
          m.userData.fv.y -= 12 * dt;
          m.position.addScaledVector(m.userData.fv, dt);
          m.rotation.x += m.userData.av.x * dt;
          m.rotation.y += m.userData.av.y * dt;
          m.rotation.z += m.userData.av.z * dt;
        });
      }

      renderer.render(scene, camera);
    }
    animate();

    // Expose imperative API to React UI
    apiRef.current = {
      pull: () => {
        if (selMesh && !over) {
          const { row, col } = selMesh.userData;
          const m = selMesh;
          selMesh = null;
          resetColor(m);
          doRemove(row, col);
        }
      },
      cancel: () => {
        if (selMesh) {
          resetColor(selMesh);
          selMesh = null;
          setUi(u => ({ ...u, selected: false, msg: `Player ${curPlayer}'s Turn — tap a block` }));
        }
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('click', onClick);
      el.removeEventListener('touchend', onTouch);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="game-screen">
      {/* HUD */}
      <div className="game-hud">
        <button className="hud-back" onClick={onExit}>← Menu</button>
        <div className="hud-turn">{ui.msg}</div>
        {ui.unstable && <div className="hud-warn">⚠️ Unstable!</div>}
        <div className="lean-bar">
          <div
            className="lean-fill"
            style={{
              width:      `${ui.lean * 100}%`,
              background: ui.lean > 0.6 ? '#ff3333' : ui.lean > 0.3 ? '#ffaa00' : '#44cc44',
            }}
          />
        </div>
      </div>

      {/* Three.js canvas mount */}
      <div ref={mountRef} className="game-canvas" />

      {/* Pull / Cancel bar */}
      {ui.selected && !ui.collapsed && (
        <div className="pull-bar">
          <button className="btn-pull"   onClick={() => apiRef.current?.pull()}>Pull Block</button>
          <button className="btn-cancel" onClick={() => apiRef.current?.cancel()}>Cancel</button>
        </div>
      )}

      {/* Collapse overlay */}
      {ui.collapsed && (
        <div className="collapse-overlay">
          <div className="collapse-card">
            <div className="collapse-emoji">💥</div>
            <h2>Tower Collapsed!</h2>
            <p>Player {ui.winner} wins!</p>
            <button className="btn-again" onClick={onExit}>Back to Menu</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HomeScreen ────────────────────────────────────────────────────────────────
function HomeScreen({ onPlay }) {
  const footerItems = [
    ['🏆', 'Profile'],
    ['🛒', 'Store'],
    ['🎁', 'Daily Reward'],
    ['🔊', 'Sound'],
  ];

  return (
    <div className="home-screen">
      <div className="bg-grain" />
      <div className="bg-block bb1" />
      <div className="bg-block bb2" />
      <div className="bg-block bb3" />

      <header className="home-header">
        <div className="block-logo">
          <div className="logo-row lr-even"><span /><span /><span /></div>
          <div className="logo-row lr-odd" ><span /><span /><span /></div>
          <div className="logo-row lr-even"><span /><span /><span /></div>
        </div>
        <h1 className="home-title">JENGA MASTER</h1>
        <p className="home-tagline">Stack. Pull. Survive.</p>
      </header>

      <nav className="home-menu">
        <button className="wood-btn primary" onClick={onPlay}>▶ Play vs Opponent</button>
        <button className="wood-btn"         onClick={onPlay}>⚡ Quick Match</button>
        <button className="wood-btn"         onClick={onPlay}>🚪 Create Room</button>
        <button className="wood-btn"         onClick={onPlay}>🔗 Join Room</button>
      </nav>

      <footer className="home-footer">
        {footerItems.map(([icon, label]) => (
          <button key={label} className="icon-btn">
            <span className="icon-emoji">{icon}</span>
            <span className="icon-label">{label}</span>
          </button>
        ))}
      </footer>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [screen, setScreen] = useState('home');

  return (
    <div className="App">
      {screen === 'home'
        ? <HomeScreen onPlay={() => setScreen('game')} />
        : <GameScreen onExit={() => setScreen('home')} />
      }
    </div>
  );
}

export default App;

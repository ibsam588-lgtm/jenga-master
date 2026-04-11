import React, { useState, useRef, useEffect, Component } from 'react';
import './App.css';

// ── Error Boundary ────────────────────────────────────────────────────────────
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to console so it appears in adb logcat
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', padding: '2rem',
          background: '#1a1a2e', color: '#fff', textAlign: 'center'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💥</div>
          <h2 style={{ marginBottom: '0.5rem' }}>Something went wrong</h2>
          <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '0.75rem 2rem', borderRadius: '8px', border: 'none',
              background: '#e63946', color: '#fff', fontSize: '1rem', cursor: 'pointer'
            }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKS_PER_ROW = 3;
const INITIAL_ROWS = 18;

function createInitialTower() {
  return Array.from({ length: INITIAL_ROWS }, () =>
    Array(BLOCKS_PER_ROW).fill(true)
  );
}

// Returns index of the highest row with at least one block, or -1 if all empty
function getTopRow(tower) {
  for (let r = tower.length - 1; r >= 0; r--) {
    if (tower[r].some(b => b)) return r;
  }
  return -1;
}

// Returns the row where the next placed block should go:
// the topmost incomplete row if it has <3 blocks, or a new row above if full
function getPlacementRow(tower) {
  const top = getTopRow(tower);
  if (top < 0) return 0;
  const full = tower[top].every(b => b);
  return full ? top + 1 : top;
}

// Tower is stable if no empty row exists below a non-empty row (no structural gaps)
function isStable(tower) {
  const top = getTopRow(tower);
  if (top < 0) return true;
  let hadEmpty = false;
  for (let r = 0; r <= top; r++) {
    const empty = tower[r].every(b => !b);
    if (empty) {
      hadEmpty = true;
    } else if (hadEmpty) {
      return false; // non-empty row above a gap = structural failure
    }
  }
  return true;
}

export default function App() {
  const [tower, setTower] = useState(createInitialTower);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [selected, setSelected] = useState(null); // { row, col }
  const [phase, setPhase] = useState('remove'); // 'remove' | 'place' | 'gameover'
  const [loser, setLoser] = useState(null);
  const [hint, setHint] = useState('');
  const towerScrollRef = useRef(null);

  const topRow = getTopRow(tower);
  const placementRow = getPlacementRow(tower);

  // When entering place phase, scroll to top so placement zone is visible
  useEffect(() => {
    if (phase === 'place' && towerScrollRef.current) {
      towerScrollRef.current.scrollTop = 0;
    }
  }, [phase]);

  // Handle Android hardware back button via Capacitor's ionBackButton event.
  // Without this, pressing back on a SPA can navigate to a blank WebView shell.
  useEffect(() => {
    const handleBackButton = (ev) => {
      try {
        // Register at priority 10; higher priorities (e.g. modals) take precedence.
        ev.detail.register(10, () => {
          if (phase === 'gameover') {
            // On game-over screen, back resets instead of exiting
            resetGame();
          }
          // During active play, swallow the event to prevent accidental exit.
          // The user must use the "New Game" button or device home to leave.
        });
      } catch (err) {
        console.warn('[BackButton] handler error:', err);
      }
    };

    document.addEventListener('ionBackButton', handleBackButton);
    return () => document.removeEventListener('ionBackButton', handleBackButton);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleBlockClick(row, col) {
    if (phase !== 'remove') return;
    if (!tower[row][col]) return; // slot is already empty

    // Cannot remove from the current top row
    if (row === topRow) {
      setHint("Can't remove from the top level!");
      return;
    }

    if (selected && selected.row === row && selected.col === col) {
      // Second tap on the same block: confirm removal
      const newTower = tower.map((r, ri) =>
        r.map((b, ci) => (ri === row && ci === col ? false : b))
      );

      if (!isStable(newTower)) {
        // Tower collapses — current player loses
        setTower(newTower);
        setLoser(currentPlayer);
        setPhase('gameover');
        setSelected(null);
        setHint('');
        return;
      }

      setTower(newTower);
      setSelected(null);
      setPhase('place');
      setHint('Tap a slot at the top to place your block');
    } else {
      // First tap: select the block
      setSelected({ row, col });
      setHint('Tap the highlighted block again to confirm removal');
    }
  }

  function handlePlaceClick(col) {
    if (phase !== 'place') return;

    // Check if the target slot is already occupied
    if (placementRow < tower.length && tower[placementRow][col]) {
      setHint('That spot is taken — pick another!');
      return;
    }

    let newTower;
    if (placementRow >= tower.length) {
      // Extend tower with a new row
      const newRow = Array(BLOCKS_PER_ROW).fill(false);
      newRow[col] = true;
      newTower = [...tower, newRow];
    } else {
      newTower = tower.map((r, ri) =>
        r.map((b, ci) => (ri === placementRow && ci === col ? true : b))
      );
    }

    setTower(newTower);
    setPhase('remove');
    setCurrentPlayer(p => (p === 1 ? 2 : 1));
    setHint('');
  }

  function resetGame() {
    setTower(createInitialTower());
    setCurrentPlayer(1);
    setSelected(null);
    setPhase('remove');
    setLoser(null);
    setHint('');
  }

  // Render tower top-to-bottom visually by reversing the array
  const displayRows = [...tower].reverse();

  const playerColors = { 1: '#e63946', 2: '#457b9d' };
  const currentColor = playerColors[currentPlayer];

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header" style={{ borderBottom: `3px solid ${currentColor}` }}>
        <h1 className="title">Classic Jenga</h1>
        {phase !== 'gameover' && (
          <div className="status">
            <span className="player-badge" style={{ background: currentColor }}>
              P{currentPlayer}
            </span>
            <span className="status-text">
              {phase === 'remove' ? 'Remove a block' : 'Place your block on top'}
            </span>
          </div>
        )}
        {hint && <p className="hint">{hint}</p>}
      </header>

      {/* ── Game-Over Overlay ── */}
      {phase === 'gameover' && (
        <div className="gameover">
          <div className="gameover-card">
            <div className="gameover-icon">💥</div>
            <h2>Tower Collapsed!</h2>
            <p>Player {loser} caused the collapse</p>
            <p className="winner">🏆 Player {loser === 1 ? 2 : 1} Wins!</p>
            <button className="btn-primary" onClick={resetGame}>
              Play Again
            </button>
          </div>
        </div>
      )}

      {/* ── Placement Zone (only visible during place phase) ── */}
      {phase === 'place' && (
        <section className="placement-zone">
          <p className="placement-label">↓ Choose where to place your block</p>
          <div className="placement-row">
            {Array(BLOCKS_PER_ROW)
              .fill(null)
              .map((_, col) => {
                const occupied =
                  placementRow < tower.length && tower[placementRow][col];
                return (
                  <button
                    key={col}
                    className={`place-btn ${
                      occupied ? 'place-btn--occupied' : 'place-btn--empty'
                    }`}
                    onClick={() => handlePlaceClick(col)}
                    disabled={!!occupied}
                    aria-label={occupied ? 'Occupied' : `Place in slot ${col + 1}`}
                  >
                    {occupied ? '' : '+'}
                  </button>
                );
              })}
          </div>
        </section>
      )}

      {/* ── Tower ── */}
      <main className="tower-scroll" ref={towerScrollRef}>
        <div className="tower">
          {displayRows.map((row, displayIdx) => {
            const rowIdx = tower.length - 1 - displayIdx;
            const isTop = rowIdx === topRow;
            // Alternate block orientation each row (visual differentiation)
            const isHoriz = rowIdx % 2 === 0;

            return (
              <div
                key={rowIdx}
                className={`row ${isHoriz ? 'row--h' : 'row--v'} ${
                  isTop ? 'row--top' : ''
                }`}
              >
                {row.map((present, col) => {
                  if (!present) {
                    return (
                      <div
                        key={col}
                        className="block block--empty"
                        aria-hidden="true"
                      />
                    );
                  }

                  const isSelected =
                    selected?.row === rowIdx && selected?.col === col;
                  const canRemove = phase === 'remove' && rowIdx !== topRow;

                  return (
                    <button
                      key={col}
                      className={`block ${isSelected ? 'block--selected' : ''} ${
                        isTop ? 'block--top' : ''
                      } ${canRemove ? 'block--removable' : ''}`}
                      onClick={() => handleBlockClick(rowIdx, col)}
                      disabled={phase !== 'remove' || !canRemove}
                      aria-label={`Block row ${rowIdx + 1} slot ${col + 1}`}
                      aria-pressed={isSelected}
                    >
                      <span
                        className={`grain grain--${isHoriz ? 'h' : 'v'}`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </main>

      {/* ── Footer ── */}
      {phase !== 'gameover' && (
        <footer className="footer">
          <button className="btn-secondary" onClick={resetGame}>
            New Game
          </button>
        </footer>
      )}
    </div>
  );
}

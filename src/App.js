import React, { useState, useRef, useEffect, useCallback, Component } from 'react';
import Peer from 'peerjs';
import './App.css';

// ═══════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ═══════════════════════════════════════════════════════════════════════════
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-screen">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GAME LOGIC
// ═══════════════════════════════════════════════════════════════════════════
const BLOCKS_PER_ROW = 3;
const INITIAL_ROWS = 18;

function createInitialTower() {
  return Array.from({ length: INITIAL_ROWS }, () => Array(BLOCKS_PER_ROW).fill(true));
}

function getTopRow(tower) {
  for (let r = tower.length - 1; r >= 0; r--) {
    if (tower[r].some(b => b)) return r;
  }
  return -1;
}

function getPlacementRow(tower) {
  const top = getTopRow(tower);
  if (top < 0) return 0;
  return tower[top].every(b => b) ? top + 1 : top;
}

function isStable(tower) {
  const top = getTopRow(tower);
  if (top < 0) return true;
  let hadEmpty = false;
  for (let r = 0; r <= top; r++) {
    const empty = tower[r].every(b => !b);
    if (empty) hadEmpty = true;
    else if (hadEmpty) return false;
  }
  return true;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

// Returns list of safe (non-collapsing) moves for AI; falls back to any valid move.
function getAISafeMoves(tower, topRow) {
  const safe = [], any = [];
  for (let row = 0; row < tower.length; row++) {
    if (row === topRow) continue;
    for (let col = 0; col < BLOCKS_PER_ROW; col++) {
      if (!tower[row][col]) continue;
      any.push({ row, col });
      const next = tower.map((r, ri) => r.map((b, ci) => ri === row && ci === col ? false : b));
      if (isStable(next)) safe.push({ row, col });
    }
  }
  return safe.length > 0 ? safe : any;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  // Navigation
  const [screen, setScreen] = useState('home');

  // Multiplayer
  const [mode, setMode] = useState(null);        // 'local' | 'online' | 'ai'
  const [role, setRole] = useState(null);         // 'host' | 'guest'
  const [roomCode, setRoomCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState('');
  const [copied, setCopied] = useState(false);
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
  const towerRef = useRef(null);
  // Refs for the back-button handler so it can always see fresh values without
  // re-registering the listener on every render (re-registration leaves a brief
  // window where back navigates the WebView to about:blank).
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const goHomeRef = useRef(null);

  // Derived
  const topRow = getTopRow(tower);
  const placementRow = getPlacementRow(tower);
  const isMyTurn = mode === 'local' || currentPlayer === myPlayer;

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      connRef.current?.close();
      peerRef.current?.destroy();
    };
  }, []);

  // ── Android back button — registered once, reads current values via refs ──
  useEffect(() => {
    const handler = (ev) => {
      try {
        ev.detail.register(10, () => {
          if (screenRef.current !== 'home') goHomeRef.current?.();
        });
      } catch (e) { /* ignore */ }
    };
    document.addEventListener('ionBackButton', handler);
    return () => document.removeEventListener('ionBackButton', handler);
  }, []);

  // ── Scroll to top of tower when placing ──
  useEffect(() => {
    if (phase === 'place' && towerRef.current) {
      const towerEl = towerRef.current.querySelector('.tower');
      if (towerEl) {
        const offset = towerEl.offsetTop - towerRef.current.offsetTop;
        towerRef.current.scrollTop = Math.max(0, offset - 8);
      } else {
        towerRef.current.scrollTop = 0;
      }
    }
  }, [phase]);

  // ── AI auto-play (player 2) ──
  useEffect(() => {
    if (mode !== 'ai' || currentPlayer !== 2 || phase === 'gameover') return;

    let outerTimer, innerTimer;
    if (phase === 'remove') {
      // 1-2 second "thinking" delay before selecting a block
      outerTimer = setTimeout(() => {
        const top = getTopRow(tower);
        const moves = getAISafeMoves(tower, top);
        if (!moves.length) return;

        // Prefer edge columns (0 or 2) — middle is structurally safest in real Jenga
        const edgeMoves = moves.filter(m => m.col !== 1);
        const pool = edgeMoves.length > 0 ? edgeMoves : moves;
        const move = pool[Math.floor(Math.random() * pool.length)];

        setSelected({ row: move.row, col: move.col });
        setHint('AI is thinking...');

        // Brief pause after "selection" before executing the removal
        innerTimer = setTimeout(() => {
          const newTower = tower.map((r, ri) =>
            r.map((b, ci) => ri === move.row && ci === move.col ? false : b)
          );
          setSelected(null);
          if (!isStable(newTower)) {
            setTower(newTower);
            setLoser(2);
            setPhase('gameover');
            setHint('');
          } else {
            setTower(newTower);
            setPhase('place');
            setHint('AI is placing...');
          }
        }, 600);
      }, 1000 + Math.random() * 1000);
    } else if (phase === 'place') {
      outerTimer = setTimeout(() => {
        const pr = getPlacementRow(tower);
        const available = [];
        for (let col = 0; col < BLOCKS_PER_ROW; col++) {
          if (!(pr < tower.length && tower[pr][col])) available.push(col);
        }
        if (!available.length) return;

        // Prefer middle column for balance
        const col = available.includes(1) ? 1 : available[Math.floor(Math.random() * available.length)];

        let newTower;
        if (pr >= tower.length) {
          const newRow = Array(BLOCKS_PER_ROW).fill(false);
          newRow[col] = true;
          newTower = [...tower, newRow];
        } else {
          newTower = tower.map((r, ri) =>
            r.map((b, ci) => ri === pr && ci === col ? true : b)
          );
        }

        setTower(newTower);
        setPhase('remove');
        setCurrentPlayer(1);
        setHint('Your turn!');
        innerTimer = setTimeout(() => setHint(''), 1500);
      }, 600 + Math.random() * 600);
    }

    return () => { clearTimeout(outerTimer); clearTimeout(innerTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase, currentPlayer, tower]);

  // ── Stable game state reset ──
  const resetGameState = useCallback(() => {
    setTower(createInitialTower());
    setCurrentPlayer(1);
    setPhase('remove');
    setLoser(null);
    setSelected(null);
    setHint('');
  }, []);

  // ── Network message handler ──
  const handleMessage = useCallback((data) => {
    if (data.type === 'state') {
      setTower(data.tower);
      setCurrentPlayer(data.currentPlayer);
      setPhase(data.phase);
      setLoser(data.loser);
      setSelected(null);
      setHint('');
    } else if (data.type === 'restart') {
      resetGameState();
    }
  }, [resetGameState]);

  // ── Send state to opponent ──
  const sendState = useCallback((t, cp, ph, l) => {
    if (connRef.current?.open) {
      connRef.current.send({ type: 'state', tower: t, currentPlayer: cp, phase: ph, loser: l });
    }
  }, []);

  // ── Setup PeerJS data connection ──
  function setupConn(conn, isHost) {
    connRef.current = conn;
    conn.on('open', () => {
      setConnected(true);
      setScreen('game');
      if (isHost) {
        const t = createInitialTower();
        setTower(t);
        setCurrentPlayer(1);
        setPhase('remove');
        setLoser(null);
        conn.send({ type: 'state', tower: t, currentPlayer: 1, phase: 'remove', loser: null });
      }
    });
    conn.on('data', handleMessage);
    conn.on('close', () => {
      setConnected(false);
      setHint('Opponent disconnected');
    });
  }

  // ── Create Room (Host) ──
  function createRoom() {
    const code = generateRoomCode();
    setRoomCode(code);
    setRole('host');
    setMode('online');
    setMyPlayer(1);
    setScreen('lobby');
    setConnError('');

    const peer = new Peer(`jenga-${code}`, { debug: 0 });
    peerRef.current = peer;

    peer.on('open', () => { /* peer ready */ });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        createRoom();
      } else {
        setConnError('Connection error. Please try again.');
      }
    });
    peer.on('connection', (conn) => setupConn(conn, true));
  }

  // ── Join Room (Guest) ──
  function joinRoom() {
    const code = joinInput.toUpperCase().trim();
    if (code.length < 4) {
      setConnError('Enter a valid room code');
      return;
    }
    setRoomCode(code);
    setRole('guest');
    setMode('online');
    setMyPlayer(2);
    setScreen('lobby');
    setConnError('');

    const peer = new Peer(undefined, { debug: 0 });
    peerRef.current = peer;

    peer.on('open', () => {
      const conn = peer.connect(`jenga-${code}`, { reliable: true });
      setupConn(conn, false);
      setTimeout(() => {
        if (!connRef.current?.open) {
          setConnError('Could not find room. Check the code and try again.');
        }
      }, 10000);
    });
    peer.on('error', () => {
      setConnError('Connection failed. Check the code and try again.');
    });
  }

  // ── Start Local Game ──
  function startLocal() {
    setMode('local');
    setMyPlayer(1);
    resetGameState();
    setScreen('game');
  }

  // ── Start vs AI ──
  function startAI() {
    setMode('ai');
    setMyPlayer(1);
    resetGameState();
    setScreen('game');
  }

  // ── Game Actions ──
  function handleBlockClick(row, col) {
    if (phase !== 'remove' || !isMyTurn) return;
    if (!tower[row][col]) return;
    if (row === topRow) {
      setHint("Can't remove from the top row!");
      return;
    }

    if (selected?.row === row && selected?.col === col) {
      const newTower = tower.map((r, ri) =>
        r.map((b, ci) => (ri === row && ci === col ? false : b))
      );

      if (!isStable(newTower)) {
        setTower(newTower);
        setLoser(currentPlayer);
        setPhase('gameover');
        setSelected(null);
        setHint('');
        sendState(newTower, currentPlayer, 'gameover', currentPlayer);
        return;
      }

      setTower(newTower);
      setSelected(null);
      setPhase('place');
      setHint('Now place your block on top');
      sendState(newTower, currentPlayer, 'place', null);
    } else {
      setSelected({ row, col });
      setHint('Tap again to confirm removal');
    }
  }

  function handlePlaceClick(col) {
    if (phase !== 'place' || !isMyTurn) return;
    if (placementRow < tower.length && tower[placementRow][col]) {
      setHint('Spot taken — try another!');
      return;
    }

    let newTower;
    if (placementRow >= tower.length) {
      const newRow = Array(BLOCKS_PER_ROW).fill(false);
      newRow[col] = true;
      newTower = [...tower, newRow];
    } else {
      newTower = tower.map((r, ri) =>
        r.map((b, ci) => (ri === placementRow && ci === col ? true : b))
      );
    }

    const next = currentPlayer === 1 ? 2 : 1;
    setTower(newTower);
    setPhase('remove');
    setCurrentPlayer(next);
    setHint('');
    sendState(newTower, next, 'remove', null);
  }

  function resetGame() {
    resetGameState();
    if (mode === 'online' && connRef.current?.open) {
      connRef.current.send({ type: 'restart' });
    }
  }

  const goHome = useCallback(() => {
    connRef.current?.close();
    peerRef.current?.destroy();
    peerRef.current = null;
    connRef.current = null;
    setScreen('home');
    setMode(null);
    setRole(null);
    setRoomCode('');
    setJoinInput('');
    setConnected(false);
    setConnError('');
    setMyPlayer(null);
    setCopied(false);
    resetGameState();
  }, [resetGameState]);
  goHomeRef.current = goHome;

  function copyCode() {
    navigator.clipboard?.writeText(roomCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  // ── HOME ──
  if (screen === 'home') {
    return (
      <div className="app screen-home">
        <div className="home-content">
          <div className="home-tower">
            {[...Array(8)].map((_, i) => (
              <div key={i} className={`home-row ${i % 2 === 0 ? 'home-row--h' : 'home-row--v'}`}>
                <div className="home-block" />
                <div className="home-block" />
                <div className="home-block" />
              </div>
            ))}
          </div>
          <h1 className="home-title">JENGA</h1>
          <p className="home-subtitle">Classic Tower Game</p>
          <div className="home-actions">
            <button className="btn btn-accent" onClick={() => setScreen('online-menu')}>
              Play Online
            </button>
            <button className="btn btn-wood" onClick={startAI}>
              vs Computer
            </button>
            <button className="btn btn-ghost" onClick={startLocal}>
              Local 2 Players
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ONLINE MENU ──
  if (screen === 'online-menu') {
    return (
      <div className="app screen-online">
        <button className="nav-back" onClick={goHome}>&larr; Back</button>
        <div className="online-content">
          <h2>Play Online</h2>
          <button className="btn btn-accent btn-lg" onClick={createRoom}>
            Create Game
          </button>
          <div className="divider"><span>or join a friend</span></div>
          <input
            className="code-input"
            type="text"
            placeholder="ROOM CODE"
            value={joinInput}
            onChange={e => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            maxLength={5}
          />
          <button
            className="btn btn-wood btn-lg"
            onClick={joinRoom}
            disabled={joinInput.length < 4}
          >
            Join Game
          </button>
          {connError && <p className="error-msg">{connError}</p>}
        </div>
      </div>
    );
  }

  // ── LOBBY ──
  if (screen === 'lobby') {
    return (
      <div className="app screen-lobby">
        <button className="nav-back" onClick={goHome}>&larr; Back</button>
        <div className="lobby-content">
          {role === 'host' ? (
            <>
              <p className="lobby-label">Share this code with your friend</p>
              <div className="room-code-display" onClick={copyCode}>
                {roomCode}
              </div>
              <p className="copy-hint">{copied ? 'Copied!' : 'Tap code to copy'}</p>
              <div className="waiting">
                <div className="pulse-dot" />
                <span>Waiting for opponent...</span>
              </div>
            </>
          ) : (
            <>
              <p className="lobby-label">Joining room</p>
              <div className="room-code-display">{roomCode}</div>
              <div className="waiting">
                <div className="pulse-dot" />
                <span>Connecting...</span>
              </div>
            </>
          )}
          {connError && <p className="error-msg">{connError}</p>}
        </div>
      </div>
    );
  }

  // ── GAME SCREEN ──
  const displayRows = [...tower].reverse();
  const P1 = '#E8584A';
  const P2 = '#4A90BF';

  return (
    <div className="app screen-game">
      {/* Header */}
      <header className="game-header">
        <div className="header-row">
          <button className="nav-exit" onClick={goHome}>Exit</button>
          <span className="game-logo">JENGA</span>
          {mode === 'online' ? (
            <span className={`conn-badge ${connected ? '' : 'offline'}`}>
              {connected ? 'Online' : 'Offline'}
            </span>
          ) : mode === 'ai' ? (
            <span className="conn-badge">vs AI</span>
          ) : <span className="conn-badge">Local</span>}
        </div>
        <div className="player-bar">
          <div className={`player-tag ${currentPlayer === 1 ? 'active' : ''}`}>
            <span className="player-dot" style={{ background: P1 }} />
            <span>{mode === 'local' ? 'Player 1' : mode === 'ai' ? 'You' : myPlayer === 1 ? 'You' : 'Opponent'}</span>
          </div>
          <div className="turn-indicator">
            {phase === 'gameover'
              ? 'Game Over'
              : isMyTurn
              ? phase === 'remove'
                ? 'Remove a block'
                : 'Place on top'
              : mode === 'ai' ? 'AI thinking...' : "Opponent's turn..."}
          </div>
          <div className={`player-tag ${currentPlayer === 2 ? 'active' : ''}`}>
            <span>{mode === 'local' ? 'Player 2' : mode === 'ai' ? 'AI' : myPlayer === 2 ? 'You' : 'Opponent'}</span>
            <span className="player-dot" style={{ background: P2 }} />
          </div>
        </div>
        {hint && <p className="game-hint">{hint}</p>}
      </header>

      {/* Game Over Overlay */}
      {phase === 'gameover' && (
        <div className="gameover-overlay">
          <div className="gameover-card">
            <div className="crash-text">CRASH!</div>
            <h2>Tower Collapsed!</h2>
            <p className="go-detail">
              {mode === 'local'
                ? `Player ${loser} knocked it over`
                : mode === 'ai'
                ? loser === 1 ? 'You knocked it over!' : 'AI knocked it over!'
                : loser === myPlayer
                ? 'You knocked it over!'
                : 'Your opponent knocked it over!'}
            </p>
            <p className="go-winner">
              {mode === 'local'
                ? `Player ${loser === 1 ? 2 : 1} Wins!`
                : mode === 'ai'
                ? loser === 1 ? 'AI Wins!' : 'You Win!'
                : loser === myPlayer
                ? 'You Lose!'
                : 'You Win!'}
            </p>
            <button className="btn btn-accent" onClick={resetGame}>Play Again</button>
            <button className="btn btn-ghost" onClick={goHome} style={{ marginTop: 10 }}>Home</button>
          </div>
        </div>
      )}

      {/* Placement Zone */}
      {phase === 'place' && isMyTurn && (
        <div className="place-zone">
          <p className="place-label">Place your block</p>
          <div className="place-slots">
            {Array(BLOCKS_PER_ROW).fill(null).map((_, col) => {
              const taken = placementRow < tower.length && tower[placementRow][col];
              return (
                <button
                  key={col}
                  className={`place-slot ${taken ? 'taken' : ''}`}
                  onClick={() => handlePlaceClick(col)}
                  disabled={!!taken}
                >
                  {taken ? '' : '+'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Waiting bar when opponent is placing */}
      {phase === 'place' && !isMyTurn && (
        <div className="waiting-bar">
          <span>{mode === 'ai' ? 'AI is placing a block...' : 'Opponent is placing a block...'}</span>
        </div>
      )}

      {/* Tower */}
      <main className="tower-area" ref={towerRef}>
        <div className="tower-3d">
          <div className="tower">
            {displayRows.map((row, displayIdx) => {
              const rowIdx = tower.length - 1 - displayIdx;
              const isTop = rowIdx === topRow;
              const isHoriz = rowIdx % 2 === 0;

              return (
                <div
                  key={rowIdx}
                  className={`t-row ${isHoriz ? 't-row--h' : 't-row--v'} ${isTop ? 't-row--top' : ''}`}
                >
                  {row.map((present, col) => {
                    if (!present) {
                      return <div key={col} className="t-block t-block--empty" />;
                    }
                    const isSel = selected?.row === rowIdx && selected?.col === col;
                    const canRem = phase === 'remove' && isMyTurn && rowIdx !== topRow;

                    return (
                      <button
                        key={col}
                        className={`t-block ${isHoriz ? 't-block--h' : 't-block--v'} ${
                          isSel ? 't-block--sel' : ''} ${
                          isTop ? 't-block--top' : ''} ${
                          canRem ? 't-block--can' : ''}`}
                        onClick={() => handleBlockClick(rowIdx, col)}
                        disabled={!canRem}
                      >
                        <span className={`t-grain ${isHoriz ? 't-grain--h' : 't-grain--v'}`} />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="table-top">
            <div className="table-shadow" />
          </div>
        </div>
      </main>
    </div>
  );
}

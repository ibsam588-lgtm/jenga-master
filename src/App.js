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
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const BLOCKS_PER_ROW = 3;
const INITIAL_ROWS = 18;
const STORAGE_KEY = 'jenga_profile';

const RANKS = [
  { name: 'ROOKIE', xp: 0, icon: '🪵' },
  { name: 'STACKER', xp: 100, icon: '🧱' },
  { name: 'BUILDER', xp: 300, icon: '🔨' },
  { name: 'ARCHITECT', xp: 600, icon: '📐' },
  { name: 'ENGINEER', xp: 1000, icon: '⚙️' },
  { name: 'MASTER', xp: 1600, icon: '🏗️' },
  { name: 'GRANDMASTER', xp: 2500, icon: '🏛️' },
  { name: 'CHAMPION', xp: 4000, icon: '🏆' },
  { name: 'LEGEND', xp: 6000, icon: '👑' },
  { name: 'IMMORTAL', xp: 10000, icon: '⭐' },
];

const COUNTRIES = [
  '🇺🇸 USA', '🇬🇧 UK', '🇩🇪 Germany', '🇫🇷 France', '🇷🇺 Russia',
  '🇨🇳 China', '🇯🇵 Japan', '🇰🇷 S. Korea', '🇮🇳 India', '🇧🇷 Brazil',
  '🇦🇺 Australia', '🇨🇦 Canada', '🇵🇰 Pakistan', '🇿🇦 S. Africa',
  '🇲🇽 Mexico', '🇸🇦 Saudi Arabia', '🇪🇬 Egypt', '🇳🇬 Nigeria',
  '🇮🇩 Indonesia', '🇵🇭 Philippines', '🇹🇷 Turkey', '🇮🇹 Italy',
  '🇪🇸 Spain', '🇦🇷 Argentina', '🇨🇴 Colombia',
];

const AVATARS = ['🪵', '🏗️', '🧱', '🔨', '📐', '⚙️', '🏛️', '🏆', '👑', '⭐'];

const REWARD_WIN = { xp: 50, coins: 25 };
const REWARD_LOSS = { xp: 15, coins: 5 };

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveProfile(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function createProfile(name, country, avatar) {
  return {
    name, country, avatar,
    xp: 0, coins: 0, score: 0,
    wins: 0, losses: 0, streak: 0, bestStreak: 0,
    gamesPlayed: 0, created: Date.now(),
  };
}

function getRank(xp) {
  let r = RANKS[0];
  for (const rank of RANKS) { if (xp >= rank.xp) r = rank; }
  return r;
}

function getNextRank(xp) {
  for (const rank of RANKS) { if (xp < rank.xp) return rank; }
  return null;
}

function getRankProgress(xp) {
  const current = getRank(xp);
  const next = getNextRank(xp);
  if (!next) return 1;
  return Math.min(1, (xp - current.xp) / (next.xp - current.xp));
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════
const BOT_NAMES = [
  'BlockMaster', 'TowerKing', 'WoodChuck', 'StackQueen', 'JengaPro',
  'SteadyHand', 'TopStacker', 'WoodNinja', 'TowerBoss', 'BlockAce',
  'PullKing', 'StackLord', 'TowerGod', 'WoodSage', 'BlockWiz',
  'JengaKid', 'TowerNerd', 'WoodPunk', 'StackBro', 'PullMaster',
];

function generateLeaderboard(profile) {
  const LB_KEY = 'jenga_leaderboard';
  let lb;
  try { lb = JSON.parse(localStorage.getItem(LB_KEY)); } catch { lb = null; }
  if (!lb || !Array.isArray(lb) || lb.length < 15) {
    lb = BOT_NAMES.map((n, i) => ({
      name: n,
      country: COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)],
      score: Math.max(0, 2000 - i * 80 + Math.floor(Math.random() * 100)),
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      isBot: true,
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

// ═══════════════════════════════════════════════════════════════════════════
// GAME LOGIC
// ═══════════════════════════════════════════════════════════════════════════
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
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

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
  const [profile, setProfile] = useState(() => loadProfile());
  const [regName, setRegName] = useState('');
  const [regCountry, setRegCountry] = useState('');
  const [regAvatar, setRegAvatar] = useState('🪵');
  const [screen, setScreen] = useState(profile ? 'hq' : 'splash');
  const [mode, setMode] = useState(null);
  const [role, setRole] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState('');
  const [copied, setCopied] = useState(false);
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const [tower, setTower] = useState(createInitialTower);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [selected, setSelected] = useState(null);
  const [phase, setPhase] = useState('remove');
  const [loser, setLoser] = useState(null);
  const [hint, setHint] = useState('');
  const [myPlayer, setMyPlayer] = useState(null);
  const [movesThisGame, setMovesThisGame] = useState(0);
  const [rewardShown, setRewardShown] = useState(null);
  const towerRef = useRef(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const goHomeRef = useRef(null);

  const topRow = getTopRow(tower);
  const placementRow = getPlacementRow(tower);
  const isMyTurn = mode === 'local' || currentPlayer === myPlayer;

  useEffect(() => { if (profile) saveProfile(profile); }, [profile]);

  useEffect(() => {
    if (screen === 'splash') {
      const t = setTimeout(() => setScreen(profile ? 'hq' : 'register'), 2200);
      return () => clearTimeout(t);
    }
  }, [screen, profile]);

  useEffect(() => { return () => { connRef.current?.close(); peerRef.current?.destroy(); }; }, []);

  useEffect(() => {
    const handler = (ev) => {
      try { ev.detail.register(10, () => { if (!['hq','splash','register'].includes(screenRef.current)) goHomeRef.current?.(); }); } catch {}
    };
    document.addEventListener('ionBackButton', handler);
    return () => document.removeEventListener('ionBackButton', handler);
  }, []);

  useEffect(() => {
    if (!towerRef.current || screen !== 'game') return;
    requestAnimationFrame(() => {
      if (!towerRef.current) return;
      if (phase === 'place') towerRef.current.scrollTop = 0;
      else towerRef.current.scrollTop = towerRef.current.scrollHeight;
    });
  }, [screen, phase]);

  // AI
  useEffect(() => {
    if (mode !== 'ai' || currentPlayer !== 2 || phase === 'gameover') return;
    let t1, t2;
    if (phase === 'remove') {
      t1 = setTimeout(() => {
        const top = getTopRow(tower);
        const moves = getAISafeMoves(tower, top);
        if (!moves.length) return;
        const withSib = moves.filter(m => tower[m.row].filter(b => b).length > 1);
        const pool = withSib.length > 0 ? withSib : moves;
        const move = Math.random() < 0.2 ? moves[Math.floor(Math.random() * moves.length)] : pool[Math.floor(Math.random() * pool.length)];
        setSelected({ row: move.row, col: move.col });
        setHint('AI is thinking...');
        t2 = setTimeout(() => {
          const nt = tower.map((r, ri) => r.map((b, ci) => ri === move.row && ci === move.col ? false : b));
          setSelected(null);
          if (!isStable(nt)) {
            setTower(nt); setLoser(2); setPhase('gameover'); setHint('');
            applyReward(2);
          } else { setTower(nt); setPhase('place'); setHint('AI is placing...'); }
        }, 600);
      }, 1000 + Math.random() * 1000);
    } else if (phase === 'place') {
      t1 = setTimeout(() => {
        const pr = getPlacementRow(tower);
        const avail = [];
        for (let c = 0; c < BLOCKS_PER_ROW; c++) { if (!(pr < tower.length && tower[pr][c])) avail.push(c); }
        if (!avail.length) return;
        const col = avail.includes(1) ? 1 : avail[Math.floor(Math.random() * avail.length)];
        let nt;
        if (pr >= tower.length) { const nr = Array(BLOCKS_PER_ROW).fill(false); nr[col] = true; nt = [...tower, nr]; }
        else { nt = tower.map((r, ri) => r.map((b, ci) => ri === pr && ci === col ? true : b)); }
        setTower(nt); setPhase('remove'); setCurrentPlayer(1); setHint('Your turn!');
      }, 600 + Math.random() * 600);
    }
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase, currentPlayer, tower]);

  function applyReward(losingPlayer) {
    if (!profile) return;
    const isWin = (mode === 'ai' && losingPlayer === 2) || (mode === 'online' && losingPlayer !== myPlayer) || (mode === 'local' && losingPlayer === 2);
    const reward = isWin ? REWARD_WIN : REWARD_LOSS;
    const bonus = Math.min(movesThisGame * 2, 30);
    const totalXP = reward.xp + bonus;
    const totalCoins = reward.coins + Math.floor(bonus / 2);
    const scoreGain = isWin ? 50 + bonus : Math.max(0, bonus - 10);
    setProfile(prev => {
      const ns = isWin ? prev.streak + 1 : 0;
      return { ...prev, xp: prev.xp + totalXP, coins: prev.coins + totalCoins, score: prev.score + scoreGain,
        wins: prev.wins + (isWin ? 1 : 0), losses: prev.losses + (isWin ? 0 : 1),
        streak: ns, bestStreak: Math.max(prev.bestStreak, ns), gamesPlayed: prev.gamesPlayed + 1 };
    });
    setRewardShown({ xp: totalXP, coins: totalCoins, score: scoreGain, isWin });
  }

  function register() {
    if (!regName.trim() || !regCountry) return;
    const p = createProfile(regName.trim(), regCountry, regAvatar);
    setProfile(p); saveProfile(p); setScreen('hq');
  }

  const resetGameState = useCallback(() => {
    setTower(createInitialTower()); setCurrentPlayer(1); setPhase('remove');
    setLoser(null); setSelected(null); setHint(''); setMovesThisGame(0); setRewardShown(null);
  }, []);

  const handleMessage = useCallback((data) => {
    if (data.type === 'state') {
      setTower(data.tower); setCurrentPlayer(data.currentPlayer); setPhase(data.phase);
      setLoser(data.loser); setSelected(null); setHint('');
      if (data.loser) applyReward(data.loser);
    } else if (data.type === 'restart') resetGameState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetGameState]);

  const sendState = useCallback((t, cp, ph, l) => {
    if (connRef.current?.open) connRef.current.send({ type: 'state', tower: t, currentPlayer: cp, phase: ph, loser: l });
  }, []);

  function setupConn(conn, isHost) {
    connRef.current = conn;
    conn.on('open', () => { setConnected(true); setScreen('game');
      if (isHost) { const t = createInitialTower(); setTower(t); setCurrentPlayer(1); setPhase('remove'); setLoser(null);
        conn.send({ type: 'state', tower: t, currentPlayer: 1, phase: 'remove', loser: null }); }
    });
    conn.on('data', handleMessage);
    conn.on('close', () => { setConnected(false); setHint('Opponent disconnected'); });
  }

  function createRoom() {
    const code = generateRoomCode(); setRoomCode(code); setRole('host'); setMode('online'); setMyPlayer(1); setScreen('lobby'); setConnError('');
    const peer = new Peer(`jenga-${code}`, { debug: 0 }); peerRef.current = peer;
    peer.on('open', () => {});
    peer.on('error', (err) => { if (err.type === 'unavailable-id') { peer.destroy(); createRoom(); } else setConnError('Connection error.'); });
    peer.on('connection', (conn) => setupConn(conn, true));
  }

  function joinRoom() {
    const code = joinInput.toUpperCase().trim();
    if (code.length < 4) { setConnError('Enter a valid room code'); return; }
    setRoomCode(code); setRole('guest'); setMode('online'); setMyPlayer(2); setScreen('lobby'); setConnError('');
    const peer = new Peer(undefined, { debug: 0 }); peerRef.current = peer;
    peer.on('open', () => { const conn = peer.connect(`jenga-${code}`, { reliable: true }); setupConn(conn, false);
      setTimeout(() => { if (!connRef.current?.open) setConnError('Could not find room.'); }, 10000); });
    peer.on('error', () => setConnError('Connection failed.'));
  }

  function startLocal() { setMode('local'); setMyPlayer(1); resetGameState(); setScreen('game'); }
  function startAI() { setMode('ai'); setMyPlayer(1); resetGameState(); setScreen('game'); }

  function handleBlockClick(row, col) {
    if (phase !== 'remove' || !isMyTurn || !tower[row][col]) return;
    if (row === topRow) { setHint("Can't remove from the top row!"); return; }
    if (selected?.row === row && selected?.col === col) {
      const nt = tower.map((r, ri) => r.map((b, ci) => (ri === row && ci === col ? false : b)));
      if (!isStable(nt)) {
        setTower(nt); setLoser(currentPlayer); setPhase('gameover'); setSelected(null); setHint('');
        sendState(nt, currentPlayer, 'gameover', currentPlayer); applyReward(currentPlayer); return;
      }
      setTower(nt); setSelected(null); setPhase('place'); setHint('Now place your block on top');
      setMovesThisGame(m => m + 1); sendState(nt, currentPlayer, 'place', null);
    } else { setSelected({ row, col }); setHint('Tap again to confirm removal'); }
  }

  function handlePlaceClick(col) {
    if (phase !== 'place' || !isMyTurn) return;
    if (placementRow < tower.length && tower[placementRow][col]) { setHint('Spot taken!'); return; }
    let nt;
    if (placementRow >= tower.length) { const nr = Array(BLOCKS_PER_ROW).fill(false); nr[col] = true; nt = [...tower, nr]; }
    else { nt = tower.map((r, ri) => r.map((b, ci) => (ri === placementRow && ci === col ? true : b))); }
    const next = currentPlayer === 1 ? 2 : 1;
    setTower(nt); setPhase('remove'); setCurrentPlayer(next); setHint('');
    sendState(nt, next, 'remove', null);
  }

  function resetGame() { resetGameState(); if (mode === 'online' && connRef.current?.open) connRef.current.send({ type: 'restart' }); }

  const goHome = useCallback(() => {
    connRef.current?.close(); peerRef.current?.destroy(); peerRef.current = null; connRef.current = null;
    setScreen('hq'); setMode(null); setRole(null); setRoomCode(''); setJoinInput('');
    setConnected(false); setConnError(''); setMyPlayer(null); setCopied(false); resetGameState();
  }, [resetGameState]);
  goHomeRef.current = goHome;

  function copyCode() { navigator.clipboard?.writeText(roomCode).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  // SPLASH
  if (screen === 'splash') {
    return (
      <div className="app screen-splash">
        <div className="splash-tower">
          {[...Array(6)].map((_, i) => (
            <div key={i} className={`splash-row ${i % 2 === 0 ? 'splash-row--h' : 'splash-row--v'}`} style={{ animationDelay: `${i * 0.12}s` }}>
              <div className="splash-block" /><div className="splash-block" /><div className="splash-block" />
            </div>
          ))}
        </div>
        <h1 className="splash-title">JENGA</h1>
        <p className="splash-sub">TOWER MASTER</p>
        <div className="splash-loader"><div className="splash-loader-bar" /></div>
      </div>
    );
  }

  // REGISTER
  if (screen === 'register') {
    return (
      <div className="app screen-register">
        <div className="reg-content">
          <h1 className="reg-title">JOIN THE TOWER</h1>
          <p className="reg-sub">Set up your profile to start stacking!</p>
          <label className="field-label">YOUR NAME</label>
          <input className="field-input" type="text" placeholder="TowerMaster" value={regName} onChange={e => setRegName(e.target.value.slice(0, 16))} maxLength={16} />
          <label className="field-label">YOUR COUNTRY</label>
          <select className="field-select" value={regCountry} onChange={e => setRegCountry(e.target.value)}>
            <option value="">— Pick Country —</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="field-label">PICK YOUR ICON</label>
          <div className="avatar-grid">
            {AVATARS.map(a => (<div key={a} className={`av-opt ${regAvatar === a ? 'av-opt--active' : ''}`} onClick={() => setRegAvatar(a)}>{a}</div>))}
          </div>
          <button className="btn btn-accent btn-lg" onClick={register} disabled={!regName.trim() || !regCountry}>START STACKING!</button>
        </div>
      </div>
    );
  }

  // HQ
  if (screen === 'hq' && profile) {
    const rank = getRank(profile.xp);
    const nextRank = getNextRank(profile.xp);
    const progress = getRankProgress(profile.xp);
    const winRate = profile.gamesPlayed > 0 ? Math.round((profile.wins / profile.gamesPlayed) * 100) : 0;
    return (
      <div className="app screen-hq">
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
          <div className="xp-bar"><div className="xp-fill" style={{ width: `${progress * 100}%` }} /></div>
          {nextRank && <div className="xp-next">Next: {nextRank.icon} {nextRank.name}</div>}
        </div>
        <div className="stats-strip">
          <div className="stat-box"><div className="stat-n">{profile.wins}</div><div className="stat-l">WINS</div></div>
          <div className="stat-box"><div className="stat-n">{profile.losses}</div><div className="stat-l">LOSSES</div></div>
          <div className="stat-box"><div className="stat-n">{profile.streak > 0 ? `${profile.streak}🔥` : '0'}</div><div className="stat-l">STREAK</div></div>
          <div className="stat-box"><div className="stat-n">{winRate}%</div><div className="stat-l">WIN %</div></div>
        </div>
        <div className="currency-strip">
          <div className="currency-box"><span className="currency-icon">🪙</span><span className="currency-val">{profile.coins}</span><span className="currency-label">COINS</span></div>
          <div className="currency-box"><span className="currency-icon">⭐</span><span className="currency-val">{profile.score}</span><span className="currency-label">SCORE</span></div>
        </div>
        <div className="hq-actions">
          <button className="btn btn-accent btn-lg" onClick={startAI}>⚔️ vs COMPUTER</button>
          <button className="btn btn-wood btn-lg" onClick={() => setScreen('online-menu')}>🌐 PLAY ONLINE</button>
          <button className="btn btn-ghost" onClick={startLocal}>👥 LOCAL 2 PLAYERS</button>
        </div>
        <div className="hq-nav">
          <button className="hq-nav-btn" onClick={() => setScreen('leaderboard')}><span className="hq-nav-icon">🏆</span><span>Leaderboard</span></button>
          <button className="hq-nav-btn" onClick={() => setScreen('stats')}><span className="hq-nav-icon">📊</span><span>Stats</span></button>
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
            <div key={i} className={`lb-row ${!entry.isBot ? 'lb-row--me' : ''}`}>
              <span className="lb-pos">#{i + 1}</span>
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
        <div className="stats-card"><div className="stats-avatar">{profile.avatar}</div><div className="stats-name">{profile.name}</div><div className="stats-rank">{rank.icon} {rank.name}</div></div>
        <div className="stats-grid">
          <div className="sg-item"><div className="sg-n">{profile.gamesPlayed}</div><div className="sg-l">Games Played</div></div>
          <div className="sg-item"><div className="sg-n">{profile.wins}</div><div className="sg-l">Wins</div></div>
          <div className="sg-item"><div className="sg-n">{profile.losses}</div><div className="sg-l">Losses</div></div>
          <div className="sg-item"><div className="sg-n">{profile.bestStreak}</div><div className="sg-l">Best Streak</div></div>
          <div className="sg-item"><div className="sg-n">{profile.xp}</div><div className="sg-l">Total XP</div></div>
          <div className="sg-item"><div className="sg-n">{profile.coins}</div><div className="sg-l">Total Coins</div></div>
          <div className="sg-item"><div className="sg-n">{profile.score}</div><div className="sg-l">Score</div></div>
          <div className="sg-item"><div className="sg-n">{profile.gamesPlayed > 0 ? Math.round((profile.wins / profile.gamesPlayed) * 100) : 0}%</div><div className="sg-l">Win Rate</div></div>
        </div>
      </div>
    );
  }

  // ONLINE MENU
  if (screen === 'online-menu') {
    return (
      <div className="app screen-online">
        <button className="nav-back" onClick={goHome}>&larr; Back</button>
        <div className="online-content">
          <h2>Play Online</h2>
          <button className="btn btn-accent btn-lg" onClick={createRoom}>Create Game</button>
          <div className="divider"><span>or join a friend</span></div>
          <input className="code-input" type="text" placeholder="ROOM CODE" value={joinInput} onChange={e => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={5} />
          <button className="btn btn-wood btn-lg" onClick={joinRoom} disabled={joinInput.length < 4}>Join Game</button>
          {connError && <p className="error-msg">{connError}</p>}
        </div>
      </div>
    );
  }

  // LOBBY
  if (screen === 'lobby') {
    return (
      <div className="app screen-lobby">
        <button className="nav-back" onClick={goHome}>&larr; Back</button>
        <div className="lobby-content">
          {role === 'host' ? (<>
            <p className="lobby-label">Share this code with your friend</p>
            <div className="room-code-display" onClick={copyCode}>{roomCode}</div>
            <p className="copy-hint">{copied ? 'Copied!' : 'Tap code to copy'}</p>
            <div className="waiting"><div className="pulse-dot" /><span>Waiting for opponent...</span></div>
          </>) : (<>
            <p className="lobby-label">Joining room</p>
            <div className="room-code-display">{roomCode}</div>
            <div className="waiting"><div className="pulse-dot" /><span>Connecting...</span></div>
          </>)}
          {connError && <p className="error-msg">{connError}</p>}
        </div>
      </div>
    );
  }

  // GAME SCREEN
  if (screen !== 'game') return null;
  const displayRows = [...tower].reverse();
  const P1 = '#E8584A', P2 = '#4A90BF';

  return (
    <div className="app screen-game">
      <header className="game-header">
        <div className="header-row">
          <button className="nav-exit" onClick={goHome}>Exit</button>
          <span className="game-logo">JENGA</span>
          <div className="header-right">
            {profile && <span className="hdr-coin">🪙 {profile.coins}</span>}
            <span className={`conn-badge ${mode === 'online' ? (connected ? '' : 'offline') : ''}`}>
              {mode === 'online' ? (connected ? 'Online' : 'Offline') : mode === 'ai' ? 'vs AI' : 'Local'}
            </span>
          </div>
        </div>
        <div className="player-bar">
          <div className={`player-tag ${currentPlayer === 1 ? 'active' : ''}`}>
            <span className="player-dot" style={{ background: P1 }} />
            <span>{mode === 'local' ? 'Player 1' : mode === 'ai' ? (profile?.name || 'You') : myPlayer === 1 ? 'You' : 'Opponent'}</span>
          </div>
          <div className="turn-indicator">
            {phase === 'gameover' ? 'Game Over' : isMyTurn ? (phase === 'remove' ? 'Remove a block' : 'Place on top') : mode === 'ai' ? 'AI thinking...' : "Opponent's turn..."}
          </div>
          <div className={`player-tag ${currentPlayer === 2 ? 'active' : ''}`}>
            <span>{mode === 'local' ? 'Player 2' : mode === 'ai' ? 'AI' : myPlayer === 2 ? 'You' : 'Opponent'}</span>
            <span className="player-dot" style={{ background: P2 }} />
          </div>
        </div>
        {hint && <p className="game-hint">{hint}</p>}
      </header>

      {phase === 'gameover' && (
        <div className="gameover-overlay">
          <div className="gameover-card">
            <div className="crash-text">CRASH!</div>
            <h2>Tower Collapsed!</h2>
            <p className="go-detail">
              {mode === 'local' ? `Player ${loser} knocked it over` : mode === 'ai' ? (loser === 1 ? 'You knocked it over!' : 'AI knocked it over!') : (loser === myPlayer ? 'You knocked it over!' : 'Your opponent knocked it over!')}
            </p>
            <p className="go-winner">
              {mode === 'local' ? `Player ${loser === 1 ? 2 : 1} Wins!` : mode === 'ai' ? (loser === 1 ? 'AI Wins!' : 'You Win!') : (loser === myPlayer ? 'You Lose!' : 'You Win!')}
            </p>
            {rewardShown && (
              <div className="reward-strip">
                <div className="reward-item"><span className="reward-icon">⚡</span><span className="reward-val">+{rewardShown.xp} XP</span></div>
                <div className="reward-item"><span className="reward-icon">🪙</span><span className="reward-val">+{rewardShown.coins}</span></div>
                <div className="reward-item"><span className="reward-icon">⭐</span><span className="reward-val">+{rewardShown.score}</span></div>
              </div>
            )}
            <button className="btn btn-accent" onClick={resetGame}>Play Again</button>
            <button className="btn btn-ghost" onClick={goHome} style={{ marginTop: 10 }}>Home</button>
          </div>
        </div>
      )}

      {phase === 'place' && isMyTurn && (
        <div className="place-zone">
          <p className="place-label">Place your block</p>
          <div className="place-slots">
            {Array(BLOCKS_PER_ROW).fill(null).map((_, col) => {
              const taken = placementRow < tower.length && tower[placementRow][col];
              return (<button key={col} className={`place-slot ${taken ? 'taken' : ''}`} onClick={() => handlePlaceClick(col)} disabled={!!taken}>{taken ? '' : '+'}</button>);
            })}
          </div>
        </div>
      )}

      {phase === 'place' && !isMyTurn && (
        <div className="waiting-bar"><span>{mode === 'ai' ? 'AI is placing a block...' : 'Opponent is placing a block...'}</span></div>
      )}

      <main className="tower-area" ref={towerRef}>
        <div className="tower-3d">
          <div className="tower">
            {displayRows.map((row, displayIdx) => {
              const rowIdx = tower.length - 1 - displayIdx;
              const isTop = rowIdx === topRow;
              const isHoriz = rowIdx % 2 === 0;
              return (
                <div key={rowIdx} className={`t-row ${isHoriz ? 't-row--h' : 't-row--v'} ${isTop ? 't-row--top' : ''}`}>
                  {row.map((present, col) => {
                    if (!present) return <div key={col} className="t-block t-block--empty" />;
                    const isSel = selected?.row === rowIdx && selected?.col === col;
                    const canRem = phase === 'remove' && isMyTurn && rowIdx !== topRow;
                    return (
                      <button key={col}
                        className={`t-block ${isHoriz ? 't-block--h' : 't-block--v'} ${isSel ? 't-block--sel' : ''} ${isTop ? 't-block--top' : ''} ${canRem ? 't-block--can' : ''}`}
                        onClick={() => handleBlockClick(rowIdx, col)} disabled={!canRem}>
                        <span className={`t-grain ${isHoriz ? 't-grain--h' : 't-grain--v'}`} />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="table-top"><div className="table-shadow" /></div>
        </div>
      </main>
    </div>
  );
}

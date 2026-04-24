# Jenga Master

A full-featured Jenga tower game built with React + Capacitor for Android deployment.

## Features

### Core Gameplay
- **3 Game Modes**: vs AI, Local 2-Player, Online Multiplayer (PeerJS)
- **18-row tower** with alternating horizontal/vertical block orientation
- **Remove & place** mechanics with stability checking
- **AI opponent** with smart move selection and difficulty scaling
- **Online multiplayer** via PeerJS with room codes

### Profile & Progression (NEW)
- **Registration**: Name, country (25 countries with flags), avatar picker
- **Rank System**: 10 ranks from Rookie → Immortal based on XP
- **XP & Coins**: Earned after every game (more for wins + bonus per move)
- **Score System**: Cumulative score tracked across sessions
- **Win/Loss Tracking**: Wins, losses, streak, best streak, win rate

### Social Features (NEW)
- **Leaderboard**: Global leaderboard sorted by score with country flags
- **Stats Screen**: Full career stats grid (games played, best streak, total XP, etc.)
- **Profile Card**: Shows avatar, name, country, rank on HQ screen

### Visual Design (NEW)
- **Bangers font** with bold cartoon/comic style
- **Animated splash screen** with tower build animation
- **Thick outlines** on all blocks and UI elements
- **Reward popups** showing XP, coins, and score earned after each game
- **3D perspective tower** with wood grain textures

### Technical
- **Capacitor** wrapper for Android APK builds
- **PeerJS** for peer-to-peer online multiplayer
- **localStorage** for persistent profile, stats, and leaderboard data
- **Android back button** support via `ionBackButton` events
- **Responsive** design for mobile screens

## Getting Started

```bash
npm install
npm start        # Development server
npm run build    # Production build
```

### Android Build

```bash
npx cap sync
npx cap open android   # Opens in Android Studio
```

## Screens

1. **Splash** → Animated tower build + loading bar
2. **Register** → Name, country, avatar setup (first launch only)
3. **HQ** → Profile card, XP bar, stats, coins/score, play buttons
4. **Game** → Full tower with header, placement zone, game-over overlay
5. **Leaderboard** → Top 25 players by score
6. **Stats** → Detailed career statistics
7. **Online Menu** → Create/Join room with code
8. **Lobby** → Waiting for opponent with room code display

## Rank Progression

| Rank | XP Required | Icon |
|------|-------------|------|
| Rookie | 0 | 🪵 |
| Stacker | 100 | 🧱 |
| Builder | 300 | 🔨 |
| Architect | 600 | 📐 |
| Engineer | 1,000 | ⚙️ |
| Master | 1,600 | 🏗️ |
| Grandmaster | 2,500 | 🏛️ |
| Champion | 4,000 | 🏆 |
| Legend | 6,000 | 👑 |
| Immortal | 10,000 | ⭐ |

## CI/CD

GitHub Actions automatically builds and deploys to Google Play internal testing on every push to `main`. The workflow:

1. Builds the React app
2. Syncs with Capacitor
3. Generates app icons
4. Builds a signed AAB
5. Uploads to Play Console internal track (auto-rolls out to testers)

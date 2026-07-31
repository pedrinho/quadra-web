# Quadra Web - Phase 1

This is the web conversion of the original Quadra game, currently in Phase 1 development.

## Overview

Phase 1 focuses on setting up the basic infrastructure for the web version:

- ✅ Modern web development environment (Vite + TypeScript)
- ✅ Core game engine architecture
- ✅ Basic rendering system (WebGL + Canvas 2D fallback)
- ✅ Input handling (keyboard, mouse, touch)
- ✅ Audio system (Web Audio API)
- ✅ Network infrastructure (WebSocket ready)
- ✅ Asset management system

## Project Structure

```
src/
├── main.ts                 # Main entry point
├── index.html             # HTML template
├── engine/
│   └── GameEngine.ts      # Core game engine
├── renderer/
│   └── Renderer.ts        # WebGL/Canvas rendering
├── input/
│   └── InputManager.ts    # Input handling
├── audio/
│   └── AudioManager.ts    # Audio system
├── network/
│   └── NetworkManager.ts  # Network communication
└── assets/
    └── AssetManager.ts    # Asset loading and caching
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Open browser to `http://localhost:3000`

## Development

- **Build**: `npm run build`
- **Preview**: `npm run preview`
- **Lint**: `npm run lint`
- **Type Check**: `npm run type-check`

## Current Status

The basic infrastructure is in place and the game will:
- Initialize all systems
- Show a loading screen
- Switch to menu state when ready
- Display a black canvas (rendering placeholder)

## Next Steps (Phase 2)

1. Port core game mechanics
2. Implement asset loading from original game files
3. Add basic UI components
4. Create game state management
5. Implement basic rendering of game elements

## Technical Notes

- Uses WebGL with Canvas 2D fallback for maximum compatibility
- Supports keyboard, mouse, and touch input
- Web Audio API for sound effects and music
- WebSocket-ready for multiplayer functionality
- TypeScript for type safety and better development experience
- Vite for fast development and building

## Browser Support

- Modern browsers with WebGL support
- Fallback to Canvas 2D for older browsers
- Touch support for mobile devices
- Web Audio API for sound (with graceful degradation) 
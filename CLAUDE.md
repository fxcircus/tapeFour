# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TapeFour is a web-based 4-track audio recorder that simulates vintage tape recording with modern digital features. Built with React, TypeScript, and Web Audio API.

## Essential Commands

```bash
# Development (from tapefour-react directory)
cd tapefour-react
npm run dev        # Start dev server on localhost:3000

# Build & Deployment
npm run build      # TypeScript compile + Vite production build
npm run lint       # Run ESLint
npm run preview    # Preview production build
npm run deploy     # Deploy to GitHub Pages at /tapeFour/
```

## Architecture Overview

### Core Audio Engine: `src/lib/TapeFour.ts`
The heart of the application - handles all audio processing via Web Audio API:
- 4-track recording/playback management
- Real-time effects (reverse, half-speed)
- Waveform visualization data
- Mix/master export via JSZip
- Audio context and device management

### Main UI Component: `src/App.tsx`
Provides the vintage tape recorder interface:
- Visual tape reel animations using CSS transforms
- 4-track mixer with volume faders and pan knobs
- Transport controls (play, record, stop)
- Theme system (5 themes stored in localStorage)
- Settings modal for audio device configuration
- Keyboard shortcuts (A=Play, Q=Record, W=Stop, etc.)

### Key State Management Pattern
The app uses React hooks with refs for audio objects:
```typescript
const [isPlaying, setIsPlaying] = useState(false);
const tapeFourRef = useRef<TapeFour | null>(null);
```
Audio state changes trigger React re-renders for UI updates.

### Deployment Configuration
- Vite config sets base path to `/tapeFour/` for GitHub Pages
- The root `index.html` redirects to `tapefour-react/`
- Deploy script uses `gh-pages` package

## Important Development Notes

1. **Audio Context**: Initialize TapeFour only after user interaction due to browser autoplay policies
2. **Web Workers**: Used for audio processing (WAV encoding, effects)
3. **Testing**: Full test suite with Vitest - run `npm test`
4. **Themes**: CSS variables defined in `:root` and theme-specific selectors
5. **Local Storage**: Used for theme, count-in, and volume preferences
6. **Debug Logging**: Disabled in production, configurable in development via .env.local
7. **Resource Limits**: 
   - Max recording duration: 10 minutes
   - Max recording buffer: 500MB
   - Max undo history: 10 steps per track
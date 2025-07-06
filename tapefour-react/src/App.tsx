import { useEffect, useRef, useState } from 'react'
import TapeFour from './lib/TapeFour'
import Metronome from './components/Metronome'

type Theme = 'vintage' | 'indie' | 'disco' | 'dark' | '808'

function App() {
  const tapeFourRef = useRef<TapeFour | null>(null)
  const [currentTheme, setCurrentTheme] = useState<Theme>('vintage')
  const [bpm, setBpm] = useState(120)
  const [metronomePlaying, setMetronomePlaying] = useState(false)

  useEffect(() => {
    tapeFourRef.current = new TapeFour()
    // Set the metronome stop callback
    tapeFourRef.current.setMetronomeStopCallback(() => {
      setMetronomePlaying(false);
    });
    // Set the metronome start callback
    tapeFourRef.current.setMetronomeStartCallback(() => {
      setMetronomePlaying(true);
    });
    return () => {
      tapeFourRef.current = null
    }
  }, [])

  // Load saved theme from localStorage on component mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('tapefour-theme') as Theme | null
    if (savedTheme && ['vintage', 'indie', 'disco', 'dark', '808'].includes(savedTheme)) {
      setCurrentTheme(savedTheme)
      document.documentElement.setAttribute('data-theme', savedTheme)
    }
  }, [])

  const handleThemeChange = (theme: Theme) => {
    setCurrentTheme(theme)
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('tapefour-theme', theme)
  }

  const handleOpenSettings = () => {
    tapeFourRef.current?.openSettings()
  }

  const handleStop = () => {
    // ... any existing stop logic ...
    setMetronomePlaying(false) // Stop metronome if playing
  }

  return (
    <div className="recorder-container">
      {/* <div className="header">
        <span>TapeFour</span>
      </div> */}

      <div className="cassette-display">
        <svg className="tape-reel left-reel" id="left-reel" width="104" height="104" viewBox="0 0 104 104">
          <defs>
            {/* Cassette reel gradient for realistic metallic appearance */}
            <radialGradient id="cassette-gradient" cx="0.3" cy="0.3" r="0.8">
              <stop offset="0%" stopColor="hsl(200, 35%, 75%)" />
              <stop offset="40%" stopColor="hsl(200, 40%, 65%)" />
              <stop offset="70%" stopColor="hsl(200, 45%, 55%)" />
              <stop offset="100%" stopColor="hsl(200, 50%, 45%)" />
            </radialGradient>
            

            
            {/* Vintage theme - traditional reel slots */}
            <mask id="vintage-slots-left">
              <rect width="104" height="104" fill="white" />
              <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" />
              <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" transform="rotate(120 52 52)" />
              <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" transform="rotate(240 52 52)" />
            </mask>
            {/* Indie theme - simplified cassette cogwheel */}
            <mask id="cassette-holes-left">
              <rect width="104" height="104" fill="white" />
              {/* Central cogwheel/gear hole - like real cassettes */}
              <circle cx="52" cy="52" r="12" fill="black" />
              {/* Gear teeth - 6 rectangular notches around the center */}
              <rect x="50" y="28" width="4" height="8" fill="black" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(60 52 52)" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(120 52 52)" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(180 52 52)" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(240 52 52)" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(300 52 52)" />
            </mask>
          </defs>
          <g className="reel">
            <circle className="reel-base" cx="52" cy="52" r="50" fill="var(--color-track-well)" />
            {/* Vintage reel face */}
            <circle className="reel-face vintage-reel" cx="52" cy="52" r="50" fill="var(--reel-mid)" mask="url(#vintage-slots-left)" />
            {/* Indie reel face */}
            <circle className="reel-face indie-reel" cx="52" cy="52" r="50" fill="var(--reel-mid)" mask="url(#cassette-holes-left)" />
            {/* Disco neon reel - transparent with glowing concentric rings */}
            <g className="disco-reel">
              <circle className="neon-ring-outer" cx="52" cy="52" r="48" fill="none" stroke="hsl(180, 100%, 75%)" strokeWidth="0.5" opacity="0.6" />
              <circle className="neon-ring-mid" cx="52" cy="52" r="40" fill="none" stroke="hsl(320, 100%, 70%)" strokeWidth="0.3" opacity="0.8" />
              <circle className="neon-ring-inner" cx="52" cy="52" r="32" fill="none" stroke="hsl(280, 100%, 80%)" strokeWidth="0.2" opacity="0.5" />
              <circle className="neon-plate" cx="52" cy="52" r="50" fill="hsla(310, 80%, 20%, 0.1)" stroke="hsl(340, 100%, 75%)" strokeWidth="1" />
            </g>
            {/* 808 turntable record */}
            <g className="turntable-reel">
              {/* Vinyl record base */}
              <circle className="vinyl-record" cx="52" cy="52" r="50" fill="hsl(0, 0%, 8%)" stroke="hsl(0, 0%, 15%)" strokeWidth="0.5" />
              {/* Record grooves */}
              <circle className="record-groove" cx="52" cy="52" r="45" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.6" />
              <circle className="record-groove" cx="52" cy="52" r="40" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.4" />
              <circle className="record-groove" cx="52" cy="52" r="35" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.3" />
              <circle className="record-groove" cx="52" cy="52" r="30" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.2" />
              {/* Center label */}
              <circle className="record-label" cx="52" cy="52" r="20" fill="hsl(20, 100%, 55%)" stroke="hsl(20, 100%, 45%)" strokeWidth="1" />
              <circle className="label-ring" cx="52" cy="52" r="15" fill="none" stroke="hsl(20, 80%, 40%)" strokeWidth="0.5" />
              <text className="label-text" x="52" y="56" textAnchor="middle" fill="hsl(45, 100%, 85%)" fontSize="7" fontWeight="bold">Make</text>
            </g>
            {/* Dark theme radial bars */}
            <g className="radial-bars">
              {/* 8 radial bars positioned around the center */}
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(45 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(90 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(135 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(180 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(225 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(270 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(315 52 52)" />
            </g>
            <circle className="reel-rim" cx="52" cy="52" r="50" />
            {/* Vintage hub (larger) */}
            <circle className="reel-hub vintage-hub" cx="52" cy="52" r="14" fill="var(--reel-hub)" />
            {/* Indie hub (cogwheel center) */}
            <circle className="reel-hub indie-hub" cx="52" cy="52" r="8" fill="var(--reel-hub)" />
            {/* Disco neon hub */}
            <circle className="reel-hub disco-hub" cx="52" cy="52" r="6" fill="hsla(340, 100%, 75%, 0.3)" stroke="hsl(340, 100%, 85%)" strokeWidth="1" />
            {/* 808 turntable hub (center hole) */}
            <circle className="reel-hub turntable-hub" cx="52" cy="52" r="4" fill="hsl(0, 0%, 5%)" stroke="hsl(0, 0%, 20%)" strokeWidth="0.5" />
            {/* Dark theme radial hub */}
            <circle className="reel-hub radial-hub" cx="52" cy="52" r="8" fill="hsl(215, 15%, 25%)" stroke="hsl(215, 15%, 45%)" strokeWidth="1" />
          </g>
        </svg>
        <div className="display-section">
          <div className="display-row">
            <div className="timecode" id="timecode">00:00</div>
          </div>
        </div>
        <svg className="tape-reel right-reel" id="right-reel" width="104" height="104" viewBox="0 0 104 104">
          <defs>
            {/* Cassette reel gradient for realistic metallic appearance */}
            <radialGradient id="cassette-gradient-right" cx="0.3" cy="0.3" r="0.8">
              <stop offset="0%" stopColor="hsl(200, 35%, 75%)" />
              <stop offset="40%" stopColor="hsl(200, 40%, 65%)" />
              <stop offset="70%" stopColor="hsl(200, 45%, 55%)" />
              <stop offset="100%" stopColor="hsl(200, 50%, 45%)" />
            </radialGradient>
            

            
            {/* Vintage theme - traditional reel slots */}
            <mask id="vintage-slots-right">
              <rect width="104" height="104" fill="white" />
              <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" />
              <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" transform="rotate(120 52 52)" />
              <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" transform="rotate(240 52 52)" />
            </mask>
            {/* Indie theme - simplified cassette cogwheel */}
            <mask id="cassette-holes-right">
              <rect width="104" height="104" fill="white" />
              {/* Central cogwheel/gear hole - like real cassettes */}
              <circle cx="52" cy="52" r="12" fill="black" />
              {/* Gear teeth - 6 rectangular notches around the center */}
              <rect x="50" y="28" width="4" height="8" fill="black" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(60 52 52)" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(120 52 52)" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(180 52 52)" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(240 52 52)" />
              <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(300 52 52)" />
            </mask>
          </defs>
          <g className="reel">
            <circle className="reel-base" cx="52" cy="52" r="50" fill="var(--color-track-well)" />
            {/* Vintage reel face */}
            <circle className="reel-face vintage-reel" cx="52" cy="52" r="50" fill="var(--reel-mid)" mask="url(#vintage-slots-right)" />
            {/* Indie reel face */}
            <circle className="reel-face indie-reel" cx="52" cy="52" r="50" fill="var(--reel-mid)" mask="url(#cassette-holes-right)" />
            {/* Disco neon reel - transparent with glowing concentric rings */}
            <g className="disco-reel">
              <circle className="neon-ring-outer" cx="52" cy="52" r="48" fill="none" stroke="hsl(180, 100%, 75%)" strokeWidth="0.5" opacity="0.6" />
              <circle className="neon-ring-mid" cx="52" cy="52" r="40" fill="none" stroke="hsl(320, 100%, 70%)" strokeWidth="0.3" opacity="0.8" />
              <circle className="neon-ring-inner" cx="52" cy="52" r="32" fill="none" stroke="hsl(280, 100%, 80%)" strokeWidth="0.2" opacity="0.5" />
              <circle className="neon-plate" cx="52" cy="52" r="50" fill="hsla(310, 80%, 20%, 0.1)" stroke="hsl(340, 100%, 75%)" strokeWidth="1" />
            </g>
            {/* 808 turntable record */}
            <g className="turntable-reel">
              {/* Vinyl record base */}
              <circle className="vinyl-record" cx="52" cy="52" r="50" fill="hsl(0, 0%, 8%)" stroke="hsl(0, 0%, 15%)" strokeWidth="0.5" />
              {/* Record grooves */}
              <circle className="record-groove" cx="52" cy="52" r="45" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.6" />
              <circle className="record-groove" cx="52" cy="52" r="40" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.4" />
              <circle className="record-groove" cx="52" cy="52" r="35" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.3" />
              <circle className="record-groove" cx="52" cy="52" r="30" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.2" />
              {/* Center label */}
              <circle className="record-label" cx="52" cy="52" r="20" fill="hsl(45, 100%, 50%)" stroke="hsl(45, 100%, 40%)" strokeWidth="1" />
              <circle className="label-ring" cx="52" cy="52" r="15" fill="none" stroke="hsl(45, 80%, 35%)" strokeWidth="0.5" />
              <text className="label-text" x="52" y="56" textAnchor="middle" fill="hsl(20, 100%, 85%)" fontSize="7" fontWeight="bold">Music</text>
            </g>
            {/* Dark theme radial bars */}
            <g className="radial-bars">
              {/* 8 radial bars positioned around the center */}
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(45 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(90 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(135 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(180 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(225 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(270 52 52)" />
              <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(315 52 52)" />
            </g>
            <circle className="reel-rim" cx="52" cy="52" r="50" />
            {/* Vintage hub (larger) */}
            <circle className="reel-hub vintage-hub" cx="52" cy="52" r="14" fill="var(--reel-hub)" />
            {/* Indie hub (cogwheel center) */}
            <circle className="reel-hub indie-hub" cx="52" cy="52" r="8" fill="var(--reel-hub)" />
            {/* Disco neon hub */}
            <circle className="reel-hub disco-hub" cx="52" cy="52" r="6" fill="hsla(340, 100%, 75%, 0.3)" stroke="hsl(340, 100%, 85%)" strokeWidth="1" />
            {/* 808 turntable hub (center hole) */}
            <circle className="reel-hub turntable-hub" cx="52" cy="52" r="4" fill="hsl(0, 0%, 5%)" stroke="hsl(0, 0%, 20%)" strokeWidth="0.5" />
            {/* Dark theme radial hub */}
            <circle className="reel-hub radial-hub" cx="52" cy="52" r="8" fill="hsl(215, 15%, 25%)" stroke="hsl(215, 15%, 45%)" strokeWidth="1" />
          </g>
        </svg>
        <div className="cassette-controls-stack">
          <Metronome 
            bpm={bpm} 
            onBpmChange={setBpm} 
            metronomePlaying={metronomePlaying}
            setMetronomePlaying={setMetronomePlaying}
          />
          <div className="playhead" id="playhead">
            <canvas className="waveform-canvas" id="waveform-canvas" width="800" height="30"></canvas>
            <div className="playhead-indicator" id="playhead-indicator" />
          </div>
        </div>
      </div>
      
      <div className="mixer-section">
        <div className="tracks-container">
          <div className="tracks-header">
            <div className="volume-meter" id="volume-meter">
              <div className="volume-meter-fill" id="volume-meter-fill"></div>
            </div>
          </div>
          <div className="tracks-row">
            {Array.from({ length: 4 }, (_, i) => {
              const id = i + 1
              return (
                <div className="track" key={id}>
                  <div className="track-controls">
                    <div className="pan-knob-container">
                      <input
                        type="range"
                        className="pan-knob"
                        id={`pan-${id}`}
                        min={0}
                        max={100}
                        defaultValue={50}
                      />
                    </div>
                    <div className="mute-button-container">
                      <input type="checkbox" className="mute-button" id={`mute-${id}`} data-track={id} />
                      <label htmlFor={`mute-${id}`} className="mute-button-label">{id}</label>
                    </div>
                    <input type="checkbox" className="solo-button" id={`solo-${id}`} data-track={id} />
                    <div className="speed-controls">
                      <button className="reverse-button" id={`reverse-${id}`} data-track={id} title={`Reverse Track ${id}`}>
                        ⇄
                      </button>
                      <button className="half-speed-button" id={`half-speed-${id}`} data-track={id} title={`Half-speed Track ${id}`}>
                        ½
                      </button>
                    </div>
                    <input type="checkbox" className="arm-button" id={`track-${id}`} data-track={id} title={`Arm Track ${id} (${id})`} />
                  </div>
                  <div className="fader-section">
                    <input
                      type="range"
                      className="fader"
                      id={`fader-${id}`}
                      min={0}
                      max={100}
                      defaultValue={80}
                    />
                    <div className="fader-markings">
                      <div className="marking" data-db="0">0</div>
                      <div className="marking dash">-</div>
                      <div className="marking" data-db="-12">-12</div>
                      <div className="marking dash">-</div>
                      <div className="marking" data-db="-36">-36</div>
                      <div className="marking dash">-</div>
                      <div className="marking" data-db="-60">-60</div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="master-section">
              <div className="master-controls">
                <div className="master-label-vertical">
                  <div className="master-divider">|</div>
                  <div className="master-text">
                    <div>M</div>
                    <div>A</div>
                    <div>S</div>
                    <div>T</div>
                    <div>E</div>
                    <div>R</div>
                  </div>
                </div>
                <div className="master-fader-section">
                  <input
                    type="range"
                    className="master-fader"
                    id="master-fader"
                    min={0}
                    max={100}
                    defaultValue={80}
                  />
                  <div className="fader-markings">
                    <div className="marking" data-db="0">0</div>
                    <div className="marking dash">-</div>
                    <div className="marking" data-db="-12">-12</div>
                    <div className="marking dash">-</div>
                    <div className="marking" data-db="-36">-36</div>
                    <div className="marking dash">-</div>
                    <div className="marking" data-db="-60">-60</div>
                  </div>
                </div>
              </div>
              <div className="master-spacer"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="transport-controls">
        <button className="transport-button" id="stop-btn" title="Stop (S)" onClick={handleStop}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="12" height="12" />
          </svg>
        </button>
        <button className="transport-button play-button" id="play-btn" title="Play (A)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </button>
        <button className="transport-button" id="pause-btn" title="Pause (P)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        </button>
        <button className="transport-button record-button" id="record-btn" title="Record (Q)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
          </svg>
        </button>
        <button className="transport-button" id="undo-btn" title="Undo Last Override (U)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 14 4 9 9 4"></polyline>
            <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
          </svg>
        </button>
        <button className="transport-button loop-button" id="loop-btn" title="Enable Loop Mode (L)">
          <svg width="36" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 12C6 7 14 7 20 12C26 17 34 17 34 12C34 7 26 7 20 12C14 17 6 17 6 12Z" />
          </svg>
        </button>
        <button className="transport-button bounce-button" id="bounce-btn" title="Bounce to Master (B)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6 C2 6, 6 4, 12 6 C18 8, 22 6, 22 6" />
            <path d="M2 10 C2 10, 6 8, 12 10 C18 12, 22 10, 22 10" />
            <path d="M2 14 C2 14, 6 12, 12 14 C18 16, 22 14, 22 14" />
            <path d="M2 18 C2 18, 6 16, 12 18 C18 20, 22 18, 22 18" />
          </svg>
        </button>
        <button className="transport-button" id="export-btn" title="Export (E)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7,10 12,15 17,10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button className="transport-button clear-button" id="clear-btn" title="Clear everything (N)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3,6 5,6 21,6" />
            <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6M8,6V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
        <button className="transport-button settings-button" id="settings-btn" title="Settings (,)" onClick={handleOpenSettings}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <div id="settings-modal" className="settings-modal" style={{ display: 'none' }}>
        <div className="settings-content">
          <h3 className="settings-title">Settings</h3>
          
          <div className="settings-group">
            <div className="settings-toggle-header" id="audio-processing-toggle">
              <h4 className="settings-subtitle">🎤 Audio</h4>
              <div className="toggle-arrow" id="audio-processing-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6,9 12,15 18,9"></polyline>
                </svg>
              </div>
            </div>
            <div className="audio-content collapsed" id="audio-processing-options">
              <div className="audio-input-section">
                <label className="settings-label" htmlFor="audio-input-select">Audio Input Device</label>
                <select id="audio-input-select" className="settings-select">
                  <option value="">Select Audio Input Device...</option>
                </select>
              </div>
              <div className="audio-output-section">
                <label className="settings-label" htmlFor="audio-output-select">Audio Output Device</label>
                <select id="audio-output-select" className="settings-select">
                  <option value="">Select Audio Output Device...</option>
                </select>
                <button className="scan-output-devices-btn" id="scan-output-devices-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                  Scan Devices
                </button>
              </div>
              <h5 className="processing-subtitle">Export Options</h5>
                <div className="export-mode-selector">
                  <button 
                    className="export-option active"
                    id="multitrack-export-btn"
                  >
                    MultiTrack ZIP
                  </button>
                  <span className="export-separator"> | </span>
                  <button 
                    className="export-option"
                    id="master-export-btn"
                  >
                    Master Only
                  </button>
                </div>
                <div className="divider"></div>
              <div className="audio-processing-section">
                <h5 className="processing-subtitle">Audio Processing Options</h5>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input type="checkbox" id="echo-cancellation-checkbox" className="settings-checkbox" />
                    Feedback Cancellation
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" id="noise-suppression-checkbox" className="settings-checkbox" />
                    Noise gate
                  </label>
                </div>
                <div className="divider"></div>
                
              </div>
            </div>
          </div>
          
          <div className="settings-group">
            <div className="settings-toggle-header" id="theme-toggle">
              <h4 className="settings-subtitle">🎨 Theme</h4>
              <div className="toggle-arrow" id="theme-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6,9 12,15 18,9"></polyline>
                </svg>
              </div>
            </div>
            <div className="theme-content collapsed" id="theme-options">
              <div className="theme-selector">
                <button 
                  className={`theme-option ${currentTheme === 'vintage' ? 'active' : ''}`}
                  onClick={() => handleThemeChange('vintage')}
                >
                  Vintage
                </button>
                <span className="theme-separator"> | </span>
                <button 
                  className={`theme-option ${currentTheme === 'disco' ? 'active' : ''}`}
                  onClick={() => handleThemeChange('disco')}
                >
                  Disco
                </button>
                <span className="theme-separator"> | </span>
                <button 
                  className={`theme-option ${currentTheme === 'indie' ? 'active' : ''}`}
                  onClick={() => handleThemeChange('indie')}
                >
                  Indie
                </button>
                <span className="theme-separator"> | </span>
                <button 
                  className={`theme-option ${currentTheme === 'dark' ? 'active' : ''}`}
                  onClick={() => handleThemeChange('dark')}
                >
                  Dark
                </button>
                <span className="theme-separator"> | </span>
                <button 
                  className={`theme-option ${currentTheme === '808' ? 'active' : ''}`}
                  onClick={() => handleThemeChange('808')}
                >
                  HipHop
                </button>
              </div>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-toggle-header" id="keyboard-shortcuts-toggle">
              <h4 className="settings-subtitle">⌨️ Keyboard Shortcuts</h4>
              <div className="toggle-arrow" id="keyboard-shortcuts-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6,9 12,15 18,9"></polyline>
                </svg>
              </div>
            </div>
            <div className="keyboard-shortcuts-table collapsed" id="keyboard-shortcuts-options">
              <table className="shortcuts-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><kbd>A</kbd></td>
                    <td>Play</td>
                  </tr>
                  <tr>
                    <td><kbd>P</kbd></td>
                    <td>Pause</td>
                  </tr>
                  <tr>
                    <td><kbd>Q</kbd></td>
                    <td>Record</td>
                  </tr>
                  <tr>
                    <td><kbd>L</kbd></td>
                    <td>Toggle Loop</td>
                  </tr>
                  <tr>
                    <td><kbd>S</kbd></td>
                    <td>Stop</td>
                  </tr>
                  <tr>
                    <td><kbd>E</kbd></td>
                    <td>Export</td>
                  </tr>
                  <tr>
                    <td><kbd>,</kbd></td>
                    <td>Settings</td>
                  </tr>
                  <tr>
                    <td><kbd>B</kbd></td>
                    <td>Bounce to master</td>
                  </tr>
                  <tr>
                    <td><kbd>N</kbd></td>
                    <td>Clear everything</td>
                  </tr>
                  <tr>
                    <td><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd></td>
                    <td>Arm tracks</td>
                  </tr>
                  <tr>
                    <td><kbd>U</kbd></td>
                    <td>Undo Last Override</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="settings-group">
            <div className="settings-toggle-header" id="tips-toggle">
              <h4 className="settings-subtitle">💡 Tips</h4>
              <div className="toggle-arrow" id="tips-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6,9 12,15 18,9"></polyline>
                </svg>
              </div>
            </div>
            <div className="tips-content collapsed" id="tips-options">
              <p className="tip-item">- Use headphones when recording with a microphone to avoid feedback from speakers!</p>
              <p className="tip-item">- Double-click pan knobs or faders to reset to default values</p>
              <p className="tip-item">- Drag the red playhead in the grid to jump to a specific timecode</p>
            </div>
          </div>
          
          <button className="close-settings-btn" id="cancel-settings">Close</button>
        </div>
      </div>

      <div id="error-modal" className="settings-modal" style={{ display: 'none' }}>
        <div className="settings-content">
          <h3 className="settings-title">⚠️ Error</h3>
          <div className="settings-group">
            <p id="error-message" className="error-message">Error message will appear here</p>
          </div>
          <button className="close-settings-btn" id="close-error-modal">OK</button>
        </div>
      </div>

      <div id="warning-modal" className="settings-modal" style={{ display: 'none' }}>
        <div className="settings-content">
          <h3 className="settings-title">🎧 Important Audio Warning</h3>
          <div className="settings-group">
            <p className="warning-message">
              Before recording, please put on headphones to avoid audio feedback from your speakers. 
              Audio feedback can be loud and potentially damage your hearing or equipment.
            </p>
            <label className="checkbox-label warning-checkbox-label">
              <input type="checkbox" id="dont-show-warning-checkbox" className="settings-checkbox" defaultChecked />
              Don't show this warning again
            </label>
          </div>
          <div className="warning-buttons">
            <button className="close-settings-btn warning-cancel-btn" id="cancel-warning">Cancel</button>
            <button className="close-settings-btn warning-continue-btn" id="continue-warning">Continue</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

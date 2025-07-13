import { useEffect, useRef, useState, useCallback } from 'react'
import TapeFour from './lib/TapeFour'
import Metronome from './components/Metronome'
import TapeReel from './components/TapeReel'

type Theme = 'vintage' | 'indie' | 'disco' | 'dark' | '808'

function App() {
  const tapeFourRef = useRef<TapeFour | null>(null)
  const [currentTheme, setCurrentTheme] = useState<Theme>('vintage')
  const [bpm, setBpm] = useState(120)
  const [metronomePlaying, setMetronomePlaying] = useState(false)
  const [countInEnabled, setCountInEnabledState] = useState(() => {
    const stored = localStorage.getItem('tapefour-should-count-in');
    return stored === null ? true : stored === 'true';
  })
  const [quantizedLooping, setQuantizedLoopingState] = useState(() => {
    const stored = localStorage.getItem('tapefour-quantized-looping');
    return stored === 'true';
  })
  const [loopBars, setLoopBarsState] = useState(() => {
    const stored = localStorage.getItem('tapefour-loop-bars');
    return stored ? Number(stored) : 4;
  })
  const [latencyCompensation, setLatencyCompensationState] = useState(() => {
    const stored = localStorage.getItem('tapefour-latency-compensation');
    return stored ? Number(stored) : 0;
  })

  const setCountInEnabled = useCallback((enabled: boolean) => {
    setCountInEnabledState(enabled);
    localStorage.setItem('tapefour-should-count-in', enabled ? 'true' : 'false');
  }, [])

  const setQuantizedLooping = useCallback((enabled: boolean) => {
    setQuantizedLoopingState(enabled);
    localStorage.setItem('tapefour-quantized-looping', enabled ? 'true' : 'false');
    if (tapeFourRef.current) {
      tapeFourRef.current.setQuantizedLooping(enabled);
    }
  }, [])
  
  const setLoopBars = useCallback((bars: number) => {
    setLoopBarsState(bars);
    localStorage.setItem('tapefour-loop-bars', bars.toString());
    if (tapeFourRef.current) {
      tapeFourRef.current.setLoopBars(bars);
    }
  }, [])
  
  const setLatencyCompensation = useCallback((ms: number) => {
    setLatencyCompensationState(ms);
    localStorage.setItem('tapefour-latency-compensation', ms.toString());
    if (tapeFourRef.current) {
      tapeFourRef.current.setRecordingLatencyCompensation(ms);
    }
  }, [])

  // Initialize TapeFour only once
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
      if (tapeFourRef.current) {
        tapeFourRef.current.cleanup();
        tapeFourRef.current = null;
      }
    }
  }, []) // Empty dependency array - only run once
  
  // Update callbacks when values change without recreating TapeFour
  useEffect(() => {
    if (tapeFourRef.current) {
      // Set the count-in callback
      tapeFourRef.current.setCountInCallback(() => {
        return countInEnabled;
      });
    }
  }, [countInEnabled])
  
  useEffect(() => {
    if (tapeFourRef.current) {
      // Set the BPM callback
      tapeFourRef.current.setBpmCallback(() => {
        return bpm;
      });
    }
  }, [bpm])

  useEffect(() => {
    if (tapeFourRef.current) {
      tapeFourRef.current.setQuantizedLooping(quantizedLooping);
    }
  }, [quantizedLooping])
  
  useEffect(() => {
    if (tapeFourRef.current) {
      tapeFourRef.current.setLoopBars(loopBars);
    }
  }, [loopBars])
  
  useEffect(() => {
    if (tapeFourRef.current) {
      tapeFourRef.current.setRecordingLatencyCompensation(latencyCompensation);
    }
  }, [latencyCompensation])

  // Load saved theme from localStorage on component mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('tapefour-theme') as Theme | null
    if (savedTheme && ['vintage', 'indie', 'disco', 'dark', '808'].includes(savedTheme)) {
      setCurrentTheme(savedTheme)
      document.documentElement.setAttribute('data-theme', savedTheme)
    }
  }, [])

  const handleThemeChange = useCallback((theme: Theme) => {
    setCurrentTheme(theme)
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('tapefour-theme', theme)
  }, [])

  const handleOpenSettings = useCallback(() => {
    tapeFourRef.current?.openSettings()
  }, [])

  const handleStop = useCallback(() => {
    // ... any existing stop logic ...
    setMetronomePlaying(false) // Stop metronome if playing
  }, [])

  return (
    <div className="recorder-container">
      {/* <div className="header">
        <span>TapeFour</span>
      </div> */}

      <div className="cassette-display">
        <TapeReel side="left" />
        <div className="display-section">
          <div className="display-row">
            <div className="timecode" id="timecode">00:00</div>
          </div>
        </div>
        <TapeReel side="right" />
        <div className="cassette-controls-stack">
          <Metronome 
            bpm={bpm} 
            onBpmChange={setBpm} 
            metronomePlaying={metronomePlaying}
            setMetronomePlaying={setMetronomePlaying}
            countInEnabled={countInEnabled}
            setCountInEnabled={setCountInEnabled}
            quantizedLooping={quantizedLooping}
            onQuantizedLoopingChange={setQuantizedLooping}
            loopBars={loopBars}
            onLoopBarsChange={setLoopBars}
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
                </div>
                <div className="divider"></div>
                <div className="latency-compensation-section">
                  <h5 className="processing-subtitle">Recording Latency Compensation</h5>
                  <p className="settings-description">
                    Adjust if recordings don't align with the metronome.
                    Negative = earlier, Positive = later
                  </p>
                  <div className="latency-control">
                    <input 
                      type="range" 
                      className="latency-slider"
                      min={-200} 
                      max={200} 
                      step={10}
                      value={latencyCompensation}
                      onChange={(e) => setLatencyCompensation(Number(e.target.value))}
                    />
                    <div className="latency-value-display">
                      <span className="latency-value">{latencyCompensation}ms</span>
                      {latencyCompensation !== 0 && (
                        <button 
                          className="reset-latency-btn"
                          onClick={() => setLatencyCompensation(0)}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
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

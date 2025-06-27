import { useEffect, useRef } from 'react'
import TapeFour from './lib/TapeFour'

function App() {
  const tapeFourRef = useRef<TapeFour | null>(null)

  useEffect(() => {
    tapeFourRef.current = new TapeFour()
    return () => {
      tapeFourRef.current = null
    }
  }, [])

  const handleOpenSettings = () => {
    tapeFourRef.current?.openSettings()
  }

  return (
    <div className="recorder-container">
      <div className="header">TapeFour</div>

      <div className="cassette-display">
        <div className="tape-reel left-reel" id="left-reel">
          <div className="reel-center"></div>
          <div className="reel-holes">
            <div className="hole"></div>
            <div className="hole"></div>
            <div className="hole"></div>
            <div className="hole"></div>
            <div className="hole"></div>
            <div className="hole"></div>
          </div>
        </div>
        <div className="display-section">
          <div className="display-row">
            <div className="timecode" id="timecode">00:00</div>
            <div className="volume-meter" id="volume-meter">
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
              <div className="volume-meter-segment"></div>
            </div>
          </div>
        </div>
        <div className="tape-reel right-reel" id="right-reel">
          <div className="reel-center"></div>
          <div className="reel-holes">
            <div className="hole"></div>
            <div className="hole"></div>
            <div className="hole"></div>
            <div className="hole"></div>
            <div className="hole"></div>
            <div className="hole"></div>
          </div>
        </div>
        <div className="playhead" id="playhead">
          <div className="playhead-indicator" id="playhead-indicator" />
        </div>
      </div>

      <div className="mixer-section">
        <div className="tracks-container">
          {Array.from({ length: 4 }, (_, i) => {
            const id = i + 1
            return (
              <div className="track" key={id}>
                <input
                  type="range"
                  className="fader"
                  id={`fader-${id}`}
                  min={0}
                  max={100}
                  defaultValue={75}
                />
                <div className="mute-button-container">
                  <input type="checkbox" className="mute-button" id={`mute-${id}`} data-track={id} />
                  <label htmlFor={`mute-${id}`} className="mute-button-label">{id}</label>
                </div>
                <input type="checkbox" className="solo-button" id={`solo-${id}`} data-track={id} />
                <input type="checkbox" className="arm-button" id={`track-${id}`} data-track={id} />
              </div>
            )
          })}
          <div className="master-section">
            <input
              type="range"
              className="master-fader"
              id="master-fader"
              min={0}
              max={100}
              defaultValue={75}
            />
            <div className="master-spacer"></div>
            <div className="master-label">MAIN</div>
          </div>
        </div>
      </div>

      <div className="transport-controls">
        <button className="transport-button" id="stop-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="12" height="12" />
          </svg>
        </button>
        <button className="transport-button play-button" id="play-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </button>
        <button className="transport-button" id="pause-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        </button>
        <button className="transport-button record-button" id="record-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
          </svg>
        </button>
        <button className="transport-button" id="export-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7,10 12,15 17,10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button className="transport-button settings-button" id="settings-btn" onClick={handleOpenSettings}>
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
            <label className="settings-label" htmlFor="audio-input-select">Audio Input</label>
            <select id="audio-input-select" className="settings-select">
              <option value="">Select Audio Input Device...</option>
            </select>
            <button className="scan-devices-btn" id="scan-devices-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
              Scan Devices
            </button>
          </div>
          
          <div className="settings-group">
            <div className="settings-toggle-header" id="audio-processing-toggle">
              <h4 className="settings-subtitle">Audio Processing</h4>
              <div className="toggle-arrow" id="audio-processing-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6,9 12,15 18,9"></polyline>
                </svg>
              </div>
            </div>
            <div className="checkbox-group collapsed" id="audio-processing-options">
              <label className="checkbox-label">
                <input type="checkbox" id="echo-cancellation-checkbox" className="settings-checkbox" />
                Echo Cancellation
              </label>
              <label className="checkbox-label">
                <input type="checkbox" id="noise-suppression-checkbox" className="settings-checkbox" />
                Noise Suppression
              </label>
              <label className="checkbox-label">
                <input type="checkbox" id="auto-gain-control-checkbox" className="settings-checkbox" />
                Auto Gain Control
              </label>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-toggle-header" id="keyboard-shortcuts-toggle">
              <h4 className="settings-subtitle">Keyboard Shortcuts</h4>
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
                    <td><kbd>Space</kbd></td>
                    <td>Play</td>
                  </tr>
                  <tr>
                    <td><kbd>Q</kbd></td>
                    <td>Record</td>
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
                    <td><kbd>1</kbd></td>
                    <td>Arm Track 1</td>
                  </tr>
                  <tr>
                    <td><kbd>2</kbd></td>
                    <td>Arm Track 2</td>
                  </tr>
                  <tr>
                    <td><kbd>3</kbd></td>
                    <td>Arm Track 3</td>
                  </tr>
                  <tr>
                    <td><kbd>4</kbd></td>
                    <td>Arm Track 4</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <button className="close-settings-btn" id="cancel-settings">Close</button>
        </div>
      </div>
    </div>
  )
}

export default App

// TapeFour Web Audio engine
// Extracted from the original prototype and adapted as a module.
// The class still manipulates DOM nodes by id. As long as the host React
// component renders elements with matching ids, it will work.
// A future refactor could fully lift UI state into React, but this keeps
// behaviour identical while we incrementally migrate the codebase.

import JSZip from 'jszip';

export default class TapeFour {
  // Debug configuration - reads from environment variables
  private debug = {
    // Global debug toggle
    enabled: import.meta.env.VITE_DEBUG_ENABLED !== 'false', // Default to true unless explicitly disabled
    
    // Debug categories - CONFIGURED FOR VOLUME METER DEBUG
    transport: false, // Disable transport noise
    input: true,      // ✅ ENABLE - Input monitoring, microphone access, volume meter setup
    waveform: false,  // Disable - Very noisy during recording
    meter: false,      // ✅ ENABLE - Volume meter frame-by-frame updates (will be noisy!)
    punchIn: false,   // Disable - Not relevant to meter
    halfSpeed: false, // Disable - Not relevant to meter
    ui: false,        // Disable - UI noise not needed
    audio: false,     // Disable - Audio routing not relevant to meter
    bounce: false,    // Disable - Not relevant to meter
    scrub: false,     // Disable - Scrubbing noise not needed
    general: true,    // ✅ ENABLE - General application logs for context
    duration: false,  // Disable - Not relevant to meter
    processing: false,// Disable - Not relevant to meter
    keyboard: false,  // Disable - Keyboard shortcuts not needed
    settings: false,  // Disable - Settings noise not needed
  };

  // Debug helper methods
  private debugLog(category: keyof typeof this.debug, message: string, ...args: any[]) {
    if (this.debug.enabled && this.debug[category]) {
      console.log(message, ...args);
    }
  }

  private debugWarn(category: keyof typeof this.debug, message: string, ...args: any[]) {
    if (this.debug.enabled && this.debug[category]) {
      console.warn(message, ...args);
    }
  }

  private debugError(category: keyof typeof this.debug, message: string, ...args: any[]) {
    if (this.debug.enabled && this.debug[category]) {
      console.error(message, ...args);
    }
  }

  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private masterGainNode: GainNode | null = null;
  private monitoringGainNode: GainNode | null = null;
  private recordingBuffer: Blob[] = [];
  private eventListenersInitialized = false;

  private playheadTimer: number | null = null;
  private playStartTime = 0;
  private volumeMeterActive = false;
  private volumeMeterAnimationId: number | null = null;
  private analyserNode: AnalyserNode | null = null;
  private reelAnimationActive = false;
  
  // Input monitoring nodes
  private inputSourceNode: MediaStreamAudioSourceNode | null = null;
  private inputMonitoringGainNode: GainNode | null = null;

  // Waveform strip variables
  private waveformCanvas: HTMLCanvasElement | null = null;
  private waveformContext: CanvasRenderingContext2D | null = null;
  private waveformRenderingId: number | null = null;
  private waveformBufferSize = 800; // Width of canvas in pixels
  private waveformAnalyserNode: AnalyserNode | null = null;
  
  // Track-specific waveform storage: array of {position, peak} objects for each track
  private trackWaveforms: Map<number, Array<{position: number, peak: number}>> = new Map();
  private masterWaveform: Array<{position: number, peak: number}> = [];
  
  // Track colors for waveform visualization - distinct colors for each track
  private trackColors = {
    1: '#D18C33', // Burnt orange (track 1)
    2: '#2ECC71', // Emerald green (track 2) 
    3: '#3498DB', // Bright blue (track 3)
    4: '#C8A8E9', // Light lavender purple (track 4) - light enough for black text
    master: '#d2a75b', // Golden for master mix
  };

  private state = {
    isPlaying: false,
    isRecording: false,
    isPaused: false,
    playheadPosition: 0,
    selectedInputDeviceId: null as string | null,
    selectedOutputDeviceId: null as string | null,
    maxRecordingTime: 60000, // 60 seconds
    inputMuted: false,
    isMonitoring: false, // Whether input monitoring is active
    // Audio processing settings - default to false for more raw recording
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    // Export settings - default to multi-track export
    multiTrackExport: true,
    // Punch-in recording state
    recordMode: 'fresh' as 'fresh' | 'punchIn',
    punchInStartPosition: 0, // Position where punch-in recording started (in ms)
    // Bounce to master
    masterBuffer: null as AudioBuffer | null,
    duration: 0, // Total duration in milliseconds
    // Loop functionality
    loopStart: 0, // Loop start time in seconds
    loopEnd: 0, // Loop end time in seconds
    isLooping: false, // Whether loop mode is active
    isDraggingLoopStart: false, // Whether user is dragging loop start handle
    isDraggingLoopEnd: false, // Whether user is dragging loop end handle
    hasCompletedFirstRecording: false, // Track if we've completed the first recording pass
  };

  private tracks: Array<{
    id: number;
    audioBuffer: AudioBuffer | null;
    originalBuffer: AudioBuffer | null; // Store original buffer for toggling reverse
    originalBufferForSpeed: AudioBuffer | null; // Store original buffer for toggling half-speed
    recordStartTime: number; // Timeline position (ms) where this track's recording started
    isArmed: boolean;
    isSolo: boolean;
    isMuted: boolean;
    isManuallyMuted: boolean; // Visual state for mute button
    isReversed: boolean; // Track if audio is reversed
    isHalfSpeed: boolean; // Track if audio is at half speed
    gainNode: GainNode | null;
    sourceNode: AudioBufferSourceNode | null;
    panNode: StereoPannerNode | null;
    panValue: number; // 0 = fully left, 50 = center, 100 = fully right
    undoHistory: AudioBuffer[]; // Stack to store previous buffer states for undo
  }> = [
    { id: 1, audioBuffer: null, originalBuffer: null, originalBufferForSpeed: null, recordStartTime: 0, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, isReversed: false, isHalfSpeed: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50, undoHistory: [] },
    { id: 2, audioBuffer: null, originalBuffer: null, originalBufferForSpeed: null, recordStartTime: 0, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, isReversed: false, isHalfSpeed: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50, undoHistory: [] },
    { id: 3, audioBuffer: null, originalBuffer: null, originalBufferForSpeed: null, recordStartTime: 0, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, isReversed: false, isHalfSpeed: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50, undoHistory: [] },
    { id: 4, audioBuffer: null, originalBuffer: null, originalBufferForSpeed: null, recordStartTime: 0, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, isReversed: false, isHalfSpeed: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50, undoHistory: [] },
  ];

  // Store previous mute states for when solo is disengaged
  private previousMuteStates: boolean[] = [false, false, false, false];

  // Scrubbing/timeline interaction
  private isDraggingPlayhead = false;
  private playheadContainer: HTMLElement | null = null;
  private lastSettingsToggleTime = 0;
  
  // Volume meter debug counter
  private _meterUpdateCount = 0;

  constructor() {
    // Load previously selected audio device and processing settings from localStorage
    this.loadSavedAudioDevice();
    this.loadSavedAudioOutputDevice();
    this.loadSavedAudioProcessingSettings(); // This now includes export settings
    this.loadArmedTrackState(); // Load armed track state from localStorage
    this.initializeAudio();
    this.initializeUI();
    this.setupEventListeners();
    this.checkMicrophonePermissions();
    // Initialize volume meter with a small visible level
    setTimeout(() => {
      this.updateVolumeMeter(0.1); // Show 10% level initially
    }, 1000);
  }

  /* ---------- Initialisation helpers ---------- */

  private async initializeAudio() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // master chain
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.value = 1.0; // 0 dB (80% with logarithmic taper)

      // Create monitoring gain node for playback during recording (lower volume)
      this.monitoringGainNode = this.audioContext.createGain();
      this.monitoringGainNode.gain.value = 0.3; // Lower volume for monitoring

      // Create input monitoring gain node for hearing live input
      this.inputMonitoringGainNode = this.audioContext.createGain();
      this.inputMonitoringGainNode.gain.value = 0.5; // Moderate volume for input monitoring

      this.masterGainNode.connect(this.audioContext.destination);

      // Monitoring path: master -> monitoring gain -> destination
      this.masterGainNode.connect(this.monitoringGainNode);
      this.monitoringGainNode.connect(this.audioContext.destination);

      // Input monitoring path: input -> input monitoring gain -> destination
      this.inputMonitoringGainNode.connect(this.audioContext.destination);

      // track gain and pan nodes
      this.tracks.forEach((track) => {
        track.gainNode = this.audioContext!.createGain();
        track.gainNode.gain.value = 1.0; // 0 dB (80% with logarithmic taper)
        
        track.panNode = this.audioContext!.createStereoPanner();
        track.panNode.pan.value = 0; // Start at center (0 = center, -1 = left, 1 = right)
        
        // Connect: gain -> pan -> master
        track.gainNode.connect(track.panNode);
        track.panNode.connect(this.masterGainNode!);
      });
    }

    if (this.audioContext!.state === 'suspended') {
      await this.audioContext!.resume();
    }

    // Try to set the saved output device if available
    if (this.state.selectedOutputDeviceId) {
      try {
        if ('setSinkId' in this.audioContext! && typeof this.audioContext!.setSinkId === 'function') {
          await (this.audioContext! as any).setSinkId(this.state.selectedOutputDeviceId);
          this.debugLog('settings', `[TAPEFOUR] 🔊 Applied saved output device: ${this.state.selectedOutputDeviceId}`);
        }
      } catch (err) {
        this.debugWarn('settings', '[TAPEFOUR] ⚠️ Failed to apply saved output device:', err);
        // Don't clear the saved device ID - user can try again or select a different one
      }
    }
  }

  private initializeUI() {
    // reset faders & knobs
    this.tracks.forEach((track) => {
      const fader = document.getElementById(`fader-${track.id}`) as HTMLInputElement | null;
      if (fader) {
        fader.value = '80'; // 0 dB = 80% fader position (logarithmic taper)
        // Initialize CSS custom property for volume indicator line
        fader.style.setProperty('--fader-value', '80');
      }
      
      const panKnob = document.getElementById(`pan-${track.id}`) as HTMLInputElement | null;
      if (panKnob) panKnob.value = '50'; // Center position
    });
    
    const masterFader = document.getElementById('master-fader') as HTMLInputElement | null;
    if (masterFader) {
      masterFader.setAttribute('value', '80'); // 0 dB = 80% fader position (logarithmic taper)
      // Initialize CSS custom property for master fader volume indicator line
      masterFader.style.setProperty('--master-fader-value', '80');
    }

    // Initialize waveform canvas
    this.waveformCanvas = document.getElementById('waveform-canvas') as HTMLCanvasElement | null;
    if (this.waveformCanvas) {
      this.waveformContext = this.waveformCanvas.getContext('2d');
      this.clearWaveform(); // Clear all tracks on initialization
    }

    // Apply track colors to mute buttons
    this.applyTrackColorsToUI();
    
    // Update existing button styling immediately if tracks exist
    setTimeout(() => {
      this.tracks.forEach(track => {
        this.updateMuteButtonStyling(track.id);
        this.updateReverseButtonStyling(track.id);
        this.updateHalfSpeedButtonStyling(track.id);
      });
      this.updateBounceButtonState(); // Initialize bounce button state
      this.updateLoopButtonState(); // Initialize loop button state
      this.updateUndoButtonState(); // Initialize undo button state
    }, 100);
  }

  private setupEventListeners() {
    // Prevent duplicate event listener initialization
    if (this.eventListenersInitialized) {
      this.debugLog('general', '[TAPEFOUR] ⚠️ Event listeners already initialized, skipping...');
      return;
    }
    
    this.debugLog('general', '[TAPEFOUR] 🎧 Setting up event listeners...');
    
    // Arming toggles
    this.tracks.forEach((track) => {
      const el = document.getElementById(`track-${track.id}`) as HTMLInputElement;
      el?.addEventListener('click', (e) => {
        // Get the checkbox state after the click
        const isNowChecked = (e.target as HTMLInputElement).checked;
        
        // If checkbox is now checked (arming) and we should show warning
        if (isNowChecked && this.shouldShowWarning() && !this.tracks[track.id - 1].isArmed) {
          // Immediately reset the checkbox since we need to show warning first
          (e.target as HTMLInputElement).checked = false;
          this.showWarning(track.id);
          return;
        }
        
        // Otherwise proceed with normal toggle logic
        this.doToggleTrackArm(track.id);
      });
    });

    // Solo buttons
    this.tracks.forEach((track) => {
      const el = document.getElementById(`solo-${track.id}`);
      el?.addEventListener('click', () => this.toggleTrackSolo(track.id));
    });

    // Mute buttons
    this.tracks.forEach((track) => {
      const el = document.getElementById(`mute-${track.id}`);
      el?.addEventListener('click', () => this.toggleTrackMute(track.id));
    });

    // Reverse buttons
    this.tracks.forEach((track) => {
      const el = document.getElementById(`reverse-${track.id}`);
      el?.addEventListener('click', () => this.toggleTrackReverse(track.id));
    });

    // Half-speed buttons
    this.tracks.forEach((track) => {
      const el = document.getElementById(`half-speed-${track.id}`);
      el?.addEventListener('click', () => this.toggleTrackHalfSpeed(track.id));
    });

    // Faders
    this.tracks.forEach((track) => {
      const fader = document.getElementById(`fader-${track.id}`) as HTMLInputElement | null;
      fader?.addEventListener('input', (e) => this.updateTrackGain(track.id, +(e.target as HTMLInputElement).value));
      // Double-click to reset to default value (80% = 0 dB)
      fader?.addEventListener('dblclick', () => this.resetTrackFader(track.id));
    });

    // Pan knobs
    this.tracks.forEach((track) => {
      const panKnob = document.getElementById(`pan-${track.id}`) as HTMLInputElement | null;
      const panContainer = panKnob?.parentElement;
      
      if (panKnob && panContainer) {
        // Handle mouse events for vertical drag behavior
        let isDragging = false;
        let startY = 0;
        let startValue = 0;

        const updateKnobRotation = (value: number) => {
          // Convert 0-100 to -135deg to +135deg (270 degree total range)
          const rotation = (value - 50) * 2.7; // 270 degrees / 100 = 2.7
          panContainer.style.setProperty('--rotation', `${rotation}deg`);
        };

        // Initialize rotation
        updateKnobRotation(parseInt(panKnob.value));

        panContainer.addEventListener('mousedown', (e) => {
          isDragging = true;
          startY = e.clientY;
          startValue = parseInt(panKnob.value);
          e.preventDefault();
          e.stopPropagation(); // Prevent click-through to mute button
          e.stopImmediatePropagation(); // Stop all event propagation
        });

        document.addEventListener('mousemove', (e) => {
          if (isDragging) {
            const deltaY = startY - e.clientY; // Inverted: up = positive
            const sensitivity = 0.5; // Adjust sensitivity
            const newValue = Math.max(0, Math.min(100, startValue + deltaY * sensitivity));
            panKnob.value = newValue.toString();
            updateKnobRotation(newValue);
            this.updateTrackPan(track.id, newValue);
            e.preventDefault();
          }
        });

        document.addEventListener('mouseup', () => {
          isDragging = false;
        });

        // Handle regular input events (for keyboard, touch, etc.)
        panKnob.addEventListener('input', (e) => {
          if (!isDragging) {
            const value = +(e.target as HTMLInputElement).value;
            updateKnobRotation(value);
            this.updateTrackPan(track.id, value);
          }
        });

        // Add click event to prevent click-through
        panContainer.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        });

        // Double-click to reset to center (50)
        panContainer.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation(); // Prevent click-through to mute button
          e.stopImmediatePropagation(); // Stop all event propagation
          this.resetTrackPan(track.id);
          updateKnobRotation(50);
        });
      }
    });

    // Master fader
    const masterFader = document.getElementById('master-fader') as HTMLInputElement | null;
    masterFader?.addEventListener('input', (e) => this.updateMasterGain(+(e.target as HTMLInputElement).value));
    // Double-click to reset to default value (80% = 0 dB)
    masterFader?.addEventListener('dblclick', () => this.resetMasterFader());

    // Transport
    document.getElementById('play-btn')?.addEventListener('click', () => this.play());
    document.getElementById('stop-btn')?.addEventListener('click', () => this.stop());
    document.getElementById('pause-btn')?.addEventListener('click', () => this.pause());
    document.getElementById('record-btn')?.addEventListener('click', () => this.record());
    document.getElementById('loop-btn')?.addEventListener('click', () => this.toggleLoop());
    document.getElementById('export-btn')?.addEventListener('click', () => this.export());
    document.getElementById('bounce-btn')?.addEventListener('click', () => this.bounce());
    document.getElementById('clear-btn')?.addEventListener('click', () => this.clearEverything());
    document.getElementById('settings-btn')?.addEventListener('click', () => this.openSettings());
    document.getElementById('undo-btn')?.addEventListener('click', () => this.undoLastOverride());

    // Settings modal buttons
    document.getElementById('cancel-settings')?.addEventListener('click', () => this.closeSettings());

    // Error modal buttons
    document.getElementById('close-error-modal')?.addEventListener('click', () => this.closeError());

    // Warning modal buttons
    document.getElementById('cancel-warning')?.addEventListener('click', () => this.closeWarning());
    document.getElementById('continue-warning')?.addEventListener('click', () => this.continueWithArming());

    // Audio input device selection - change immediately when selected
    document.getElementById('audio-input-select')?.addEventListener('change', async (e) => {
      const select = e.target as HTMLSelectElement;
      await this.changeAudioInputDevice(select.value || null);
    });

    // Audio output device selection - change immediately when selected
    document.getElementById('audio-output-select')?.addEventListener('change', async (e) => {
      const select = e.target as HTMLSelectElement;
      this.debugLog('settings', `[TAPEFOUR] 🔊 Output device selection changed to: ${select.value || 'default'}`);
      await this.changeAudioOutputDevice(select.value || null);
    });

    // Scan devices button (refresh both input and output device lists without closing modal)
    document.getElementById('scan-output-devices-btn')?.addEventListener('click', async () => {
      await this.populateAudioInputSelect();
      await this.populateAudioOutputSelect();
    });

    // Audio processing toggle - improved reliability
    document.getElementById('audio-processing-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const options = document.getElementById('audio-processing-options');
      const arrow = document.getElementById('audio-processing-arrow');
      
      if (options && arrow) {
        const isCollapsed = options.classList.contains('collapsed');
        this.debugLog('settings', `[TAPEFOUR] 🔧 Audio processing toggle clicked, currently collapsed: ${isCollapsed}`);
        
        if (isCollapsed) {
          options.classList.remove('collapsed');
          arrow.classList.add('rotated');
                      this.debugLog('settings', '[TAPEFOUR] 🔧 Audio processing expanded');
          } else {
            options.classList.add('collapsed');
            arrow.classList.remove('rotated');
            this.debugLog('settings', '[TAPEFOUR] 🔧 Audio processing collapsed');
        }
              } else {
          this.debugWarn('settings', '[TAPEFOUR] ⚠️ Audio processing toggle elements not found');
        }
    });

    // Keyboard shortcuts toggle - improved reliability
    document.getElementById('keyboard-shortcuts-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const options = document.getElementById('keyboard-shortcuts-options');
      const arrow = document.getElementById('keyboard-shortcuts-arrow');
      
      if (options && arrow) {
        const isCollapsed = options.classList.contains('collapsed');
        this.debugLog('settings', `[TAPEFOUR] ⌨️ Keyboard shortcuts toggle clicked, currently collapsed: ${isCollapsed}`);
        
        if (isCollapsed) {
          options.classList.remove('collapsed');
          arrow.classList.add('rotated');
          this.debugLog('settings', '[TAPEFOUR] ⌨️ Keyboard shortcuts expanded');
        } else {
          options.classList.add('collapsed');
          arrow.classList.remove('rotated');
          this.debugLog('settings', '[TAPEFOUR] ⌨️ Keyboard shortcuts collapsed');
        }
              } else {
          this.debugWarn('settings', '[TAPEFOUR] ⚠️ Keyboard shortcuts toggle elements not found');
        }
    });

    // Tips toggle - same logic as other toggles
    document.getElementById('tips-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const options = document.getElementById('tips-options');
      const arrow = document.getElementById('tips-arrow');
      
      if (options && arrow) {
        const isCollapsed = options.classList.contains('collapsed');
        this.debugLog('settings', `[TAPEFOUR] 💡 Tips toggle clicked, currently collapsed: ${isCollapsed}`);
        
        if (isCollapsed) {
          options.classList.remove('collapsed');
          arrow.classList.add('rotated');
          this.debugLog('settings', '[TAPEFOUR] 💡 Tips expanded');
        } else {
          options.classList.add('collapsed');
          arrow.classList.remove('rotated');
          this.debugLog('settings', '[TAPEFOUR] 💡 Tips collapsed');
        }
              } else {
          this.debugWarn('settings', '[TAPEFOUR] ⚠️ Tips toggle elements not found');
        }
    });

    // Theme toggle - same logic as other toggles
    document.getElementById('theme-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const options = document.getElementById('theme-options');
      const arrow = document.getElementById('theme-arrow');
      
      if (options && arrow) {
        const isCollapsed = options.classList.contains('collapsed');
        this.debugLog('settings', `[TAPEFOUR] 🎨 Theme toggle clicked, currently collapsed: ${isCollapsed}`);
        
        if (isCollapsed) {
          options.classList.remove('collapsed');
          arrow.classList.add('rotated');
          this.debugLog('settings', '[TAPEFOUR] 🎨 Theme expanded');
        } else {
          options.classList.add('collapsed');
          arrow.classList.remove('rotated');
          this.debugLog('settings', '[TAPEFOUR] 🎨 Theme collapsed');
        }
              } else {
          this.debugWarn('settings', '[TAPEFOUR] ⚠️ Theme toggle elements not found');
        }
    });

    // Audio processing settings checkboxes
    document.getElementById('echo-cancellation-checkbox')?.addEventListener('change', (e) => {
      this.state.echoCancellation = (e.target as HTMLInputElement).checked;
      this.saveAudioProcessingSettings();
      this.debugLog('settings', `[TAPEFOUR] 🔧 Echo cancellation ${this.state.echoCancellation ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('noise-suppression-checkbox')?.addEventListener('change', (e) => {
      this.state.noiseSuppression = (e.target as HTMLInputElement).checked;
      this.saveAudioProcessingSettings();
      this.debugLog('settings', `[TAPEFOUR] 🔧 Noise suppression ${this.state.noiseSuppression ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('auto-gain-control-checkbox')?.addEventListener('change', (e) => {
      this.state.autoGainControl = (e.target as HTMLInputElement).checked;
      this.saveAudioProcessingSettings();
      this.debugLog('settings', `[TAPEFOUR] 🔧 Auto gain control ${this.state.autoGainControl ? 'enabled' : 'disabled'}`);
    });

    // Export mode toggle buttons
    document.getElementById('multitrack-export-btn')?.addEventListener('click', () => {
      this.state.multiTrackExport = true;
      this.saveAudioProcessingSettings();
      this.debugLog('settings', '[TAPEFOUR] 📁 Export mode changed to MultiTrack');
      
      // Update UI
      const multiTrackBtn = document.getElementById('multitrack-export-btn');
      const masterBtn = document.getElementById('master-export-btn');
      if (multiTrackBtn && masterBtn) {
        multiTrackBtn.classList.add('active');
        masterBtn.classList.remove('active');
      }
    });

    document.getElementById('master-export-btn')?.addEventListener('click', () => {
      this.state.multiTrackExport = false;
      this.saveAudioProcessingSettings();
      this.debugLog('settings', '[TAPEFOUR] 📁 Export mode changed to Master Only');
      
      // Update UI
      const multiTrackBtn = document.getElementById('multitrack-export-btn');
      const masterBtn = document.getElementById('master-export-btn');
      if (multiTrackBtn && masterBtn) {
        multiTrackBtn.classList.remove('active');
        masterBtn.classList.add('active');
      }
    });

    // Dismiss modal on backdrop click
    document.getElementById('settings-modal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'settings-modal') this.closeSettings();
    });
    
    document.getElementById('error-modal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'error-modal') this.closeError();
    });
    
    document.getElementById('warning-modal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'warning-modal') this.closeWarning();
    });

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
        return;
      }

      // Prevent key repeat for all shortcuts
      if (e.repeat) return;

      switch (e.code) {
        case 'KeyA':
          // A key for play
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ A key pressed - triggering play');
          this.play();
          break;
        
        case 'KeyP':
          // P key for pause
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ P key pressed - triggering pause');
          this.pause();
          break;
        
        case 'KeyQ':
          // Q key for record
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ Q key pressed - triggering record');
          this.record();
          break;
        
        case 'KeyS':
          // S key for stop
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ S key pressed - triggering stop');
          this.stop();
          break;
        
        case 'KeyE':
          // E key for export
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ E key pressed - triggering export');
          this.export();
          break;
        
        case 'KeyB':
          // B key for bounce
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ B key pressed - triggering bounce');
          this.bounce();
          break;
        
        case 'KeyN':
          // N key for clear everything
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ N key pressed - triggering clear everything');
          this.clearEverything();
          break;
        
        case 'Digit1':
          // 1 key for track 1
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ 1 key pressed - toggling track 1 arm');
          this.toggleTrackArm(1);
          break;
        
        case 'Digit2':
          // 2 key for track 2
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ 2 key pressed - toggling track 2 arm');
          this.toggleTrackArm(2);
          break;
        
        case 'Digit3':
          // 3 key for track 3
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ 3 key pressed - toggling track 3 arm');
          this.toggleTrackArm(3);
          break;
        
        case 'Digit4':
          // 4 key for track 4
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ 4 key pressed - toggling track 4 arm');
          this.toggleTrackArm(4);
          break;
        
        case 'Comma':
          // Comma key for settings (both , and < which is shift+comma)
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ Comma key pressed - toggling settings');
          this.toggleSettings();
          break;
        
        case 'KeyL':
          // L key for loop toggle
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ L key pressed - toggling loop');
          this.toggleLoop();
          break;
        
        case 'KeyU':
          // U key for undo
          e.preventDefault();
          this.debugLog('keyboard', '[TAPEFOUR] ⌨️ U key pressed - triggering undo');
          this.undoLastOverride();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    // Playhead scrubbing functionality
    this.setupPlayheadScrubbing();
    
    // Loop handle dragging functionality
    this.setupLoopHandleDragging();
    
    // Mark event listeners as initialized
    this.eventListenersInitialized = true;
    this.debugLog('general', '[TAPEFOUR] ✅ Event listeners setup complete');
  }

  private setupPlayheadScrubbing() {
    // Get playhead container and indicator elements
    this.playheadContainer = document.getElementById('playhead');
    const playheadIndicator = document.getElementById('playhead-indicator') as HTMLElement | null;
    
    if (!this.playheadContainer || !playheadIndicator) {
      this.debugWarn('scrub', '[SCRUB] ⚠️ Playhead elements not found, scrubbing disabled');
      return;
    }
    
    this.debugLog('scrub', '[SCRUB] 🎯 Setting up playhead scrubbing...');
    
    // Add mouse event listeners for scrubbing
    const onMouseDown = (e: MouseEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) return;
      
      this.isDraggingPlayhead = true;
      this.debugLog('scrub', '[SCRUB] 🎯 Started playhead dragging');
      
      // Handle the initial position
      this.handlePlayheadDrag(e);
      
      e.preventDefault();
      e.stopPropagation();
      
      // Add document-level event listeners for smooth dragging
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };
    
    const onMouseMove = (e: MouseEvent) => {
      if (this.isDraggingPlayhead) {
        this.handlePlayheadDrag(e);
        e.preventDefault();
      }
    };
    
    const onMouseUp = () => {
      if (this.isDraggingPlayhead) {
        this.isDraggingPlayhead = false;
        this.debugLog('scrub', '[SCRUB] 🎯 Stopped playhead dragging');
        
        // If we were playing during the drag, restart audio from new position
        if (this.state.isPlaying && !this.state.isPaused) {
          this.restartPlaybackFromCurrentPosition();
        }
        
        // Remove document-level event listeners
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
    };
    
    // Attach listeners to both the playhead container and indicator
    this.playheadContainer.addEventListener('mousedown', onMouseDown);
    playheadIndicator.addEventListener('mousedown', onMouseDown);
    
    // Add click handling for immediate seek
    const onClick = (e: MouseEvent) => {
      // Only handle clicks if not dragging (to avoid double-triggering)
      if (!this.isDraggingPlayhead) {
        this.handlePlayheadDrag(e);
        this.debugLog('scrub', '[SCRUB] 🎯 Playhead clicked to seek');
      }
    };
    
    this.playheadContainer.addEventListener('click', onClick);
    
    // Add visual feedback with CSS cursor
    this.updatePlayheadCursor();
    
    this.debugLog('scrub', '[SCRUB] ✅ Playhead scrubbing setup complete');
  }

  private setupLoopHandleDragging() {
    if (!this.waveformCanvas) {
      this.debugWarn('general', '[LOOP] ⚠️ Waveform canvas not found, loop handle dragging disabled');
      return;
    }
    
    this.debugLog('general', '[LOOP] 🎯 Setting up loop handle dragging...');
    
    const onMouseDown = (e: MouseEvent) => {
      if (!this.state.isLooping || !this.waveformCanvas) return;
      
      const rect = this.waveformCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      
      // Convert to canvas coordinates
      const canvasScale = this.waveformCanvas.width / rect.width;
      const canvasX = x * canvasScale;
      
      // Convert to time coordinates
      const maxTimeSeconds = this.state.maxRecordingTime / 1000;
      const canvasInternalWidth = this.waveformCanvas.width;
      const loopStartX = (this.state.loopStart / maxTimeSeconds) * canvasInternalWidth;
      const loopEndX = (this.state.loopEnd / maxTimeSeconds) * canvasInternalWidth;
      
      const handleTolerance = 12; // Pixels
      
      // Check if clicking on loop start handle
      if (Math.abs(canvasX - loopStartX) < handleTolerance) {
        this.state.isDraggingLoopStart = true;
        this.debugLog('general', '[LOOP] 🎯 Started dragging loop start handle');
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // Check if clicking on loop end handle
      if (Math.abs(canvasX - loopEndX) < handleTolerance) {
        this.state.isDraggingLoopEnd = true;
        this.debugLog('general', '[LOOP] 🎯 Started dragging loop end handle');
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    };
    
    const onMouseMove = (e: MouseEvent) => {
      if ((!this.state.isDraggingLoopStart && !this.state.isDraggingLoopEnd) || !this.waveformCanvas) return;
      
      const rect = this.waveformCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      
      // Convert to time
      const progress = Math.max(0, Math.min(1, x / rect.width));
      const maxTimeSeconds = this.state.maxRecordingTime / 1000;
      const timeInSeconds = progress * maxTimeSeconds;
      
      // Snap to 0.1s increments for easier use
      const snappedTime = Math.round(timeInSeconds * 10) / 10;
      
      if (this.state.isDraggingLoopStart) {
        this.setLoopStart(snappedTime);
      } else if (this.state.isDraggingLoopEnd) {
        this.setLoopEnd(snappedTime);
      }
      
      e.preventDefault();
    };
    
    const onMouseUp = () => {
      if (this.state.isDraggingLoopStart || this.state.isDraggingLoopEnd) {
        this.debugLog('general', `[LOOP] 🎯 Finished dragging loop handle`);
        this.state.isDraggingLoopStart = false;
        this.state.isDraggingLoopEnd = false;
        this.redrawAllTrackWaveforms(); // Refresh to show final handle state
      }
    };
    
    const onDoubleClick = (e: MouseEvent) => {
      if (!this.state.isLooping || !this.waveformCanvas) return;
      
      const rect = this.waveformCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      
      // Convert to canvas coordinates
      const canvasScale = this.waveformCanvas.width / rect.width;
      const canvasX = x * canvasScale;
      
      // Convert to time coordinates
      const maxTimeSeconds = this.state.maxRecordingTime / 1000;
      const canvasInternalWidth = this.waveformCanvas.width;
      const loopStartX = (this.state.loopStart / maxTimeSeconds) * canvasInternalWidth;
      const loopEndX = (this.state.loopEnd / maxTimeSeconds) * canvasInternalWidth;
      
      const handleTolerance = 12; // Pixels
      
      // Double-click on start handle resets to 0
      if (Math.abs(canvasX - loopStartX) < handleTolerance) {
        this.setLoopStart(0);
        this.debugLog('general', '[LOOP] 🎯 Reset loop start to 0s');
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // Double-click on end handle resets to track duration
      if (Math.abs(canvasX - loopEndX) < handleTolerance) {
        const trackDuration = this.getMaxTrackDuration();
        this.setLoopEnd(trackDuration);
        this.debugLog('general', `[LOOP] 🎯 Reset loop end to ${trackDuration.toFixed(2)}s`);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    };
    
    // Add event listeners to waveform canvas
    this.waveformCanvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    this.waveformCanvas.addEventListener('dblclick', onDoubleClick);
    
    // Update cursor style when hovering over handles
    this.waveformCanvas.addEventListener('mousemove', (e) => {
      if (!this.state.isLooping || !this.waveformCanvas) return;
      
      const rect = this.waveformCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const canvasScale = this.waveformCanvas.width / rect.width;
      const canvasX = x * canvasScale;
      
      const maxTimeSeconds = this.state.maxRecordingTime / 1000;
      const canvasInternalWidth = this.waveformCanvas.width;
      const loopStartX = (this.state.loopStart / maxTimeSeconds) * canvasInternalWidth;
      const loopEndX = (this.state.loopEnd / maxTimeSeconds) * canvasInternalWidth;
      
      const handleTolerance = 12;
      const isOverHandle = Math.abs(canvasX - loopStartX) < handleTolerance || 
                          Math.abs(canvasX - loopEndX) < handleTolerance;
      
      this.waveformCanvas.style.cursor = isOverHandle ? 'ew-resize' : 'pointer';
    });
    
    this.debugLog('general', '[LOOP] ✅ Loop handle dragging setup complete');
  }

  private getMaxTrackDuration(): number {
    let maxDuration = 0;
    
    // Check individual tracks
    this.tracks.forEach(track => {
      if (track.audioBuffer) {
        maxDuration = Math.max(maxDuration, track.audioBuffer.duration);
      }
    });
    
    // Check master buffer
    if (this.state.masterBuffer) {
      maxDuration = Math.max(maxDuration, this.state.masterBuffer.duration);
    }
    
    return maxDuration || (this.state.maxRecordingTime / 1000);
  }

  private handlePlayheadDrag(e: MouseEvent) {
    if (!this.playheadContainer) return;
    
    // Disable scrubbing while recording to prevent accidental repositioning
    if (this.state.isRecording) {
      this.debugLog('scrub', '[SCRUB] ⚠️ Scrubbing disabled during recording');
      return;
    }
    
    // Get mouse position relative to the playhead container
    const rect = this.playheadContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    // Convert pixel position to time position
    const progress = Math.max(0, Math.min(1, x / rect.width));
    const newPosition = progress * this.state.maxRecordingTime;
    
    // Update playhead position
    this.state.playheadPosition = newPosition;
    
    // Update UI immediately
    this.updatePlayheadUI();
    
    this.debugLog('scrub', `[SCRUB] 🎯 Scrubbed to ${(newPosition / 1000).toFixed(2)}s (${(progress * 100).toFixed(1)}%)`);
  }

  private updatePlayheadCursor() {
    if (!this.playheadContainer) return;
    
    const playheadIndicator = document.getElementById('playhead-indicator') as HTMLElement | null;
    
    if (this.state.isRecording) {
      // Recording mode: show disabled cursor
      this.playheadContainer.style.cursor = 'not-allowed';
      if (playheadIndicator) playheadIndicator.style.cursor = 'not-allowed';
      this.playheadContainer.title = 'Scrubbing disabled during recording';
    } else {
      // Normal mode: show interactive cursor
      this.playheadContainer.style.cursor = 'pointer';
      if (playheadIndicator) playheadIndicator.style.cursor = 'grab';
      this.playheadContainer.title = 'Click or drag to scrub timeline';
    }
  }

  private restartPlaybackFromCurrentPosition() {
    this.debugLog('scrub', '[SCRUB] 🔄 Restarting playback from scrubbed position');
    
    // Stop any existing audio sources with proper cleanup
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        this.debugLog('transport', `🛑 Stopping track ${t.id} source to restart from scrubbed position`);
        try {
          t.sourceNode.stop();
          t.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
          this.debugLog('transport', `  - Track ${t.id} source already stopped`);
        }
        t.sourceNode = null;
      }
    });
    
    // Update the play start time to account for the new position
    this.playStartTime = Date.now() - this.state.playheadPosition;
    
    // Add a small delay to ensure all sources are fully stopped before restarting
    setTimeout(() => {
      if (this.state.isPlaying && !this.state.isPaused) {
        // Restart all tracks from the current playhead position
        const startTime = this.audioContext!.currentTime + 0.05; // Small delay for sync
        this.tracks.forEach((t) => {
          if (t.audioBuffer) {
            this.debugLog('scrub', `🎶 Restarting track ${t.id} from position ${(this.state.playheadPosition / 1000).toFixed(2)}s`);
            this.playTrack(t, startTime);
          }
        });
        
        this.debugLog('scrub', `✅ Restarted playback from ${(this.state.playheadPosition / 1000).toFixed(2)}s`);
      }
    }, 10); // 10ms delay to ensure cleanup is complete
  }

  /* ---------- UI helpers ---------- */

  private toggleTrackArm(trackId: number) {
    // Check if we should show the warning first (for keyboard shortcuts)
    if (this.shouldShowWarning() && !this.tracks[trackId - 1].isArmed) {
      // Only show warning when arming a track (not when disarming)
      this.showWarning(trackId);
      return;
    }
    
    // If warning is disabled or track is being disarmed, proceed directly
    this.doToggleTrackArm(trackId);
  }

  private async doToggleTrackArm(trackId: number) {
    const track = this.tracks.find((t) => t.id === trackId)!;
    const el = document.getElementById(`track-${trackId}`) as HTMLInputElement;

    // Exclusive arming: only one track can be armed at a time
    if (track.isArmed) {
      // Disarm this track
      track.isArmed = false;
      if (el) el.checked = false;
    } else {
      // Disarm all other tracks first
      this.tracks.forEach((t) => {
        if (t.id !== trackId) {
          t.isArmed = false;
          const otherEl = document.getElementById(`track-${t.id}`) as HTMLInputElement;
          if (otherEl) otherEl.checked = false;
        }
      });
      
      // Arm this track
      track.isArmed = true;
      if (el) el.checked = true;
    }
    
    // Save armed track state to localStorage
    this.saveArmedTrackState();
    
    // Start/stop volume meter monitoring when tracks are armed/disarmed
    await this.manageVolumeMeter();
    this.updateUndoButtonState();
  }

  private async manageVolumeMeter() {
    const hasArmedTracks = this.tracks.some(t => t.isArmed);
    
    if (hasArmedTracks && !this.volumeMeterActive) {
      await this.startVolumeMeter(); // Wait for volume meter and media stream setup
      await this.startInputMonitoring(); // Then start input monitoring
    } else if (!hasArmedTracks && this.volumeMeterActive) {
      this.stopVolumeMeter();
      this.stopInputMonitoring();
    }
  }

  private toggleTrackSolo(trackId: number) {
    const track = this.tracks.find((t) => t.id === trackId)!;
    const el = document.getElementById(`solo-${trackId}`) as HTMLInputElement;

    // Check if any track is currently soloed
    const currentlySoloedTrack = this.tracks.find(t => t.isSolo);

    // Exclusive solo: only one track can be soloed at a time
    if (track.isSolo) {
      // Unsolo this track - restore previous mute states
      track.isSolo = false;
      if (el) el.checked = false;
      
      // Restore previous mute states (from before any solo was active)
      this.tracks.forEach((t, index) => {
        t.isMuted = this.previousMuteStates[index];
        t.isManuallyMuted = this.previousMuteStates[index];
        // Update mute button visual state to match manual mute state
        const muteEl = document.getElementById(`mute-${t.id}`) as HTMLInputElement;
        if (muteEl) muteEl.checked = t.isManuallyMuted;
        // Update mute button styling to reflect restored state
        this.updateMuteButtonStyling(t.id);
      });
      
      this.debugLog('audio', `[TAPEFOUR] 🔇 Track ${trackId} unsolo - restored previous mute states:`, this.previousMuteStates);
    } else {
      // Only store current manual mute states if no track is currently soloed
      // This prevents overwriting the original states when switching between solo tracks
      if (!currentlySoloedTrack) {
        this.tracks.forEach((t, index) => {
          this.previousMuteStates[index] = t.isManuallyMuted;
        });
        this.debugLog('audio', `[TAPEFOUR] 💾 Stored original manual mute states before first solo:`, this.previousMuteStates);
      }
      
      // Unsolo all other tracks first
      this.tracks.forEach((t) => {
        if (t.id !== trackId) {
          t.isSolo = false;
          const otherEl = document.getElementById(`solo-${t.id}`) as HTMLInputElement;
          if (otherEl) otherEl.checked = false;
        }
      });
      
      // Solo this track - mute all tracks except this one
      this.tracks.forEach((t) => {
        t.isMuted = t.id !== trackId; // Mute all tracks except the soloed one
        // Don't update mute button visual state when soloing - only when manually clicked
        // But do update the styling to show which tracks are effectively muted
        this.updateMuteButtonStyling(t.id);
      });
      
      // Set solo state
      track.isSolo = true;
      if (el) el.checked = true;
      
      this.debugLog('audio', `[TAPEFOUR] 🔊 Track ${trackId} soloed - all other tracks muted`);
    }
    
    // Update audio routing
    this.updateAudioRouting();
  }

  private toggleTrackMute(trackId: number) {
    const track = this.tracks.find((t) => t.id === trackId)!;
    const el = document.getElementById(`mute-${trackId}`) as HTMLInputElement;

    // If any track is currently soloed, don't allow manual mute changes
    const hasSoloedTrack = this.tracks.some(t => t.isSolo);
    if (hasSoloedTrack) {
      this.debugLog('audio', `[TAPEFOUR] ⚠️ Cannot manually mute/unmute while a track is soloed`);
      // Reset the checkbox to current manual mute state
      if (el) el.checked = track.isManuallyMuted;
      return;
    }

    // Toggle manual mute state
    track.isManuallyMuted = !track.isManuallyMuted;
    track.isMuted = track.isManuallyMuted; // Sync internal state with manual state
    if (el) el.checked = track.isManuallyMuted;
    
    this.debugLog('audio', `[TAPEFOUR] ${track.isManuallyMuted ? '🔇' : '🔊'} Track ${trackId} ${track.isManuallyMuted ? 'manually muted' : 'manually unmuted'}`);
    
    // Update mute button styling based on new state
    this.updateMuteButtonStyling(trackId);
    
    // Update audio routing
    this.updateAudioRouting();
  }

  private updateAudioRouting() {
    // Update gain nodes based on mute/solo state
    this.tracks.forEach((track) => {
      if (track.gainNode) {
        // If track is muted, set gain to 0, otherwise use fader value
        if (track.isMuted) {
          track.gainNode.gain.value = 0;
        } else {
          // Get current fader value and apply it
          const fader = document.getElementById(`fader-${track.id}`) as HTMLInputElement | null;
          const faderValue = fader ? parseInt(fader.value) : 80; // Default to 0 dB (80%)
          track.gainNode.gain.value = this.faderToGain(faderValue);
        }
      }
    });
  }

  // Audio fader taper conversion functions
  private faderToGain(faderValue: number): number {
    if (faderValue === 0) return 0; // -∞ dB
    
    if (faderValue <= 80) {
      // Logarithmic taper for 0-80% -> -60dB to 0dB
      const ratio = faderValue / 80;
      const dB = -60 + (60 * Math.pow(ratio, 0.25)); // Fourth root for audio taper
      return Math.pow(10, dB / 20);
    } else {
      // Linear taper for 80-100% -> 0dB to +12dB
      const ratio = (faderValue - 80) / 20;
      const dB = ratio * 12;
      return Math.pow(10, dB / 20);
    }
  }

  private gainToDb(gain: number): number {
    if (gain === 0) return -Infinity;
    return 20 * Math.log10(gain);
  }

  private updateTrackGain(trackId: number, value: number) {
    const track = this.tracks.find((t) => t.id === trackId)!;
    if (track.gainNode) {
      // If track is muted, keep gain at 0 regardless of fader position
      if (track.isMuted) {
        track.gainNode.gain.value = 0;
        this.debugLog('audio', `🎚️ Track ${trackId} fader moved to ${value}% but track is muted (gain remains 0)`);
      } else {
        const gainValue = this.faderToGain(value);
        const dbValue = this.gainToDb(gainValue);
        track.gainNode.gain.value = gainValue;
        this.debugLog('audio', `🎚️ Track ${trackId} fader at ${value}% = ${dbValue.toFixed(1)} dB (gain: ${gainValue.toFixed(3)})`);
      }
    } else {
      this.debugWarn('audio', `⚠️ No gain node found for track ${trackId}`);
    }
    
    // Update the CSS custom property for the volume indicator line position
    const faderElement = document.getElementById(`fader-${trackId}`) as HTMLElement;
    if (faderElement) {
      faderElement.style.setProperty('--fader-value', value.toString());
    }
  }

  private updateMasterGain(value: number) {
    if (this.masterGainNode) {
      const gainValue = this.faderToGain(value);
      const dbValue = this.gainToDb(gainValue);
      this.masterGainNode.gain.value = gainValue;
      this.debugLog('audio', `🎚️ Master fader at ${value}% = ${dbValue.toFixed(1)} dB (gain: ${gainValue.toFixed(3)})`);
    }
    
    // Update the CSS custom property for the master fader volume indicator line position
    const masterFaderElement = document.getElementById('master-fader') as HTMLElement;
    if (masterFaderElement) {
      masterFaderElement.style.setProperty('--master-fader-value', value.toString());
    }
  }

  private resetTrackFader(trackId: number) {
    const fader = document.getElementById(`fader-${trackId}`) as HTMLInputElement | null;
    if (fader) {
      const currentValue = parseInt(fader.value);
      const targetValue = 80; // 0 dB with logarithmic taper
      
      // Only animate if there's a difference
      if (currentValue !== targetValue) {
        // Add reset animation class for visual feedback
        fader.classList.add('fader-resetting');
        
        // Animate the fader value smoothly
        this.animateFaderValue(fader, currentValue, targetValue, 200, (value: number) => {
          this.updateTrackGain(trackId, value);
        });
        
        // Remove the animation class after animation completes
        setTimeout(() => {
          fader.classList.remove('fader-resetting');
        }, 200);
      }
      
      this.debugLog('audio', `🎚️ Track ${trackId} fader reset to default (80% = 0 dB)`);
    }
  }

  private resetMasterFader() {
    const masterFader = document.getElementById('master-fader') as HTMLInputElement | null;
    if (masterFader) {
      const currentValue = parseInt(masterFader.value);
      const targetValue = 80; // 0 dB with logarithmic taper
      
      // Only animate if there's a difference
      if (currentValue !== targetValue) {
        // Add reset animation class for visual feedback
        masterFader.classList.add('fader-resetting');
        
        // Animate the fader value smoothly
        this.animateFaderValue(masterFader, currentValue, targetValue, 200, (value: number) => {
          this.updateMasterGain(value);
        });
        
        // Remove the animation class after animation completes
        setTimeout(() => {
          masterFader.classList.remove('fader-resetting');
        }, 200);
      }
      
      this.debugLog('audio', `🎚️ Master fader reset to default (80% = 0 dB)`);
    }
  }

  private animateFaderValue(
    fader: HTMLInputElement, 
    startValue: number, 
    endValue: number, 
    duration: number, 
    onUpdate: (value: number) => void
  ) {
    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Use easeOutCubic for smooth deceleration
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      
      const currentValue = startValue + (endValue - startValue) * easeOutCubic;
      const roundedValue = Math.round(currentValue);
      
      fader.value = roundedValue.toString();
      onUpdate(roundedValue);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    requestAnimationFrame(animate);
  }

  private updateTrackPan(trackId: number, value: number) {
    const track = this.tracks.find((t) => t.id === trackId)!;
    if (track.panNode) {
      // Convert 0-100 range to -1 to 1 range for StereoPannerNode
      // 0 = fully left (-1), 50 = center (0), 100 = fully right (1)
      const panValue = (value - 50) / 50;
      track.panNode.pan.value = panValue;
      track.panValue = value;
      this.debugLog('audio', `🎛️ Track ${trackId} pan set to ${value} (${panValue.toFixed(2)})`);
    } else {
      this.debugWarn('audio', `⚠️ No pan node found for track ${trackId}`);
    }
  }

  private resetTrackPan(trackId: number) {
    const panKnob = document.getElementById(`pan-${trackId}`) as HTMLInputElement | null;
    if (panKnob) {
      panKnob.value = '50'; // Reset to center
      this.updateTrackPan(trackId, 50); // Update the pan
      this.debugLog('audio', `🎛️ Track ${trackId} pan reset to center (50)`);
    }
  }

  private applyTrackColorsToUI() {
    // Apply track colors to mute button backgrounds for visual consistency
    this.tracks.forEach((track) => {
      this.updateMuteButtonStyling(track.id);
    });
  }

  private toggleTrackReverse(trackId: number) {
    this.debugLog('processing', `[TAPEFOUR] 🔄 Toggling reverse for track ${trackId}`);
    
    const track = this.tracks[trackId - 1];
    if (!track) return;

    // Safety check: Stop transport if playing or recording
    if (this.state.isPlaying || this.state.isRecording) {
      this.debugLog('processing', '[TAPEFOUR] 🛑 Stopping transport before reversing track');
      this.stop();
    }

    // Check if track has audio
    if (!track.audioBuffer) {
      this.debugLog('processing', `[TAPEFOUR] ⚠️ Track ${trackId} has no audio to reverse`);
      return;
    }

    try {
      if (track.isReversed) {
        // Track is currently reversed, restore original
        if (track.originalBuffer) {
          this.debugLog('processing', `[TAPEFOUR] ⏮️ Restoring original audio for track ${trackId}`);
          track.audioBuffer = track.originalBuffer;
          track.isReversed = false;
        }
      } else {
        // Track is not reversed, reverse it
        this.debugLog('processing', `[TAPEFOUR] 🔄 Reversing audio for track ${trackId}`);
        
        // Store original buffer if not already stored
        if (!track.originalBuffer) {
          track.originalBuffer = track.audioBuffer;
        }
        
        // Create reversed buffer
        const reversedBuffer = this.reverseAudioBuffer(track.audioBuffer);
        track.audioBuffer = reversedBuffer;
        track.isReversed = true;
      }

      // Update UI state
      this.updateReverseButtonStyling(trackId);
      
      // Redraw waveforms with visual flip for reversed tracks
      this.redrawAllTrackWaveforms();
      
      this.debugLog('processing', `[TAPEFOUR] ✅ Track ${trackId} reverse toggle complete. Reversed: ${track.isReversed}`);
      
    } catch (error) {
      this.debugError('processing', `[TAPEFOUR] ❌ Error reversing track ${trackId}:`, error);
      this.showError(`Failed to reverse track ${trackId}. Please try again.`);
    }
  }

  private reverseAudioBuffer(originalBuffer: AudioBuffer): AudioBuffer {
    if (!this.audioContext) {
      throw new Error('No audio context available');
    }

    // Create new buffer with same properties
    const reversedBuffer = this.audioContext.createBuffer(
      originalBuffer.numberOfChannels,
      originalBuffer.length,
      originalBuffer.sampleRate
    );

    // Reverse each channel
    for (let channel = 0; channel < originalBuffer.numberOfChannels; channel++) {
      const originalData = originalBuffer.getChannelData(channel);
      const reversedData = reversedBuffer.getChannelData(channel);
      
      // Copy samples in reverse order
      for (let i = 0; i < originalData.length; i++) {
        reversedData[i] = originalData[originalData.length - 1 - i];
      }
    }

    return reversedBuffer;
  }

  private updateReverseButtonStyling(trackId: number) {
    const reverseButton = document.getElementById(`reverse-${trackId}`);
    const track = this.tracks[trackId - 1];
    
    if (!reverseButton || !track) return;

    // Update button visual state
    if (track.isReversed) {
      reverseButton.classList.add('active');
    } else {
      reverseButton.classList.remove('active');
    }

    // Update button disabled state
    if (!track.audioBuffer) {
      reverseButton.setAttribute('disabled', 'true');
      reverseButton.setAttribute('title', 'No audio to reverse');
    } else {
      reverseButton.removeAttribute('disabled');
      reverseButton.setAttribute('title', `Reverse Track ${trackId}`);
    }
  }

  private async toggleTrackHalfSpeed(trackId: number) {
    this.debugLog('halfSpeed', `[HALF-SPEED] 🐌 toggleTrackHalfSpeed() called for track ${trackId}`);
    
    // Transport safety - stop all activity first
    if (this.state.isPlaying || this.state.isRecording || this.state.isPaused) {
      this.debugLog('halfSpeed', '[HALF-SPEED] 🛑 Stopping transport for safety');
      this.stop();
    }
    
    const track = this.tracks.find(t => t.id === trackId);
    if (!track || !track.audioBuffer) {
      this.debugWarn('halfSpeed', `[HALF-SPEED] ⚠️ Track ${trackId} has no audio buffer to process`);
      return;
    }
    
    try {
      if (track.isHalfSpeed) {
        // Disable half-speed: restore original buffer
        this.debugLog('halfSpeed', `[HALF-SPEED] ⏮️ Disabling half-speed for track ${trackId}`);
        if (track.originalBufferForSpeed) {
          track.audioBuffer = track.originalBufferForSpeed;
          track.originalBufferForSpeed = null;
          track.isHalfSpeed = false;
          this.debugLog('halfSpeed', `[HALF-SPEED] ✅ Restored original buffer for track ${trackId}`);
        } else {
          this.debugWarn('halfSpeed', `[HALF-SPEED] ⚠️ No original buffer found for track ${trackId}`);
        }
      } else {
        // Enable half-speed: create half-speed buffer
        this.debugLog('halfSpeed', `[HALF-SPEED] 🐌 Enabling half-speed for track ${trackId}`);
        
        // Store original buffer for restoration
        track.originalBufferForSpeed = track.audioBuffer;
        
        // Show processing indicator for longer operations
        const startTime = Date.now();
        
        // Create half-speed buffer
        const halfSpeedBuffer = await this.createHalfSpeedBuffer(track.audioBuffer);
        
        const processingTime = Date.now() - startTime;
        if (processingTime > 200) {
          this.debugLog('halfSpeed', `[HALF-SPEED] ⏰ Processing took ${processingTime}ms`);
        }
        
        // Apply the half-speed buffer
        track.audioBuffer = halfSpeedBuffer;
        track.isHalfSpeed = true;
        
        this.debugLog('halfSpeed', `[HALF-SPEED] ✅ Created half-speed buffer for track ${trackId}: ${halfSpeedBuffer.duration.toFixed(2)}s (2x original)`);
      }
      
      // Update button styling
      this.updateHalfSpeedButtonStyling(trackId);
      
      // Regenerate waveform to match new duration
      this.generateTrackWaveform(track.audioBuffer, trackId);
      
      // Update project duration
      this.updateProjectDuration();
      
      this.debugLog('halfSpeed', `[HALF-SPEED] ✅ Half-speed toggle complete for track ${trackId}`);
      
    } catch (error) {
      this.debugError('halfSpeed', `[HALF-SPEED] ❌ Error toggling half-speed for track ${trackId}:`, error);
      this.showError(`Failed to process half-speed for track ${trackId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async createHalfSpeedBuffer(originalBuffer: AudioBuffer): Promise<AudioBuffer> {
    this.debugLog('halfSpeed', `[HALF-SPEED] 🔧 Creating half-speed buffer from ${originalBuffer.duration.toFixed(2)}s original`);
    
    if (!this.audioContext) {
      throw new Error('AudioContext not available');
    }
    
    // Create offline context with double the length for half-speed
    const offlineContext = new OfflineAudioContext(
      originalBuffer.numberOfChannels,
      originalBuffer.length * 2, // Double the length
      originalBuffer.sampleRate
    );
    
    // Create source and set to half playback rate
    const source = offlineContext.createBufferSource();
    source.buffer = originalBuffer;
    source.playbackRate.value = 0.5; // Half speed = double duration, lower pitch
    
    // Connect to output
    source.connect(offlineContext.destination);
    
    // Start playback and render
    source.start(0);
    const renderedBuffer = await offlineContext.startRendering();
    
    this.debugLog('halfSpeed', `[HALF-SPEED] ✅ Half-speed buffer created: ${renderedBuffer.duration.toFixed(2)}s`);
    return renderedBuffer;
  }

  private updateHalfSpeedButtonStyling(trackId: number) {
    const halfSpeedButton = document.getElementById(`half-speed-${trackId}`);
    const track = this.tracks[trackId - 1];
    
    if (!halfSpeedButton || !track) return;

    // Update button visual state
    if (track.isHalfSpeed) {
      halfSpeedButton.classList.add('active');
    } else {
      halfSpeedButton.classList.remove('active');
    }

    // Update button disabled state
    if (!track.audioBuffer) {
      halfSpeedButton.setAttribute('disabled', 'true');
      halfSpeedButton.setAttribute('title', 'No audio to slow down');
    } else {
      halfSpeedButton.removeAttribute('disabled');
      halfSpeedButton.setAttribute('title', `Half-speed Track ${trackId}`);
    }
  }

  private updateProjectDuration() {
    // Calculate the maximum duration across all tracks (including master)
    let maxDuration = 0;
    
    // Check individual tracks
    this.tracks.forEach(track => {
      if (track.audioBuffer) {
        const trackDuration = track.recordStartTime + (track.audioBuffer.duration * 1000);
        maxDuration = Math.max(maxDuration, trackDuration);
      }
    });
    
    // Check master buffer
    if (this.state.masterBuffer) {
      maxDuration = Math.max(maxDuration, this.state.masterBuffer.duration * 1000);
    }
    
    this.state.duration = maxDuration;
    this.debugLog('duration', `[DURATION] 📏 Project duration updated to ${(maxDuration / 1000).toFixed(2)}s`);
  }

  private updateMuteButtonStyling(trackId: number) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;

    const color = this.trackColors[trackId as keyof typeof this.trackColors];
    const muteButton = document.getElementById(`mute-${trackId}`) as HTMLElement | null;
    const muteLabel = document.querySelector(`label[for="mute-${trackId}"]`) as HTMLElement | null;
    
    if (muteButton && muteLabel) {
      if (track.isMuted) {
        // Muted state (either manually or via solo): use default disabled styling
        muteButton.style.backgroundColor = ''; // Reset to CSS default (--color-chassis)
        muteButton.style.borderColor = ''; // Reset to CSS default
        muteLabel.style.color = 'var(--color-text-primary)'; // Default text color
        muteLabel.style.fontWeight = '600'; // Normal weight
        
        this.debugLog('ui', `🎨 Applied muted (disabled) styling to track ${trackId} mute button`);
      } else {
        // Unmuted state: use track color
        muteButton.style.backgroundColor = color;
        muteButton.style.borderColor = this.darkenColor(color, 0.2); // Slightly darker border
        
        // Choose text color based on background luminance for optimal contrast
        const textColor = this.getContrastColor(color);
        muteLabel.style.color = textColor;
        muteLabel.style.fontWeight = '700'; // Bold for better visibility
        
        this.debugLog('ui', `🎨 Applied active color ${color} with ${textColor} text to track ${trackId} mute button`);
      }
    }
  }

  // Calculate luminance to determine if we should use black or white text
  private getContrastColor(hexColor: string): string {
    // Remove # if present
    const color = hexColor.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return black for light backgrounds, white for dark backgrounds
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
  }

  // Darken a hex color by a percentage
  private darkenColor(hexColor: string, amount: number): string {
    const color = hexColor.replace('#', '');
    const r = Math.max(0, parseInt(color.substr(0, 2), 16) * (1 - amount));
    const g = Math.max(0, parseInt(color.substr(2, 2), 16) * (1 - amount));
    const b = Math.max(0, parseInt(color.substr(4, 2), 16) * (1 - amount));
    
    return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
  }

  private updateBounceButtonState() {
    const bounceBtn = document.getElementById('bounce-btn') as HTMLButtonElement | null;
    if (!bounceBtn) return;

    // Check if bounce should be enabled
    const canBounce = this.canBounce();
    
    bounceBtn.disabled = !canBounce;
    
    if (!canBounce) {
      if (this.state.isRecording) {
        bounceBtn.title = 'Stop recording first to bounce';
      } else if (this.state.isPlaying) {
        bounceBtn.title = 'Stop playback first to bounce';
      } else {
        bounceBtn.title = 'No tracks to bounce. Record some audio first.';
      }
    } else {
      bounceBtn.title = 'Bounce to Master Track (B)';
    }
  }

  private updateLoopButtonState() {
    const loopBtn = document.getElementById('loop-btn') as HTMLButtonElement | null;
    if (!loopBtn) return;

    // Determine if loop should be enabled
    const hasAudio = this.tracks.some(t => t.audioBuffer) || !!this.state.masterBuffer;
    loopBtn.disabled = !hasAudio;

    if (!hasAudio) {
      loopBtn.title = 'Record audio to enable loop';
    } else {
      loopBtn.title = this.state.isLooping ? 'Disable Loop Mode (L)' : 'Enable Loop Mode (L)';
    }

    // Color/theme: match bounce button
    loopBtn.classList.remove('loop-enabled', 'loop-disabled');
    if (!hasAudio) {
      loopBtn.classList.add('loop-disabled');
    } else {
      loopBtn.classList.add('loop-enabled');
    }
  }

  private canBounce(): boolean {
    // Cannot bounce while recording or playing
    if (this.state.isRecording || this.state.isPlaying) {
      return false;
    }
    
    // Need either individual tracks with audio OR an existing master buffer
    const tracksToMix = this.getTracksForMixdown();
    const hasMasterBuffer = !!this.state.masterBuffer;
    const hasIndividualTracks = tracksToMix.length > 0;
    
    return tracksToMix.length >= 1 || hasMasterBuffer;
  }

  /* ---------- Transport ---------- */

  public async play() {
    this.debugLog('transport', '▶️ PLAY button pressed');
    
    // If recording, stop it first
    if (this.state.isRecording) {
      this.debugLog('transport', '🛑 Stopping active recording before playback');
      this.stopRecording();
    }
    
    // If already playing, restart from the beginning
    if (this.state.isPlaying && !this.state.isPaused) {
      this.debugLog('transport', '🔄 Already playing, restarting from beginning');
      // Call stop method to properly clean up everything
      this.stop();
      // Now continue with normal play logic below
    }

    await this.initializeAudio();
    await this.ensureInputStream();
    
    // Only mute input during playback if no tracks are armed (to preserve monitoring)
    const hasArmedTracks = this.tracks.some(t => t.isArmed);
    if (!hasArmedTracks) {
      await this.muteInput(); // Mute input during playback only when no monitoring needed
      this.debugLog('transport', '🔇 Input muted during playback (no armed tracks)');
    } else {
      this.debugLog('transport', '🎧 Keeping input active during playback for monitoring (armed tracks present)');
    }

    // If paused, use the dedicated resume method instead
    if (this.state.isPaused) {
      this.resumeFromPause();
      return;
    }

    this.debugLog('transport', '🎵 Starting fresh playback');
    
    // Disable monitoring mode for full volume playback
    this.disableMonitoringMode();
    
    // Stop any existing sources before starting new ones
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        this.debugLog('transport', `🛑 Stopping existing source for track ${t.id} before starting new playback`);
        try {
          t.sourceNode.stop();
          t.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
          this.debugLog('transport', `  - Track ${t.id} source already stopped`);
        }
        t.sourceNode = null;
      }
    });

    this.state.isPlaying = true;
    // Keep current playhead position for scrubbing functionality
    
    // Schedule all tracks to start at a slightly future time for perfect sync
    const startTime = this.audioContext!.currentTime + 0.1; // 100ms in the future
    this.playStartTime = Date.now() + 100; // Adjust playhead timer accordingly
    
    this.debugLog('transport', `🕐 Scheduling synchronized playback at audio context time: ${startTime}`);

    // Play master buffer if available (from bounce)
    if (this.state.masterBuffer) {
      this.debugLog('transport', '🏆 Playing master buffer from bounce');
      this.playMasterTrack(startTime);
    }
    
    // ALSO play any individual tracks (for layering new recordings on top of master)
    const tracksToPlay = this.tracks.filter(t => t.audioBuffer);
    if (tracksToPlay.length > 0) {
      this.debugLog('transport', `🎵 Preparing ${tracksToPlay.length} individual tracks for playback${this.state.masterBuffer ? ' (layered with master)' : ''}`);
      
      this.tracks.forEach((t) => {
        if (t.audioBuffer) {
          this.debugLog('transport', `🎶 Playing track ${t.id} - buffer length: ${t.audioBuffer.length} samples`);
          this.playTrack(t, startTime);
        } else {
          this.debugLog('transport', `⚪ Track ${t.id} has no audio buffer`);
        }
      });
    }

    this.startPlayheadTimer();
    document.getElementById('play-btn')?.classList.add('playing');
    
    // Update bounce button state
    this.updateBounceButtonState();
    
    // Initialize timecode display
    this.updateTimecode();
    this.debugLog('transport', '✅ Playback started');
  }

  private playTrack(track: typeof this.tracks[number], startTime?: number) {
    if (!track.audioBuffer || !this.audioContext) return;
    
    this.debugLog('transport', `🎵 playTrack() called for track ${track.id}`);
    
    // Calculate track's timeline boundaries
    const trackStartMs = track.recordStartTime;
    const trackEndMs = track.recordStartTime + (track.audioBuffer.duration * 1000);
    const currentPlayheadMs = this.state.playheadPosition;
    
    this.debugLog('transport', `  - Track ${track.id} timeline: ${trackStartMs}ms - ${trackEndMs}ms, playhead at ${currentPlayheadMs}ms`);
    this.debugLog('transport', `  - Track ${track.id} is ${track.isReversed ? 'REVERSED' : 'NORMAL'}, buffer duration: ${track.audioBuffer.duration.toFixed(3)}s`);
    
    // Ensure any existing source is properly stopped and cleaned up
    if (track.sourceNode) {
      this.debugLog('transport', `  - Stopping existing source for track ${track.id}`);
      try {
        track.sourceNode.stop();
        track.sourceNode.disconnect();
      } catch (e) {
        // Source might already be stopped/disconnected, ignore errors
        this.debugLog('transport', `  - Source for track ${track.id} already stopped`);
      }
      track.sourceNode = null;
    }

    let actualStartTime = startTime || this.audioContext!.currentTime;
    let bufferOffset = 0;

    if (currentPlayheadMs < trackStartMs) {
      // Case 1: Playhead is before track starts - schedule track to start at correct time
      const delaySeconds = (trackStartMs - currentPlayheadMs) / 1000;
      actualStartTime += delaySeconds;
      bufferOffset = 0; // Start from beginning of track
      this.debugLog('transport', `  - Track ${track.id} scheduled to start in ${delaySeconds.toFixed(3)}s at timeline position ${trackStartMs}ms`);
    } else if (currentPlayheadMs >= trackEndMs) {
      // Case 2: Playhead is past track end - don't play
      this.debugLog('transport', `  - Track ${track.id} not playing: playhead past end of track`);
      return;
    } else {
      // Case 3: Playhead is within track timeline - start immediately with offset
      const timeFromTrackStart = currentPlayheadMs - trackStartMs;
      bufferOffset = timeFromTrackStart / 1000;
      this.debugLog('transport', `  - Track ${track.id} starting immediately with offset ${bufferOffset.toFixed(3)}s`);
    }

    // For reversed tracks, the buffer is already reversed, so we use the same offset logic
    if (track.isReversed) {
      this.debugLog('transport', `  - Track ${track.id} is REVERSED: using offset ${bufferOffset.toFixed(3)}s in reversed buffer`);
    }
    
    // Ensure offset is within valid bounds
    bufferOffset = Math.max(0, Math.min(bufferOffset, track.audioBuffer.duration - 0.001));

    const source = this.audioContext!.createBufferSource();
    source.buffer = track.audioBuffer!;
    this.debugLog('transport', `  - Created source node for track ${track.id}`);
    this.debugLog('transport', `  - Connecting: source -> gainNode(${track.gainNode!.gain.value}) -> panNode(${track.panNode!.pan.value}) -> master`);
    source.connect(track.gainNode!);
    source.onended = () => {
      this.debugLog('transport', `  - Track ${track.id} source ended naturally`);
      if (track.sourceNode === source) {
        track.sourceNode = null;
      }
    };
    
    // Add debug logging for scheduled sources
    if (actualStartTime > this.audioContext!.currentTime + 0.2) {
      this.debugLog('transport', `  - Track ${track.id} scheduled to start at ${actualStartTime.toFixed(3)}, current time is ${this.audioContext!.currentTime.toFixed(3)} (delay: ${(actualStartTime - this.audioContext!.currentTime).toFixed(3)}s)`);
      
      // Add a timeout to check if the source actually starts
      setTimeout(() => {
        this.debugLog('transport', `  - Checking scheduled track ${track.id}: sourceNode is ${track.sourceNode ? 'still active' : 'null'}`);
      }, (actualStartTime - this.audioContext!.currentTime) * 1000 + 100);
    }
    
    source.start(actualStartTime, bufferOffset);
    this.debugLog('transport', `  - Started track ${track.id} playback at audio context time: ${actualStartTime.toFixed(3)}, buffer offset: ${bufferOffset.toFixed(3)}s`);

    track.sourceNode = source;
  }

  private playMasterTrack(startTime?: number) {
    if (!this.state.masterBuffer || !this.audioContext) return;
    
    this.debugLog('transport', `🏆 playMasterTrack() called`);
    
    // Stop any existing master source
    if ((this as any).masterSourceNode) {
      try {
        (this as any).masterSourceNode.stop();
        (this as any).masterSourceNode.disconnect();
      } catch (e) {
        this.debugLog('transport', '  - Master source already stopped');
      }
      (this as any).masterSourceNode = null;
    }
    
    // Create a dedicated source for the master buffer
    const source = this.audioContext.createBufferSource();
    source.buffer = this.state.masterBuffer;
    
    // Connect directly to master gain (no individual track processing needed)
    source.connect(this.masterGainNode!);
    
    const actualStartTime = startTime || this.audioContext.currentTime;
    const startOffset = this.state.playheadPosition / 1000; // Convert ms to seconds
    
    this.debugLog('transport', `  - Starting master source at time ${actualStartTime} from position ${startOffset.toFixed(2)}s`);
    source.start(actualStartTime, startOffset);
    
    // Store reference for cleanup during stop()
    (this as any).masterSourceNode = source;
    
    source.onended = () => {
      this.debugLog('transport', `  - Master source ended naturally`);
      (this as any).masterSourceNode = null;
    };
  }

  public stop() {
    this.debugLog('transport', '⏹️ STOP button pressed');
    
    // Add visual feedback to stop button
    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) {
      stopBtn.classList.add('stopping');
      // Remove the class after 200ms for brief flash effect
      setTimeout(() => {
        stopBtn.classList.remove('stopping');
      }, 200);
    }
    
    // Stop recording if active
    if (this.state.isRecording) {
      this.debugLog('transport', '🛑 Stopping active recording');
      // Force the MediaRecorder to stop and process the recording
      if (this.mediaRecorder?.state === 'recording') {
        this.debugLog('transport', '[TAPEFOUR] 🎬 Forcing MediaRecorder to stop and process recording');
        this.mediaRecorder.stop(); // This will trigger processRecording()
      }
      this.stopRecording();
    }
    
    // FORCE stop all transport state - this fixes loop playback not stopping
    this.state.isPlaying = false;
    this.state.isPaused = false;
    this.state.playheadPosition = 0; // Reset playhead to beginning on stop

    this.debugLog('transport', '🛑 Stopping all track sources');
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        this.debugLog('transport', `  - Stopping track ${t.id} source`);
        try {
          t.sourceNode.stop();
          t.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
          this.debugLog('transport', `  - Track ${t.id} source already stopped`);
        }
        t.sourceNode = null;
      }
    });

    // Stop master source if playing
    if ((this as any).masterSourceNode) {
      this.debugLog('transport', '🛑 Stopping master source');
      try {
        (this as any).masterSourceNode.stop();
        (this as any).masterSourceNode.disconnect();
      } catch (e) {
        this.debugLog('transport', '  - Master source already stopped');
      }
      (this as any).masterSourceNode = null;
    }

    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();

    // Only unmute input when stopping if no tracks are armed (to preserve monitoring state)
    const hasArmedTracks = this.tracks.some(t => t.isArmed);
    if (!hasArmedTracks) {
      this.unmuteInput();
      this.debugLog('transport', '🔊 Input unmuted on stop (no armed tracks)');
    } else {
      this.debugLog('transport', '🎧 Keeping input state unchanged on stop (armed tracks present)');
    }

    this.stopPlayheadTimer();

    document.getElementById('play-btn')?.classList.remove('playing');
    document.getElementById('pause-btn')?.classList.remove('paused');
    document.getElementById('record-btn')?.classList.remove('recording');
    
    // Reset playhead indicator and timecode to beginning
    this.updatePlayheadUI();
    
    // Only reset volume meter if no tracks are armed (otherwise keep monitoring input levels)
    if (!this.tracks.some(t => t.isArmed)) {
      this.updateVolumeMeter(0);
    }
    
    // Keep waveform visible after recording for visual reference
    // (waveform will only clear when starting new recording)
    
    // Update bounce button state
    this.updateBounceButtonState();
    
    this.debugLog('transport', '✅ Stop complete');
  }

  // Public loop control methods for React component integration
  public toggleLoopMode() {
    this.toggleLoop();
  }

  public setLoopRegion(startSeconds: number, endSeconds: number) {
    this.state.loopStart = Math.max(0, startSeconds);
    this.state.loopEnd = Math.max(this.state.loopStart + 0.1, endSeconds);
    this.state.isLooping = true;
    this.debugLog('general', `[LOOP] 🎯 Loop region set: ${this.state.loopStart.toFixed(2)}s → ${this.state.loopEnd.toFixed(2)}s`);
    this.updateLoopButtonState();
    this.updateTransportDisplay();
    this.redrawAllTrackWaveforms();
  }

  public getLoopState() {
    return {
      isLooping: this.state.isLooping,
      loopStart: this.state.loopStart,
      loopEnd: this.state.loopEnd,
      hasCompletedFirstRecording: this.state.hasCompletedFirstRecording
    };
  }

  public clearEverything() {
    this.debugLog('general', '[TAPEFOUR] 🗑️ Clear everything requested');
    
    // Add visual feedback to clear button
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
      clearBtn.classList.add('clearing');
      // Remove the class after animation
      setTimeout(() => {
        clearBtn.classList.remove('clearing');
      }, 200);
    }
    
    // First stop all transport activity
    this.stop();
    
    // Clear all track audio buffers and reset states
    this.tracks.forEach((track) => {
      track.audioBuffer = null;
      track.originalBuffer = null;
      track.originalBufferForSpeed = null;
      track.isReversed = false;
      track.isHalfSpeed = false;
      track.recordStartTime = 0;
      track.undoHistory = []; // Clear undo history
      this.debugLog('general', `[TAPEFOUR] 🗑️ Cleared track ${track.id} buffer and reset all states`);
      // Update button styling
      this.updateReverseButtonStyling(track.id);
      this.updateHalfSpeedButtonStyling(track.id);
    });
    
    // Clear master buffer
    this.state.masterBuffer = null;
    this.state.duration = 0;
    this.debugLog('general', '[TAPEFOUR] 🗑️ Cleared master buffer');
    
    // Reset loop state
    this.state.loopStart = 0;
    this.state.loopEnd = 0;
    this.state.isLooping = false;
    this.state.isDraggingLoopStart = false;
    this.state.isDraggingLoopEnd = false;
    this.state.hasCompletedFirstRecording = false;
    this.updateLoopButtonState(); // Update button visual state
    this.debugLog('general', '[TAPEFOUR] 🗑️ Reset loop state');
    
    // Clear all waveforms
    this.trackWaveforms.clear();
    this.masterWaveform = [];
    this.clearWaveform(); // Clear the canvas
    
    // Reset playhead position to 0
    this.state.playheadPosition = 0;
    this.updatePlayheadUI();
    this.updateTimecode();
    
    // Update bounce button state since there's no audio to bounce
    this.updateBounceButtonState();
    this.updateUndoButtonState();
    
    this.debugLog('general', '[TAPEFOUR] 🗑️ Everything cleared - project reset');
  }

  public pause() {
    if (this.state.isPlaying && !this.state.isPaused) {
      this.audioContext!.suspend();
      this.state.isPaused = true;
      this.stopPlayheadTimer();
      document.getElementById('play-btn')?.classList.remove('playing');
      document.getElementById('pause-btn')?.classList.add('paused');
    } else if (this.state.isPaused) {
      this.resumeFromPause();
    }
  }

  private async resumeFromPause() {
    this.debugLog('transport', '⏯️ Resuming from pause');
    
    // Stop any existing audio sources since we need to restart from current position
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        this.debugLog('transport', `🛑 Stopping track ${t.id} source to restart from current position`);
        try {
          t.sourceNode.stop();
          t.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
          this.debugLog('transport', `  - Track ${t.id} source already stopped`);
        }
        t.sourceNode = null;
      }
    });

    // Stop master source if playing
    if ((this as any).masterSourceNode) {
      this.debugLog('transport', '🛑 Stopping master source to restart from current position');
      try {
        (this as any).masterSourceNode.stop();
        (this as any).masterSourceNode.disconnect();
      } catch (e) {
        this.debugLog('transport', '  - Master source already stopped');
      }
      (this as any).masterSourceNode = null;
    }

    await this.audioContext!.resume();
    this.state.isPaused = false;
    this.state.isPlaying = true;
    
    // Restart playback from the current playhead position (accounting for any scrubbing during pause)
    const startTime = this.audioContext!.currentTime + 0.05; // Small delay for sync
    
    if (this.state.masterBuffer) {
      this.debugLog('transport', '🏆 Restarting master buffer from scrubbed position');
      this.playMasterTrack(startTime);
    }
    
    // ALSO restart any individual tracks (for layering new recordings on top of master)
    const tracksToRestart = this.tracks.filter(t => t.audioBuffer);
    if (tracksToRestart.length > 0) {
      this.debugLog('transport', `🎵 Restarting ${tracksToRestart.length} individual tracks${this.state.masterBuffer ? ' (layered with master)' : ''}`);
      this.tracks.forEach((t) => {
        if (t.audioBuffer) {
          this.debugLog('transport', `🎶 Restarting track ${t.id} from scrubbed position`);
          this.playTrack(t, startTime);
        }
      });
    }

    this.startPlayheadTimer();
    document.getElementById('play-btn')?.classList.add('playing');
    document.getElementById('pause-btn')?.classList.remove('paused');
    
    this.debugLog('transport', `✅ Resumed playback from ${(this.state.playheadPosition / 1000).toFixed(2)}s`);
  }

  public async record() {
    this.debugLog('transport', '[TAPEFOUR] 🔴 RECORD button pressed');
    if (this.state.isRecording) return this.stopRecording();

    // If currently paused, unpause and reset pause button
    if (this.state.isPaused) {
      this.debugLog('transport', '[TAPEFOUR] ⏯️ Unpausing before recording');
      this.state.isPaused = false;
      document.getElementById('pause-btn')?.classList.remove('paused');
    }

    const armedTrack = this.tracks.find((t) => t.isArmed);
    this.debugLog('transport', `[TAPEFOUR] 🎯 Armed track: ${armedTrack?.id || 'none'}`);
    if (!armedTrack) return this.showError('Please arm a track before recording.');

    // Determine recording mode based on current playhead position
    if (this.state.playheadPosition > 0) {
      this.state.recordMode = 'punchIn';
      this.state.punchInStartPosition = this.state.playheadPosition;
      this.debugLog('punchIn', `[PUNCH-IN] 🎯 Punch-in recording from ${(this.state.playheadPosition / 1000).toFixed(2)}s`);
    } else {
      this.state.recordMode = 'fresh';
      this.state.punchInStartPosition = 0;
      // For fresh recordings, clear the undo history and set the start time
      if (armedTrack) {
        armedTrack.recordStartTime = this.state.playheadPosition;
        armedTrack.undoHistory = [];
        this.debugLog('general', `[UNDO] Cleared undo history for track ${armedTrack.id}`);
      }
      this.debugLog('transport', `[TAPEFOUR] 🎵 Fresh recording starting at timeline position ${this.state.playheadPosition}ms`);
    }

    await this.initializeAudio();
    await this.setupRecording();
    await this.unmuteInput();

    // Clear any previous recording data
    this.recordingBuffer = [];
    this.debugLog('transport', '[TAPEFOUR] 🗑️ Recording buffer cleared');

    this.state.isRecording = true;
    
    // Update record button styling based on mode
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) {
      recordBtn.classList.add('recording');
      if (this.state.recordMode === 'punchIn') {
        recordBtn.classList.add('punch-in');
        recordBtn.title = 'Punch-In Recording - Only armed tracks will be overdubbed';
      } else {
        recordBtn.classList.remove('punch-in');
        recordBtn.title = 'Recording - Armed tracks will be replaced from beginning';
      }
    }
    
    // Update bounce button state
    this.updateBounceButtonState();
    
    // Update playhead cursor to show scrubbing is disabled
    this.updatePlayheadCursor();

    this.debugLog('transport', '[TAPEFOUR] 🎵 Starting monitoring playback during recording...');
    this.debugLog('transport', '[TAPEFOUR] 🎧 Other tracks will play at reduced volume to minimize bleed');
    
    // Keep input monitoring active during recording so you can hear yourself
    // Note: Use headphones to prevent feedback between speakers and microphone
    this.debugLog('input', `[TAPEFOUR] 🎧 Input monitoring during recording: ${this.state.isMonitoring ? 'ACTIVE' : 'INACTIVE'}`);
    if (this.state.isMonitoring) {
      this.debugLog('input', '[TAPEFOUR] ✅ You should be able to hear your input while recording');
    }
    
    // Enable monitoring mode (lower volume playback during recording)
    this.enableMonitoringMode();
    
    // Play all tracks for monitoring (including armed tracks in punch-in mode)
    const recordingStartTime = this.audioContext!.currentTime + 0.05;
    this.debugLog('transport', `[TAPEFOUR] 🕐 Starting synchronized monitoring playback at audio context time: ${recordingStartTime}`);
    
    this.tracks.forEach((t) => {
      if (t.audioBuffer && (this.state.recordMode === 'punchIn' || !t.isArmed)) {
        this.debugLog('transport', `[TAPEFOUR]   - Playing track ${t.id} for monitoring during recording`);
        this.playTrack(t, recordingStartTime);
      }
    });

    this.state.isPlaying = true;
    // For fresh recording, start from beginning; for punch-in, continue from current position
    if (this.state.recordMode === 'fresh') {
      this.state.playheadPosition = 0;
    }
    this.startPlayheadTimer();
    document.getElementById('play-btn')?.classList.add('playing');

    this.mediaRecorder!.start();
    
    // Handle waveform capture based on recording mode
    if (this.state.recordMode === 'fresh') {
      // Fresh recording: clear the current track's waveform
      this.clearWaveform(armedTrack.id);
    } else {
      // Punch-in: fade existing waveform and prepare for overlay
      this.preparePunchInWaveform(armedTrack.id);
    }
    this.startWaveformCapture();
    
    this.debugLog('transport', `[TAPEFOUR] ✅ ${this.state.recordMode === 'punchIn' ? 'Punch-in' : 'Fresh'} recording started`);
  }

  private async setupRecording() {
    try {
      // Check if volume meter and monitoring were active before stopping the stream
      const wasVolumeMeterActive = this.volumeMeterActive;
      const wasMonitoringActive = this.state.isMonitoring;
      
      // Stop volume meter first if it was active
      if (wasVolumeMeterActive) {
        this.debugLog('input', '[TAPEFOUR] 🔇 Stopping volume meter before recreating media stream');
        this.stopVolumeMeter();
      }
      
      // Stop input monitoring if it was active
      if (wasMonitoringActive) {
        this.debugLog('input', '[TAPEFOUR] 🔇 Stopping input monitoring before recreating media stream');
        this.stopInputMonitoring();
      }
      
      // Always stop and clean up existing media stream before creating a new one
      // This ensures we use the currently selected device for recording
      if (this.mediaStream) {
        this.debugLog('input', '[TAPEFOUR] 🛑 Stopping existing media stream before creating new one');
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
        this.mediaRecorder = null;
        
        // Clean up input source node since the stream is changing
        if (this.inputSourceNode) {
          this.inputSourceNode.disconnect();
          this.inputSourceNode = null;
        }
      }

      const constraints: MediaStreamConstraints = {
        audio: this.state.selectedInputDeviceId 
          ? { 
              deviceId: { exact: this.state.selectedInputDeviceId },
              echoCancellation: this.state.echoCancellation,
              noiseSuppression: this.state.noiseSuppression,
              autoGainControl: this.state.autoGainControl,
              // Enhanced constraints for audio interfaces
              sampleRate: 48000, // Common for audio interfaces
              channelCount: { max: 2 } // Request up to 2 channels (stereo)
            } 
          : {
              echoCancellation: this.state.echoCancellation,
              noiseSuppression: this.state.noiseSuppression,
              autoGainControl: this.state.autoGainControl,
              sampleRate: 48000,
              channelCount: { max: 2 }
            },
      };

      this.debugLog('input', '[TAPEFOUR] 🎤 Requesting microphone with enhanced constraints:', JSON.stringify(constraints, null, 2));

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.mediaRecorder = new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          this.debugLog('input', `[TAPEFOUR] 📊 MediaRecorder data chunk: ${ev.data.size} bytes`);
          this.recordingBuffer.push(ev.data);
        }
      };
      this.mediaRecorder.onstop = () => {
        this.debugLog('input', `[TAPEFOUR] 🛑 MediaRecorder stopped, buffer has ${this.recordingBuffer.length} chunks`);
        this.processRecording();
      };
      
      this.debugLog('input', `[TAPEFOUR] 🎤 MediaRecorder created, input tracks: ${this.mediaStream.getAudioTracks().length}`);
      this.mediaStream.getAudioTracks().forEach((track, i) => {
        this.debugLog('input', `[TAPEFOUR]   Track ${i}: ${track.label}, enabled: ${track.enabled}`);
        // Log the track's capabilities for debugging
        const capabilities = track.getCapabilities();
        this.debugLog('input', `[TAPEFOUR]   Track capabilities:`, {
          sampleRate: capabilities.sampleRate,
          channelCount: capabilities.channelCount,
          echoCancellation: capabilities.echoCancellation
        });
        // Log current settings
        const settings = track.getSettings();
        this.debugLog('input', `[TAPEFOUR]   Track settings:`, settings);
      });

      // Restart volume meter if it was previously active
      if (wasVolumeMeterActive) {
        this.debugLog('input', '[TAPEFOUR] 🔊 Restarting volume meter with new media stream');
        await this.startVolumeMeter();
      }
      
      // Restart input monitoring if it was previously active
      if (wasMonitoringActive) {
        this.debugLog('input', '[TAPEFOUR] 🎧 Restarting input monitoring with new media stream');
        await this.startInputMonitoring();
      }
      
      // Setup waveform analyser for recording
      this.setupWaveformAnalyser();
      
    } catch (err) {
      this.debugError('input', 'Error setting up recording', err);
              this.showError('Could not access microphone. Please check permissions and settings.');
    }
  }

  private stopRecording() {
    this.debugLog('transport', `[TAPEFOUR] 🛑 Stopping ${this.state.recordMode} recording`);
    if (!this.state.isRecording) return;
    
    this.state.isRecording = false;
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
    
    // Clean up record button styling
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) {
      recordBtn.classList.remove('recording', 'punch-in');
      recordBtn.title = 'Record';
    }
    
    // Re-enable scrubbing by updating cursor
    this.updatePlayheadCursor();
    
    // Stop waveform capture
    this.stopWaveformCapture();
    
    // Stop monitoring playback and disable monitoring mode
    this.disableMonitoringMode();
    if (this.state.isPlaying) {
      this.state.isPlaying = false;
      document.getElementById('play-btn')?.classList.remove('playing');
      this.stopPlayheadTimer();
      
      // Stop all track sources
      this.tracks.forEach((t) => {
        if (t.sourceNode) {
          try {
            t.sourceNode.stop();
            t.sourceNode.disconnect();
          } catch (e) {
            // Source might already be stopped, ignore errors
            this.debugLog('transport', `  - Track ${t.id} source already stopped`);
          }
          t.sourceNode = null;
        }
      });
    }
    
    // Input monitoring continues as long as tracks are armed
    
    // Ensure recording buffer is cleared if recording was interrupted
    setTimeout(() => {
      if (this.recordingBuffer.length > 0) {
        this.debugLog('transport', '[TAPEFOUR] 🗑️ Clearing leftover recording buffer after stop');
        this.recordingBuffer = [];
      }
      
      // Redraw waveforms to remove punch-in overlay and restore normal opacity
      this.redrawAllTrackWaveforms();
    }, 100); // Small delay to allow MediaRecorder onstop to fire first
    
    this.debugLog('transport', `[TAPEFOUR] ✅ ${this.state.recordMode} recording stopped`);
  }

  private async processRecording() {
    if (!this.recordingBuffer.length) return;

    this.debugLog('general', `[TAPEFOUR] 🔍 Processing recording with ${this.recordingBuffer.length} data chunks`);
    const blob = new Blob(this.recordingBuffer, { type: 'audio/wav' });
    this.debugLog('general', `[TAPEFOUR] 📦 Created blob: ${blob.size} bytes, type: ${blob.type}`);
    const arrayBuffer = await blob.arrayBuffer();

    try {
      const newAudioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
      this.debugLog('general', `[TAPEFOUR] 🎵 Decoded audio buffer: ${newAudioBuffer.length} samples, ${newAudioBuffer.duration.toFixed(2)}s, ${newAudioBuffer.numberOfChannels} channels`);
      
      // Find the currently armed track
      const armedTrack = this.tracks.find((t) => t.isArmed);
      if (armedTrack) {
        if (this.state.recordMode === 'fresh') {
          // Fresh recording: replace the entire buffer (recordStartTime already set in record() method)
          armedTrack.audioBuffer = newAudioBuffer;
          this.debugLog('general', `[TAPEFOUR] ✅ Fresh recording assigned to track ${armedTrack.id} starting at ${armedTrack.recordStartTime}ms`);
          this.debugLog('general', `[TAPEFOUR] 📊 Track ${armedTrack.id} now has ${newAudioBuffer.length} samples (${newAudioBuffer.duration.toFixed(2)}s)`);
          
          // Auto-set loop after first recording
          if (!this.state.hasCompletedFirstRecording) {
            this.setupInitialLoop(newAudioBuffer.duration);
            this.state.hasCompletedFirstRecording = true;
          }
        } else {
          // Punch-in recording: save current state for undo, then merge
          if (armedTrack.audioBuffer) {
            armedTrack.undoHistory.push(armedTrack.audioBuffer);
            this.debugLog('general', `[UNDO] Stored buffer for track ${armedTrack.id}. History size: ${armedTrack.undoHistory.length}`);
          }
          const mergedBuffer = this.mergeBuffersForPunchIn(armedTrack.audioBuffer, newAudioBuffer, this.state.punchInStartPosition);
          armedTrack.audioBuffer = mergedBuffer;
          // For punch-in, recordStartTime remains unchanged as it keeps the original track's timeline position
          this.debugLog('punchIn', `[PUNCH-IN] ✅ Punch-in recording merged into track ${armedTrack.id} (original start time: ${armedTrack.recordStartTime}ms)`);
          this.debugLog('punchIn', `[PUNCH-IN] 📊 Track ${armedTrack.id} now has ${mergedBuffer.length} samples (${mergedBuffer.duration.toFixed(2)}s)`);
        }
      } else {
        this.debugWarn('general', '[TAPEFOUR] ⚠️ No armed track found to assign recording to');
      }
    } catch (err) {
      this.debugError('general', '[TAPEFOUR] Error processing recording', err);
    }

    // Reset recording mode state
    this.state.recordMode = 'fresh';
    this.state.punchInStartPosition = 0;

    // Only stop media stream if no tracks are armed (no need for continued monitoring)
    const hasArmedTracks = this.tracks.some(t => t.isArmed);
    if (!hasArmedTracks) {
      this.mediaStream?.getTracks().forEach((t) => t.stop());
      this.debugLog('general', '[TAPEFOUR] 🔌 Media stream tracks stopped (no armed tracks)');
    } else {
      this.debugLog('general', '[TAPEFOUR] 🎧 Keeping media stream alive for continued input monitoring');
    }
    
    // Update bounce button state since new audio may be available
    this.updateBounceButtonState();
    
    // Update button states for the recorded track
    const armedTrack = this.tracks.find((t) => t.isArmed);
    if (armedTrack) {
      this.updateReverseButtonStyling(armedTrack.id);
      this.updateHalfSpeedButtonStyling(armedTrack.id);
      this.updateUndoButtonState(); // Update undo button state
    }
  }

  private mergeBuffersForPunchIn(existingBuffer: AudioBuffer | null, newBuffer: AudioBuffer, punchInStartMs: number): AudioBuffer {
    const sampleRate = this.audioContext!.sampleRate;
    const punchInStartSamples = Math.floor((punchInStartMs / 1000) * sampleRate);
    const newBufferLength = newBuffer.length;
    const punchOutSamples = punchInStartSamples + newBufferLength;
    
    this.debugLog('punchIn', `[PUNCH-IN] 🔧 Merging buffers:`);
    this.debugLog('punchIn', `  - Punch-in start: ${punchInStartMs}ms (${punchInStartSamples} samples)`);
    this.debugLog('punchIn', `  - New recording: ${newBufferLength} samples`);
    this.debugLog('punchIn', `  - Punch-out: ${punchOutSamples} samples`);
    
    // Determine the final buffer length
    const existingLength = existingBuffer ? existingBuffer.length : 0;
    const finalLength = Math.max(existingLength, punchOutSamples);
    
    // Determine channel count (use the maximum of existing and new)
    const existingChannels = existingBuffer ? existingBuffer.numberOfChannels : 1;
    const newChannels = newBuffer.numberOfChannels;
    const finalChannels = Math.max(existingChannels, newChannels);
    
    this.debugLog('punchIn', `  - Final buffer: ${finalLength} samples, ${finalChannels} channels`);
    
    // Create the merged buffer
    const mergedBuffer = this.audioContext!.createBuffer(finalChannels, finalLength, sampleRate);
    
    // Process each channel
    for (let channel = 0; channel < finalChannels; channel++) {
      const mergedData = mergedBuffer.getChannelData(channel);
      
      // 1. Copy pre-punch segment from existing buffer (if it exists)
      if (existingBuffer && punchInStartSamples > 0) {
        const existingChannelIndex = Math.min(channel, existingBuffer.numberOfChannels - 1);
        const existingData = existingBuffer.getChannelData(existingChannelIndex);
        const prePunchLength = Math.min(punchInStartSamples, existingData.length);
        
        for (let i = 0; i < prePunchLength; i++) {
          mergedData[i] = existingData[i];
        }
        this.debugLog('punchIn', `  - Channel ${channel}: Copied ${prePunchLength} pre-punch samples`);
      }
      
      // 2. Copy new recording data (punch-in segment)
      const newChannelIndex = Math.min(channel, newBuffer.numberOfChannels - 1);
      const newData = newBuffer.getChannelData(newChannelIndex);
      
      for (let i = 0; i < newBufferLength; i++) {
        const targetIndex = punchInStartSamples + i;
        if (targetIndex < finalLength) {
          mergedData[targetIndex] = newData[i];
        }
      }
      this.debugLog('punchIn', `  - Channel ${channel}: Copied ${newBufferLength} punch-in samples`);
      
      // 3. Copy post-punch segment from existing buffer (if it exists and extends beyond punch-out)
      if (existingBuffer && existingBuffer.length > punchOutSamples) {
        const existingChannelIndex = Math.min(channel, existingBuffer.numberOfChannels - 1);
        const existingData = existingBuffer.getChannelData(existingChannelIndex);
        const postPunchStart = punchOutSamples;
        const postPunchLength = existingBuffer.length - postPunchStart;
        
        for (let i = 0; i < postPunchLength; i++) {
          const sourceIndex = postPunchStart + i;
          const targetIndex = postPunchStart + i;
          if (targetIndex < finalLength && sourceIndex < existingData.length) {
            mergedData[targetIndex] = existingData[sourceIndex];
          }
        }
        this.debugLog('punchIn', `  - Channel ${channel}: Copied ${postPunchLength} post-punch samples`);
      }
      
      // Fill any remaining gaps with silence (already zeroed by createBuffer)
    }
    
    this.debugLog('punchIn', `[PUNCH-IN] ✅ Buffer merge complete: ${finalLength} samples (${(finalLength / sampleRate).toFixed(2)}s)`);
    return mergedBuffer;
  }

  /* ---------- Playhead --------- */

  private startPlayheadTimer() {
    this.playStartTime = Date.now() - this.state.playheadPosition;
    this.playheadTimer = window.setInterval(() => {
      // Exit immediately if not playing - this fixes loop not stopping
      if (!this.state.isPlaying) {
        return;
      }
      
      // Don't update playhead position while user is dragging
      if (!this.isDraggingPlayhead) {
        this.state.playheadPosition = Date.now() - this.playStartTime;
        
        // Handle looping behavior - but only if still playing
        if (this.state.isLooping && this.state.isPlaying) {
          const currentTimeSeconds = this.state.playheadPosition / 1000;
          if (currentTimeSeconds >= this.state.loopEnd) {
            // Jump back to loop start
            this.state.playheadPosition = this.state.loopStart * 1000;
            this.playStartTime = Date.now() - this.state.playheadPosition;
            this.debugLog('general', `[LOOP] 🔄 Looped back to ${this.state.loopStart.toFixed(2)}s`);
            
            // Restart all playing tracks from loop start
            this.restartTracksFromLoopStart();
          }
        }
        
        this.updatePlayheadUI();
        if (this.state.playheadPosition >= this.state.maxRecordingTime) this.stop();
      }
    }, 50);
    this.startTapeReelSpinning();
  }

  private stopPlayheadTimer() {
    if (this.playheadTimer) window.clearInterval(this.playheadTimer);
    this.playheadTimer = null;
    this.stopTapeReelSpinning();
  }

  private updatePlayheadUI() {
    const progress = this.state.playheadPosition / this.state.maxRecordingTime;
    
    // Get the actual rendered width of the playhead container for accurate positioning
    const playheadElement = document.getElementById('playhead');
    const maxWidth = playheadElement ? playheadElement.clientWidth : 120;
    
    const pos = Math.min(progress * maxWidth, maxWidth);
    (document.getElementById('playhead-indicator') as HTMLElement | null)?.style.setProperty('left', `${pos}px`);
    
    // Update timecode display
    this.updateTimecode();
  }

  private updateTimecode() {
    // Regular timecode display only - no loop info
    const totalSeconds = Math.floor(this.state.playheadPosition / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    const timecodeElement = document.getElementById('timecode');
    if (timecodeElement) {
      timecodeElement.textContent = timeString;
    }
  }

  private updateVolumeMeter(level: number) {
    // Clamp level to 0-1 range
    const clampedLevel = Math.max(0, Math.min(1, level));
    const fillElement = document.getElementById('volume-meter-fill') as HTMLElement | null;
    
    // Debug logging - sample every 60 calls or when level > 0.05
    this._meterUpdateCount = (this._meterUpdateCount || 0) + 1;
    const shouldLog = this._meterUpdateCount % 60 === 0 || clampedLevel > 0.05;
    
    if (shouldLog) {
      this.debugLog('meter', `[METER] 🎚️ updateVolumeMeter called - input: ${level.toFixed(3)}, clamped: ${clampedLevel.toFixed(3)}, element found: ${!!fillElement}`);
    }
    
    if (fillElement) {
      // Set width as percentage
      const widthPercent = clampedLevel * 100;
      fillElement.style.width = `${widthPercent}%`;
      
      // Determine color and glow based on level
      let color: string;
      let glowColor: string;
      let zone: string;
      
      if (clampedLevel >= 0.9) {
        // Red zone (90-100%)
        color = 'var(--color-record)';
        glowColor = 'rgba(210, 50, 25, 0.5)';
        zone = 'RED';
      } else if (clampedLevel >= 0.7) {
        // Amber zone (70-90%)
        color = 'var(--color-stop)';
        glowColor = 'rgba(245, 158, 11, 0.4)';
        zone = 'AMBER';
      } else {
        // Green zone (0-70%)
        color = 'var(--color-play)';
        glowColor = 'rgba(34, 197, 94, 0.3)';
        zone = 'GREEN';
      }
      
      fillElement.style.backgroundColor = color;
      fillElement.style.boxShadow = `0 0 4px ${glowColor}`;
      
      if (shouldLog) {
        this.debugLog('meter', `[METER] 🎨 UI updated - width: ${widthPercent.toFixed(1)}%, zone: ${zone}, color: ${color}`);
      }
      
      // Debug logging for high levels
      if (clampedLevel >= 0.7) {
        this.debugLog('meter', `[METER] 📊 High level detected: ${level.toFixed(3)} (${widthPercent.toFixed(1)}%) -> ${zone} zone`);
      }
    } else {
      if (shouldLog) {
        this.debugWarn('meter', '[METER] ❌ volume-meter-fill element not found in DOM');
      }
    }
  }

  /* ---------- Settings modal ---------- */

  /**
   * Enumerate available audio input devices and populate the <select> element.
   * This can be called any time (modal open, Scan Devices button, etc.).
   */
  private async populateAudioInputSelect() {
    const select = document.getElementById('audio-input-select') as HTMLSelectElement | null;
    if (!select) return;

    select.innerHTML = '<option value="">Default Audio Input</option>';

    try {
      let devices = await navigator.mediaDevices.enumerateDevices();

      // If labels are blank (happens before permission), request a one-time gUM to unlock them
      const labelsMissing = devices.every((d) => !d.label);
      if (labelsMissing) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
        } catch (gumErr) {
          // ignore; we'll still show generic labels below
        }
      }

      const inputs = devices.filter((d) => d.kind === 'audioinput');

      // Enhanced device information logging
      this.debugLog('settings', '[TAPEFOUR] 🎤 Available audio input devices:');
      inputs.forEach((device, index) => {
        this.debugLog('settings', `[TAPEFOUR]   ${index + 1}. ${device.label || 'Unknown Device'} (${device.deviceId.slice(0, 8)}...)`);
      });

      // Deduplicate identical labels by appending an index
      const labelCounts: Record<string, number> = {};
      inputs.forEach((d) => {
        let label = d.label || 'Audio Input';
        labelCounts[label] = (labelCounts[label] || 0) + 1;
      });

      const seen: Record<string, number> = {};
      inputs.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;

        let label = d.label || 'Audio Input';
        if (labelCounts[label] > 1) {
          // multiple devices share this label – append a running index
          seen[label] = (seen[label] || 0) + 1;
          label = `${label} #${seen[label]}`;
        }

        opt.textContent = label;
        if (d.deviceId === this.state.selectedInputDeviceId) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (err) {
      this.debugError('settings', 'enumerateDevices error', err);
    }
  }

  /**
   * Enumerate available audio output devices and populate the <select> element.
   * This can be called any time (modal open, Scan Devices button, etc.).
   */
  private async populateAudioOutputSelect() {
    const select = document.getElementById('audio-output-select') as HTMLSelectElement | null;
    if (!select) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Audio output select element not found');
      return;
    }

    this.debugLog('settings', '[TAPEFOUR] 🔊 Populating audio output device list...');
    select.innerHTML = '<option value="">Default Audio Output</option>';

    try {
      let devices = await navigator.mediaDevices.enumerateDevices();

      // If labels are blank (happens before permission), request a one-time gUM to unlock them
      const labelsMissing = devices.every((d) => !d.label);
      if (labelsMissing) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
        } catch (gumErr) {
          // ignore; we'll still show generic labels below
        }
      }

      const outputs = devices.filter((d) => d.kind === 'audiooutput');

      // Enhanced device information logging
      this.debugLog('settings', `[TAPEFOUR] 🔊 Found ${outputs.length} audio output devices:`);
      outputs.forEach((device, index) => {
        this.debugLog('settings', `[TAPEFOUR]   ${index + 1}. ${device.label || 'Unknown Device'} (${device.deviceId.slice(0, 8)}...)`);
      });

      // Deduplicate identical labels by appending an index
      const labelCounts: Record<string, number> = {};
      outputs.forEach((d) => {
        let label = d.label || 'Audio Output';
        labelCounts[label] = (labelCounts[label] || 0) + 1;
      });

      const seen: Record<string, number> = {};
      outputs.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;

        let label = d.label || 'Audio Output';
        if (labelCounts[label] > 1) {
          // multiple devices share this label – append a running index
          seen[label] = (seen[label] || 0) + 1;
          label = `${label} #${seen[label]}`;
        }

        opt.textContent = label;
        if (d.deviceId === this.state.selectedOutputDeviceId) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (err) {
      this.debugError('settings', 'enumerateDevices error', err);
    }
  }

  private async changeAudioOutputDevice(newDeviceId: string | null) {
    // If device changed, update the stored device ID
    if (newDeviceId !== this.state.selectedOutputDeviceId) {
      this.debugLog('settings', `[TAPEFOUR] 🔊 Audio output device changing from ${this.state.selectedOutputDeviceId || 'default'} to ${newDeviceId || 'default'}`);
      
      this.state.selectedOutputDeviceId = newDeviceId;
      
      // Save the device selection to localStorage
      this.saveAudioOutputDevice(newDeviceId);
      
      // Try to actually change the output device using modern Web APIs
      if (this.audioContext) {
        try {
          // Check if AudioContext.setSinkId is supported (newer browsers)
          if ('setSinkId' in this.audioContext && typeof this.audioContext.setSinkId === 'function') {
            this.debugLog('settings', '[TAPEFOUR] 🔊 Attempting to set output device using AudioContext.setSinkId...');
            await (this.audioContext as any).setSinkId(newDeviceId || '');
            this.debugLog('settings', `[TAPEFOUR] ✅ Successfully changed audio output device to: ${newDeviceId || 'default'}`);
          } else {
            this.debugWarn('settings', '[TAPEFOUR] ⚠️ AudioContext.setSinkId not supported in this browser');
            this.debugLog('settings', '[TAPEFOUR] 💾 Output device preference saved for future compatibility');
          }
        } catch (err) {
          this.debugError('settings', '[TAPEFOUR] ❌ Failed to change audio output device:', err);
          
          // Check for specific error types
          if (err instanceof Error) {
            if (err.name === 'NotFoundError') {
              this.showError('Selected audio output device not found. Please try selecting a different device or check your audio settings.');
            } else if (err.name === 'NotAllowedError') {
              this.showError('Permission denied to change audio output device. Please check your browser permissions.');
            } else {
              this.showError(`Failed to change audio output device: ${err.message}`);
            }
          } else {
            this.showError('Failed to change audio output device. Please try a different device.');
          }
        }
      } else {
        this.debugWarn('settings', '[TAPEFOUR] ⚠️ No audio context available for output device change');
      }
    }
  }

  public async openSettings() {
    // Add visual feedback to settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.classList.add('opening');
      // Remove the class after animation
      setTimeout(() => {
        settingsBtn.classList.remove('opening');
      }, 200);
    }

    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    await this.populateAudioInputSelect();
    await this.populateAudioOutputSelect();
    
    // Populate audio processing checkboxes with current state
    const echoCancellationCheckbox = document.getElementById('echo-cancellation-checkbox') as HTMLInputElement | null;
    const noiseSuppressionCheckbox = document.getElementById('noise-suppression-checkbox') as HTMLInputElement | null;
    const autoGainControlCheckbox = document.getElementById('auto-gain-control-checkbox') as HTMLInputElement | null;
    
    if (echoCancellationCheckbox) echoCancellationCheckbox.checked = this.state.echoCancellation;
    if (noiseSuppressionCheckbox) noiseSuppressionCheckbox.checked = this.state.noiseSuppression;
    if (autoGainControlCheckbox) autoGainControlCheckbox.checked = this.state.autoGainControl;
    
    // Populate export mode selector with current state
    const multiTrackBtn = document.getElementById('multitrack-export-btn');
    const masterBtn = document.getElementById('master-export-btn');
    
    if (multiTrackBtn && masterBtn) {
      if (this.state.multiTrackExport) {
        multiTrackBtn.classList.add('active');
        masterBtn.classList.remove('active');
      } else {
        multiTrackBtn.classList.remove('active');
        masterBtn.classList.add('active');
      }
    }
    
    modal && (modal.style.display = 'flex');
  }

  private closeSettings() {
    (document.getElementById('settings-modal') as HTMLElement | null)?.style.setProperty('display', 'none');
  }

  private toggleSettings() {
    // Debounce to prevent rapid toggling (100ms minimum between toggles)
    const now = Date.now();
    if (now - this.lastSettingsToggleTime < 100) {
      this.debugLog('settings', '[TAPEFOUR] ⌨️ Settings toggle debounced');
      return;
    }
    this.lastSettingsToggleTime = now;

    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (modal) {
      // Check computed style instead of inline style for more reliable detection
      const computedStyle = window.getComputedStyle(modal);
      const isVisible = computedStyle.display !== 'none';
      if (isVisible) {
        this.debugLog('settings', '[TAPEFOUR] ⌨️ Closing settings modal');
        this.closeSettings();
      } else {
        this.debugLog('settings', '[TAPEFOUR] ⌨️ Opening settings modal');
        this.openSettings();
      }
    }
  }

  private showError(message: string) {
    const modal = document.getElementById('error-modal');
    const messageElement = document.getElementById('error-message');
    
    if (modal && messageElement) {
      messageElement.textContent = message;
      modal.style.display = 'flex';
    }
  }

  private closeError() {
    const modal = document.getElementById('error-modal');
    if (modal) modal.style.display = 'none';
  }

  private showStatus(message: string) {
    // Reuse the error modal for status messages
    const modal = document.getElementById('error-modal');
    const messageElement = document.getElementById('error-message');
    const titleElement = document.querySelector('#error-modal .settings-title');
    
    if (modal && messageElement && titleElement) {
      titleElement.textContent = '📁 Export Status';
      messageElement.textContent = message;
      modal.style.display = 'flex';
    }
  }

  private hideStatus() {
    const modal = document.getElementById('error-modal');
    if (modal) modal.style.display = 'none';
  }



  private pendingTrackArmId: number | null = null;

  private showWarning(trackId: number) {
    this.pendingTrackArmId = trackId;
    
    const modal = document.getElementById('warning-modal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  private closeWarning() {
    const modal = document.getElementById('warning-modal');
    if (modal) modal.style.display = 'none';
    this.pendingTrackArmId = null;
  }

  private continueWithArming() {
    // Save the "don't show again" preference if checkbox is checked
    const checkbox = document.getElementById('dont-show-warning-checkbox') as HTMLInputElement;
    if (checkbox && checkbox.checked) {
      this.saveWarningPreference(false);
    }
    
    // Close the warning modal
    this.closeWarning();
    
    // Continue with the original track arm operation
    if (this.pendingTrackArmId !== null) {
      this.doToggleTrackArm(this.pendingTrackArmId);
    }
  }

  private shouldShowWarning(): boolean {
    try {
      const preference = localStorage.getItem('tapefour-show-feedback-warning');
      return preference !== 'false';
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not load warning preference:', err);
      return true; // Default to showing the warning
    }
  }

  private saveWarningPreference(shouldShow: boolean) {
    try {
      localStorage.setItem('tapefour-show-feedback-warning', shouldShow.toString());
      this.debugLog('settings', `[TAPEFOUR] 💾 Saved warning preference: ${shouldShow ? 'show' : 'hide'}`);
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not save warning preference:', err);
    }
  }

  private loadSavedAudioDevice() {
    try {
      const savedDeviceId = localStorage.getItem('tapefour-audio-input-device');
      if (savedDeviceId && savedDeviceId !== 'null') {
        this.state.selectedInputDeviceId = savedDeviceId;
        this.debugLog('settings', `[TAPEFOUR] 💾 Loaded saved audio device: ${savedDeviceId}`);
      } else {
        this.debugLog('settings', '[TAPEFOUR] 💾 No saved audio device found, using default');
      }
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not load saved audio device:', err);
    }
  }

  private saveAudioDevice(deviceId: string | null) {
    try {
      if (deviceId) {
        localStorage.setItem('tapefour-audio-input-device', deviceId);
        this.debugLog('settings', `[TAPEFOUR] 💾 Saved audio device: ${deviceId}`);
      } else {
        localStorage.removeItem('tapefour-audio-input-device');
        this.debugLog('settings', '[TAPEFOUR] 💾 Cleared saved audio device (using default)');
      }
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not save audio device:', err);
    }
  }

  private loadSavedAudioOutputDevice() {
    try {
      const savedDeviceId = localStorage.getItem('tapefour-audio-output-device');
      if (savedDeviceId && savedDeviceId !== 'null') {
        this.state.selectedOutputDeviceId = savedDeviceId;
        this.debugLog('settings', `[TAPEFOUR] 💾 Loaded saved audio output device: ${savedDeviceId}`);
      } else {
        this.debugLog('settings', '[TAPEFOUR] 💾 No saved audio output device found, using default');
      }
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not load saved audio output device:', err);
    }
  }

  private saveAudioOutputDevice(deviceId: string | null) {
    try {
      if (deviceId) {
        localStorage.setItem('tapefour-audio-output-device', deviceId);
        this.debugLog('settings', `[TAPEFOUR] 💾 Saved audio output device: ${deviceId}`);
      } else {
        localStorage.removeItem('tapefour-audio-output-device');
        this.debugLog('settings', '[TAPEFOUR] 💾 Cleared saved audio output device (using default)');
      }
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not save audio output device:', err);
    }
  }

  private loadSavedAudioProcessingSettings() {
    try {
      const echoCancellation = localStorage.getItem('tapefour-echo-cancellation');
      const noiseSuppression = localStorage.getItem('tapefour-noise-suppression');
      const autoGainControl = localStorage.getItem('tapefour-auto-gain-control');
      const multiTrackExport = localStorage.getItem('tapefour-multitrack-export');
      
      if (echoCancellation !== null) {
        this.state.echoCancellation = echoCancellation === 'true';
      }
      if (noiseSuppression !== null) {
        this.state.noiseSuppression = noiseSuppression === 'true';
      }
      if (autoGainControl !== null) {
        this.state.autoGainControl = autoGainControl === 'true';
      }
      if (multiTrackExport !== null) {
        this.state.multiTrackExport = multiTrackExport === 'true';
      }
      
      this.debugLog('settings', `[TAPEFOUR] 💾 Loaded settings: echo=${this.state.echoCancellation}, noise=${this.state.noiseSuppression}, agc=${this.state.autoGainControl}, multitrack=${this.state.multiTrackExport}`);
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not load audio processing settings:', err);
    }
  }

  private saveAudioProcessingSettings() {
    try {
      localStorage.setItem('tapefour-echo-cancellation', this.state.echoCancellation.toString());
      localStorage.setItem('tapefour-noise-suppression', this.state.noiseSuppression.toString());
      localStorage.setItem('tapefour-auto-gain-control', this.state.autoGainControl.toString());
      localStorage.setItem('tapefour-multitrack-export', this.state.multiTrackExport.toString());
      this.debugLog('settings', `[TAPEFOUR] 💾 Saved settings: echo=${this.state.echoCancellation}, noise=${this.state.noiseSuppression}, agc=${this.state.autoGainControl}, multitrack=${this.state.multiTrackExport}`);
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not save audio processing settings:', err);
    }
  }

  private loadArmedTrackState() {
    try {
      const armedTrackId = localStorage.getItem('tapefour-armed-track');
      if (armedTrackId !== null) {
        const trackId = parseInt(armedTrackId, 10);
        if (trackId >= 1 && trackId <= 4) {
          // Find the track and arm it
          const track = this.tracks.find(t => t.id === trackId);
          if (track) {
            track.isArmed = true;
            // Update UI element (defer to ensure DOM is ready)
            setTimeout(() => {
              const el = document.getElementById(`track-${trackId}`) as HTMLInputElement;
              if (el) el.checked = true;
            }, 100);
            this.debugLog('settings', `[TAPEFOUR] 💾 Restored armed track: ${trackId}`);
            // Ensure monitoring is enabled if a track is armed
            setTimeout(() => { this.manageVolumeMeter(); }, 150);
          }
        }
      }
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not load armed track state:', err);
    }
  }

  private saveArmedTrackState() {
    try {
      const armedTrack = this.tracks.find(t => t.isArmed);
      if (armedTrack) {
        localStorage.setItem('tapefour-armed-track', armedTrack.id.toString());
        this.debugLog('settings', `[TAPEFOUR] 💾 Saved armed track: ${armedTrack.id}`);
      } else {
        localStorage.removeItem('tapefour-armed-track');
        this.debugLog('settings', '[TAPEFOUR] 💾 Cleared armed track (no tracks armed)');
      }
    } catch (err) {
      this.debugWarn('settings', '[TAPEFOUR] ⚠️ Could not save armed track state:', err);
    }
  }

  private async changeAudioInputDevice(newDeviceId: string | null) {
    // If device changed, we need to refresh the media stream
    if (newDeviceId !== this.state.selectedInputDeviceId) {
      this.debugLog('settings', `[TAPEFOUR] 🔄 Audio input device changed from ${this.state.selectedInputDeviceId || 'default'} to ${newDeviceId || 'default'}`);
      
      this.state.selectedInputDeviceId = newDeviceId;
      
      // Save the device selection to localStorage
      this.saveAudioDevice(newDeviceId);
      
      // IMPORTANT: Always stop and recreate media stream when device changes
      // This ensures ALL future recordings (any track) use the new device
      if (this.mediaStream) {
        this.debugLog('settings', '[TAPEFOUR] 🛑 Stopping existing media stream');
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
        this.mediaRecorder = null;
        
        // Clean up input source node since the stream is changing
        if (this.inputSourceNode) {
          this.inputSourceNode.disconnect();
          this.inputSourceNode = null;
        }
      }
      
      // Stop volume meter and restart it to pick up new device
      if (this.volumeMeterActive) {
        this.debugLog('settings', '[TAPEFOUR] 🔄 Restarting volume meter with new device');
        this.stopVolumeMeter();
        // Restart volume meter if we have armed tracks
        const hasArmedTracks = this.tracks.some(t => t.isArmed);
        if (hasArmedTracks) {
          await this.ensureInputStream();
          this.startVolumeMeter();
        }
      } else {
        // Even if no tracks are armed, we should test the new device works
        this.debugLog('settings', '[TAPEFOUR] 🧪 Testing new audio device');
        try {
          await this.ensureInputStream();
          this.debugLog('settings', '[TAPEFOUR] ✅ New audio device is working');
        } catch (err) {
          this.debugError('settings', '[TAPEFOUR] ❌ New audio device failed:', err);
          this.showError('Failed to connect to the selected audio device. Please try a different device or check your audio settings.');
        }
      }
    }
  }

  /* ---------- Bounce & Export ---------- */

  public async bounce() {
    // Add visual feedback to bounce button
    const bounceBtn = document.getElementById('bounce-btn');
    if (bounceBtn) {
      bounceBtn.classList.add('bouncing');
      // Remove the class after animation
      setTimeout(() => {
        bounceBtn.classList.remove('bouncing');
      }, 200);
    }

    if (!this.audioContext) {
      return this.showError('No audio context available.');
    }

    // Check if we're in a valid state to bounce
    if (this.state.isRecording) {
              return this.showError('Cannot bounce while recording. Stop recording first.');
    }

    if (this.state.isPlaying) {
              return this.showError('Cannot bounce while playing. Stop playback first.');
    }

    // Get tracks that have audio and should be included in the mix
    const tracksToMix = this.getTracksForMixdown();
    const hasMasterBuffer = !!this.state.masterBuffer;
    const hasIndividualTracks = tracksToMix.length > 0;
    
    if (!hasMasterBuffer && !hasIndividualTracks) {
              return this.showError('No tracks to bounce. Please record some audio first.');
    }

    try {
      this.debugLog('bounce', '[TAPEFOUR] 🎯 Starting bounce operation...');
      this.debugLog('bounce', `[TAPEFOUR] 📊 Master buffer: ${hasMasterBuffer ? 'Yes' : 'No'}, Individual tracks: ${tracksToMix.length}`);
      
      // Calculate the duration considering both master buffer and individual tracks
      let maxDuration = 0;
      if (hasMasterBuffer) {
        maxDuration = Math.max(maxDuration, this.state.masterBuffer!.duration);
      }
      if (hasIndividualTracks) {
        maxDuration = Math.max(maxDuration, ...tracksToMix.map(track => track.audioBuffer!.duration));
      }
      
      // Create offline context for rendering
      const offline = new OfflineAudioContext(
        2, // Stereo output
        Math.ceil(this.audioContext.sampleRate * maxDuration),
        this.audioContext.sampleRate
      );

      // Create master gain node for the offline context
      const offlineMaster = offline.createGain();
      offlineMaster.gain.value = this.masterGainNode!.gain.value;
      offlineMaster.connect(offline.destination);

      // Include existing master buffer if it exists
      if (hasMasterBuffer) {
        this.debugLog('bounce', '[TAPEFOUR] 🏆 Adding existing master buffer to bounce');
        const masterSrc = offline.createBufferSource();
        masterSrc.buffer = this.state.masterBuffer!;
        masterSrc.connect(offlineMaster);
        masterSrc.start(0);
      }

      // Set up each individual track in the offline context
      tracksToMix.forEach((track) => {
        this.debugLog('bounce', `[TAPEFOUR] 🎵 Adding track ${track.id} to bounce`);
        const src = offline.createBufferSource();
        const gain = offline.createGain();
        const pan = offline.createStereoPanner();
        
        // Set up the audio chain: source -> gain -> pan -> master
        src.buffer = track.audioBuffer!;
        gain.gain.value = track.gainNode!.gain.value;
        
        // Convert track pan value (0-100) to StereoPanner value (-1 to 1)
        const panPosition = (track.panValue - 50) / 50;
        pan.pan.value = panPosition;
        
        // Connect the audio chain
        src.connect(gain);
        gain.connect(pan);
        pan.connect(offlineMaster);
        src.start(0);
      });

      // Render the mix
      this.debugLog('bounce', '[TAPEFOUR] 🎯 Rendering bounce...');
      const rendered = await offline.startRendering();
      
      // Store the master buffer and update duration
      this.state.masterBuffer = rendered;
      this.state.duration = Math.max(this.state.duration, rendered.duration * 1000); // Convert to ms
      
      this.debugLog('bounce', `[TAPEFOUR] ✅ Bounce complete! Duration: ${rendered.duration.toFixed(2)}s`);
      
      // DESTRUCTIVE BOUNCE: Replace original tracks with master mix
      this.debugLog('bounce', '[TAPEFOUR] 🔄 Performing destructive bounce - clearing original tracks');
      
      // Clear all original tracks
      this.tracks.forEach(track => {
        track.audioBuffer = null;
        // Stop any playing sources
        if (track.sourceNode) {
          try {
            track.sourceNode.stop();
            track.sourceNode.disconnect();
          } catch (e) {
            // Ignore if already stopped
          }
          track.sourceNode = null;
        }
      });
      
      // Generate master waveform that preserves the original timeline positioning
      // (Do this BEFORE clearing track waveforms since we need the position data)
      if (hasIndividualTracks) {
        // If we have individual tracks, generate waveform from their positions
        this.generateMasterWaveformFromTracks(rendered, tracksToMix);
      } else {
        // If only master buffer (no new tracks), regenerate from the rendered buffer
        this.generateMasterWaveform(rendered);
      }
      
      // Clear all track waveforms AFTER generating master waveform
      this.trackWaveforms.clear();
      
      // Reset all track controls to default positions
      this.tracks.forEach((track, index) => {
        // Reset faders to 0dB (80%)
        const fader = document.getElementById(`fader-${track.id}`) as HTMLInputElement | null;
        if (fader) {
          fader.value = '80';
          fader.style.setProperty('--fader-value', '80');
          if (track.gainNode) {
            track.gainNode.gain.value = 1.0; // 0 dB
          }
        }
        
        // Reset pan to center (50)
        const panKnob = document.getElementById(`pan-${track.id}`) as HTMLInputElement | null;
        if (panKnob) {
          panKnob.value = '50';
          track.panValue = 50;
          if (track.panNode) {
            track.panNode.pan.value = 0; // Center
          }
          // Update knob rotation visual
          const panContainer = panKnob.parentElement;
          if (panContainer) {
            panContainer.style.setProperty('--rotation', '0deg');
          }
        }
        
        // Disarm all tracks except Track 1
        track.isArmed = false;
        const armButton = document.getElementById(`track-${track.id}`) as HTMLInputElement | null;
        if (armButton) {
          armButton.checked = false;
        }
        
        // Clear solo and mute states
        track.isSolo = false;
        track.isMuted = false;
        track.isManuallyMuted = false;
        
        const soloButton = document.getElementById(`solo-${track.id}`) as HTMLInputElement | null;
        const muteButton = document.getElementById(`mute-${track.id}`) as HTMLInputElement | null;
        
        if (soloButton) soloButton.checked = false;
        if (muteButton) muteButton.checked = false;
        
        // Update mute button styling
        this.updateMuteButtonStyling(track.id);
      });
      
      // Update audio routing to reflect the reset state
      this.updateAudioRouting();
      
      // Update the waveform display
      this.redrawAllTrackWaveforms();
      
      if (hasMasterBuffer && hasIndividualTracks) {
        this.debugLog('bounce', '[TAPEFOUR] ✅ Additive bounce complete - combined previous master with new tracks');
      } else if (hasMasterBuffer) {
        this.debugLog('bounce', '[TAPEFOUR] ✅ Master-only bounce complete - regenerated master buffer');
      } else {
        this.debugLog('bounce', '[TAPEFOUR] ✅ Initial bounce complete - tracks bounced to master');
      }
      
    } catch (err) {
      this.debugError('bounce', '[TAPEFOUR] ❌ Bounce error:', err);
      this.showError('Error bouncing tracks. Please try again.');
    }
  }

  private getTracksForMixdown() {
    // Get tracks with audio buffers
    const tracksWithAudio = this.tracks.filter(track => track.audioBuffer);
    
    // Apply solo logic: if any tracks are soloed, only include soloed tracks
    const soloedTracks = tracksWithAudio.filter(track => track.isSolo);
    const tracksToMix = soloedTracks.length > 0 ? soloedTracks : tracksWithAudio;
    
    return tracksToMix;
  }

  private generateMasterWaveform(audioBuffer: AudioBuffer) {
    const samples = audioBuffer.getChannelData(0); // Use left channel for waveform
    const waveformData: Array<{position: number, peak: number}> = [];
    
    // Sample every N samples to create manageable waveform data
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const samplesPerPixel = Math.floor(samples.length / this.waveformBufferSize);
    
    for (let i = 0; i < this.waveformBufferSize; i++) {
      const start = i * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, samples.length);
      
      let peak = 0;
      for (let j = start; j < end; j++) {
        peak = Math.max(peak, Math.abs(samples[j]));
      }
      
      const position = (i / this.waveformBufferSize) * duration * 1000; // Convert to ms
      waveformData.push({ position, peak });
    }
    
    this.masterWaveform = waveformData;
  }

  private generateTrackWaveform(audioBuffer: AudioBuffer, trackId: number) {
    const samples = audioBuffer.getChannelData(0); // Use left channel for waveform
    const waveformData: Array<{position: number, peak: number}> = [];
    
    // Sample every N samples to create manageable waveform data
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const samplesPerPixel = Math.floor(samples.length / this.waveformBufferSize);
    
    for (let i = 0; i < this.waveformBufferSize; i++) {
      const start = i * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, samples.length);
      
      let peak = 0;
      for (let j = start; j < end; j++) {
        peak = Math.max(peak, Math.abs(samples[j]));
      }
      
      const position = (i / this.waveformBufferSize) * duration * 1000; // Convert to ms
      waveformData.push({ position, peak });
    }
    
    // Store waveform data for the specified track
    this.trackWaveforms.set(trackId, waveformData);
    this.debugLog('waveform', `[WAVEFORM] 🎨 Generated waveform for track ${trackId} with ${waveformData.length} peaks`);
  }

  private generateMasterWaveformFromTracks(rendered: AudioBuffer, originalTracks: any[]) {
    // Collect ALL waveform points from original tracks to preserve exact positioning
    const allOriginalPoints: Array<{position: number, peak: number}> = [];
    
    originalTracks.forEach(track => {
      const waveformData = this.trackWaveforms.get(track.id);
      if (waveformData && waveformData.length > 0) {
        allOriginalPoints.push(...waveformData);
      }
    });
    
    // If no existing waveforms found, fall back to time-based generation
    if (allOriginalPoints.length === 0) {
      this.generateMasterWaveform(rendered);
      return;
    }
    
    // Sort by position to maintain timeline order
    allOriginalPoints.sort((a, b) => a.position - b.position);
    
    // Get canvas dimensions for position mapping
    const canvasInternalWidth = this.waveformCanvas?.width || 800;
    const samples = rendered.getChannelData(0);
    const samplesPerPixel = samples.length / canvasInternalWidth;
    
    const waveformData: Array<{position: number, peak: number}> = [];
    
    // For each original canvas position, calculate the corresponding peak in the bounced audio
    allOriginalPoints.forEach(originalPoint => {
      const canvasX = originalPoint.position; // This is already in canvas coordinates (0-800)
      const sampleIndex = Math.floor(canvasX * samplesPerPixel);
      
      // Sample a small window around this position to get the peak
      const windowSize = Math.max(1, Math.floor(samplesPerPixel)); // At least 1 sample
      const startSample = Math.max(0, sampleIndex - Math.floor(windowSize / 2));
      const endSample = Math.min(samples.length, startSample + windowSize);
      
      let peak = 0;
      for (let i = startSample; i < endSample; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
      }
      
      if (peak > 0.01) { // Only add significant peaks
        waveformData.push({ position: canvasX, peak });
      }
    });
    
    this.masterWaveform = waveformData;
    this.debugLog('waveform', `[WAVEFORM] 🏆 Generated master waveform with ${waveformData.length} peaks at original canvas positions`);
  }

  public async export() {
    if (!this.audioContext) return this.showError('No audio to export. Please record something first.');
    
    if (this.state.multiTrackExport) {
      this.debugLog('general', '[TAPEFOUR] 📁 Starting multi-track export...');
      await this.exportMultiTrack();
    } else {
      this.debugLog('general', '[TAPEFOUR] 📁 Starting master-only export...');
      await this.exportMasterOnly();
    }
  }

  private async exportMasterOnly() {
    // Prefer master buffer if available (from bounce), otherwise mix tracks on-the-fly
    if (this.state.masterBuffer) {
      this.debugLog('general', '[TAPEFOUR] 📁 Exporting bounced master mix');
      this.downloadWav(this.state.masterBuffer, 'master');
      return;
    }
    
    this.debugLog('general', '[TAPEFOUR] 📁 Exporting live mix (no bounce available)');
    
    const tracksWithAudio = this.tracks.filter((t) => t.audioBuffer);
    if (tracksWithAudio.length === 0) {
      return this.showError('No tracks to export. Please record some audio first.');
    }

    try {
      // Create offline context for live mix export
      const maxDuration = Math.max(...tracksWithAudio.map(t => t.audioBuffer!.duration));
      const offline = new OfflineAudioContext(
        2, // Stereo
        Math.ceil(this.audioContext!.sampleRate * maxDuration),
        this.audioContext!.sampleRate
      );

      const offlineMaster = offline.createGain();
      offlineMaster.gain.value = this.masterGainNode!.gain.value;
      offlineMaster.connect(offline.destination);

      tracksWithAudio.forEach((track) => {
        if (!track.isMuted && (!this.tracks.some(t => t.isSolo) || track.isSolo)) {
          const src = offline.createBufferSource();
          const gain = offline.createGain();
          const pan = offline.createStereoPanner();
          
          src.buffer = track.audioBuffer!;
          gain.gain.value = track.gainNode!.gain.value;
          const panPosition = (track.panValue - 50) / 50;
          pan.pan.value = panPosition;
          
          src.connect(gain);
          gain.connect(pan);
          pan.connect(offlineMaster);
          src.start(0);
        }
      });

      const rendered = await offline.startRendering();
      this.downloadWav(rendered, 'master');
    } catch (err) {
      this.debugError('general', 'export error', err);
      this.showError('Error exporting audio. Please try again.');
    }
  }

  private async exportMultiTrack() {
    const tracksWithAudio = this.tracks.filter((t) => t.audioBuffer);
    if (tracksWithAudio.length === 0 && !this.state.masterBuffer) {
      return this.showError('No tracks to export. Please record some audio first.');
    }

    const totalFiles = tracksWithAudio.length + (this.state.masterBuffer || tracksWithAudio.length > 0 ? 1 : 0);
    this.showStatus(`📦 Creating multi-track zip with ${totalFiles} files...`);

    try {
      const zip = new JSZip();
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '_');
      let fileCount = 0;

      // Add individual tracks to zip
      for (const track of tracksWithAudio) {
        this.showStatus(`📦 Adding Track ${track.id} to zip... (${fileCount + 1}/${totalFiles})`);
        this.debugLog('general', `[TAPEFOUR] 📁 Processing Track ${track.id} for zip...`);
        
        const trackBuffer = await this.renderTrackBuffer(track);
        const wavData = this.audioBufferToWav(trackBuffer);
        const filename = `track_${track.id}_${timestamp}.wav`;
        
        zip.file(filename, wavData);
        fileCount++;
        this.debugLog('general', `[TAPEFOUR] ✅ Added ${filename} to zip`);
      }

      // Add master mix to zip
      if (this.state.masterBuffer) {
        this.showStatus(`📦 Adding Master Mix to zip... (${fileCount + 1}/${totalFiles})`);
        this.debugLog('general', `[TAPEFOUR] 📁 Processing bounced master for zip...`);
        
        const wavData = this.audioBufferToWav(this.state.masterBuffer);
        const filename = `master_${timestamp}.wav`;
        zip.file(filename, wavData);
        fileCount++;
        this.debugLog('general', `[TAPEFOUR] ✅ Added ${filename} to zip`);
      } else if (tracksWithAudio.length > 0) {
        this.showStatus(`📦 Adding Master Mix to zip... (${fileCount + 1}/${totalFiles})`);
        this.debugLog('general', `[TAPEFOUR] 📁 Processing live master mix for zip...`);
        
        const masterBuffer = await this.renderMasterBuffer(tracksWithAudio);
        const wavData = this.audioBufferToWav(masterBuffer);
        const filename = `master_${timestamp}.wav`;
        zip.file(filename, wavData);
        fileCount++;
        this.debugLog('general', `[TAPEFOUR] ✅ Added ${filename} to zip`);
      }

      // Generate and download zip
      this.showStatus(`📦 Generating zip file...`);
      this.debugLog('general', `[TAPEFOUR] 📦 Generating zip with ${fileCount} files...`);
      
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipFilename = `TS_tapefour_multitrack_${timestamp}.zip`;
      
      this.showStatus(`📥 Downloading ${zipFilename}...`);
      this.downloadBlob(zipBlob, zipFilename);

      this.showStatus(`✅ Multi-track export completed: ${zipFilename} downloaded!`);
      this.debugLog('general', `[TAPEFOUR] ✅ Multi-track zip export completed: ${zipFilename}`);
      
      // Hide status after a few seconds
      setTimeout(() => {
        this.hideStatus();
      }, 3000);
    } catch (err) {
      this.debugError('general', 'multi-track zip export error', err);
      this.hideStatus();
      this.showError('Error creating multi-track zip. Please try again.');
    }
  }




  private downloadWav(buf: AudioBuffer, trackName: string = 'mix') {
    try {
      this.debugLog('general', `[TAPEFOUR] 🔄 Converting ${trackName} to WAV...`);
      const wav = this.audioBufferToWav(buf);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '_');
      const filename = `TS_tapefour_${trackName}_${timestamp}.wav`;
      
      this.downloadBlob(blob, filename);
      this.debugLog('general', `[TAPEFOUR] ✅ Download initiated: ${filename}`);
    } catch (err) {
      this.debugError('general', `Download error for ${trackName}`, err);
      throw err;
    }
  }

  private downloadBlob(blob: Blob, filename: string) {
    try {
      const url = URL.createObjectURL(blob);
      this.debugLog('general', `[TAPEFOUR] 📥 Initiating download: ${filename}`);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      
      // Force user interaction by adding to DOM and triggering click
      document.body.appendChild(a);
      
      // Use setTimeout to ensure the element is in DOM
      setTimeout(() => {
        a.click();
        
        // Remove element after click
        setTimeout(() => {
          if (document.body.contains(a)) {
            document.body.removeChild(a);
          }
        }, 100);
        
        // Clean up blob URL after download should have started
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 2000);
      }, 100);
    } catch (err) {
      this.debugError('general', `Download error for ${filename}`, err);
      throw err;
    }
  }

  private async renderTrackBuffer(track: typeof this.tracks[number]): Promise<AudioBuffer> {
    if (!track.audioBuffer || !this.audioContext) {
      throw new Error(`Track ${track.id} has no audio buffer or audio context not available`);
    }

    // Create offline context for individual track export with effects applied
    const offline = new OfflineAudioContext(
      2, // Stereo
      track.audioBuffer.length,
      this.audioContext.sampleRate
    );

    const src = offline.createBufferSource();
    const gain = offline.createGain();
    const pan = offline.createStereoPanner();
    
    src.buffer = track.audioBuffer;
    gain.gain.value = track.gainNode!.gain.value;
    const panPosition = (track.panValue - 50) / 50;
    pan.pan.value = panPosition;
    
    src.connect(gain);
    gain.connect(pan);
    pan.connect(offline.destination);
    src.start(0);

    return await offline.startRendering();
  }

  private async renderMasterBuffer(tracksWithAudio: typeof this.tracks): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('Audio context not available');
    }

    const maxDuration = Math.max(...tracksWithAudio.map(t => t.audioBuffer!.duration));
    const offline = new OfflineAudioContext(
      2, // Stereo
      Math.ceil(this.audioContext.sampleRate * maxDuration),
      this.audioContext.sampleRate
    );

    const offlineMaster = offline.createGain();
    offlineMaster.gain.value = this.masterGainNode!.gain.value;
    offlineMaster.connect(offline.destination);

    tracksWithAudio.forEach((track) => {
      if (!track.isMuted && (!this.tracks.some(t => t.isSolo) || track.isSolo)) {
        const src = offline.createBufferSource();
        const gain = offline.createGain();
        const pan = offline.createStereoPanner();
        
        src.buffer = track.audioBuffer!;
        gain.gain.value = track.gainNode!.gain.value;
        const panPosition = (track.panValue - 50) / 50;
        pan.pan.value = panPosition;
        
        src.connect(gain);
        gain.connect(pan);
        pan.connect(offlineMaster);
        src.start(0);
      }
    });

    return await offline.startRendering();
  }

  private audioBufferToWav(buffer: AudioBuffer) {
    const length = buffer.length;
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;

    const ab = new ArrayBuffer(bufferSize);
    const view = new DataView(ab);
    let offset = 0;
    const writeStr = (s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
      offset += s.length;
    };

    writeStr('RIFF');
    view.setUint32(offset, bufferSize - 8, true); offset += 4;
    writeStr('WAVE');
    writeStr('fmt ');
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2; // PCM
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;
    writeStr('data');
    view.setUint32(offset, dataSize, true); offset += 4;

    const channels: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));

    let sampleOffset = offset;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(sampleOffset, sample * 0x7fff, true);
        sampleOffset += 2;
      }
    }

    return ab;
  }

  /**
   * Check microphone permissions on page load and prompt if needed.
   * This ensures we have access before the user tries to record.
   */
  private async checkMicrophonePermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      this.debugLog('input', 'Microphone permission granted');
    } catch (err) {
      this.debugWarn('input', 'Microphone permission denied or not available:', err);
    }
  }

  private async muteInput() {
    if (this.mediaStream && !this.state.inputMuted) {
      this.debugLog('input', '🔇 Muting input - tracks:', this.mediaStream.getAudioTracks().length);
      this.mediaStream.getAudioTracks().forEach(track => {
        this.debugLog('input', '  - Disabling track:', track.label, 'enabled:', track.enabled);
        track.enabled = false;
      });
      this.state.inputMuted = true;
      this.debugLog('input', '✅ Input muted');
    } else {
      this.debugLog('input', '⚠️ Cannot mute input - mediaStream:', !!this.mediaStream, 'already muted:', this.state.inputMuted);
    }
  }

  private async unmuteInput() {
    if (this.mediaStream && this.state.inputMuted) {
      this.debugLog('input', '🔊 Unmuting input');
      this.mediaStream.getAudioTracks().forEach(track => {
        this.debugLog('input', '  - Enabling track:', track.label);
        track.enabled = true;
      });
      this.state.inputMuted = false;
      this.debugLog('input', '✅ Input unmuted');
    } else {
      this.debugLog('input', '⚠️ Cannot unmute input - mediaStream:', !!this.mediaStream, 'inputMuted:', this.state.inputMuted);
    }
  }

  private async ensureInputStream() {
    if (!this.mediaStream) {
      this.debugLog('input', '🎤 No input stream found, setting up recording stream...');
      await this.setupRecording();
    } else {
      this.debugLog('input', '✅ Input stream already exists');
    }
  }

  private async startVolumeMeter() {
    this.debugLog('input', '[METER] 🎚️ startVolumeMeter() called');
    
    if (this.volumeMeterActive) {
      this.debugLog('input', '[METER] ⚠️ Volume meter already active, skipping');
      return;
    }
    
    this.debugLog('input', '[METER] 🔧 Initializing audio context and input stream...');
    
    // Ensure we have audio context and media stream
    await this.initializeAudio();
    await this.ensureInputStream();
    
    if (!this.mediaStream || !this.audioContext) {
      this.debugWarn('input', '[METER] ❌ Missing required components - mediaStream:', !!this.mediaStream, 'audioContext:', !!this.audioContext);
      return;
    }

    this.debugLog('input', '[METER] ✅ Required components available');

    // Ensure we have a shared input source node (only one per MediaStream allowed)
    if (!this.inputSourceNode) {
      this.debugLog('input', '[METER] 🔌 Creating shared input source node');
      this.inputSourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    } else {
      this.debugLog('input', '[METER] ♻️ Using existing shared input source node');
    }

    // Create analyser for volume monitoring
    this.debugLog('input', '[METER] 📊 Creating analyser node');
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 512; // Increased for better resolution
    this.analyserNode.smoothingTimeConstant = 0.1; // Faster response for better peak detection
    
    // Connect the shared input source to the analyser
    this.debugLog('input', '[METER] 🔗 Connecting shared input source to analyser');
    this.inputSourceNode.connect(this.analyserNode);
    
    // IMPORTANT: Also reconnect to input monitoring if it's active
    if (this.state.isMonitoring && this.inputMonitoringGainNode) {
      this.debugLog('input', '[METER] 🔗 Reconnecting shared input source to monitoring gain');
      this.inputSourceNode.connect(this.inputMonitoringGainNode);
    }

    const dataArray = new Uint8Array(this.analyserNode.fftSize); // Use time domain data size
    this.volumeMeterActive = true;
    
    this.debugLog('input', '[METER] 🎯 Volume meter activated - starting animation loop');
    
    let peakHold = 0;
    let peakHoldTime = 0;
    let frameCount = 0;
    
    const updateMeter = () => {
      if (this.volumeMeterActive && this.analyserNode) {
        frameCount++;
        
        // Use time domain data for better peak detection
        this.analyserNode.getByteTimeDomainData(dataArray);
        
        // Calculate peak level for clipping detection
        let peak = 0;
        let rmsSum = 0;
        
        for (let i = 0; i < dataArray.length; i++) {
          // Convert from unsigned byte (0-255) to signed (-1 to 1)
          const sample = (dataArray[i] - 128) / 128;
          const absSample = Math.abs(sample);
          
          // Track peak
          if (absSample > peak) {
            peak = absSample;
          }
          
          // Accumulate for RMS
          rmsSum += sample * sample;
        }
        
        // Calculate RMS
        const rms = Math.sqrt(rmsSum / dataArray.length);
        
        // Use peak level with some RMS influence for better responsiveness
        // This gives us good peak detection while still showing consistent levels
        let displayLevel = Math.max(peak * 0.8, rms * 2); // Boost RMS for visibility
        
        // Apply some compression/scaling to make higher levels more visible
        // This helps show amber and red zones more easily
        displayLevel = Math.pow(displayLevel, 0.7); // Slight compression curve
        
        // Peak hold functionality - hold peaks for a brief moment
        const now = performance.now();
        if (displayLevel > peakHold) {
          peakHold = displayLevel;
          peakHoldTime = now;
        } else if (now - peakHoldTime > 200) { // Hold for 200ms
          peakHold *= 0.95; // Slow decay
        }
        
        // Use the higher of current level or peak hold
        const finalLevel = Math.max(displayLevel, peakHold);
        
        // Clamp to 0-1 range
        const clampedLevel = Math.min(Math.max(finalLevel, 0), 1);
        
        // Debug log every 30 frames (roughly every 0.5 seconds) or when level changes significantly
        if (frameCount % 30 === 0 || clampedLevel > 0.1) {
          this.debugLog('meter', `[METER] 📊 Frame ${frameCount}: peak=${peak.toFixed(3)}, rms=${rms.toFixed(3)}, display=${displayLevel.toFixed(3)}, final=${clampedLevel.toFixed(3)}`);
        }
        
        this.updateVolumeMeter(clampedLevel);
        this.volumeMeterAnimationId = requestAnimationFrame(updateMeter);
      } else {
        this.debugLog('input', '[METER] 🛑 Volume meter animation loop stopped');
      }
    };
    
    this.debugLog('input', '[METER] 🚀 Starting volume meter animation loop');
    updateMeter();
  }

  private stopVolumeMeter() {
    this.debugLog('input', '[METER] 🛑 Stopping volume meter...');
    
    this.volumeMeterActive = false;
    if (this.volumeMeterAnimationId) {
      cancelAnimationFrame(this.volumeMeterAnimationId);
      this.volumeMeterAnimationId = null;
    }
    
    // Disconnect analyser from shared input source node
    if (this.analyserNode && this.inputSourceNode) {
      try {
        this.debugLog('input', '[METER] 🔗 Disconnecting analyser from shared input source');
        this.inputSourceNode.disconnect(this.analyserNode);
      } catch (e) {
        this.debugWarn('input', '[METER] ⚠️ Error disconnecting analyser:', e);
      }
      this.analyserNode = null;
    }
    
    // Only clean up shared input source node if monitoring is not active
    if (!this.state.isMonitoring && this.inputSourceNode) {
      this.debugLog('input', '[METER] 🗑️ Cleaning up shared input source (monitoring not active)');
      this.inputSourceNode.disconnect();
      this.inputSourceNode = null;
    } else if (this.state.isMonitoring) {
      this.debugLog('input', '[METER] 🎧 Keeping shared input source for active monitoring');
    }
    
    this.updateVolumeMeter(0);
    this.debugLog('input', '[METER] ✅ Volume meter stopped');
  }

  private async startInputMonitoring() {
    // Only start if not already active
    if (this.state.isMonitoring) {
      this.debugLog('input', '[INPUT] 🎧 Input monitoring already active, skipping...');
      return;
    }
    
    this.debugLog('input', '[INPUT] 🎧 Starting input monitoring...');
    
    // Check required components
    if (!this.audioContext || !this.mediaStream || !this.inputMonitoringGainNode) {
      this.debugWarn('input', '[INPUT] ⚠️ Cannot start input monitoring - missing required components');
      return;
    }
    
    try {
      // Ensure we have a shared input source node (only one per MediaStream allowed)
      if (!this.inputSourceNode) {
        this.debugLog('input', '[INPUT] 🔌 Creating shared input source node...');
        this.inputSourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      } else {
        this.debugLog('input', '[INPUT] ♻️ Using existing shared input source node');
      }
      
      // Connect input to monitoring gain node (already connected to audio destination)
      this.debugLog('input', '[INPUT] 🔗 Connecting shared input source to monitoring gain');
      this.inputSourceNode.connect(this.inputMonitoringGainNode);
      
      this.state.isMonitoring = true;
      
      this.debugLog('input', '[INPUT] ✅ Input monitoring started - you can now hear live input');
    } catch (error) {
      this.debugError('input', '[INPUT] ❌ Error connecting input monitoring:', error);
    }
  }

  private stopInputMonitoring() {
    this.debugLog('input', '[INPUT] 🔇 Stopping input monitoring...');
    
    try {
      if (this.inputSourceNode && this.inputMonitoringGainNode) {
        // Only disconnect from the monitoring gain node, keep the shared source intact
        this.debugLog('input', '[INPUT] 🔗 Disconnecting from monitoring gain node only');
        this.inputSourceNode.disconnect(this.inputMonitoringGainNode);
      }
      this.debugLog('input', '[INPUT] ✅ Input monitoring stopped');
    } catch (error) {
      this.debugWarn('input', '[INPUT] ⚠️ Error stopping input monitoring:', error);
    }
    
    // CRITICAL: Always reset monitoring state even if nodes don't exist
    // This fixes the bug where monitoring state gets stuck as "true"
    this.state.isMonitoring = false;
    this.debugLog('input', '[INPUT] 🔇 Input monitoring state reset');
  }

  private enableMonitoringMode() {
    if (this.monitoringGainNode) {
      this.monitoringGainNode.gain.value = 0.3; // Set monitoring gain to 30%
      console.log('🎧 Monitoring mode enabled - playback at 30% volume');
    } else {
      console.warn('⚠️ Monitoring gain node not found');
    }
  }

  private disableMonitoringMode() {
    if (this.monitoringGainNode) {
      this.monitoringGainNode.gain.value = 0; // Mute monitoring during normal playback
      console.log('🔇 Monitoring mode disabled');
    }
  }

  private startTapeReelSpinning() {
    const leftReel = document.getElementById('left-reel');
    const rightReel = document.getElementById('right-reel');
    
    if (leftReel) leftReel.classList.add('spinning');
    if (rightReel) rightReel.classList.add('spinning');
    
    console.log('🎞️ Tape reels started spinning');
  }

  private stopTapeReelSpinning() {
    // Prevent multiple animations from running simultaneously
    if (this.reelAnimationActive) {
      console.log('🛑 Reel animation already in progress, skipping');
      return;
    }

    const leftReel = document.getElementById('left-reel') as unknown as SVGElement;
    const rightReel = document.getElementById('right-reel') as unknown as SVGElement;
    
    if (leftReel) {
      console.log('🛑 Left reel stopping with manual animation');
      leftReel.classList.remove('spinning');
    }
    
    if (rightReel) {
      console.log('🛑 Right reel stopping with manual animation');
      rightReel.classList.remove('spinning');
    }
    
    // Start the animation for both reels
    this.reelAnimationActive = true;
    this.animateReelRotation(leftReel, rightReel, 500);
    
    console.log('🛑 Tape reels stopping with smooth animation');
  }

  private animateReelRotation(leftReel: SVGElement | null, rightReel: SVGElement | null, duration: number) {
    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Use easeOutCubic for smooth deceleration (same as fader animation)
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      
      // Animate from current rotation to 0 degrees
      // We'll assume the reel could be at any rotation, so we animate towards 0
      const currentRotation = (1 - easeOutCubic) * 360; // Start from a full rotation and go to 0
      
      if (leftReel) {
        leftReel.style.transform = `translateY(-50%) rotate(${currentRotation}deg)`;
      }
      if (rightReel) {
        rightReel.style.transform = `translateY(-50%) rotate(${currentRotation}deg)`;
      }
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Ensure final position is exactly 0
        if (leftReel) leftReel.style.transform = `translateY(-50%) rotate(0deg)`;
        if (rightReel) rightReel.style.transform = `translateY(-50%) rotate(0deg)`;
        
        // Mark animation as complete
        this.reelAnimationActive = false;
        console.log('🛑 Reel animation complete');
      }
    };
    
    requestAnimationFrame(animate);
  }

  /* ---------- Loop Functionality Methods ---------- */

  private setupInitialLoop(recordingDuration: number) {
    this.state.loopStart = 0;
    this.state.loopEnd = recordingDuration;
    this.state.isLooping = true;
    
    this.debugLog('general', `[LOOP] 🔄 Auto-set loop: 0s → ${recordingDuration.toFixed(2)}s`);
    
    // Update loop button visual state
    this.updateLoopButtonState();
    
    // Update transport display
    this.updateTransportDisplay();
    
    // Redraw waveform to show loop region
    this.redrawAllTrackWaveforms();
    
    // Automatically start playback from loop start for immediate overdubbing
    setTimeout(() => {
      this.state.playheadPosition = 0; // Reset to beginning
      this.play(); // Start playback from loop start
      this.debugLog('general', '[LOOP] 🔄 Auto-started playback from loop beginning for overdubbing');
    }, 100); // Small delay to ensure UI updates complete
  }

  private toggleLoop() {
    this.state.isLooping = !this.state.isLooping;
    this.debugLog('general', `[LOOP] ${this.state.isLooping ? '🔄' : '⏹️'} Loop ${this.state.isLooping ? 'enabled' : 'disabled'}`);
    
    // Update loop button visual state
    this.updateLoopButtonState();
    
    // Update transport display
    this.updateTransportDisplay();
    
    // Redraw waveform to show/hide loop region
    this.redrawAllTrackWaveforms();
  }

  private setLoopStart(timeInSeconds: number) {
    // Ensure start is not after end
    this.state.loopStart = Math.max(0, Math.min(timeInSeconds, this.state.loopEnd - 0.1));
    this.debugLog('general', `[LOOP] 🎯 Loop start set to ${this.state.loopStart.toFixed(2)}s`);
    this.updateTransportDisplay();
    this.redrawAllTrackWaveforms();
  }

  private setLoopEnd(timeInSeconds: number) {
    // Ensure end is not before start
    const maxDuration = this.state.maxRecordingTime / 1000; // Convert ms to seconds
    this.state.loopEnd = Math.min(maxDuration, Math.max(timeInSeconds, this.state.loopStart + 0.1));
    this.debugLog('general', `[LOOP] 🎯 Loop end set to ${this.state.loopEnd.toFixed(2)}s`);
    this.updateTransportDisplay();
    this.redrawAllTrackWaveforms();
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const centiseconds = Math.floor((seconds % 1) * 100);
    return `${minutes}:${secs.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }

  private updateTransportDisplay() {
    // Loop display is now handled entirely in the waveform area
    // Just update the regular timecode
    this.updateTimecode();
  }

  private restartTracksFromLoopStart() {
    // Don't restart if we're not supposed to be playing
    if (!this.state.isPlaying) {
      this.debugLog('general', '[LOOP] ⏹️ Not restarting tracks - playback stopped');
      return;
    }
    
    // Stop all currently playing sources
    this.tracks.forEach((track) => {
      if (track.sourceNode) {
        try {
          track.sourceNode.stop();
          track.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
        }
        track.sourceNode = null;
      }
    });

    // Stop master source if playing
    if ((this as any).masterSourceNode) {
      try {
        (this as any).masterSourceNode.stop();
        (this as any).masterSourceNode.disconnect();
      } catch (e) {
        // Ignore if already stopped
      }
      (this as any).masterSourceNode = null;
    }

    // Only restart if still playing
    if (this.state.isPlaying) {
      // Restart all tracks from loop start position
      const startTime = this.audioContext!.currentTime + 0.05; // Small delay for sync
      
      if (this.state.masterBuffer) {
        this.playMasterTrack(startTime);
      }
      
      this.tracks.forEach((track) => {
        if (track.audioBuffer) {
          this.playTrack(track, startTime);
        }
      });
      
      this.debugLog('general', `[LOOP] 🔄 Restarted all tracks from loop start (${this.state.loopStart.toFixed(2)}s)`);
    }
  }

  private drawLoopRegion() {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    const canvas = this.waveformCanvas;
    const ctx = this.waveformContext;
    const height = canvas.height;
    const canvasInternalWidth = canvas.width;
    
    // Convert loop times to canvas positions
    const maxTimeSeconds = this.state.maxRecordingTime / 1000;
    const loopStartX = (this.state.loopStart / maxTimeSeconds) * canvasInternalWidth;
    const loopEndX = (this.state.loopEnd / maxTimeSeconds) * canvasInternalWidth;
    const loopWidth = loopEndX - loopStartX;
    
    // Draw semi-transparent loop region
    ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'; // Green with low opacity
    ctx.fillRect(loopStartX, 0, loopWidth, height);
    
    // Draw loop region borders
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)'; // More opaque green for borders
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); // Dashed line
    ctx.strokeRect(loopStartX, 0, loopWidth, height);
    ctx.setLineDash([]); // Reset line dash
    
    // Draw draggable handles
    this.drawLoopHandle(loopStartX, 'start');
    this.drawLoopHandle(loopEndX, 'end');
    
    // Time labels removed - cleaner visual appearance
  }

  private drawLoopHandle(x: number, type: 'start' | 'end') {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    const ctx = this.waveformContext;
    const height = this.waveformCanvas.height;
    const handleWidth = 8;
    const handleHeight = height;
    
    // Determine if this handle is being dragged
    const isDragging = (type === 'start' && this.state.isDraggingLoopStart) || 
                      (type === 'end' && this.state.isDraggingLoopEnd);
    
    // Handle colors
    const baseColor = type === 'start' ? 'rgba(34, 197, 94, 0.8)' : 'rgba(34, 197, 94, 0.8)';
    const activeColor = type === 'start' ? 'rgba(34, 197, 94, 1)' : 'rgba(34, 197, 94, 1)';
    
    // Draw handle background
    ctx.fillStyle = isDragging ? activeColor : baseColor;
    ctx.fillRect(x - handleWidth / 2, 0, handleWidth, handleHeight);
    
    // Draw handle border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - handleWidth / 2, 0, handleWidth, handleHeight);
    
    // Draw grip lines for visual feedback
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const lineY = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x - 2, lineY);
      ctx.lineTo(x + 2, lineY);
      ctx.stroke();
    }
  }

  private drawLoopTimeLabels(startX: number, endX: number) {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    const ctx = this.waveformContext;
    const canvas = this.waveformCanvas;
    
    // Set up text styling
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(34, 197, 94, 1)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // Draw start time label
    const startLabel = this.formatTime(this.state.loopStart);
    ctx.fillText(startLabel, startX, 5);
    
    // Draw end time label
    const endLabel = this.formatTime(this.state.loopEnd);
    ctx.fillText(endLabel, endX, 5);
    
    // Draw loop duration in the center
    const centerX = (startX + endX) / 2;
    const duration = this.state.loopEnd - this.state.loopStart;
    const durationLabel = `${duration.toFixed(2)}s`;
    ctx.fillStyle = 'rgba(34, 197, 94, 0.8)';
    ctx.fillText(durationLabel, centerX, canvas.height - 15);
  }

  /* ---------- Waveform Strip Methods ---------- */

  private clearWaveform(trackId?: number) {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    if (trackId) {
      // Clear only the specified track's waveform data
      this.trackWaveforms.set(trackId, []);
      console.log(`[WAVEFORM] 🗑️ Cleared waveform data for track ${trackId}`);
    } else {
      // Clear all track waveforms (used for full reset)
      this.trackWaveforms.clear();
      console.log('[WAVEFORM] 🗑️ Cleared all track waveform data');
    }
    
    // Always clear the canvas and redraw remaining waveforms
    this.waveformContext.clearRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
    this.redrawAllTrackWaveforms();
  }

  private preparePunchInWaveform(trackId: number) {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    console.log(`[PUNCH-IN] 🎨 Preparing punch-in waveform for track ${trackId}`);
    
    // Mark this track as in punch-in mode for visual rendering
    // We'll render existing waveform at reduced opacity and overlay new recording
    this.redrawAllTrackWaveforms();
    
    console.log('[PUNCH-IN] ✅ Punch-in waveform prepared - existing waveform will be faded during recording');
  }

  private setupWaveformAnalyser() {
    if (!this.audioContext || !this.inputSourceNode) return;
    
    this.waveformAnalyserNode = this.audioContext.createAnalyser();
    this.waveformAnalyserNode.fftSize = 512; // Smaller FFT for better performance
    this.waveformAnalyserNode.smoothingTimeConstant = 0.3;
    
    // Connect input to waveform analyser
    this.inputSourceNode.connect(this.waveformAnalyserNode);
    
    console.log('[WAVEFORM] 🌊 Waveform analyser setup complete');
  }

  private startWaveformCapture() {
    if (!this.waveformAnalyserNode) return;
    
    console.log('[WAVEFORM] 🎬 Starting waveform capture...');
    
    const dataArray = new Uint8Array(this.waveformAnalyserNode.frequencyBinCount);
    
    const captureWaveform = () => {
      if (!this.state.isRecording || !this.waveformAnalyserNode) {
        this.waveformRenderingId = null;
        return;
      }
      
      // Get time domain data (waveform)
      this.waveformAnalyserNode.getByteTimeDomainData(dataArray);
      
      // Calculate peak amplitude for this frame
      let peak = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const sample = Math.abs(dataArray[i] - 128) / 128; // Convert to 0-1 range
        if (sample > peak) peak = sample;
      }
      
      // Draw this peak immediately at current X position (left-to-right)
      this.drawWaveformPeak(peak);
      
      // Continue capturing
      this.waveformRenderingId = requestAnimationFrame(captureWaveform);
    };
    
    this.waveformRenderingId = requestAnimationFrame(captureWaveform);
  }

  private drawWaveformPeak(peak: number) {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    // Find the currently armed track
    const armedTrack = this.tracks.find(t => t.isArmed);
    if (!armedTrack) return;
    
    const canvas = this.waveformCanvas;
    const height = canvas.height;
    
    // Calculate current playhead position using the SAME logic as updatePlayheadUI
    const progress = this.state.playheadPosition / this.state.maxRecordingTime;
    
    // Get the displayed width of the playhead container (what the user sees)
    const playheadElement = document.getElementById('playhead');
    const displayedWidth = playheadElement ? playheadElement.clientWidth : 120;
    
    // Scale the position to match the canvas internal coordinate system
    const canvasInternalWidth = canvas.width; // 800px from HTML
    const scaleFactor = canvasInternalWidth / displayedWidth;
    
    // Calculate position in playhead space, then scale to canvas space
    const playheadPosition = Math.min(progress * displayedWidth, displayedWidth);
    const canvasX = playheadPosition * scaleFactor;
    
    // Store this peak data for the current track
    if (!this.trackWaveforms.has(armedTrack.id)) {
      this.trackWaveforms.set(armedTrack.id, []);
    }
    
    this.trackWaveforms.get(armedTrack.id)!.push({
      position: canvasX,
      peak: peak
    });
    
    // Redraw all track waveforms to show the new peak
    this.redrawAllTrackWaveforms();
  }
  
  private redrawAllTrackWaveforms() {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    const canvas = this.waveformCanvas;
    const ctx = this.waveformContext;
    const height = canvas.height;
    const canvasInternalWidth = canvas.width;
    
    // Clear the canvas
    ctx.clearRect(0, 0, canvasInternalWidth, height);
    
    let totalTracksDrawn = 0;
    const armedTrack = this.tracks.find(t => t.isArmed);
    const isPunchInRecording = this.state.isRecording && this.state.recordMode === 'punchIn';
    
    // Draw master waveform first (in background) if it exists
    if (this.masterWaveform.length > 0) {
      ctx.fillStyle = this.trackColors.master;
      ctx.strokeStyle = this.trackColors.master;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3; // Lower opacity so it stays in background
      
      const peakWidth = 2; // Slightly thinner for master
      for (const { position, peak } of this.masterWaveform) {
        const peakHeight = peak * (height * 0.9); // Slightly taller to be visible
        if (position < canvasInternalWidth && position >= 0) {
          ctx.fillRect(position, height - peakHeight, peakWidth, peakHeight);
        }
      }
      console.log(`[WAVEFORM] 🏆 Drew master waveform with ${this.masterWaveform.length} peaks`);
    }
    
    // Draw waveforms for all tracks with data (in order: 1, 2, 3, 4)
    for (let trackId = 1; trackId <= 4; trackId++) {
      const waveformData = this.trackWaveforms.get(trackId);
      if (!waveformData || waveformData.length === 0) continue;
      
      // Check if this track is reversed
      const track = this.tracks[trackId - 1];
      const isReversed = track?.isReversed || false;
      
      // Set color for this track
      const color = this.trackColors[trackId as keyof typeof this.trackColors] || '#D18C33';
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      
      // Determine opacity based on punch-in recording state
      if (isPunchInRecording && armedTrack && trackId === armedTrack.id) {
        // Armed track during punch-in: fade existing waveform to 40% opacity
        ctx.globalAlpha = 0.4;
      } else {
        // Normal opacity for other tracks or non-punch-in recording
        ctx.globalAlpha = 0.85;
      }
      
      // Draw all peaks for this track
      const peakWidth = 3;
      
      if (isReversed) {
        // For reversed tracks, find the min and max positions and flip within that range
        const positions = waveformData.map(d => d.position);
        const minPos = Math.min(...positions);
        const maxPos = Math.max(...positions);
        const rangeWidth = maxPos - minPos;
        
        for (const { position, peak } of waveformData) {
          // Flip position within its own recorded range
          const relativePosition = position - minPos; // Position relative to start of recording
          const flippedRelativePosition = rangeWidth - relativePosition; // Flip within the range
          const drawPosition = minPos + flippedRelativePosition; // Map back to canvas
          const peakHeight = peak * (height * 0.8);
          
          if (drawPosition < canvasInternalWidth && drawPosition >= 0) {
            ctx.fillRect(drawPosition, height - peakHeight, peakWidth, peakHeight);
          }
        }
      } else {
        // Normal (non-reversed) drawing
        for (const { position, peak } of waveformData) {
          const peakHeight = peak * (height * 0.8);
          
          if (position < canvasInternalWidth && position >= 0) {
            ctx.fillRect(position, height - peakHeight, peakWidth, peakHeight);
          }
        }
      }
      
      totalTracksDrawn++;
    }
    
    // Draw punch-in overlay if actively recording in punch-in mode
    if (isPunchInRecording && armedTrack) {
      this.drawPunchInOverlay(armedTrack.id);
    }
    
    // Reset alpha
    ctx.globalAlpha = 1;
    
    // Draw loop region if looping is active
    if (this.state.isLooping) {
      this.drawLoopRegion();
    }
    
    if (totalTracksDrawn > 0 || this.masterWaveform.length > 0) {
      this.debugLog('waveform', `[WAVEFORM] 🎨 Redrawn waveforms for ${totalTracksDrawn} tracks + master`);
    }
  }

  private drawPunchInOverlay(trackId: number) {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    const canvas = this.waveformCanvas;
    const ctx = this.waveformContext;
    const height = canvas.height;
    
    // Calculate punch-in region
    const progress = this.state.playheadPosition / this.state.maxRecordingTime;
    const punchInProgress = this.state.punchInStartPosition / this.state.maxRecordingTime;
    
    // Get the displayed width and scale to canvas
    const playheadElement = document.getElementById('playhead');
    const displayedWidth = playheadElement ? playheadElement.clientWidth : 120;
    const scaleFactor = canvas.width / displayedWidth;
    
    const punchInStartX = punchInProgress * displayedWidth * scaleFactor;
    const currentX = progress * displayedWidth * scaleFactor;
    const overlayWidth = currentX - punchInStartX;
    
    if (overlayWidth > 0) {
      // Set punch-in overlay color (semi-transparent orange)
      const trackColor = this.trackColors[trackId as keyof typeof this.trackColors] || '#D18C33';
      ctx.fillStyle = `${trackColor}80`; // Add 50% transparency (80 in hex)
      ctx.globalAlpha = 0.7;
      
      // Draw overlay rectangle from punch-in start to current position
      ctx.fillRect(punchInStartX, 0, overlayWidth, height);
      
      // Draw a subtle border to highlight the punch-in region
      ctx.strokeStyle = trackColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.strokeRect(punchInStartX, 0, overlayWidth, height);
      
      console.log(`[PUNCH-IN] 🎨 Drew punch-in overlay: ${punchInStartX.toFixed(1)}px to ${currentX.toFixed(1)}px (width: ${overlayWidth.toFixed(1)}px)`);
    }
  }

  private stopWaveformCapture() {
    if (this.waveformRenderingId) {
      cancelAnimationFrame(this.waveformRenderingId);
      this.waveformRenderingId = null;
    }
    
    if (this.waveformAnalyserNode) {
      this.waveformAnalyserNode.disconnect();
      this.waveformAnalyserNode = null;
    }
    
    this.debugLog('waveform', '[WAVEFORM] 🛑 Waveform capture stopped');
  }

  private updateUndoButtonState() {
    const undoButton = document.getElementById('undo-btn');
    if (undoButton) {
      undoButton.disabled = this.tracks.some(track => track.undoHistory.length > 0);
    }
  }

  /* ---------- Undo Functionality Methods ---------- */

  public undoLastOverride() {
    this.debugLog('general', '[UNDO] Undo requested');
    const armedTrack = this.tracks.find(t => t.isArmed);

    if (!armedTrack) {
      this.debugLog('general', '[UNDO] No track armed, cannot undo.');
      // No modal message, just silent fail.
      return;
    }

    if (armedTrack.undoHistory.length > 0) {
      const lastState = armedTrack.undoHistory.pop();
      if (lastState) { // Check if a state was popped successfully
        armedTrack.audioBuffer = lastState;
        this.debugLog('general', `[UNDO] Reverted track ${armedTrack.id} to previous state. History size: ${armedTrack.undoHistory.length}`);
        
        // Non-intrusive console confirmation
        console.log(`[TAPEFOUR] Undo: Last overdub removed from Track ${armedTrack.id}.`);

        this.redrawAllTrackWaveforms();
      }
    } else {
      this.debugLog('general', `[UNDO] No undo history for track ${armedTrack.id}.`);
    }

    // Always update the button state after an attempt
    this.updateUndoButtonState();
  }

  private updateUndoButtonState() {
    const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement | null;
    if (!undoBtn) return;

    const armedTrack = this.tracks.find(t => t.isArmed);
    // Button should be enabled only if a track is armed AND that track has an undo history.
    const canUndo = !!armedTrack && armedTrack.undoHistory.length > 0;

    undoBtn.disabled = !canUndo;

    // Add/remove class for visual styling
    if (canUndo) {
      undoBtn.classList.remove('disabled');
    } else {
      undoBtn.classList.add('disabled');
    }
    
    if (canUndo) {
      undoBtn.title = 'Undo Last Override (U)';
    } else {
      undoBtn.title = armedTrack ? 'No override to undo on this track' : 'Arm a track to undo an override';
    }
  }
}
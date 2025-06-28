// TapeFour Web Audio engine
// Extracted from the original prototype and adapted as a module.
// The class still manipulates DOM nodes by id. As long as the host React
// component renders elements with matching ids, it will work.
// A future refactor could fully lift UI state into React, but this keeps
// behaviour identical while we incrementally migrate the codebase.

export default class TapeFour {
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
    maxRecordingTime: 60000, // 60 seconds
    inputMuted: false,
    isMonitoring: false, // Whether input monitoring is active
    // Audio processing settings - default to false for more raw recording
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    // Punch-in recording state
    recordMode: 'fresh' as 'fresh' | 'punchIn',
    punchInStartPosition: 0, // Position where punch-in recording started (in ms)
    // Bounce to master
    masterBuffer: null as AudioBuffer | null,
    duration: 0, // Total duration in milliseconds
  };

  private tracks: Array<{
    id: number;
    audioBuffer: AudioBuffer | null;
    originalBuffer: AudioBuffer | null; // Store original buffer for toggling reverse
    isArmed: boolean;
    isSolo: boolean;
    isMuted: boolean;
    isManuallyMuted: boolean; // Visual state for mute button
    isReversed: boolean; // Track if audio is reversed
    gainNode: GainNode | null;
    sourceNode: AudioBufferSourceNode | null;
    panNode: StereoPannerNode | null;
    panValue: number; // 0 = fully left, 50 = center, 100 = fully right
  }> = [
    { id: 1, audioBuffer: null, originalBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, isReversed: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50 },
    { id: 2, audioBuffer: null, originalBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, isReversed: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50 },
    { id: 3, audioBuffer: null, originalBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, isReversed: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50 },
    { id: 4, audioBuffer: null, originalBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, isReversed: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50 },
  ];

  // Store previous mute states for when solo is disengaged
  private previousMuteStates: boolean[] = [false, false, false, false];

  // Scrubbing/timeline interaction
  private isDraggingPlayhead = false;
  private playheadContainer: HTMLElement | null = null;
  private lastSettingsToggleTime = 0;

  constructor() {
    // Load previously selected audio device and processing settings from localStorage
    this.loadSavedAudioDevice();
    this.loadSavedAudioProcessingSettings();
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
      });
      this.updateBounceButtonState(); // Initialize bounce button state
    }, 100);
  }

  private setupEventListeners() {
    // Prevent duplicate event listener initialization
    if (this.eventListenersInitialized) {
      console.log('[TAPEFOUR] ⚠️ Event listeners already initialized, skipping...');
      return;
    }
    
    console.log('[TAPEFOUR] 🎧 Setting up event listeners...');
    
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
    document.getElementById('export-btn')?.addEventListener('click', () => this.export());
    document.getElementById('bounce-btn')?.addEventListener('click', () => this.bounce());
    document.getElementById('clear-btn')?.addEventListener('click', () => this.clearEverything());
    document.getElementById('settings-btn')?.addEventListener('click', () => this.openSettings());

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

    // Scan devices button (refresh the list without closing modal)
    document.getElementById('scan-devices-btn')?.addEventListener('click', () => this.populateAudioInputSelect());

    // Audio processing toggle - improved reliability
    document.getElementById('audio-processing-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const options = document.getElementById('audio-processing-options');
      const arrow = document.getElementById('audio-processing-arrow');
      
      if (options && arrow) {
        const isCollapsed = options.classList.contains('collapsed');
        console.log(`[TAPEFOUR] 🔧 Audio processing toggle clicked, currently collapsed: ${isCollapsed}`);
        
        if (isCollapsed) {
          options.classList.remove('collapsed');
          arrow.classList.add('rotated');
          console.log('[TAPEFOUR] 🔧 Audio processing expanded');
        } else {
          options.classList.add('collapsed');
          arrow.classList.remove('rotated');
          console.log('[TAPEFOUR] 🔧 Audio processing collapsed');
        }
      } else {
        console.warn('[TAPEFOUR] ⚠️ Audio processing toggle elements not found');
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
        console.log(`[TAPEFOUR] ⌨️ Keyboard shortcuts toggle clicked, currently collapsed: ${isCollapsed}`);
        
        if (isCollapsed) {
          options.classList.remove('collapsed');
          arrow.classList.add('rotated');
          console.log('[TAPEFOUR] ⌨️ Keyboard shortcuts expanded');
        } else {
          options.classList.add('collapsed');
          arrow.classList.remove('rotated');
          console.log('[TAPEFOUR] ⌨️ Keyboard shortcuts collapsed');
        }
      } else {
        console.warn('[TAPEFOUR] ⚠️ Keyboard shortcuts toggle elements not found');
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
        console.log(`[TAPEFOUR] 💡 Tips toggle clicked, currently collapsed: ${isCollapsed}`);
        
        if (isCollapsed) {
          options.classList.remove('collapsed');
          arrow.classList.add('rotated');
          console.log('[TAPEFOUR] 💡 Tips expanded');
        } else {
          options.classList.add('collapsed');
          arrow.classList.remove('rotated');
          console.log('[TAPEFOUR] 💡 Tips collapsed');
        }
      } else {
        console.warn('[TAPEFOUR] ⚠️ Tips toggle elements not found');
      }
    });

    // Audio processing settings checkboxes
    document.getElementById('echo-cancellation-checkbox')?.addEventListener('change', (e) => {
      this.state.echoCancellation = (e.target as HTMLInputElement).checked;
      this.saveAudioProcessingSettings();
      console.log(`[TAPEFOUR] 🔧 Echo cancellation ${this.state.echoCancellation ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('noise-suppression-checkbox')?.addEventListener('change', (e) => {
      this.state.noiseSuppression = (e.target as HTMLInputElement).checked;
      this.saveAudioProcessingSettings();
      console.log(`[TAPEFOUR] 🔧 Noise suppression ${this.state.noiseSuppression ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('auto-gain-control-checkbox')?.addEventListener('change', (e) => {
      this.state.autoGainControl = (e.target as HTMLInputElement).checked;
      this.saveAudioProcessingSettings();
      console.log(`[TAPEFOUR] 🔧 Auto gain control ${this.state.autoGainControl ? 'enabled' : 'disabled'}`);
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
          console.log('[TAPEFOUR] ⌨️ A key pressed - triggering play');
          this.play();
          break;
        
        case 'KeyP':
          // P key for pause
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ P key pressed - triggering pause');
          this.pause();
          break;
        
        case 'KeyQ':
          // Q key for record
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ Q key pressed - triggering record');
          this.record();
          break;
        
        case 'KeyS':
          // S key for stop
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ S key pressed - triggering stop');
          this.stop();
          break;
        
        case 'KeyE':
          // E key for export
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ E key pressed - triggering export');
          this.export();
          break;
        
        case 'KeyB':
          // B key for bounce
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ B key pressed - triggering bounce');
          this.bounce();
          break;
        
        case 'KeyN':
          // N key for clear everything
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ N key pressed - triggering clear everything');
          this.clearEverything();
          break;
        
        case 'Digit1':
          // 1 key for track 1
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ 1 key pressed - toggling track 1 arm');
          this.toggleTrackArm(1);
          break;
        
        case 'Digit2':
          // 2 key for track 2
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ 2 key pressed - toggling track 2 arm');
          this.toggleTrackArm(2);
          break;
        
        case 'Digit3':
          // 3 key for track 3
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ 3 key pressed - toggling track 3 arm');
          this.toggleTrackArm(3);
          break;
        
        case 'Digit4':
          // 4 key for track 4
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ 4 key pressed - toggling track 4 arm');
          this.toggleTrackArm(4);
          break;
        
        case 'Comma':
          // Comma key for settings (both , and < which is shift+comma)
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ Comma key pressed - toggling settings');
          this.toggleSettings();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    // Playhead scrubbing functionality
    this.setupPlayheadScrubbing();
    
    // Mark event listeners as initialized
    this.eventListenersInitialized = true;
    console.log('[TAPEFOUR] ✅ Event listeners setup complete');
  }

  private setupPlayheadScrubbing() {
    // Get playhead container and indicator elements
    this.playheadContainer = document.getElementById('playhead');
    const playheadIndicator = document.getElementById('playhead-indicator') as HTMLElement | null;
    
    if (!this.playheadContainer || !playheadIndicator) {
      console.warn('[SCRUB] ⚠️ Playhead elements not found, scrubbing disabled');
      return;
    }
    
    console.log('[SCRUB] 🎯 Setting up playhead scrubbing...');
    
    // Add mouse event listeners for scrubbing
    const onMouseDown = (e: MouseEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) return;
      
      this.isDraggingPlayhead = true;
      console.log('[SCRUB] 🎯 Started playhead dragging');
      
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
        console.log('[SCRUB] 🎯 Stopped playhead dragging');
        
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
        console.log('[SCRUB] 🎯 Playhead clicked to seek');
      }
    };
    
    this.playheadContainer.addEventListener('click', onClick);
    
    // Add visual feedback with CSS cursor
    this.updatePlayheadCursor();
    
    console.log('[SCRUB] ✅ Playhead scrubbing setup complete');
  }

  private handlePlayheadDrag(e: MouseEvent) {
    if (!this.playheadContainer) return;
    
    // Disable scrubbing while recording to prevent accidental repositioning
    if (this.state.isRecording) {
      console.log('[SCRUB] ⚠️ Scrubbing disabled during recording');
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
    
    console.log(`[SCRUB] 🎯 Scrubbed to ${(newPosition / 1000).toFixed(2)}s (${(progress * 100).toFixed(1)}%)`);
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
    console.log('[SCRUB] 🔄 Restarting playback from scrubbed position');
    
    // Stop any existing audio sources with proper cleanup
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        console.log(`🛑 Stopping track ${t.id} source to restart from scrubbed position`);
        try {
          t.sourceNode.stop();
          t.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
          console.log(`  - Track ${t.id} source already stopped`);
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
            console.log(`🎶 Restarting track ${t.id} from position ${(this.state.playheadPosition / 1000).toFixed(2)}s`);
            this.playTrack(t, startTime);
          }
        });
        
        console.log(`✅ Restarted playback from ${(this.state.playheadPosition / 1000).toFixed(2)}s`);
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

  private doToggleTrackArm(trackId: number) {
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
    
    // Start/stop volume meter monitoring when tracks are armed/disarmed
    this.manageVolumeMeter();
  }

  private manageVolumeMeter() {
    const hasArmedTracks = this.tracks.some(t => t.isArmed);
    
    if (hasArmedTracks && !this.volumeMeterActive) {
      this.startVolumeMeter();
      this.startInputMonitoring();
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
      
      console.log(`[TAPEFOUR] 🔇 Track ${trackId} unsolo - restored previous mute states:`, this.previousMuteStates);
    } else {
      // Only store current manual mute states if no track is currently soloed
      // This prevents overwriting the original states when switching between solo tracks
      if (!currentlySoloedTrack) {
        this.tracks.forEach((t, index) => {
          this.previousMuteStates[index] = t.isManuallyMuted;
        });
        console.log(`[TAPEFOUR] 💾 Stored original manual mute states before first solo:`, this.previousMuteStates);
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
      
      console.log(`[TAPEFOUR] 🔊 Track ${trackId} soloed - all other tracks muted`);
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
      console.log(`[TAPEFOUR] ⚠️ Cannot manually mute/unmute while a track is soloed`);
      // Reset the checkbox to current manual mute state
      if (el) el.checked = track.isManuallyMuted;
      return;
    }

    // Toggle manual mute state
    track.isManuallyMuted = !track.isManuallyMuted;
    track.isMuted = track.isManuallyMuted; // Sync internal state with manual state
    if (el) el.checked = track.isManuallyMuted;
    
    console.log(`[TAPEFOUR] ${track.isManuallyMuted ? '🔇' : '🔊'} Track ${trackId} ${track.isManuallyMuted ? 'manually muted' : 'manually unmuted'}`);
    
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
        console.log(`🎚️ Track ${trackId} fader moved to ${value}% but track is muted (gain remains 0)`);
      } else {
        const gainValue = this.faderToGain(value);
        const dbValue = this.gainToDb(gainValue);
        track.gainNode.gain.value = gainValue;
        console.log(`🎚️ Track ${trackId} fader at ${value}% = ${dbValue.toFixed(1)} dB (gain: ${gainValue.toFixed(3)})`);
      }
    } else {
      console.warn(`⚠️ No gain node found for track ${trackId}`);
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
      console.log(`🎚️ Master fader at ${value}% = ${dbValue.toFixed(1)} dB (gain: ${gainValue.toFixed(3)})`);
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
      
      console.log(`🎚️ Track ${trackId} fader reset to default (80% = 0 dB)`);
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
      
      console.log(`🎚️ Master fader reset to default (80% = 0 dB)`);
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
      console.log(`🎛️ Track ${trackId} pan set to ${value} (${panValue.toFixed(2)})`);
    } else {
      console.warn(`⚠️ No pan node found for track ${trackId}`);
    }
  }

  private resetTrackPan(trackId: number) {
    const panKnob = document.getElementById(`pan-${trackId}`) as HTMLInputElement | null;
    if (panKnob) {
      panKnob.value = '50'; // Reset to center
      this.updateTrackPan(trackId, 50); // Update the pan
      console.log(`🎛️ Track ${trackId} pan reset to center (50)`);
    }
  }

  private applyTrackColorsToUI() {
    // Apply track colors to mute button backgrounds for visual consistency
    this.tracks.forEach((track) => {
      this.updateMuteButtonStyling(track.id);
    });
  }

  private toggleTrackReverse(trackId: number) {
    console.log(`[TAPEFOUR] 🔄 Toggling reverse for track ${trackId}`);
    
    const track = this.tracks[trackId - 1];
    if (!track) return;

    // Safety check: Stop transport if playing or recording
    if (this.state.isPlaying || this.state.isRecording) {
      console.log('[TAPEFOUR] 🛑 Stopping transport before reversing track');
      this.stop();
    }

    // Check if track has audio
    if (!track.audioBuffer) {
      console.log(`[TAPEFOUR] ⚠️ Track ${trackId} has no audio to reverse`);
      return;
    }

    try {
      if (track.isReversed) {
        // Track is currently reversed, restore original
        if (track.originalBuffer) {
          console.log(`[TAPEFOUR] ⏮️ Restoring original audio for track ${trackId}`);
          track.audioBuffer = track.originalBuffer;
          track.isReversed = false;
        }
      } else {
        // Track is not reversed, reverse it
        console.log(`[TAPEFOUR] 🔄 Reversing audio for track ${trackId}`);
        
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
      
      console.log(`[TAPEFOUR] ✅ Track ${trackId} reverse toggle complete. Reversed: ${track.isReversed}`);
      
    } catch (error) {
      console.error(`[TAPEFOUR] ❌ Error reversing track ${trackId}:`, error);
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
        
        console.log(`🎨 Applied muted (disabled) styling to track ${trackId} mute button`);
      } else {
        // Unmuted state: use track color
        muteButton.style.backgroundColor = color;
        muteButton.style.borderColor = this.darkenColor(color, 0.2); // Slightly darker border
        
        // Choose text color based on background luminance for optimal contrast
        const textColor = this.getContrastColor(color);
        muteLabel.style.color = textColor;
        muteLabel.style.fontWeight = '700'; // Bold for better visibility
        
        console.log(`🎨 Applied active color ${color} with ${textColor} text to track ${trackId} mute button`);
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

  private canBounce(): boolean {
    // Cannot bounce while recording or playing
    if (this.state.isRecording || this.state.isPlaying) {
      return false;
    }
    
    // Need either individual tracks with audio OR an existing master buffer
    const tracksToMix = this.getTracksForMixdown();
    const hasMasterBuffer = !!this.state.masterBuffer;
    
    return tracksToMix.length >= 1 || hasMasterBuffer;
  }

  /* ---------- Transport ---------- */

  public async play() {
    console.log('▶️ PLAY button pressed');
    
    // If recording, stop it first
    if (this.state.isRecording) {
      console.log('🛑 Stopping active recording before playback');
      this.stopRecording();
    }
    
    // If already playing, restart from the beginning
    if (this.state.isPlaying && !this.state.isPaused) {
      console.log('🔄 Already playing, restarting from beginning');
      // Call stop method to properly clean up everything
      this.stop();
      // Now continue with normal play logic below
    }

    await this.initializeAudio();
    await this.ensureInputStream();
    await this.muteInput(); // Mute input during playback

    // If paused, use the dedicated resume method instead
    if (this.state.isPaused) {
      this.resumeFromPause();
      return;
    }

    console.log('🎵 Starting fresh playback');
    
    // Disable monitoring mode for full volume playback
    this.disableMonitoringMode();
    
    // Stop any existing sources before starting new ones
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        console.log(`🛑 Stopping existing source for track ${t.id} before starting new playback`);
        try {
          t.sourceNode.stop();
          t.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
          console.log(`  - Track ${t.id} source already stopped`);
        }
        t.sourceNode = null;
      }
    });

    this.state.isPlaying = true;
    // Keep current playhead position for scrubbing functionality
    
    // Schedule all tracks to start at a slightly future time for perfect sync
    const startTime = this.audioContext!.currentTime + 0.1; // 100ms in the future
    this.playStartTime = Date.now() + 100; // Adjust playhead timer accordingly
    
    console.log(`🕐 Scheduling synchronized playback at audio context time: ${startTime}`);

    // Play master buffer if available (from bounce)
    if (this.state.masterBuffer) {
      console.log('🏆 Playing master buffer from bounce');
      this.playMasterTrack(startTime);
    }
    
    // ALSO play any individual tracks (for layering new recordings on top of master)
    const tracksToPlay = this.tracks.filter(t => t.audioBuffer);
    if (tracksToPlay.length > 0) {
      console.log(`🎵 Preparing ${tracksToPlay.length} individual tracks for playback${this.state.masterBuffer ? ' (layered with master)' : ''}`);
      
      this.tracks.forEach((t) => {
        if (t.audioBuffer) {
          console.log(`🎶 Playing track ${t.id} - buffer length: ${t.audioBuffer.length} samples`);
          this.playTrack(t, startTime);
        } else {
          console.log(`⚪ Track ${t.id} has no audio buffer`);
        }
      });
    }

    this.startPlayheadTimer();
    document.getElementById('play-btn')?.classList.add('playing');
    
    // Update bounce button state
    this.updateBounceButtonState();
    
    // Initialize timecode display
    this.updateTimecode();
    console.log('✅ Playback started');
  }

  private playTrack(track: typeof this.tracks[number], startTime?: number) {
    console.log(`🎵 playTrack() called for track ${track.id}`);
    
    // Ensure any existing source is properly stopped and cleaned up
    if (track.sourceNode) {
      console.log(`  - Stopping existing source for track ${track.id}`);
      try {
        track.sourceNode.stop();
        track.sourceNode.disconnect();
      } catch (e) {
        // Source might already be stopped/disconnected, ignore errors
        console.log(`  - Source for track ${track.id} already stopped`);
      }
      track.sourceNode = null;
    }

    const source = this.audioContext!.createBufferSource();
    source.buffer = track.audioBuffer!;
    console.log(`  - Created source node for track ${track.id}`);
    console.log(`  - Connecting: source -> gainNode(${track.gainNode!.gain.value}) -> master`);
    source.connect(track.gainNode!);
    source.onended = () => {
      console.log(`  - Track ${track.id} source ended naturally`);
      if (track.sourceNode === source) {
        track.sourceNode = null;
      }
    };
    
    // All tracks should start simultaneously from the current playhead position
    // This ensures they play together as a multitrack recording
    const actualStartTime = startTime || this.audioContext!.currentTime;
    const offset = this.state.playheadPosition / 1000;
    source.start(actualStartTime, offset);
    console.log(`  - Started playback at audio context time: ${actualStartTime}, offset: ${offset}s`);

    track.sourceNode = source;
  }

  private playMasterTrack(startTime?: number) {
    if (!this.state.masterBuffer || !this.audioContext) return;
    
    console.log(`🏆 playMasterTrack() called`);
    
    // Stop any existing master source
    if ((this as any).masterSourceNode) {
      try {
        (this as any).masterSourceNode.stop();
        (this as any).masterSourceNode.disconnect();
      } catch (e) {
        console.log('  - Master source already stopped');
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
    
    console.log(`  - Starting master source at time ${actualStartTime} from position ${startOffset.toFixed(2)}s`);
    source.start(actualStartTime, startOffset);
    
    // Store reference for cleanup during stop()
    (this as any).masterSourceNode = source;
    
    source.onended = () => {
      console.log(`  - Master source ended naturally`);
      (this as any).masterSourceNode = null;
    };
  }

  public stop() {
    console.log('⏹️ STOP button pressed');
    
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
      console.log('🛑 Stopping active recording');
      // Force the MediaRecorder to stop and process the recording
      if (this.mediaRecorder?.state === 'recording') {
        console.log('[TAPEFOUR] 🎬 Forcing MediaRecorder to stop and process recording');
        this.mediaRecorder.stop(); // This will trigger processRecording()
      }
      this.stopRecording();
    }
    
    this.state.isPlaying = false;
    this.state.isPaused = false;
    this.state.playheadPosition = 0; // Reset playhead to beginning on stop

    console.log('🛑 Stopping all track sources');
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        console.log(`  - Stopping track ${t.id} source`);
        try {
          t.sourceNode.stop();
          t.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
          console.log(`  - Track ${t.id} source already stopped`);
        }
        t.sourceNode = null;
      }
    });

    // Stop master source if playing
    if ((this as any).masterSourceNode) {
      console.log('🛑 Stopping master source');
      try {
        (this as any).masterSourceNode.stop();
        (this as any).masterSourceNode.disconnect();
      } catch (e) {
        console.log('  - Master source already stopped');
      }
      (this as any).masterSourceNode = null;
    }

    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();

    // Unmute input when stopping
    this.unmuteInput();

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
    
    console.log('✅ Stop complete');
  }

  public clearEverything() {
    console.log('[TAPEFOUR] 🗑️ Clear everything requested');
    
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
    
    // Clear all track audio buffers and reset reverse states
    this.tracks.forEach((track) => {
      track.audioBuffer = null;
      track.originalBuffer = null;
      track.isReversed = false;
      console.log(`[TAPEFOUR] 🗑️ Cleared track ${track.id} buffer and reset reverse state`);
      // Update reverse button styling
      this.updateReverseButtonStyling(track.id);
    });
    
    // Clear master buffer
    this.state.masterBuffer = null;
    this.state.duration = 0;
    console.log('[TAPEFOUR] 🗑️ Cleared master buffer');
    
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
    
    console.log('[TAPEFOUR] 🗑️ Everything cleared - project reset');
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
    console.log('⏯️ Resuming from pause');
    
    // Stop any existing audio sources since we need to restart from current position
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        console.log(`🛑 Stopping track ${t.id} source to restart from current position`);
        try {
          t.sourceNode.stop();
          t.sourceNode.disconnect();
        } catch (e) {
          // Source might already be stopped, ignore errors
          console.log(`  - Track ${t.id} source already stopped`);
        }
        t.sourceNode = null;
      }
    });

    // Stop master source if playing
    if ((this as any).masterSourceNode) {
      console.log('🛑 Stopping master source to restart from current position');
      try {
        (this as any).masterSourceNode.stop();
        (this as any).masterSourceNode.disconnect();
      } catch (e) {
        console.log('  - Master source already stopped');
      }
      (this as any).masterSourceNode = null;
    }

    await this.audioContext!.resume();
    this.state.isPaused = false;
    this.state.isPlaying = true;
    
    // Restart playback from the current playhead position (accounting for any scrubbing during pause)
    const startTime = this.audioContext!.currentTime + 0.05; // Small delay for sync
    
    if (this.state.masterBuffer) {
      console.log('🏆 Restarting master buffer from scrubbed position');
      this.playMasterTrack(startTime);
    }
    
    // ALSO restart any individual tracks (for layering new recordings on top of master)
    const tracksToRestart = this.tracks.filter(t => t.audioBuffer);
    if (tracksToRestart.length > 0) {
      console.log(`🎵 Restarting ${tracksToRestart.length} individual tracks${this.state.masterBuffer ? ' (layered with master)' : ''}`);
      this.tracks.forEach((t) => {
        if (t.audioBuffer) {
          console.log(`🎶 Restarting track ${t.id} from scrubbed position`);
          this.playTrack(t, startTime);
        }
      });
    }

    this.startPlayheadTimer();
    document.getElementById('play-btn')?.classList.add('playing');
    document.getElementById('pause-btn')?.classList.remove('paused');
    
    console.log(`✅ Resumed playback from ${(this.state.playheadPosition / 1000).toFixed(2)}s`);
  }

  public async record() {
    console.log('[TAPEFOUR] 🔴 RECORD button pressed');
    if (this.state.isRecording) return this.stopRecording();

    // If currently paused, unpause and reset pause button
    if (this.state.isPaused) {
      console.log('[TAPEFOUR] ⏯️ Unpausing before recording');
      this.state.isPaused = false;
      document.getElementById('pause-btn')?.classList.remove('paused');
    }

    const armedTrack = this.tracks.find((t) => t.isArmed);
    console.log(`[TAPEFOUR] 🎯 Armed track: ${armedTrack?.id || 'none'}`);
    if (!armedTrack) return this.showError('Please arm a track before recording.');

    // Determine recording mode based on current playhead position
    if (this.state.playheadPosition > 0) {
      this.state.recordMode = 'punchIn';
      this.state.punchInStartPosition = this.state.playheadPosition;
      console.log(`[PUNCH-IN] 🎯 Punch-in recording from ${(this.state.playheadPosition / 1000).toFixed(2)}s`);
    } else {
      this.state.recordMode = 'fresh';
      this.state.punchInStartPosition = 0;
      console.log('[TAPEFOUR] 🎵 Fresh recording from beginning');
    }

    await this.initializeAudio();
    await this.setupRecording();
    await this.unmuteInput();

    // Clear any previous recording data
    this.recordingBuffer = [];
    console.log('[TAPEFOUR] 🗑️ Recording buffer cleared');

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

    console.log('[TAPEFOUR] 🎵 Starting monitoring playback during recording...');
    console.log('[TAPEFOUR] 🎧 Other tracks will play at reduced volume to minimize bleed');
    
    // Keep input monitoring active during recording so you can hear yourself
    // Note: Use headphones to prevent feedback between speakers and microphone
    console.log(`[TAPEFOUR] 🎧 Input monitoring during recording: ${this.state.isMonitoring ? 'ACTIVE' : 'INACTIVE'}`);
    if (this.state.isMonitoring) {
      console.log('[TAPEFOUR] ✅ You should be able to hear your input while recording');
    }
    
    // Enable monitoring mode (lower volume playback during recording)
    this.enableMonitoringMode();
    
    // Play all tracks for monitoring (including armed tracks in punch-in mode)
    const recordingStartTime = this.audioContext!.currentTime + 0.05;
    console.log(`[TAPEFOUR] 🕐 Starting synchronized monitoring playback at audio context time: ${recordingStartTime}`);
    
    this.tracks.forEach((t) => {
      if (t.audioBuffer && (this.state.recordMode === 'punchIn' || !t.isArmed)) {
        console.log(`[TAPEFOUR]   - Playing track ${t.id} for monitoring during recording`);
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
    
    console.log(`[TAPEFOUR] ✅ ${this.state.recordMode === 'punchIn' ? 'Punch-in' : 'Fresh'} recording started`);
  }

  private async setupRecording() {
    try {
      // Check if volume meter and monitoring were active before stopping the stream
      const wasVolumeMeterActive = this.volumeMeterActive;
      const wasMonitoringActive = this.state.isMonitoring;
      
      // Stop volume meter first if it was active
      if (wasVolumeMeterActive) {
        console.log('[TAPEFOUR] 🔇 Stopping volume meter before recreating media stream');
        this.stopVolumeMeter();
      }
      
      // Stop input monitoring if it was active
      if (wasMonitoringActive) {
        console.log('[TAPEFOUR] 🔇 Stopping input monitoring before recreating media stream');
        this.stopInputMonitoring();
      }
      
      // Always stop and clean up existing media stream before creating a new one
      // This ensures we use the currently selected device for recording
      if (this.mediaStream) {
        console.log('[TAPEFOUR] 🛑 Stopping existing media stream before creating new one');
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

      console.log('[TAPEFOUR] 🎤 Requesting microphone with enhanced constraints:', JSON.stringify(constraints, null, 2));

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.mediaRecorder = new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          console.log(`[TAPEFOUR] 📊 MediaRecorder data chunk: ${ev.data.size} bytes`);
          this.recordingBuffer.push(ev.data);
        }
      };
      this.mediaRecorder.onstop = () => {
        console.log(`[TAPEFOUR] 🛑 MediaRecorder stopped, buffer has ${this.recordingBuffer.length} chunks`);
        this.processRecording();
      };
      
      console.log(`[TAPEFOUR] 🎤 MediaRecorder created, input tracks: ${this.mediaStream.getAudioTracks().length}`);
      this.mediaStream.getAudioTracks().forEach((track, i) => {
        console.log(`[TAPEFOUR]   Track ${i}: ${track.label}, enabled: ${track.enabled}`);
        // Log the track's capabilities for debugging
        const capabilities = track.getCapabilities();
        console.log(`[TAPEFOUR]   Track capabilities:`, {
          sampleRate: capabilities.sampleRate,
          channelCount: capabilities.channelCount,
          echoCancellation: capabilities.echoCancellation
        });
        // Log current settings
        const settings = track.getSettings();
        console.log(`[TAPEFOUR]   Track settings:`, settings);
      });

      // Restart volume meter if it was previously active
      if (wasVolumeMeterActive) {
        console.log('[TAPEFOUR] 🔊 Restarting volume meter with new media stream');
        await this.startVolumeMeter();
      }
      
      // Restart input monitoring if it was previously active
      if (wasMonitoringActive) {
        console.log('[TAPEFOUR] 🎧 Restarting input monitoring with new media stream');
        await this.startInputMonitoring();
      }
      
      // Setup waveform analyser for recording
      this.setupWaveformAnalyser();
      
    } catch (err) {
      console.error('Error setting up recording', err);
              this.showError('Could not access microphone. Please check permissions and settings.');
    }
  }

  private stopRecording() {
    console.log(`[TAPEFOUR] 🛑 Stopping ${this.state.recordMode} recording`);
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
            console.log(`  - Track ${t.id} source already stopped`);
          }
          t.sourceNode = null;
        }
      });
    }
    
    // Input monitoring continues as long as tracks are armed
    
    // Ensure recording buffer is cleared if recording was interrupted
    setTimeout(() => {
      if (this.recordingBuffer.length > 0) {
        console.log('[TAPEFOUR] 🗑️ Clearing leftover recording buffer after stop');
        this.recordingBuffer = [];
      }
      
      // Redraw waveforms to remove punch-in overlay and restore normal opacity
      this.redrawAllTrackWaveforms();
    }, 100); // Small delay to allow MediaRecorder onstop to fire first
    
    console.log(`[TAPEFOUR] ✅ ${this.state.recordMode} recording stopped`);
  }

  private async processRecording() {
    if (!this.recordingBuffer.length) return;

    console.log(`[TAPEFOUR] 🔍 Processing recording with ${this.recordingBuffer.length} data chunks`);
    const blob = new Blob(this.recordingBuffer, { type: 'audio/wav' });
    console.log(`[TAPEFOUR] 📦 Created blob: ${blob.size} bytes, type: ${blob.type}`);
    const arrayBuffer = await blob.arrayBuffer();

    try {
      const newAudioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
      console.log(`[TAPEFOUR] 🎵 Decoded audio buffer: ${newAudioBuffer.length} samples, ${newAudioBuffer.duration.toFixed(2)}s, ${newAudioBuffer.numberOfChannels} channels`);
      
      // Find the currently armed track
      const armedTrack = this.tracks.find((t) => t.isArmed);
      if (armedTrack) {
        if (this.state.recordMode === 'fresh') {
          // Fresh recording: replace the entire buffer
          armedTrack.audioBuffer = newAudioBuffer;
          console.log(`[TAPEFOUR] ✅ Fresh recording assigned to track ${armedTrack.id}`);
          console.log(`[TAPEFOUR] 📊 Track ${armedTrack.id} now has ${newAudioBuffer.length} samples (${newAudioBuffer.duration.toFixed(2)}s)`);
        } else {
          // Punch-in recording: merge with existing buffer
          const mergedBuffer = this.mergeBuffersForPunchIn(armedTrack.audioBuffer, newAudioBuffer, this.state.punchInStartPosition);
          armedTrack.audioBuffer = mergedBuffer;
          console.log(`[PUNCH-IN] ✅ Punch-in recording merged into track ${armedTrack.id}`);
          console.log(`[PUNCH-IN] 📊 Track ${armedTrack.id} now has ${mergedBuffer.length} samples (${mergedBuffer.duration.toFixed(2)}s)`);
        }
      } else {
        console.warn('[TAPEFOUR] ⚠️ No armed track found to assign recording to');
      }
    } catch (err) {
      console.error('[TAPEFOUR] Error processing recording', err);
    }

    // Reset recording mode state
    this.state.recordMode = 'fresh';
    this.state.punchInStartPosition = 0;

    this.mediaStream?.getTracks().forEach((t) => t.stop());
    console.log('[TAPEFOUR] 🔌 Media stream tracks stopped');
    
    // Update bounce button state since new audio may be available
    this.updateBounceButtonState();
    
    // Update reverse button state for the recorded track
    const armedTrack = this.tracks.find((t) => t.isArmed);
    if (armedTrack) {
      this.updateReverseButtonStyling(armedTrack.id);
    }
  }

  private mergeBuffersForPunchIn(existingBuffer: AudioBuffer | null, newBuffer: AudioBuffer, punchInStartMs: number): AudioBuffer {
    const sampleRate = this.audioContext!.sampleRate;
    const punchInStartSamples = Math.floor((punchInStartMs / 1000) * sampleRate);
    const newBufferLength = newBuffer.length;
    const punchOutSamples = punchInStartSamples + newBufferLength;
    
    console.log(`[PUNCH-IN] 🔧 Merging buffers:`);
    console.log(`  - Punch-in start: ${punchInStartMs}ms (${punchInStartSamples} samples)`);
    console.log(`  - New recording: ${newBufferLength} samples`);
    console.log(`  - Punch-out: ${punchOutSamples} samples`);
    
    // Determine the final buffer length
    const existingLength = existingBuffer ? existingBuffer.length : 0;
    const finalLength = Math.max(existingLength, punchOutSamples);
    
    // Determine channel count (use the maximum of existing and new)
    const existingChannels = existingBuffer ? existingBuffer.numberOfChannels : 1;
    const newChannels = newBuffer.numberOfChannels;
    const finalChannels = Math.max(existingChannels, newChannels);
    
    console.log(`  - Final buffer: ${finalLength} samples, ${finalChannels} channels`);
    
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
        console.log(`  - Channel ${channel}: Copied ${prePunchLength} pre-punch samples`);
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
      console.log(`  - Channel ${channel}: Copied ${newBufferLength} punch-in samples`);
      
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
        console.log(`  - Channel ${channel}: Copied ${postPunchLength} post-punch samples`);
      }
      
      // Fill any remaining gaps with silence (already zeroed by createBuffer)
    }
    
    console.log(`[PUNCH-IN] ✅ Buffer merge complete: ${finalLength} samples (${(finalLength / sampleRate).toFixed(2)}s)`);
    return mergedBuffer;
  }

  /* ---------- Playhead --------- */

  private startPlayheadTimer() {
    this.playStartTime = Date.now() - this.state.playheadPosition;
    this.playheadTimer = window.setInterval(() => {
      // Don't update playhead position while user is dragging
      if (!this.isDraggingPlayhead) {
        this.state.playheadPosition = Date.now() - this.playStartTime;
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
      
      // Debug logging for high levels
      if (clampedLevel >= 0.7) {
        console.log(`[METER] 📊 High level detected: ${level.toFixed(3)} (${widthPercent.toFixed(1)}%) -> ${zone} zone`);
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
      console.log('[TAPEFOUR] 🎤 Available audio input devices:');
      inputs.forEach((device, index) => {
        console.log(`[TAPEFOUR]   ${index + 1}. ${device.label || 'Unknown Device'} (${device.deviceId.slice(0, 8)}...)`);
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
      console.error('enumerateDevices error', err);
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
    
    // Populate audio processing checkboxes with current state
    const echoCancellationCheckbox = document.getElementById('echo-cancellation-checkbox') as HTMLInputElement | null;
    const noiseSuppressionCheckbox = document.getElementById('noise-suppression-checkbox') as HTMLInputElement | null;
    const autoGainControlCheckbox = document.getElementById('auto-gain-control-checkbox') as HTMLInputElement | null;
    
    if (echoCancellationCheckbox) echoCancellationCheckbox.checked = this.state.echoCancellation;
    if (noiseSuppressionCheckbox) noiseSuppressionCheckbox.checked = this.state.noiseSuppression;
    if (autoGainControlCheckbox) autoGainControlCheckbox.checked = this.state.autoGainControl;
    
    modal && (modal.style.display = 'flex');
  }

  private closeSettings() {
    (document.getElementById('settings-modal') as HTMLElement | null)?.style.setProperty('display', 'none');
  }

  private toggleSettings() {
    // Debounce to prevent rapid toggling (100ms minimum between toggles)
    const now = Date.now();
    if (now - this.lastSettingsToggleTime < 100) {
      console.log('[TAPEFOUR] ⌨️ Settings toggle debounced');
      return;
    }
    this.lastSettingsToggleTime = now;

    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (modal) {
      // Check computed style instead of inline style for more reliable detection
      const computedStyle = window.getComputedStyle(modal);
      const isVisible = computedStyle.display !== 'none';
      if (isVisible) {
        console.log('[TAPEFOUR] ⌨️ Closing settings modal');
        this.closeSettings();
      } else {
        console.log('[TAPEFOUR] ⌨️ Opening settings modal');
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
      console.warn('[TAPEFOUR] ⚠️ Could not load warning preference:', err);
      return true; // Default to showing the warning
    }
  }

  private saveWarningPreference(shouldShow: boolean) {
    try {
      localStorage.setItem('tapefour-show-feedback-warning', shouldShow.toString());
      console.log(`[TAPEFOUR] 💾 Saved warning preference: ${shouldShow ? 'show' : 'hide'}`);
    } catch (err) {
      console.warn('[TAPEFOUR] ⚠️ Could not save warning preference:', err);
    }
  }

  private loadSavedAudioDevice() {
    try {
      const savedDeviceId = localStorage.getItem('tapefour-audio-input-device');
      if (savedDeviceId && savedDeviceId !== 'null') {
        this.state.selectedInputDeviceId = savedDeviceId;
        console.log(`[TAPEFOUR] 💾 Loaded saved audio device: ${savedDeviceId}`);
      } else {
        console.log('[TAPEFOUR] 💾 No saved audio device found, using default');
      }
    } catch (err) {
      console.warn('[TAPEFOUR] ⚠️ Could not load saved audio device:', err);
    }
  }

  private saveAudioDevice(deviceId: string | null) {
    try {
      if (deviceId) {
        localStorage.setItem('tapefour-audio-input-device', deviceId);
        console.log(`[TAPEFOUR] 💾 Saved audio device: ${deviceId}`);
      } else {
        localStorage.removeItem('tapefour-audio-input-device');
        console.log('[TAPEFOUR] 💾 Cleared saved audio device (using default)');
      }
    } catch (err) {
      console.warn('[TAPEFOUR] ⚠️ Could not save audio device:', err);
    }
  }

  private loadSavedAudioProcessingSettings() {
    try {
      const echoCancellation = localStorage.getItem('tapefour-echo-cancellation');
      const noiseSuppression = localStorage.getItem('tapefour-noise-suppression');
      const autoGainControl = localStorage.getItem('tapefour-auto-gain-control');
      
      if (echoCancellation !== null) {
        this.state.echoCancellation = echoCancellation === 'true';
      }
      if (noiseSuppression !== null) {
        this.state.noiseSuppression = noiseSuppression === 'true';
      }
      if (autoGainControl !== null) {
        this.state.autoGainControl = autoGainControl === 'true';
      }
      
      console.log(`[TAPEFOUR] 💾 Loaded audio processing settings: echo=${this.state.echoCancellation}, noise=${this.state.noiseSuppression}, agc=${this.state.autoGainControl}`);
    } catch (err) {
      console.warn('[TAPEFOUR] ⚠️ Could not load audio processing settings:', err);
    }
  }

  private saveAudioProcessingSettings() {
    try {
      localStorage.setItem('tapefour-echo-cancellation', this.state.echoCancellation.toString());
      localStorage.setItem('tapefour-noise-suppression', this.state.noiseSuppression.toString());
      localStorage.setItem('tapefour-auto-gain-control', this.state.autoGainControl.toString());
      console.log(`[TAPEFOUR] 💾 Saved audio processing settings: echo=${this.state.echoCancellation}, noise=${this.state.noiseSuppression}, agc=${this.state.autoGainControl}`);
    } catch (err) {
      console.warn('[TAPEFOUR] ⚠️ Could not save audio processing settings:', err);
    }
  }

  private async changeAudioInputDevice(newDeviceId: string | null) {
    // If device changed, we need to refresh the media stream
    if (newDeviceId !== this.state.selectedInputDeviceId) {
      console.log(`[TAPEFOUR] 🔄 Audio input device changed from ${this.state.selectedInputDeviceId || 'default'} to ${newDeviceId || 'default'}`);
      
      this.state.selectedInputDeviceId = newDeviceId;
      
      // Save the device selection to localStorage
      this.saveAudioDevice(newDeviceId);
      
      // IMPORTANT: Always stop and recreate media stream when device changes
      // This ensures ALL future recordings (any track) use the new device
      if (this.mediaStream) {
        console.log('[TAPEFOUR] 🛑 Stopping existing media stream');
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
        console.log('[TAPEFOUR] 🔄 Restarting volume meter with new device');
        this.stopVolumeMeter();
        // Restart volume meter if we have armed tracks
        const hasArmedTracks = this.tracks.some(t => t.isArmed);
        if (hasArmedTracks) {
          await this.ensureInputStream();
          this.startVolumeMeter();
        }
      } else {
        // Even if no tracks are armed, we should test the new device works
        console.log('[TAPEFOUR] 🧪 Testing new audio device');
        try {
          await this.ensureInputStream();
          console.log('[TAPEFOUR] ✅ New audio device is working');
        } catch (err) {
          console.error('[TAPEFOUR] ❌ New audio device failed:', err);
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
      console.log('[TAPEFOUR] 🎯 Starting bounce operation...');
      console.log(`[TAPEFOUR] 📊 Master buffer: ${hasMasterBuffer ? 'Yes' : 'No'}, Individual tracks: ${tracksToMix.length}`);
      
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
        console.log('[TAPEFOUR] 🏆 Adding existing master buffer to bounce');
        const masterSrc = offline.createBufferSource();
        masterSrc.buffer = this.state.masterBuffer!;
        masterSrc.connect(offlineMaster);
        masterSrc.start(0);
      }

      // Set up each individual track in the offline context
      tracksToMix.forEach((track) => {
        console.log(`[TAPEFOUR] 🎵 Adding track ${track.id} to bounce`);
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
      console.log('[TAPEFOUR] 🎯 Rendering bounce...');
      const rendered = await offline.startRendering();
      
      // Store the master buffer and update duration
      this.state.masterBuffer = rendered;
      this.state.duration = Math.max(this.state.duration, rendered.duration * 1000); // Convert to ms
      
      console.log(`[TAPEFOUR] ✅ Bounce complete! Duration: ${rendered.duration.toFixed(2)}s`);
      
      // DESTRUCTIVE BOUNCE: Replace original tracks with master mix
      console.log('[TAPEFOUR] 🔄 Performing destructive bounce - clearing original tracks');
      
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
        console.log('[TAPEFOUR] ✅ Additive bounce complete - combined previous master with new tracks');
      } else if (hasMasterBuffer) {
        console.log('[TAPEFOUR] ✅ Master-only bounce complete - regenerated master buffer');
      } else {
        console.log('[TAPEFOUR] ✅ Initial bounce complete - tracks bounced to master');
      }
      
    } catch (err) {
      console.error('[TAPEFOUR] ❌ Bounce error:', err);
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
    console.log(`[WAVEFORM] 🎨 Generated waveform for track ${trackId} with ${waveformData.length} peaks`);
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
    console.log(`[WAVEFORM] 🏆 Generated master waveform with ${waveformData.length} peaks at original canvas positions`);
  }

  public async export() {
    if (!this.audioContext) return this.showError('No audio to export. Please record something first.');
    
    // Prefer master buffer if available (from bounce), otherwise mix tracks on-the-fly
    if (this.state.masterBuffer) {
      console.log('[TAPEFOUR] 📁 Exporting bounced master mix');
      this.downloadWav(this.state.masterBuffer);
      return;
    }
    
    const tracksWithAudio = this.tracks.filter((t) => t.audioBuffer);
    if (!tracksWithAudio.length) return this.showError('No recorded tracks to export.');

    try {
      console.log('[TAPEFOUR] 📁 Exporting live mix (no bounce available)');
      const offline = new OfflineAudioContext(2, this.audioContext.sampleRate * (this.state.maxRecordingTime / 1000), this.audioContext.sampleRate);
      const offlineMaster = offline.createGain();
      offlineMaster.gain.value = this.masterGainNode!.gain.value;
      offlineMaster.connect(offline.destination);

      tracksWithAudio.forEach((track) => {
        const src = offline.createBufferSource();
        const gain = offline.createGain();
        const pan = offline.createStereoPanner();
        
        // Set up the audio chain: source -> gain -> pan -> master
        src.buffer = track.audioBuffer!;
        gain.gain.value = track.gainNode!.gain.value;
        
        // Convert track pan value (0-100) to StereoPanner value (-1 to 1)
        // 0 = fully left (-1), 50 = center (0), 100 = fully right (1)
        const panPosition = (track.panValue - 50) / 50;
        pan.pan.value = panPosition;
        
        // Connect the audio chain
        src.connect(gain);
        gain.connect(pan);
        pan.connect(offlineMaster);
        src.start(0);
      });

      const rendered = await offline.startRendering();
      this.downloadWav(rendered);
    } catch (err) {
      console.error('export error', err);
      this.showError('Error exporting audio. Please try again.');
    }
  }

  private downloadWav(buf: AudioBuffer) {
    const wav = this.audioBufferToWav(buf);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `TS_tapefour_mix_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '_')}.wav`,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      // Request permission proactively - this will prompt if needed
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Got permission! Stop the stream immediately since we just wanted permission
      stream.getTracks().forEach(track => track.stop());
      console.log('Microphone permission granted');
    } catch (err) {
      console.warn('Microphone permission denied or not available:', err);
      // Show a user-friendly message
      setTimeout(() => {
        this.showError('TapeFour needs microphone access to record audio. Please allow microphone access when prompted, or check your browser settings.');
      }, 1000);
    }
  }

  /**
   * Mute the microphone input to prevent hearing live input during playback
   */
  private async muteInput() {
    if (this.mediaStream && !this.state.inputMuted) {
      console.log('🔇 Muting input - tracks:', this.mediaStream.getAudioTracks().length);
      this.mediaStream.getAudioTracks().forEach(track => {
        console.log('  - Disabling track:', track.label, 'enabled:', track.enabled);
        track.enabled = false;
      });
      this.state.inputMuted = true;
      console.log('✅ Input muted');
    } else {
      console.log('⚠️ Cannot mute input - mediaStream:', !!this.mediaStream, 'already muted:', this.state.inputMuted);
    }
  }

  /**
   * Unmute the microphone input
   */
  private async unmuteInput() {
    if (this.mediaStream && this.state.inputMuted) {
      console.log('🔊 Unmuting input');
      this.mediaStream.getAudioTracks().forEach(track => {
        console.log('  - Enabling track:', track.label);
        track.enabled = true;
      });
      this.state.inputMuted = false;
      console.log('✅ Input unmuted');
    } else {
      console.log('⚠️ Cannot unmute input - mediaStream:', !!this.mediaStream, 'inputMuted:', this.state.inputMuted);
    }
  }

  /**
   * Ensure we have an active input stream for muting/unmuting
   */
  private async ensureInputStream() {
    if (!this.mediaStream) {
      console.log('🎤 No input stream found, setting up recording stream...');
      await this.setupRecording();
    } else {
      console.log('✅ Input stream already exists');
    }
  }

  private async startVolumeMeter() {
    if (this.volumeMeterActive) return;
    
    // Ensure we have audio context and media stream
    await this.initializeAudio();
    await this.ensureInputStream();
    
    if (!this.mediaStream || !this.audioContext) return;

    // Create or reuse input source node (only one per MediaStream allowed)
    if (!this.inputSourceNode) {
      this.inputSourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    }

    // Create analyser for volume monitoring
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 512; // Increased for better resolution
    this.analyserNode.smoothingTimeConstant = 0.1; // Faster response for better peak detection
    this.inputSourceNode.connect(this.analyserNode);

    const dataArray = new Uint8Array(this.analyserNode.fftSize); // Use time domain data size
    this.volumeMeterActive = true;
    
    let peakHold = 0;
    let peakHoldTime = 0;
    
    const updateMeter = () => {
      if (this.volumeMeterActive && this.analyserNode) {
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
        
        this.updateVolumeMeter(clampedLevel);
        this.volumeMeterAnimationId = requestAnimationFrame(updateMeter);
      }
    };
    
    updateMeter();
  }

  private stopVolumeMeter() {
    this.volumeMeterActive = false;
    if (this.volumeMeterAnimationId) {
      cancelAnimationFrame(this.volumeMeterAnimationId);
      this.volumeMeterAnimationId = null;
    }
    
    // Disconnect analyser but keep input source node if monitoring is active
    if (this.analyserNode) {
      try {
        if (this.inputSourceNode) {
          this.inputSourceNode.disconnect(this.analyserNode);
        }
      } catch (e) {
        // Ignore disconnect errors - might already be disconnected
      }
      this.analyserNode = null;
    }
    
    // Only clean up input source node if monitoring is not active
    if (!this.state.isMonitoring && this.inputSourceNode) {
      this.inputSourceNode.disconnect();
      this.inputSourceNode = null;
    }
    
    this.updateVolumeMeter(0);
  }

  private async startInputMonitoring() {
    if (this.state.isMonitoring) return;
    
    // Ensure we have audio context and media stream
    await this.initializeAudio();
    await this.ensureInputStream();
    
    if (!this.mediaStream || !this.audioContext || !this.inputMonitoringGainNode) return;

    // Create or reuse input source node (only one per MediaStream allowed)
    if (!this.inputSourceNode) {
      this.inputSourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    }
    
    // Connect input source to monitoring gain
    this.inputSourceNode.connect(this.inputMonitoringGainNode);
    
    this.state.isMonitoring = true;
    
    console.log('[TAPEFOUR] 🎧 Input monitoring started - you can now hear live input');
  }

  private stopInputMonitoring() {
    if (this.inputSourceNode && this.inputMonitoringGainNode) {
      try {
        console.log('[INPUT] 🔇 Stopping input monitoring...');
        
        // Disconnect input monitoring
        this.inputSourceNode.disconnect(this.inputMonitoringGainNode);
        this.inputMonitoringGainNode.disconnect(this.audioContext!.destination);
        console.log('[INPUT] ✅ Input monitoring stopped');
        
        this.state.isMonitoring = false;
      } catch (error) {
        console.warn('[INPUT] ⚠️ Error stopping input monitoring:', error);
      }
    }
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
    
    if (totalTracksDrawn > 0 || this.masterWaveform.length > 0) {
      console.log(`[WAVEFORM] 🎨 Redrawn waveforms for ${totalTracksDrawn} tracks + master`);
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
    
    console.log('[WAVEFORM] 🛑 Waveform capture stopped');
  }
} 
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
  private waveformPeaks: number[] = [];
  private waveformRenderingId: number | null = null;
  private waveformBufferSize = 800; // Width of canvas in pixels
  private waveformAnalyserNode: AnalyserNode | null = null;

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
  };

  private tracks: Array<{
    id: number;
    audioBuffer: AudioBuffer | null;
    isArmed: boolean;
    isSolo: boolean;
    isMuted: boolean;
    isManuallyMuted: boolean; // Visual state for mute button
    gainNode: GainNode | null;
    sourceNode: AudioBufferSourceNode | null;
    panNode: StereoPannerNode | null;
    panValue: number; // 0 = fully left, 50 = center, 100 = fully right
  }> = [
    { id: 1, audioBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50 },
    { id: 2, audioBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50 },
    { id: 3, audioBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50 },
    { id: 4, audioBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, gainNode: null, sourceNode: null, panNode: null, panValue: 50 },
  ];

  // Store previous mute states for when solo is disengaged
  private previousMuteStates: boolean[] = [false, false, false, false];

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
      this.clearWaveform();
    }
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
      const el = document.getElementById(`track-${track.id}`);
      el?.addEventListener('click', () => this.toggleTrackArm(track.id));
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
    document.getElementById('settings-btn')?.addEventListener('click', () => this.openSettings());

    // Settings modal buttons
    document.getElementById('cancel-settings')?.addEventListener('click', () => this.closeSettings());

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

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
        return;
      }

      // Prevent key repeat for all shortcuts
      if (e.repeat) return;

      switch (e.code) {
        case 'Space':
          // Space key for play
          e.preventDefault();
          console.log('[TAPEFOUR] ⌨️ Space key pressed - triggering play');
          this.play();
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
    
    // Mark event listeners as initialized
    this.eventListenersInitialized = true;
    console.log('[TAPEFOUR] ✅ Event listeners setup complete');
  }

  /* ---------- UI helpers ---------- */

  private toggleTrackArm(trackId: number) {
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

    if (this.state.isPaused) {
      console.log('⏯️ Resuming from pause');
      await this.audioContext!.resume();
      this.state.isPaused = false;
      this.startPlayheadTimer();
      document.getElementById('play-btn')?.classList.add('playing');
      document.getElementById('pause-btn')?.classList.remove('paused');
      return;
    }

    console.log('🎵 Starting fresh playback');
    
    // Disable monitoring mode for full volume playback
    this.disableMonitoringMode();
    
    // Stop any existing sources before starting new ones
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        console.log(`🛑 Stopping existing source for track ${t.id} before starting new playback`);
        t.sourceNode.stop();
        t.sourceNode = null;
      }
    });

    this.state.isPlaying = true;
    this.state.playheadPosition = 0;
    
    // Schedule all tracks to start at a slightly future time for perfect sync
    const startTime = this.audioContext!.currentTime + 0.1; // 100ms in the future
    this.playStartTime = Date.now() + 100; // Adjust playhead timer accordingly
    
    console.log(`🕐 Scheduling synchronized playback at audio context time: ${startTime}`);

    // Prepare all tracks to start simultaneously
    const tracksToPlay = this.tracks.filter(t => t.audioBuffer);
    console.log(`🎵 Preparing ${tracksToPlay.length} tracks for synchronized playback`);
    
    this.tracks.forEach((t) => {
      if (t.audioBuffer) {
        console.log(`🎶 Playing track ${t.id} - buffer length: ${t.audioBuffer.length} samples`);
        this.playTrack(t, startTime);
      } else {
        console.log(`⚪ Track ${t.id} has no audio buffer`);
      }
    });

    this.startPlayheadTimer();
    document.getElementById('play-btn')?.classList.add('playing');
    
    // Initialize timecode display
    this.updateTimecode();
    console.log('✅ Playback started');
  }

  private playTrack(track: typeof this.tracks[number], startTime?: number) {
    console.log(`🎵 playTrack() called for track ${track.id}`);
    
    // Ensure any existing source is properly stopped
    if (track.sourceNode) {
      console.log(`  - Stopping existing source for track ${track.id}`);
      track.sourceNode.stop();
      track.sourceNode = null;
    }

    const source = this.audioContext!.createBufferSource();
    source.buffer = track.audioBuffer!;
    console.log(`  - Created source node for track ${track.id}`);
    console.log(`  - Connecting: source -> gainNode(${track.gainNode!.gain.value}) -> master`);
    source.connect(track.gainNode!);
    source.onended = () => {
      console.log(`  - Track ${track.id} source ended naturally`);
      track.sourceNode = null;
    };
    
    // All tracks should start simultaneously from the current playhead position
    // This ensures they play together as a multitrack recording
    const actualStartTime = startTime || this.audioContext!.currentTime;
    const offset = this.state.playheadPosition / 1000;
    source.start(actualStartTime, offset);
    console.log(`  - Started playback at audio context time: ${actualStartTime}, offset: ${offset}s`);

    track.sourceNode = source;
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
    this.state.playheadPosition = 0;

    console.log('🛑 Stopping all track sources');
    this.tracks.forEach((t) => {
      if (t.sourceNode) {
        console.log(`  - Stopping track ${t.id} source`);
      }
      t.sourceNode?.stop();
      t.sourceNode = null;
    });

    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();

    // Unmute input when stopping
    this.unmuteInput();

    this.stopPlayheadTimer();

    document.getElementById('play-btn')?.classList.remove('playing');
    document.getElementById('pause-btn')?.classList.remove('paused');
    document.getElementById('record-btn')?.classList.remove('recording');
    (document.getElementById('playhead-indicator') as HTMLElement | null)?.style.setProperty('left', '0px');
    
    // Reset displays
    this.updateTimecode();
    
    // Only reset volume meter if no tracks are armed (otherwise keep monitoring input levels)
    if (!this.tracks.some(t => t.isArmed)) {
      this.updateVolumeMeter(0);
    }
    
    // Keep waveform visible after recording for visual reference
    // (waveform will only clear when starting new recording)
    
    console.log('✅ Stop complete');
  }

  public pause() {
    if (this.state.isPlaying && !this.state.isPaused) {
      this.audioContext!.suspend();
      this.state.isPaused = true;
      this.stopPlayheadTimer();
      document.getElementById('play-btn')?.classList.remove('playing');
      document.getElementById('pause-btn')?.classList.add('paused');
    } else if (this.state.isPaused) {
      this.play();
    }
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
    if (!armedTrack) return alert('Please arm a track before recording.');

    await this.initializeAudio();
    await this.setupRecording();
    await this.unmuteInput();

    // Clear any previous recording data
    this.recordingBuffer = [];
    console.log('[TAPEFOUR] 🗑️ Recording buffer cleared');

    this.state.isRecording = true;
    document.getElementById('record-btn')?.classList.add('recording');

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
    
    // Play all other tracks for monitoring
    const recordingStartTime = this.audioContext!.currentTime + 0.05;
    console.log(`[TAPEFOUR] 🕐 Starting synchronized monitoring playback at audio context time: ${recordingStartTime}`);
    
    this.tracks.forEach((t) => {
      if (!t.isArmed && t.audioBuffer) {
        console.log(`[TAPEFOUR]   - Playing track ${t.id} for monitoring during recording`);
        this.playTrack(t, recordingStartTime);
      }
    });

    this.state.isPlaying = true;
    this.state.playheadPosition = 0; // Start from beginning for proper sync
    this.startPlayheadTimer();
    document.getElementById('play-btn')?.classList.add('playing');

    this.mediaRecorder!.start();
    
    // Start waveform capture
    this.clearWaveform();
    this.startWaveformCapture();
    
    console.log('[TAPEFOUR] ✅ Recording started');
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
      alert('Could not access microphone. Please check permissions and settings.');
    }
  }

  private stopRecording() {
    console.log('[TAPEFOUR] 🛑 Stopping recording');
    if (!this.state.isRecording) return;
    
    this.state.isRecording = false;
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
    document.getElementById('record-btn')?.classList.remove('recording');
    
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
          t.sourceNode.stop();
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
    }, 100); // Small delay to allow MediaRecorder onstop to fire first
    
    console.log('[TAPEFOUR] ✅ Recording stopped');
  }

  private async processRecording() {
    if (!this.recordingBuffer.length) return;

    console.log(`[TAPEFOUR] 🔍 Processing recording with ${this.recordingBuffer.length} data chunks`);
    const blob = new Blob(this.recordingBuffer, { type: 'audio/wav' });
    console.log(`[TAPEFOUR] 📦 Created blob: ${blob.size} bytes, type: ${blob.type}`);
    const arrayBuffer = await blob.arrayBuffer();

    try {
      const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
      console.log(`[TAPEFOUR] 🎵 Decoded audio buffer: ${audioBuffer.length} samples, ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels} channels`);
      
      // Find the currently armed track and assign the recording to it
      const armedTrack = this.tracks.find((t) => t.isArmed);
      if (armedTrack) {
        armedTrack.audioBuffer = audioBuffer;
        console.log(`[TAPEFOUR] ✅ Recorded audio assigned to track ${armedTrack.id}`);
        console.log(`[TAPEFOUR] 📊 Track ${armedTrack.id} now has ${audioBuffer.length} samples (${audioBuffer.duration.toFixed(2)}s)`);
      } else {
        console.warn('[TAPEFOUR] ⚠️ No armed track found to assign recording to');
      }
    } catch (err) {
      console.error('[TAPEFOUR] Error processing recording', err);
    }

    this.mediaStream?.getTracks().forEach((t) => t.stop());
    console.log('[TAPEFOUR] 🔌 Media stream tracks stopped');
  }

  /* ---------- Playhead --------- */

  private startPlayheadTimer() {
    this.playStartTime = Date.now() - this.state.playheadPosition;
    this.playheadTimer = window.setInterval(() => {
      this.state.playheadPosition = Date.now() - this.playStartTime;
      this.updatePlayheadUI();
      if (this.state.playheadPosition >= this.state.maxRecordingTime) this.stop();
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
    const maxWidth = 120;
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
    const modal = document.getElementById('settings-modal') as HTMLElement | null;
    if (modal) {
      // Check computed style instead of inline style for more reliable detection
      const computedStyle = window.getComputedStyle(modal);
      const isVisible = computedStyle.display !== 'none';
      if (isVisible) {
        this.closeSettings();
      } else {
        this.openSettings();
      }
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
          alert('Failed to connect to the selected audio device. Please try a different device or check your audio settings.');
        }
      }
    }
  }

  /* ---------- Export ---------- */

  public async export() {
    if (!this.audioContext) return alert('No audio to export. Please record something first.');
    const tracksWithAudio = this.tracks.filter((t) => t.audioBuffer);
    if (!tracksWithAudio.length) return alert('No recorded tracks to export.');

    try {
      const offline = new OfflineAudioContext(2, this.audioContext.sampleRate * (this.state.maxRecordingTime / 1000), this.audioContext.sampleRate);
      const offlineMaster = offline.createGain();
      offlineMaster.gain.value = this.masterGainNode!.gain.value;
      offlineMaster.connect(offline.destination);

      tracksWithAudio.forEach((track) => {
        const src = offline.createBufferSource();
        const gain = offline.createGain();
        src.buffer = track.audioBuffer!;
        gain.gain.value = track.gainNode!.gain.value;
        src.connect(gain);
        gain.connect(offlineMaster);
        src.start(0);
      });

      const rendered = await offline.startRendering();
      this.downloadWav(rendered);
    } catch (err) {
      console.error('export error', err);
      alert('Error exporting audio. Please try again.');
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
        alert('TapeFour needs microphone access to record audio. Please allow microphone access when prompted, or check your browser settings.');
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

  private clearWaveform() {
    if (!this.waveformContext || !this.waveformCanvas) return;
    
    this.waveformPeaks = [];
    this.waveformContext.clearRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
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
    
    const canvas = this.waveformCanvas;
    const ctx = this.waveformContext;
    const height = canvas.height;
    
    // Calculate current playhead position (same logic as updatePlayheadUI)
    const progress = this.state.playheadPosition / this.state.maxRecordingTime;
    const maxWidth = canvas.width; // Use full canvas width instead of fixed 120px
    const currentX = Math.min(progress * maxWidth, maxWidth);
    
    // Set waveform style to bright orange for visual pop
    ctx.fillStyle = '#D18C33'; // var(--color-accent-warm) - burnt orange for highlights
    ctx.strokeStyle = '#D18C33';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    
    // Draw waveform from bottom upward for better visual alignment
    const peakHeight = peak * (height * 0.8); // Use 80% of height for better proportions
    const peakWidth = 3; // Slightly thinner for cleaner look
    
    // Draw peak as vertical line from bottom upward at current playhead position
    if (currentX < canvas.width && currentX >= 0) {
      ctx.fillRect(currentX, height - peakHeight, peakWidth, peakHeight);
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
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

  private state = {
    isPlaying: false,
    isRecording: false,
    isPaused: false,
    playheadPosition: 0,
    selectedInputDeviceId: null as string | null,
    maxRecordingTime: 60000, // 60 seconds
    inputMuted: false,
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
  }> = [
    { id: 1, audioBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, gainNode: null, sourceNode: null },
    { id: 2, audioBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, gainNode: null, sourceNode: null },
    { id: 3, audioBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, gainNode: null, sourceNode: null },
    { id: 4, audioBuffer: null, isArmed: false, isSolo: false, isMuted: false, isManuallyMuted: false, gainNode: null, sourceNode: null },
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
      this.masterGainNode.gain.value = 0.75;

      // Create monitoring gain node for playback during recording (lower volume)
      this.monitoringGainNode = this.audioContext.createGain();
      this.monitoringGainNode.gain.value = 0.3; // Lower volume for monitoring

      this.masterGainNode.connect(this.audioContext.destination);

      // Monitoring path: master -> monitoring gain -> destination
      this.masterGainNode.connect(this.monitoringGainNode);
      this.monitoringGainNode.connect(this.audioContext.destination);

      // track gain nodes
      this.tracks.forEach((track) => {
        track.gainNode = this.audioContext!.createGain();
        track.gainNode.gain.value = 0.75;
        track.gainNode.connect(this.masterGainNode!);
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
      if (fader) fader.value = '75';
    });
    (document.getElementById('master-fader') as HTMLInputElement | null)?.setAttribute('value', '75');
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
      // Double-click to reset to default value (75)
      fader?.addEventListener('dblclick', (e) => this.resetTrackFader(track.id));
    });

    // Master fader
    const masterFader = document.getElementById('master-fader') as HTMLInputElement | null;
    masterFader?.addEventListener('input', (e) => this.updateMasterGain(+(e.target as HTMLInputElement).value));
    // Double-click to reset to default value (75)
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
    } else if (!hasArmedTracks && this.volumeMeterActive) {
      this.stopVolumeMeter();
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
          const faderValue = fader ? parseInt(fader.value) : 75;
          track.gainNode.gain.value = faderValue / 100;
        }
      }
    });
  }

  private updateTrackGain(trackId: number, value: number) {
    const track = this.tracks.find((t) => t.id === trackId)!;
    if (track.gainNode) {
      // If track is muted, keep gain at 0 regardless of fader position
      if (track.isMuted) {
        track.gainNode.gain.value = 0;
        console.log(`🎚️ Track ${trackId} fader moved to ${value}% but track is muted (gain remains 0)`);
      } else {
        const gainValue = value / 100;
        track.gainNode.gain.value = gainValue;
        console.log(`🎚️ Track ${trackId} gain set to ${gainValue} (${value}%)`);
      }
    } else {
      console.warn(`⚠️ No gain node found for track ${trackId}`);
    }
  }

  private updateMasterGain(value: number) {
    if (this.masterGainNode) this.masterGainNode.gain.value = value / 100;
  }

  private resetTrackFader(trackId: number) {
    const fader = document.getElementById(`fader-${trackId}`) as HTMLInputElement | null;
    if (fader) {
      fader.value = '75'; // Reset to default value
      this.updateTrackGain(trackId, 75); // Update the gain
      console.log(`🎚️ Track ${trackId} fader reset to default (75%)`);
    }
  }

  private resetMasterFader() {
    const masterFader = document.getElementById('master-fader') as HTMLInputElement | null;
    if (masterFader) {
      masterFader.value = '75'; // Reset to default value
      this.updateMasterGain(75); // Update the gain
      console.log(`🎚️ Master fader reset to default (75%)`);
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
    document.getElementById('record-btn')?.classList.remove('recording');
    (document.getElementById('playhead-indicator') as HTMLElement | null)?.style.setProperty('left', '0px');
    
    // Reset displays
    this.updateTimecode();
    
    // Only reset volume meter if no tracks are armed (otherwise keep monitoring input levels)
    if (!this.tracks.some(t => t.isArmed)) {
      this.updateVolumeMeter(0);
    }
    console.log('✅ Stop complete');
  }

  public pause() {
    if (this.state.isPlaying && !this.state.isPaused) {
      this.audioContext!.suspend();
      this.state.isPaused = true;
      this.stopPlayheadTimer();
      document.getElementById('play-btn')?.classList.remove('playing');
    } else if (this.state.isPaused) {
      this.play();
    }
  }

  public async record() {
    console.log('[TAPEFOUR] 🔴 RECORD button pressed');
    if (this.state.isRecording) return this.stopRecording();

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
    console.log('[TAPEFOUR] ✅ Recording started');
  }

  private async setupRecording() {
    try {
      // Check if volume meter was active before stopping the stream
      const wasVolumeMeterActive = this.volumeMeterActive;
      
      // Stop volume meter first if it was active
      if (wasVolumeMeterActive) {
        console.log('[TAPEFOUR] 🔇 Stopping volume meter before recreating media stream');
        this.stopVolumeMeter();
      }
      
      // Always stop and clean up existing media stream before creating a new one
      // This ensures we use the currently selected device for recording
      if (this.mediaStream) {
        console.log('[TAPEFOUR] 🛑 Stopping existing media stream before creating new one');
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
        this.mediaRecorder = null;
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
              channelCount: { max: 2 }, // Request up to 2 channels (stereo)
              latency: 0.01, // Low latency for audio interfaces
              volume: 1.0 // Maximum volume
            } 
          : {
              echoCancellation: this.state.echoCancellation,
              noiseSuppression: this.state.noiseSuppression,
              autoGainControl: this.state.autoGainControl,
              sampleRate: 48000,
              channelCount: { max: 2 },
              latency: 0.01,
              volume: 1.0
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
          echoCancellation: capabilities.echoCancellation,
          latency: capabilities.latency
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
    // Convert level (0-1) to number of segments (0-10)
    const segmentCount = Math.floor(level * 10);
    const volumeMeter = document.getElementById('volume-meter') as HTMLElement | null;
    
    if (volumeMeter) {
      const segments = volumeMeter.querySelectorAll('.volume-meter-segment');
      segments.forEach((segment, index) => {
        if (index < segmentCount) {
          segment.classList.add('lit');
        } else {
          segment.classList.remove('lit');
        }
      });
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

  private setupVolumeMeter() {
    // This method is deprecated in favor of startVolumeMeter()
    // Keeping for backward compatibility but redirect to proper method
    console.log('[TAPEFOUR] ⚠️ setupVolumeMeter() is deprecated, using startVolumeMeter() instead');
    this.startVolumeMeter();
  }

  private async startVolumeMeter() {
    if (this.volumeMeterActive) return;
    
    // Ensure we have audio context and media stream
    await this.initializeAudio();
    await this.ensureInputStream();
    
    if (!this.mediaStream || !this.audioContext) return;

    // Create analyser for volume monitoring
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    source.connect(this.analyserNode);

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.volumeMeterActive = true;
    
    const updateMeter = () => {
      if (this.volumeMeterActive && this.analyserNode) {
        this.analyserNode.getByteFrequencyData(dataArray);
        
        // Calculate RMS (Root Mean Square) for more accurate volume representation
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = rms / 255; // Normalize to 0-1
        
        this.updateVolumeMeter(level);
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
    this.analyserNode = null;
    this.updateVolumeMeter(0);
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
    const leftReel = document.getElementById('left-reel');
    const rightReel = document.getElementById('right-reel');
    
    if (leftReel) leftReel.classList.remove('spinning');
    if (rightReel) rightReel.classList.remove('spinning');
    
    console.log('🛑 Tape reels stopped spinning');
  }

  // Add this method for debugging
  private async debugAudioInterface() {
    console.log('[TAPEFOUR] 🔍 Audio Interface Debug Test');
    
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const scarlettDevice = devices.find(d => 
        d.kind === 'audioinput' && 
        d.label.toLowerCase().includes('scarlett')
      );
      
      if (scarlettDevice) {
        console.log('[TAPEFOUR] 🎤 Found Scarlett device:', scarlettDevice);
        
        // Test with different constraints
        const testConstraints = {
          audio: {
            deviceId: { exact: scarlettDevice.deviceId },
            sampleRate: 48000,
            channelCount: { min: 1, ideal: 2, max: 6 }, // Scarlett 6i6 has 6 inputs
            autoGainControl: false,
            noiseSuppression: false,
            echoCancellation: false
          }
        };
        
        const testStream = await navigator.mediaDevices.getUserMedia(testConstraints);
        console.log('[TAPEFOUR] ✅ Test stream created');
        
        testStream.getAudioTracks().forEach((track, i) => {
          console.log(`[TAPEFOUR] Test Track ${i}:`, {
            label: track.label,
            enabled: track.enabled,
            settings: track.getSettings(),
            capabilities: track.getCapabilities()
          });
        });
        
        // Clean up test stream
        testStream.getTracks().forEach(track => track.stop());
      } else {
        console.log('[TAPEFOUR] ⚠️ No Scarlett device found in device list');
      }
    } catch (err) {
      console.error('[TAPEFOUR] ❌ Debug test failed:', err);
    }
  }
} 
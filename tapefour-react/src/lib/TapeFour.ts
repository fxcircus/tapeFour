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
  };

  private tracks: Array<{
    id: number;
    audioBuffer: AudioBuffer | null;
    isArmed: boolean;
    gainNode: GainNode | null;
    sourceNode: AudioBufferSourceNode | null;
  }> = [
    { id: 1, audioBuffer: null, isArmed: false, gainNode: null, sourceNode: null },
    { id: 2, audioBuffer: null, isArmed: false, gainNode: null, sourceNode: null },
    { id: 3, audioBuffer: null, isArmed: false, gainNode: null, sourceNode: null },
    { id: 4, audioBuffer: null, isArmed: false, gainNode: null, sourceNode: null },
  ];

  constructor() {
    // Load previously selected audio device from localStorage
    this.loadSavedAudioDevice();
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
    // Arming toggles
    this.tracks.forEach((track) => {
      const el = document.getElementById(`track-${track.id}`);
      el?.addEventListener('click', () => this.toggleTrackArm(track.id));
    });

    // Faders
    this.tracks.forEach((track) => {
      const fader = document.getElementById(`fader-${track.id}`) as HTMLInputElement | null;
      fader?.addEventListener('input', (e) => this.updateTrackGain(track.id, +(e.target as HTMLInputElement).value));
    });

    // Master fader
    (document.getElementById('master-fader') as HTMLInputElement | null)?.addEventListener('input', (e) => this.updateMasterGain(+(e.target as HTMLInputElement).value));

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

    // Dismiss modal on backdrop click
    document.getElementById('settings-modal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'settings-modal') this.closeSettings();
    });
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

  private updateTrackGain(trackId: number, value: number) {
    const track = this.tracks.find((t) => t.id === trackId)!;
    if (track.gainNode) {
      const gainValue = value / 100;
      track.gainNode.gain.value = gainValue;
      console.log(`🎚️ Track ${trackId} gain set to ${gainValue} (${value}%)`);
    } else {
      console.warn(`⚠️ No gain node found for track ${trackId}`);
    }
  }

  private updateMasterGain(value: number) {
    if (this.masterGainNode) this.masterGainNode.gain.value = value / 100;
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
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            } 
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
      };

      console.log('[TAPEFOUR] 🎤 Requesting microphone with constraints:', JSON.stringify(constraints, null, 2));

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
      });

      // Set up volume meter monitoring during recording
      this.setupVolumeMeter();
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
    modal && (modal.style.display = 'flex');
  }

  private closeSettings() {
    (document.getElementById('settings-modal') as HTMLElement | null)?.style.setProperty('display', 'none');
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
      download: `tapefour-mix-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.wav`,
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
    if (!this.mediaStream || !this.audioContext) return;

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const updateMeter = () => {
      if (this.state.isRecording) {
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate RMS (Root Mean Square) for more accurate volume representation
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = rms / 255; // Normalize to 0-1
        
        this.updateVolumeMeter(level);
        requestAnimationFrame(updateMeter);
      } else {
        // Reset meter when not recording
        this.updateVolumeMeter(0);
      }
    };
    
    updateMeter();
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
} 
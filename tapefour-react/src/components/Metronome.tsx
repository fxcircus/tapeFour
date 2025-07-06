import React, { FC, useEffect, useState, useRef, useCallback } from "react";

interface MetronomeProps {
  bpm: number;
  onBpmChange?: (bpm: number) => void;
}

// Metronome Engine Class - Keep all the audio functionality
class MetronomeEngine {
  context: AudioContext | null = null;
  nextNoteTime: number = 0.0;
  scheduledNotes: { beat: number, time: number }[] = [];
  timerID: number | null = null;
  currentBeat: number = 0;
  beatsPerMeasure: number = 4;
  tempo: number = 120;
  running: boolean = false;
  muted: boolean = false;
  onBeatChange: ((beat: number) => void) | null = null;
  gainNode: GainNode | null = null;
  
  constructor(tempo: number, onBeatChange?: (beat: number) => void) {
    this.tempo = tempo;
    if (onBeatChange) {
      this.onBeatChange = onBeatChange;
    }
  }
  
  init() {
    try {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (!this.gainNode) {
        this.gainNode = this.context.createGain();
        this.gainNode.gain.value = 0.5;
        this.gainNode.connect(this.context.destination);
      }
      return true;
    } catch (e) {
      console.error("Web Audio API not supported in this browser:", e);
      return false;
    }
  }
  
  start() {
    if (this.running) return;
    
    if (!this.context) {
      const success = this.init();
      if (!success) return;
    }
    
    if (this.context?.state === 'suspended') {
      this.context.resume();
    }
    
    this.running = true;
    this.currentBeat = 0;
    if (this.onBeatChange) {
      this.onBeatChange(0);
    }
    this.nextNoteTime = this.context!.currentTime;
    this.scheduledNotes = [];
    this.scheduler();
  }
  
  stop() {
    this.running = false;
    this.clearTimer();
    this.scheduledNotes = [];
    
    // Reset beat
    this.currentBeat = 0;
    if (this.onBeatChange) {
      this.onBeatChange(this.currentBeat);
    }
  }
  
  setTempo(tempo: number) {
    this.tempo = tempo;
  }
  
  setMuted(muted: boolean) {
    this.muted = muted;
  }
  
  setVolume(vol: number) {
    if (this.gainNode) this.gainNode.gain.value = vol;
  }
  
  private clearTimer() {
    if (this.timerID !== null) {
      window.clearTimeout(this.timerID);
      this.timerID = null;
    }
  }
  
  private playNote(time: number, isAccent: boolean) {
    if (this.muted || !this.context) return;
    
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    
    if (isAccent) {
      osc.frequency.value = 880;
      gain.gain.value = 0.5;
    } else {
      osc.frequency.value = 440;
      gain.gain.value = 0.3;
    }
    
    osc.connect(gain);
    gain.connect(this.gainNode!);
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(gain.gain.value, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    
    osc.start(time);
    osc.stop(time + 0.15);
  }
  
  private scheduler() {
    if (!this.running || !this.context) return;
    
    while (this.nextNoteTime < this.context.currentTime + 0.1) {
      this.scheduleNote(this.currentBeat, this.nextNoteTime);
      this.advanceNote();
    }
    
    this.timerID = window.setTimeout(() => this.scheduler(), 25);
  }
  
  private scheduleNote(beatNumber: number, time: number) {
    this.scheduledNotes.push({ beat: beatNumber, time: time });
    this.playNote(time, beatNumber === 0);
  }
  
  private advanceNote() {
    if (this.onBeatChange) {
      this.onBeatChange(this.currentBeat);
    }
    this.currentBeat = (this.currentBeat + 1) % this.beatsPerMeasure;
    const secondsPerBeat = 60.0 / this.tempo;
    this.nextNoteTime += secondsPerBeat;
  }
  
  processScheduledNotes(currentTime: number): number | null {
    while (
      this.scheduledNotes.length > 0 && 
      this.scheduledNotes[0].time < currentTime
    ) {
      const note = this.scheduledNotes.shift();
      if (note) {
        return note.beat;
      }
    }
    return null;
  }
  
  cleanup() {
    this.stop();
    if (this.context) {
      this.context.close().catch(e => console.error("Error closing audio context:", e));
      this.context = null;
    }
  }
}

const Metronome: FC<MetronomeProps> = ({ bpm: initialBpm, onBpmChange }) => {
  // State
  const [metronomePlaying, setMetronomePlaying] = useState(false);
  const [muteSound, setMuteSound] = useState(false);
  const [bpm, setBpm] = useState(initialBpm);
  const [currentBeat, setCurrentBeat] = useState(0);
  const beats = [0, 1, 2, 3]; // 4/4 time signature
  const [volume, setVolume] = useState(50); // 0-100
  const volumeKnobRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(bpm.toString());
  const bpmInputRef = useRef<HTMLInputElement>(null);
  
  // Refs
  const metronomeRef = useRef<MetronomeEngine | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const prevInitialBpmRef = useRef<number>(initialBpm);
  
  // Initialize the metronome engine
  useEffect(() => {
    metronomeRef.current = new MetronomeEngine(bpm, (beat) => {
      setCurrentBeat(beat);
    });
    
    metronomeRef.current.init();
    
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      
      if (metronomeRef.current) {
        metronomeRef.current.cleanup();
        metronomeRef.current = null;
      }
    };
  }, []);
  
  // Handle external BPM changes
  useEffect(() => {
    if (initialBpm !== prevInitialBpmRef.current) {
      setBpm(initialBpm);
      prevInitialBpmRef.current = initialBpm;
      
      if (metronomeRef.current) {
        metronomeRef.current.setTempo(initialBpm);
      }
    }
  }, [initialBpm]);
  
  // Update BPM in metronome engine
  useEffect(() => {
    if (metronomeRef.current) {
      metronomeRef.current.setTempo(bpm);
    }
  }, [bpm]);
  
  // Update mute state
  useEffect(() => {
    if (metronomeRef.current) {
      metronomeRef.current.setMuted(muteSound);
    }
  }, [muteSound]);
  
  // Interactive knob logic
  useEffect(() => {
    const knob = volumeKnobRef.current;
    if (!knob) return;

    const updateKnobRotation = (value: number) => {
      const rotation = (value - 50) * 2.7;
      knob.style.setProperty('--rotation', `${rotation}deg`);
    };

    updateKnobRotation(volume);

    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      document.body.style.userSelect = 'none';
      knob.setAttribute('data-start-y', e.clientY.toString());
      knob.setAttribute('data-start-value', volume.toString());
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const startY = Number(knob.getAttribute('data-start-y'));
        const startValue = Number(knob.getAttribute('data-start-value'));
        const deltaY = startY - e.clientY;
        const sensitivity = 0.5;
        const newValue = Math.max(0, Math.min(100, startValue + deltaY * sensitivity));
        setVolume(newValue);
        updateKnobRotation(newValue);
        e.preventDefault();
      }
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.userSelect = '';
    };

    const onDblClick = () => {
      setVolume(50);
      updateKnobRotation(50);
    };

    knob.addEventListener('mousedown', onMouseDown);
    knob.addEventListener('dblclick', onDblClick);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      knob.removeEventListener('mousedown', onMouseDown);
      knob.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [volume]);

  // Update metronome engine volume
  useEffect(() => {
    if (metronomeRef.current) {
      metronomeRef.current.setVolume(volume / 100);
    }
  }, [volume]);
  
  // Start/stop metronome
  useEffect(() => {
    if (!metronomeRef.current) return;
    
    if (metronomePlaying) {
      metronomeRef.current.start();
    } else {
      metronomeRef.current.stop();
    }
  }, [metronomePlaying]);
  
  // Animation frame for UI updates
  useEffect(() => {
    if (!metronomePlaying || !metronomeRef.current?.context) return;
    
    const updateUI = () => {
      if (!metronomeRef.current?.context) return;
      if (metronomePlaying) {
        rafIdRef.current = requestAnimationFrame(updateUI);
      }
    };
    
    rafIdRef.current = requestAnimationFrame(updateUI);
    
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [metronomePlaying]);
  
  // Event handlers
  const handleIncreaseBpm = () => {
    const newBpm = Math.min(bpm + 1, 300);
    if (newBpm !== bpm) {
      setBpm(newBpm);
      onBpmChange?.(newBpm);
    }
  };
  
  const handleDecreaseBpm = () => {
    const newBpm = Math.max(bpm - 1, 40);
    if (newBpm !== bpm) {
      setBpm(newBpm);
      onBpmChange?.(newBpm);
    }
  };
  
  const toggleMetronome = () => {
    setMetronomePlaying(!metronomePlaying);
  };
  
  const toggleMute = () => {
    setMuteSound(!muteSound);
  };

  useEffect(() => {
    if (editingBpm && bpmInputRef.current) {
      bpmInputRef.current.focus();
      bpmInputRef.current.select();
    }
  }, [editingBpm]);

  const handleBpmNumberDblClick = () => {
    setBpmInput(bpm.toString());
    setEditingBpm(true);
  };

  const handleBpmInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBpmInput(e.target.value.replace(/[^0-9]/g, ''));
  };

  const commitBpmInput = () => {
    let val = parseInt(bpmInput, 10);
    if (isNaN(val)) val = bpm;
    if (val < 40) val = 40;
    if (val > 300) val = 300;
    setBpm(val);
    onBpmChange?.(val);
    setEditingBpm(false);
  };

  const handleBpmInputBlur = () => {
    commitBpmInput();
  };

  const handleBpmInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitBpmInput();
    } else if (e.key === 'Escape') {
      setEditingBpm(false);
    }
  };

  return (
    <div className="metronome-container">
      <div style={{ transform: 'scale(0.8)', transformOrigin: 'top center', width: '100%' }}>
        <div className="metronome-controls-group">
          <div className="metronome-row top-row">
            <button 
              className="metronome-btn bpm-control-btn decrease"
              onClick={handleDecreaseBpm}
              aria-label="Decrease BPM"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <div className="bpm-display">
              {editingBpm ? (
                <input
                  ref={bpmInputRef}
                  className="bpm-number"
                  type="text"
                  value={bpmInput}
                  onChange={handleBpmInputChange}
                  onBlur={handleBpmInputBlur}
                  onKeyDown={handleBpmInputKeyDown}
                  style={{ width: 38, textAlign: 'center', fontSize: '15px', fontWeight: 300, border: '1px solid #ccc', borderRadius: 4, outline: 'none', background: 'var(--color-control-surface)', color: 'var(--color-text-primary)' }}
                  inputMode="numeric"
                  min={40}
                  max={300}
                />
              ) : (
                <div
                  className="bpm-number"
                  onDoubleClick={handleBpmNumberDblClick}
                  style={{ cursor: 'pointer' }}
                  title="Double-click to edit BPM"
                >
                  {bpm}
                </div>
              )}
              <div className="bpm-label">BPM</div>
            </div>
            <button 
              className="metronome-btn bpm-control-btn increase"
              onClick={handleIncreaseBpm}
              aria-label="Increase BPM"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
          <div className="metronome-divider" />
          <div className="metronome-row bottom-row">
            <div 
              className="beats-row"
              onClick={toggleMetronome}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              aria-label={metronomePlaying ? "Pause Metronome" : "Start Metronome"}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleMetronome();
                }
              }}
            >
              {Array.from({ length: 4 }, (_, i) => (
                <div 
                  key={i}
                  className={`beat-indicator${metronomePlaying && currentBeat === i ? ' active' : ''}`}
                  aria-label={`Beat ${i + 1}`}
                />
              ))}
            </div>
            <div
              className="pan-knob-container"
              ref={volumeKnobRef}
              tabIndex={0}
              aria-label="Metronome Volume"
              style={{ '--rotation': `${(volume - 50) * 2.7}deg` } as React.CSSProperties}
            >
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={e => setVolume(Number(e.target.value))}
                className="pan-knob metronome-volume-knob"
                aria-label="Metronome Volume"
                style={{ width: 32, height: 32 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Metronome;

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
  
  constructor(tempo: number, onBeatChange?: (beat: number) => void) {
    this.tempo = tempo;
    if (onBeatChange) {
      this.onBeatChange = onBeatChange;
    }
  }
  
  init() {
    try {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    gain.connect(this.context.destination);
    
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
    this.currentBeat = (this.currentBeat + 1) % this.beatsPerMeasure;
    const secondsPerBeat = 60.0 / this.tempo;
    this.nextNoteTime += secondsPerBeat;
    
    if (this.onBeatChange) {
      this.onBeatChange(this.currentBeat);
    }
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
      
      const currentTime = metronomeRef.current.context.currentTime;
      const beatToShow = metronomeRef.current.processScheduledNotes(currentTime);
      
      if (beatToShow !== null) {
        setCurrentBeat(beatToShow);
      }
      
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

  return (
    <div className="metronome-container">
      <div className="metronome-content">
        <div className="bpm-controls">
          <button 
            className="bpm-control-btn"
            onClick={handleDecreaseBpm}
            aria-label="Decrease BPM"
          >
            −
          </button>
          
          <div className="bpm-display">{bpm}</div>
          
          <button 
            className="bpm-control-btn"
            onClick={handleIncreaseBpm}
            aria-label="Increase BPM"
          >
            +
          </button>
        </div>
        
        <div className="metronome-controls">
          <button 
            className={`metronome-control-btn play-btn ${metronomePlaying ? 'active' : ''}`}
            onClick={toggleMetronome}
            aria-label={metronomePlaying ? "Stop metronome" : "Start metronome"}
          >
            {metronomePlaying ? '⏸' : '▶'}
          </button>
          
          <button 
            className={`metronome-control-btn mute-btn ${muteSound ? 'active' : ''}`}
            onClick={toggleMute}
            aria-label={muteSound ? "Unmute metronome" : "Mute metronome"}
          >
            {muteSound ? '🔇' : '🔊'}
          </button>
        </div>
        
        <div className="beat-indicators">
          {beats.map((beat) => (
            <div 
              key={beat}
              className={`beat-indicator ${currentBeat === beat && metronomePlaying ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Metronome;

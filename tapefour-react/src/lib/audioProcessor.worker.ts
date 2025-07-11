// Audio processing Web Worker for TapeFour
// Handles CPU-intensive operations off the main thread

type AudioProcessingTask = 
  | { type: 'halfSpeed'; audioData: Float32Array[]; sampleRate: number; taskId: string }
  | { type: 'reverse'; audioData: Float32Array[]; taskId: string }
  | { type: 'export'; tracks: AudioTrackData[]; duration: number; sampleRate: number; taskId: string }
  | { type: 'wavEncode'; audioData: Float32Array[]; sampleRate: number; taskId: string };

interface AudioTrackData {
  id: number;
  audioData: Float32Array[];
  startTime: number;
  panValue: number;
  volume: number;
}

// Process half-speed effect
function processHalfSpeed(audioData: Float32Array[]): Float32Array[] {
  const result: Float32Array[] = [];
  
  for (let channel = 0; channel < audioData.length; channel++) {
    const originalData = audioData[channel];
    const halfSpeedData = new Float32Array(originalData.length * 2);
    
    // Stretch audio by duplicating each sample
    for (let i = 0; i < originalData.length; i++) {
      halfSpeedData[i * 2] = originalData[i];
      halfSpeedData[i * 2 + 1] = originalData[i];
    }
    
    result.push(halfSpeedData);
  }
  
  return result;
}

// Process reverse effect
function processReverse(audioData: Float32Array[]): Float32Array[] {
  const result: Float32Array[] = [];
  
  for (let channel = 0; channel < audioData.length; channel++) {
    const reversed = new Float32Array(audioData[channel]);
    reversed.reverse();
    result.push(reversed);
  }
  
  return result;
}

// Mix tracks for export
function mixTracksForExport(tracks: AudioTrackData[], duration: number, sampleRate: number): Float32Array[] {
  const lengthInSamples = Math.ceil(duration * sampleRate / 1000);
  const mixedLeft = new Float32Array(lengthInSamples);
  const mixedRight = new Float32Array(lengthInSamples);
  
  // Mix each track into the stereo buffer
  for (const track of tracks) {
    if (!track.audioData || track.audioData.length === 0) continue;
    
    const startSample = Math.floor(track.startTime * sampleRate / 1000);
    const panRadians = (track.panValue - 50) * Math.PI / 200; // Convert 0-100 to radians
    const leftGain = Math.cos(panRadians) * track.volume;
    const rightGain = Math.sin(panRadians + Math.PI / 2) * track.volume;
    
    // Handle both mono and stereo tracks
    const leftChannel = track.audioData[0];
    const rightChannel = track.audioData[1] || track.audioData[0]; // Use left channel if mono
    
    // Mix into the output buffer
    for (let i = 0; i < leftChannel.length && startSample + i < lengthInSamples; i++) {
      mixedLeft[startSample + i] += leftChannel[i] * leftGain;
      mixedRight[startSample + i] += rightChannel[i] * rightGain;
    }
  }
  
  return [mixedLeft, mixedRight];
}

// Encode audio to WAV format
function encodeWav(audioData: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = audioData.length;
  const length = audioData[0].length;
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

  // WAV header
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

  // Interleave samples
  let sampleOffset = offset;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, audioData[ch][i]));
      view.setInt16(sampleOffset, sample * 0x7fff, true);
      sampleOffset += 2;
    }
  }

  return ab;
}

// Handle messages from main thread
self.addEventListener('message', (event: MessageEvent<AudioProcessingTask>) => {
  const { data } = event;
  
  try {
    switch (data.type) {
      case 'halfSpeed':
        {
          const result = processHalfSpeed(data.audioData);
          self.postMessage({ type: 'halfSpeed', result, taskId: data.taskId });
        }
        break;
        
      case 'reverse':
        {
          const result = processReverse(data.audioData);
          self.postMessage({ type: 'reverse', result, taskId: data.taskId });
        }
        break;
        
      case 'export':
        {
          const result = mixTracksForExport(data.tracks, data.duration, data.sampleRate);
          self.postMessage({ type: 'export', result, taskId: data.taskId });
        }
        break;
        
      case 'wavEncode':
        {
          const result = encodeWav(data.audioData, data.sampleRate);
          self.postMessage({ type: 'wavEncode', result, taskId: data.taskId });
        }
        break;
    }
  } catch (error) {
    self.postMessage({ 
      type: 'error', 
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      taskId: data.taskId
    });
  }
});

// Export empty object to make TypeScript happy
export {};
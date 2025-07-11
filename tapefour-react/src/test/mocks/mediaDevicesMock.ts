import { vi } from 'vitest'

export function mockMediaDevices() {
  // Mock MediaStream
  class MediaStreamMock {
    private tracks: MediaStreamTrack[] = []
    id = 'mock-stream-id'
    active = true
    
    constructor(tracks?: MediaStreamTrack[]) {
      this.tracks = tracks || [new MediaStreamTrackMock()]
    }
    
    getTracks(): MediaStreamTrack[] {
      return this.tracks
    }
    
    getAudioTracks(): MediaStreamTrack[] {
      return this.tracks.filter(t => t.kind === 'audio')
    }
    
    getVideoTracks(): MediaStreamTrack[] {
      return this.tracks.filter(t => t.kind === 'video')
    }
    
    addTrack(track: MediaStreamTrack): void {
      this.tracks.push(track)
    }
    
    removeTrack(track: MediaStreamTrack): void {
      this.tracks = this.tracks.filter(t => t !== track)
    }
  }
  
  // Mock MediaStreamTrack
  class MediaStreamTrackMock {
    kind: 'audio' | 'video' = 'audio'
    id = 'mock-track-id'
    label = 'Mock Audio Input'
    enabled = true
    muted = false
    readyState: 'live' | 'ended' = 'live'
    
    stop = vi.fn(() => {
      this.readyState = 'ended'
    })
    
    getSettings(): MediaTrackSettings {
      return {
        deviceId: 'default',
        groupId: 'default-group',
        sampleRate: 44100,
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    }
  }
  
  // Mock MediaRecorder
  class MediaRecorderMock {
    state: 'inactive' | 'recording' | 'paused' = 'inactive'
    stream: MediaStream
    mimeType: string
    ondataavailable: ((event: any) => void) | null = null
    onstop: (() => void) | null = null
    onerror: ((event: any) => void) | null = null
    
    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
      this.stream = stream
      this.mimeType = options?.mimeType || 'audio/wav'
    }
    
    start = vi.fn(() => {
      this.state = 'recording'
      // Simulate data available after a delay
      setTimeout(() => {
        if (this.ondataavailable) {
          this.ondataavailable({
            data: new Blob([new ArrayBuffer(1000)], { type: this.mimeType })
          })
        }
      }, 100)
    })
    
    stop = vi.fn(() => {
      this.state = 'inactive'
      if (this.onstop) {
        setTimeout(this.onstop, 10)
      }
    })
    
    pause = vi.fn(() => {
      this.state = 'paused'
    })
    
    resume = vi.fn(() => {
      this.state = 'recording'
    })
    
    static isTypeSupported(type: string): boolean {
      return ['audio/wav', 'audio/webm'].includes(type)
    }
  }
  
  // Mock MediaDevices
  const mockMediaDevices = {
    getUserMedia: vi.fn(async (constraints?: MediaStreamConstraints) => {
      return new MediaStreamMock()
    }),
    
    enumerateDevices: vi.fn(async () => {
      return [
        {
          deviceId: 'default',
          kind: 'audioinput' as MediaDeviceKind,
          label: 'Default Audio Input',
          groupId: 'default-group'
        },
        {
          deviceId: 'mock-mic-1',
          kind: 'audioinput' as MediaDeviceKind,
          label: 'Mock Microphone 1',
          groupId: 'mock-group-1'
        },
        {
          deviceId: 'default',
          kind: 'audiooutput' as MediaDeviceKind,
          label: 'Default Audio Output',
          groupId: 'default-group'
        },
        {
          deviceId: 'mock-speaker-1',
          kind: 'audiooutput' as MediaDeviceKind,
          label: 'Mock Speaker 1',
          groupId: 'mock-group-1'
        }
      ]
    }),
    
    getSupportedConstraints: () => ({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: true,
      channelCount: true
    })
  }
  
  // Apply mocks
  Object.defineProperty(navigator, 'mediaDevices', {
    value: mockMediaDevices,
    writable: true,
    configurable: true
  })
  
  // @ts-ignore
  global.MediaStream = MediaStreamMock
  // @ts-ignore
  global.MediaStreamTrack = MediaStreamTrackMock
  // @ts-ignore
  global.MediaRecorder = MediaRecorderMock
}
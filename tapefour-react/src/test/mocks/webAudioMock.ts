import { vi } from 'vitest'

export function mockWebAudio() {
  // Mock AudioBuffer
  class AudioBufferMock {
    public sampleRate: number
    public length: number
    public duration: number
    public numberOfChannels: number
    private channels: Float32Array[]
    
    constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
      this.numberOfChannels = options.numberOfChannels
      this.length = options.length
      this.sampleRate = options.sampleRate
      this.duration = options.length / options.sampleRate
      this.channels = Array(options.numberOfChannels).fill(null).map(() => new Float32Array(options.length))
    }
    
    getChannelData(channel: number): Float32Array {
      return this.channels[channel] || new Float32Array(this.length)
    }
    
    copyFromChannel(destination: Float32Array, channelNumber: number, startInChannel?: number) {
      const source = this.channels[channelNumber]
      if (source) {
        destination.set(source.subarray(startInChannel || 0))
      }
    }
    
    copyToChannel(source: Float32Array, channelNumber: number, startInChannel?: number) {
      const dest = this.channels[channelNumber]
      if (dest) {
        dest.set(source, startInChannel || 0)
      }
    }
  }
  
  // Mock AudioNode base
  class AudioNodeMock {
    context: AudioContextMock
    numberOfInputs = 1
    numberOfOutputs = 1
    channelCount = 2
    channelCountMode = 'max'
    channelInterpretation = 'speakers'
    private connectedNodes: Set<AudioNodeMock> = new Set()
    
    constructor(context: AudioContextMock) {
      this.context = context
    }
    
    connect(destination: AudioNodeMock | AudioParam): AudioNodeMock {
      if (destination instanceof AudioNodeMock) {
        this.connectedNodes.add(destination)
      }
      return destination as AudioNodeMock
    }
    
    disconnect(destination?: AudioNodeMock): void {
      if (destination) {
        this.connectedNodes.delete(destination)
      } else {
        this.connectedNodes.clear()
      }
    }
  }
  
  // Mock GainNode
  class GainNodeMock extends AudioNodeMock {
    gain = {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
      setValueCurveAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      cancelAndHoldAtTime: vi.fn()
    }
  }
  
  // Mock AudioBufferSourceNode
  class AudioBufferSourceNodeMock extends AudioNodeMock {
    buffer: AudioBuffer | null = null
    loop = false
    loopStart = 0
    loopEnd = 0
    playbackRate = {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn()
    }
    onended: (() => void) | null = null
    
    start = vi.fn()
    stop = vi.fn()
  }
  
  // Mock AnalyserNode
  class AnalyserNodeMock extends AudioNodeMock {
    fftSize = 2048
    frequencyBinCount = 1024
    minDecibels = -100
    maxDecibels = -30
    smoothingTimeConstant = 0.8
    
    getByteTimeDomainData = vi.fn((array: Uint8Array) => {
      // Simulate some waveform data
      for (let i = 0; i < array.length; i++) {
        array[i] = 128 + Math.floor(Math.random() * 20 - 10)
      }
    })
    
    getFloatTimeDomainData = vi.fn()
    getByteFrequencyData = vi.fn()
    getFloatFrequencyData = vi.fn()
  }
  
  // Mock OscillatorNode
  class OscillatorNodeMock extends AudioNodeMock {
    frequency = {
      value: 440,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn()
    }
    detune = { value: 0 }
    type: OscillatorType = 'sine'
    
    start = vi.fn()
    stop = vi.fn()
  }
  
  // Mock StereoPannerNode
  class StereoPannerNodeMock extends AudioNodeMock {
    pan = {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn()
    }
  }
  
  // Mock AudioContext
  class AudioContextMock {
    sampleRate = 44100
    currentTime = 0
    state: AudioContextState = 'running'
    destination = new AudioNodeMock(this)
    listener = {}
    baseLatency = 0.01
    outputLatency = 0.02
    
    private timeInterval: any
    
    constructor() {
      // Simulate time progression
      this.timeInterval = setInterval(() => {
        this.currentTime += 0.01
      }, 10)
    }
    
    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
      return new AudioBufferMock({ numberOfChannels, length, sampleRate }) as any
    }
    
    createBufferSource(): AudioBufferSourceNode {
      return new AudioBufferSourceNodeMock(this) as any
    }
    
    createGain(): GainNode {
      return new GainNodeMock(this) as any
    }
    
    createAnalyser(): AnalyserNode {
      return new AnalyserNodeMock(this) as any
    }
    
    createOscillator(): OscillatorNode {
      return new OscillatorNodeMock(this) as any
    }
    
    createStereoPanner(): StereoPannerNode {
      return new StereoPannerNodeMock(this) as any
    }
    
    createMediaStreamSource(): MediaStreamAudioSourceNode {
      return new AudioNodeMock(this) as any
    }
    
    decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
      return Promise.resolve(this.createBuffer(2, 44100, 44100))
    }
    
    suspend(): Promise<void> {
      this.state = 'suspended'
      return Promise.resolve()
    }
    
    resume(): Promise<void> {
      this.state = 'running'
      return Promise.resolve()
    }
    
    close(): Promise<void> {
      this.state = 'closed'
      clearInterval(this.timeInterval)
      return Promise.resolve()
    }
  }
  
  // Mock OfflineAudioContext
  class OfflineAudioContextMock extends AudioContextMock {
    private renderPromise: Promise<AudioBuffer>
    
    constructor(numberOfChannels: number, length: number, sampleRate: number) {
      super()
      this.sampleRate = sampleRate
      this.renderPromise = Promise.resolve(this.createBuffer(numberOfChannels, length, sampleRate))
    }
    
    startRendering(): Promise<AudioBuffer> {
      return this.renderPromise
    }
  }
  
  // Apply mocks to global
  // @ts-ignore
  global.AudioContext = AudioContextMock
  // @ts-ignore
  global.webkitAudioContext = AudioContextMock
  // @ts-ignore
  global.OfflineAudioContext = OfflineAudioContextMock
  // @ts-ignore
  global.AudioBuffer = AudioBufferMock
}
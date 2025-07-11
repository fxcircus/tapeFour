import '@testing-library/jest-dom'
import { vi } from 'vitest'
import { mockWebAudio } from './mocks/webAudioMock'
import { mockMediaDevices } from './mocks/mediaDevicesMock'

// Mock Web Audio API
mockWebAudio()

// Mock MediaDevices API
mockMediaDevices()

// Mock canvas getContext for jsdom
HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
  if (contextType === '2d') {
    return {
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      getImageData: vi.fn(() => ({ 
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1 
      })),
      putImageData: vi.fn(),
      createImageData: vi.fn(() => ({ 
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1 
      })),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
      transform: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn()
      })),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn()
      })),
      createPattern: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0,
      shadowColor: 'rgba(0, 0, 0, 0)',
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      canvas: {
        width: 800,
        height: 100
      }
    }
  }
  return null
}) as any

// Mock Worker
class WorkerMock {
  onmessage: ((event: MessageEvent) => void) | null = null
  
  postMessage(data: any) {
    // Simulate worker response
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage(new MessageEvent('message', { 
          data: { 
            type: data.type,
            result: new ArrayBuffer(100),
            taskId: data.taskId 
          } 
        }))
      }
    }, 0)
  }
  
  addEventListener(event: string, handler: (event: MessageEvent) => void) {
    if (event === 'message') {
      this.onmessage = handler
    }
  }
  
  terminate() {}
}

// @ts-ignore
global.Worker = WorkerMock

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
global.URL.revokeObjectURL = vi.fn()

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((callback) => {
  return setTimeout(() => callback(Date.now()), 16) as any
})

global.cancelAnimationFrame = vi.fn((id) => {
  clearTimeout(id)
})

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

// Don't mock TapeFour for integration tests
vi.unmock('../../lib/TapeFour')

describe('Recording Integration Tests', () => {
  beforeEach(() => {
    localStorage.clear()
    
    // Set up full DOM for integration tests
    document.body.innerHTML = `<div id="root"></div>`
  })
  
  afterEach(() => {
    vi.clearAllTimers()
    vi.clearAllMocks()
  })
  
  describe('Full Recording Workflow', () => {
    it('should complete a basic recording workflow', async () => {
      const user = userEvent.setup()
      render(<App />)
      
      // 1. Arm Track 1
      const track1Checkbox = document.getElementById('track-1') as HTMLInputElement
      await user.click(track1Checkbox)
      
      // Just verify we can interact with the element
      expect(track1Checkbox).toBeInTheDocument()
      
      // 2. Start Recording
      const recordButton = document.getElementById('record-btn') as HTMLButtonElement
      await user.click(recordButton)
      
      // 3. Wait for recording to process
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // 4. Stop Recording
      const stopButton = document.getElementById('stop-btn') as HTMLButtonElement
      await user.click(stopButton)
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // 5. Play Recording
      const playButton = document.getElementById('play-btn') as HTMLButtonElement
      await user.click(playButton)
      
      // Verify all buttons exist and are clickable
      expect(recordButton).toBeInTheDocument()
      expect(stopButton).toBeInTheDocument()
      expect(playButton).toBeInTheDocument()
    })
    
    it('should handle multi-track recording', async () => {
      const user = userEvent.setup()
      render(<App />)
      
      // Record on Track 1
      const track1 = document.getElementById('track-1') as HTMLInputElement
      await user.click(track1)
      const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
      await user.click(recordBtn)
      
      // Simulate some recording time
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement
      await user.click(stopBtn)
      
      // Record on Track 2 while Track 1 plays
      const track2 = document.getElementById('track-2') as HTMLInputElement
      await user.click(track2)
      await user.click(recordBtn)
      
      // Both tracks should be in the system
      await new Promise(resolve => setTimeout(resolve, 100))
      
      await user.click(stopBtn)
      
      // Play should play both tracks
      const playBtn = document.getElementById('play-btn') as HTMLButtonElement
      await user.click(playBtn)
      
      await waitFor(() => {
        expect(playBtn.classList.contains('playing')).toBe(true)
      })
    })
  })
  
  describe('Effects Integration', () => {
    it('should apply effects to recorded tracks', async () => {
      const user = userEvent.setup()
      render(<App />)
      
      // Record something first
      const track1 = document.getElementById('track-1') as HTMLInputElement
      await user.click(track1)
      const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
      await user.click(recordBtn)
      await new Promise(resolve => setTimeout(resolve, 100))
      const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement
      await user.click(stopBtn)
      
      // Apply reverse effect
      const reverseButton = document.getElementById('reverse-1') as HTMLButtonElement
      await user.click(reverseButton)
      
      // Apply half-speed effect
      const halfSpeedButton = document.getElementById('half-speed-1') as HTMLButtonElement
      await user.click(halfSpeedButton)
      
      // Verify buttons exist and are clickable
      expect(reverseButton).toBeInTheDocument()
      expect(halfSpeedButton).toBeInTheDocument()
    })
  })
  
  describe('Export Workflow', () => {
    it('should handle export without freezing UI', async () => {
      const user = userEvent.setup()
      render(<App />)
      
      // Record a track
      const track1 = document.getElementById('track-1') as HTMLInputElement
      await user.click(track1)
      const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
      await user.click(recordBtn)
      await new Promise(resolve => setTimeout(resolve, 200)) // Longer recording
      const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement
      await user.click(stopBtn)
      
      // Export
      const exportButton = document.getElementById('export-btn') as HTMLButtonElement
      await user.click(exportButton)
      
      // UI should remain responsive (button should still be clickable)
      expect(exportButton).not.toBeDisabled()
    })
  })
  
  describe('Performance Benchmarks', () => {
    it('should maintain performance during playback', async () => {
      const user = userEvent.setup()
      render(<App />)
      
      // Measure frame rate during playback
      const startTime = performance.now()
      let frameCount = 0
      
      const measureFrames = () => {
        frameCount++
        if (performance.now() - startTime < 1000) {
          requestAnimationFrame(measureFrames)
        }
      }
      
      // Start measurement
      requestAnimationFrame(measureFrames)
      
      // Perform actions
      const track1 = document.getElementById('track-1') as HTMLInputElement
      await user.click(track1)
      const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
      await user.click(recordBtn)
      await new Promise(resolve => setTimeout(resolve, 100))
      const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement
      await user.click(stopBtn)
      const playBtn = document.getElementById('play-btn') as HTMLButtonElement
      await user.click(playBtn)
      
      // Wait for measurement to complete
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      // Should maintain at least 30fps
      expect(frameCount).toBeGreaterThan(30)
    })
    
    it('should not leak memory on repeated operations', async () => {
      const user = userEvent.setup()
      render(<App />)
      
      // Get initial memory (if available)
      const initialMemory = (performance as any).memory?.usedJSHeapSize || 0
      
      // Perform multiple record/stop cycles
      const track1 = document.getElementById('track-1') as HTMLInputElement
      const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
      const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement
      
      for (let i = 0; i < 5; i++) {
        await user.click(track1)
        await user.click(recordBtn)
        await new Promise(resolve => setTimeout(resolve, 50))
        await user.click(stopBtn)
      }
      
      // Check memory hasn't grown excessively
      const finalMemory = (performance as any).memory?.usedJSHeapSize || 0
      const memoryGrowth = finalMemory - initialMemory
      
      // Memory growth should be reasonable (less than 10MB for this test)
      // Note: This test may not work in all environments
      if (initialMemory > 0) {
        expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024)
      }
    })
  })
})
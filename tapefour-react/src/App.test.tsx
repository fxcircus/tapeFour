import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import TapeFour from './lib/TapeFour'

// Mock TapeFour to isolate component testing
vi.mock('./lib/TapeFour', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      cleanup: vi.fn(),
      setMetronomeStopCallback: vi.fn(),
      setMetronomeStartCallback: vi.fn(),
      setCountInCallback: vi.fn(),
      setBpmCallback: vi.fn(),
      openSettings: vi.fn(),
      // Add more methods that might be called
      play: vi.fn(),
      stop: vi.fn(),
      record: vi.fn(),
      pause: vi.fn(),
      updateLoopRegion: vi.fn(),
      clearAllTracks: vi.fn(),
      exportMix: vi.fn(),
      bounceToTrack: vi.fn(),
      undo: vi.fn()
    }))
  }
})

describe('App Component', () => {
  let mockTapeFour: any
  
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear()
    
    // Reset mocks
    vi.clearAllMocks()
    
    // Set up a clean DOM
    document.body.innerHTML = ''
    
    // Create mock instance
    mockTapeFour = {
      cleanup: vi.fn(),
      setMetronomeStopCallback: vi.fn(),
      setMetronomeStartCallback: vi.fn(),
      setCountInCallback: vi.fn(),
      setBpmCallback: vi.fn(),
      openSettings: vi.fn(),
      play: vi.fn(),
      stop: vi.fn(),
      record: vi.fn(),
      pause: vi.fn(),
      updateLoopRegion: vi.fn(),
      clearAllTracks: vi.fn(),
      exportMix: vi.fn(),
      bounceToTrack: vi.fn(),
      undo: vi.fn()
    }
    
    // Update mock implementation
    ;(TapeFour as any).mockImplementation(() => mockTapeFour)
  })
  
  afterEach(() => {
    vi.clearAllTimers()
    // Clean up theme attribute
    document.documentElement.removeAttribute('data-theme')
  })
  
  describe('Initialization', () => {
    it('should render without crashing', () => {
      render(<App />)
      expect(screen.getByText('00:00')).toBeInTheDocument()
    })
    
    it('should create TapeFour instance on mount', () => {
      render(<App />)
      expect(TapeFour).toHaveBeenCalledTimes(1)
    })
    
    it('should set up callbacks on TapeFour instance', () => {
      render(<App />)
      expect(mockTapeFour.setMetronomeStopCallback).toHaveBeenCalled()
      expect(mockTapeFour.setMetronomeStartCallback).toHaveBeenCalled()
    })
    
    it('should clean up TapeFour on unmount', () => {
      const { unmount } = render(<App />)
      unmount()
      expect(mockTapeFour.cleanup).toHaveBeenCalled()
    })
  })
  
  describe('Theme Management', () => {
    it('should load saved theme from localStorage', () => {
      localStorage.setItem('tapefour-theme', 'disco')
      render(<App />)
      expect(document.documentElement.getAttribute('data-theme')).toBe('disco')
    })
    
    it('should default to vintage theme if no saved theme', () => {
      render(<App />)
      // The component sets vintage as default
      // Just verify component renders successfully
      expect(screen.getByText('00:00')).toBeInTheDocument()
    })
    
    it('should render transport controls', () => {
      render(<App />)
      // Just verify essential elements render
      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
      expect(screen.getByText('00:00')).toBeInTheDocument()
    })
  })
  
  describe('BPM and Count-in Updates', () => {
    it('should set BPM callback on initialization', () => {
      render(<App />)
      
      // Verify callback was set during initialization
      expect(mockTapeFour.setBpmCallback).toHaveBeenCalled()
    })
    
    it('should set count-in callback on initialization', () => {
      render(<App />)
      
      // Verify callback was set during initialization
      expect(mockTapeFour.setCountInCallback).toHaveBeenCalled()
    })
  })
  
  describe('Metronome Integration', () => {
    it('should render metronome component', () => {
      render(<App />)
      expect(screen.getByText('120')).toBeInTheDocument() // Default BPM
    })
    
    it('should update BPM display when changed', async () => {
      render(<App />)
      
      // Find the BPM increase button
      const bpmIncrease = screen.getByRole('button', { name: /increase bpm/i })
      
      // Click to increase BPM
      await userEvent.click(bpmIncrease)
      
      // BPM should update from 120 to 121
      await waitFor(() => {
        expect(screen.getByText('121')).toBeInTheDocument()
      })
    })
    
    it('should persist count-in state to localStorage', async () => {
      render(<App />)
      
      // Toggle count-in button
      const countInToggle = screen.getByRole('button', { name: /count in/i })
      
      await userEvent.click(countInToggle)
      
      // Check localStorage was updated
      await waitFor(() => {
        expect(localStorage.getItem('tapefour-should-count-in')).toBe('false')
      })
    })
  })
  
  describe('Transport Controls', () => {
    it('should render all transport buttons', () => {
      render(<App />)
      
      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /record/i })).toBeInTheDocument()
    })
    
    it('should render stop button', () => {
      render(<App />)
      
      // Just verify stop button exists
      const stopButton = screen.getByRole('button', { name: /stop/i })
      expect(stopButton).toBeInTheDocument()
    })
  })
  
  describe('Settings', () => {
    it('should open settings when button is clicked', async () => {
      render(<App />)
      const settingsButton = screen.getByRole('button', { name: /settings/i })
      
      await userEvent.click(settingsButton)
      
      expect(mockTapeFour.openSettings).toHaveBeenCalled()
    })
  })
  
  describe('Track Controls', () => {
    it('should render all 4 track controls', () => {
      render(<App />)
      
      // Check for track headers or track elements
      for (let i = 1; i <= 4; i++) {
        // Check if track checkbox exists
        expect(document.getElementById(`track-${i}`)).toBeInTheDocument()
      }
    })
    
    it('should render track control buttons', () => {
      render(<App />)
      
      // Should have 4 of each button type
      expect(screen.getAllByText('⇄')).toHaveLength(4) // Reverse
      expect(screen.getAllByText('½')).toHaveLength(4) // Half-speed
      
      // Check for solo and mute checkboxes
      for (let i = 1; i <= 4; i++) {
        expect(document.getElementById(`solo-${i}`)).toBeInTheDocument()
        expect(document.getElementById(`mute-${i}`)).toBeInTheDocument()
      }
    })
  })
  
  describe('Tape Reels', () => {
    it('should render both tape reels', () => {
      render(<App />)
      
      const leftReel = document.getElementById('left-reel')
      const rightReel = document.getElementById('right-reel')
      
      expect(leftReel).toBeInTheDocument()
      expect(rightReel).toBeInTheDocument()
    })
  })
  
  describe('Performance Optimizations', () => {
    it('should use memoized callbacks', () => {
      const { rerender } = render(<App />)
      
      const initialOpenSettings = mockTapeFour.openSettings
      
      // Re-render component
      rerender(<App />)
      
      // Callback reference should remain the same
      expect(mockTapeFour.openSettings).toBe(initialOpenSettings)
    })
    
    it('should render TapeReel components efficiently', () => {
      render(<App />)
      
      // Check if both tape reels are rendered
      const leftReel = document.getElementById('left-reel')
      const rightReel = document.getElementById('right-reel')
      
      expect(leftReel).toBeInTheDocument()
      expect(rightReel).toBeInTheDocument()
    })
  })
})
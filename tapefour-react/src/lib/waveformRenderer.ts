export interface WaveformPoint {
  position: number;
  peak: number;
}

export interface WaveformColors {
  1: string;
  2: string;
  3: string;
  4: string;
  master: string;
}

export class WaveformRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  
  private colors: WaveformColors = {
    1: '#D18C33',
    2: '#C5473E',
    3: '#36A158',
    4: '#5379B4',
    master: '#9C27B0'
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context from canvas');
    this.ctx = ctx;
    
    // Create offscreen canvas for double buffering
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = canvas.width;
    this.offscreenCanvas.height = canvas.height;
    const offscreenCtx = this.offscreenCanvas.getContext('2d');
    if (!offscreenCtx) throw new Error('Could not get 2D context from offscreen canvas');
    this.offscreenCtx = offscreenCtx;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  clearOffscreen() {
    this.offscreenCtx.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
  }

  drawRealtimePeak(
    peak: number, 
    position: number, 
    trackId: number,
    isPunchIn: boolean = false
  ) {
    const height = this.canvas.height;
    const waveformHeight = peak * height * 0.95; // 95% of canvas height for positive only
    const barWidth = 3; // Match the width used in drawTrackWaveform
    
    // Set color based on track
    const color = this.colors[trackId as keyof typeof this.colors] || '#D18C33';
    this.ctx.fillStyle = isPunchIn ? `${color}66` : color; // 40% opacity for punch-in
    
    // Draw the peak from bottom up (positive only)
    this.ctx.fillRect(position, height - waveformHeight, barWidth, waveformHeight);
  }

  drawTrackWaveform(
    waveformData: WaveformPoint[],
    trackId: number | 'master',
    options: {
      isReversed?: boolean;
      isHalfSpeed?: boolean;
      isPunchIn?: boolean;
      opacity?: number;
    } = {}
  ) {
    if (!waveformData || waveformData.length === 0) {
      console.log(`[WaveformRenderer] No data to draw for track ${trackId}`);
      return;
    }
    
    console.log(`[WaveformRenderer] Drawing track ${trackId} with ${waveformData.length} points`);
    
    const { isReversed = false, isHalfSpeed = false, isPunchIn = false, opacity = 1 } = options;
    const height = this.canvas.height;
    const canvasWidth = this.canvas.width;
    
    // Set color
    const baseColor = this.colors[trackId as keyof typeof this.colors];
    const alpha = isPunchIn ? 0.4 : opacity;
    this.offscreenCtx.fillStyle = this.hexToRgba(baseColor, alpha);
    
    // Handle transformations
    let transformedData = [...waveformData];
    
    // Apply half-speed transformation (double the width)
    if (isHalfSpeed) {
      transformedData = transformedData.map(point => ({
        ...point,
        position: point.position * 2
      }));
    }
    
    // Apply reverse transformation
    if (isReversed && transformedData.length > 0) {
      const positions = transformedData.map(d => d.position);
      const minPos = Math.min(...positions);
      const maxPos = Math.max(...positions);
      
      transformedData = transformedData.map(point => ({
        ...point,
        position: maxPos - (point.position - minPos)
      }));
    }
    
    // Draw the waveform
    const peakWidth = 3;
    let pointsDrawn = 0;
    let pointsSkipped = 0;
    
    transformedData.forEach(({ position, peak }) => {
      // Skip points outside canvas bounds
      if (position < 0 || position > canvasWidth) {
        pointsSkipped++;
        return;
      }
      
      const waveformHeight = peak * height * 0.95; // 95% of canvas height for positive only
      this.offscreenCtx.fillRect(
        position, 
        height - waveformHeight, // Draw from bottom up
        peakWidth, 
        waveformHeight
      );
      pointsDrawn++;
    });
    
    console.log(`[WaveformRenderer] Track ${trackId}: drew ${pointsDrawn} points, skipped ${pointsSkipped} (out of bounds)`);
  }

  drawLoopRegion(loopStart: number, loopEnd: number, maxDuration: number) {
    const canvasWidth = this.canvas.width;
    const loopStartX = (loopStart / maxDuration) * canvasWidth;
    const loopEndX = (loopEnd / maxDuration) * canvasWidth;
    
    // Draw loop region overlay
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.fillRect(loopStartX, 0, loopEndX - loopStartX, this.canvas.height);
    
    // Draw loop markers
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 3]);
    
    // Start marker
    this.ctx.beginPath();
    this.ctx.moveTo(loopStartX, 0);
    this.ctx.lineTo(loopStartX, this.canvas.height);
    this.ctx.stroke();
    
    // End marker
    this.ctx.beginPath();
    this.ctx.moveTo(loopEndX, 0);
    this.ctx.lineTo(loopEndX, this.canvas.height);
    this.ctx.stroke();
    
    this.ctx.setLineDash([]);
  }

  drawPunchInRegion(punchInStart: number, currentPosition: number, maxDuration: number) {
    const canvasWidth = this.canvas.width;
    const punchStartX = (punchInStart / maxDuration) * canvasWidth;
    const currentX = (currentPosition / maxDuration) * canvasWidth;
    
    // Draw punch-in overlay
    this.ctx.fillStyle = 'rgba(255, 100, 100, 0.1)';
    this.ctx.fillRect(punchStartX, 0, currentX - punchStartX, this.canvas.height);
  }

  commit() {
    // Copy offscreen canvas to main canvas
    console.log(`[WaveformRenderer] Committing offscreen canvas (${this.offscreenCanvas.width}x${this.offscreenCanvas.height}) to main canvas`);
    this.ctx.drawImage(this.offscreenCanvas, 0, 0);
  }

  private hexToRgba(hex: string, alpha: number): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return hex;
    
    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
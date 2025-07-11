import { memo } from 'react'

interface TapeReelProps {
  side: 'left' | 'right'
}

const TapeReel = memo(({ side }: TapeReelProps) => {
  const maskId = side === 'left' ? 'slots-left' : 'slots-right'
  const cassetteId = side === 'left' ? 'cassette-holes-left' : 'cassette-holes-right'
  const gradientId = side === 'left' ? 'cassette-gradient' : 'cassette-gradient-right'
  
  return (
    <svg className={`tape-reel ${side}-reel`} id={`${side}-reel`} width="104" height="104" viewBox="0 0 104 104">
      <defs>
        {/* Cassette reel gradient for realistic metallic appearance */}
        <radialGradient id={gradientId} cx="0.3" cy="0.3" r="0.8">
          <stop offset="0%" stopColor="hsl(200, 35%, 75%)" />
          <stop offset="40%" stopColor="hsl(200, 40%, 65%)" />
          <stop offset="70%" stopColor="hsl(200, 45%, 55%)" />
          <stop offset="100%" stopColor="hsl(200, 50%, 45%)" />
        </radialGradient>
        
        {/* Vintage theme - traditional reel slots */}
        <mask id={`vintage-${maskId}`}>
          <rect width="104" height="104" fill="white" />
          <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" />
          <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" transform="rotate(120 52 52)" />
          <rect x="44" y="10" width="16" height="22" rx="4" ry="4" fill="black" transform="rotate(240 52 52)" />
        </mask>
        {/* Indie theme - simplified cassette cogwheel */}
        <mask id={cassetteId}>
          <rect width="104" height="104" fill="white" />
          {/* Central cogwheel/gear hole - like real cassettes */}
          <circle cx="52" cy="52" r="12" fill="black" />
          {/* Gear teeth - 6 rectangular notches around the center */}
          <rect x="50" y="28" width="4" height="8" fill="black" />
          <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(60 52 52)" />
          <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(120 52 52)" />
          <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(180 52 52)" />
          <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(240 52 52)" />
          <rect x="50" y="28" width="4" height="8" fill="black" transform="rotate(300 52 52)" />
        </mask>
      </defs>
      <g className="reel">
        <circle className="reel-base" cx="52" cy="52" r="50" fill="var(--color-track-well)" />
        {/* Vintage reel face */}
        <circle className="reel-face vintage-reel" cx="52" cy="52" r="50" fill="var(--reel-mid)" mask={`url(#vintage-${maskId})`} />
        {/* Indie reel face */}
        <circle className="reel-face indie-reel" cx="52" cy="52" r="50" fill="var(--reel-mid)" mask={`url(#${cassetteId})`} />
        {/* Disco neon reel - transparent with glowing concentric rings */}
        <g className="disco-reel">
          <circle className="neon-ring-outer" cx="52" cy="52" r="48" fill="none" stroke="hsl(180, 100%, 75%)" strokeWidth="0.5" opacity="0.6" />
          <circle className="neon-ring-mid" cx="52" cy="52" r="40" fill="none" stroke="hsl(320, 100%, 70%)" strokeWidth="0.3" opacity="0.8" />
          <circle className="neon-ring-inner" cx="52" cy="52" r="32" fill="none" stroke="hsl(280, 100%, 80%)" strokeWidth="0.2" opacity="0.5" />
          <circle className="neon-plate" cx="52" cy="52" r="50" fill="hsla(310, 80%, 20%, 0.1)" stroke="hsl(340, 100%, 75%)" strokeWidth="1" />
        </g>
        {/* 808 turntable record */}
        <g className="turntable-reel">
          {/* Vinyl record base */}
          <circle className="vinyl-record" cx="52" cy="52" r="50" fill="hsl(0, 0%, 8%)" stroke="hsl(0, 0%, 15%)" strokeWidth="0.5" />
          {/* Record grooves */}
          <circle className="record-groove" cx="52" cy="52" r="45" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.6" />
          <circle className="record-groove" cx="52" cy="52" r="40" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.4" />
          <circle className="record-groove" cx="52" cy="52" r="35" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.3" />
          <circle className="record-groove" cx="52" cy="52" r="30" fill="none" stroke="hsl(0, 0%, 12%)" strokeWidth="0.3" opacity="0.2" />
          {/* Center label */}
          <circle className="record-label" cx="52" cy="52" r="20" fill={side === 'left' ? "hsl(20, 100%, 55%)" : "hsl(45, 100%, 50%)"} stroke={side === 'left' ? "hsl(20, 100%, 45%)" : "hsl(45, 100%, 40%)"} strokeWidth="1" />
          <circle className="label-ring" cx="52" cy="52" r="15" fill="none" stroke={side === 'left' ? "hsl(20, 80%, 40%)" : "hsl(45, 80%, 35%)"} strokeWidth="0.5" />
          <text className="label-text" x="52" y="56" textAnchor="middle" fill={side === 'left' ? "hsl(45, 100%, 85%)" : "hsl(20, 100%, 85%)"} fontSize="7" fontWeight="bold">
            {side === 'left' ? 'Make' : 'Music'}
          </text>
        </g>
        {/* Dark theme radial bars */}
        <g className="radial-bars">
          {/* 8 radial bars positioned around the center */}
          <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" />
          <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(45 52 52)" />
          <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(90 52 52)" />
          <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(135 52 52)" />
          <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(180 52 52)" />
          <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(225 52 52)" />
          <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(270 52 52)" />
          <rect className="radial-bar" x="50" y="12" width="4" height="16" rx="2" ry="2" fill="hsl(215, 15%, 40%)" transform="rotate(315 52 52)" />
        </g>
        <circle className="reel-rim" cx="52" cy="52" r="50" />
        {/* Vintage hub (larger) */}
        <circle className="reel-hub vintage-hub" cx="52" cy="52" r="14" fill="var(--reel-hub)" />
        {/* Indie hub (cogwheel center) */}
        <circle className="reel-hub indie-hub" cx="52" cy="52" r="8" fill="var(--reel-hub)" />
        {/* Disco neon hub */}
        <circle className="reel-hub disco-hub" cx="52" cy="52" r="6" fill="hsla(340, 100%, 75%, 0.3)" stroke="hsl(340, 100%, 85%)" strokeWidth="1" />
        {/* 808 turntable hub (center hole) */}
        <circle className="reel-hub turntable-hub" cx="52" cy="52" r="4" fill="hsl(0, 0%, 5%)" stroke="hsl(0, 0%, 20%)" strokeWidth="0.5" />
        {/* Dark theme radial hub */}
        <circle className="reel-hub radial-hub" cx="52" cy="52" r="8" fill="hsl(215, 15%, 25%)" stroke="hsl(215, 15%, 45%)" strokeWidth="1" />
      </g>
    </svg>
  )
})

TapeReel.displayName = 'TapeReel'

export default TapeReel
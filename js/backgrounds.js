/**
 * Custom Reading Dashboard — Circadian Nerdy Background Engine (`js/backgrounds.js`)
 *
 * Provides a zero-dependency, offline-ready library of nerdy wallpapers
 * (Pixelated 8/16-bit scenes, PCB & Isometric Tech, Modern Algorithmic Geometry,
 * Retro CRT Terminals, and Deep-Space Telemetry) plus user-configured custom URLs.
 *
 * Features:
 * - Deterministic daily random switching (`YYYY-MM-DD` + `shuffleNonce`)
 * - Time-of-day mood & lighting adaptation (`morning`, `deep-work`, `evening`, `night`)
 * - Strict MV3 CSP compliance (pure SVG data URIs and safe DOM APIs)
 */

export const BACKGROUND_CATEGORIES = [
  { id: 'pixel', label: '👾 Pixel Art' },
  { id: 'technology', label: '🔌 Circuit & Tech' },
  { id: 'modern', label: '📐 Modern Architecture' },
  { id: 'retro', label: '🖥️ Retro Terminal' },
  { id: 'space', label: '🛰️ Orbital & Sci-Fi' }
];

/**
 * Curated catalog of 12 built-in nerdy procedural/pixel scenes.
 */
export const BACKGROUND_PACK = [
  {
    id: 'pixel-cyber-bonsai',
    name: '16-Bit Cyber-Bonsai Desk',
    category: 'pixel',
    isPixelArt: true,
    description: 'Pixelated desk studio with a glowing mechanical keyboard, CRT monitor, and a serene pixel bonsai overlooking the skyline.'
  },
  {
    id: 'pixel-bit-city',
    name: '8-Bit Rooftop Server Skyline',
    category: 'pixel',
    isPixelArt: true,
    description: 'Pixelated city rooftops with microwave relay dishes, blinking server towers, and time-of-day sky.'
  },
  {
    id: 'pixel-arcade-lab',
    name: 'Pixel Quantum Lab & Espresso',
    category: 'pixel',
    isPixelArt: true,
    description: 'Retro pixel bench with an oscilloscope waveform, steaming coffee mug, and cartridge rack.'
  },
  {
    id: 'pixel-starship-bridge',
    name: 'Pixel Starship Observation Deck',
    category: 'pixel',
    isPixelArt: true,
    description: '16-bit viewport looking out onto a ringed exoplanet, pixel nebula, and bridge status LEDs.'
  },
  {
    id: 'tech-pcb-traces',
    name: 'Silicon & Copper PCB Bus',
    category: 'technology',
    isPixelArt: false,
    description: 'Precision motherboard copper/gold traces, CPU die pins, and logic-bus routing vias.'
  },
  {
    id: 'tech-isometric-cluster',
    name: 'Isometric Edge Compute Mesh',
    category: 'technology',
    isPixelArt: false,
    description: 'Isometric distributed server nodes linked by glowing fiber-optic data conduits.'
  },
  {
    id: 'tech-neural-constellation',
    name: 'Transformer Attention Lattice',
    category: 'technology',
    isPixelArt: false,
    description: 'Multi-head attention arcs, embedding vectors, and geometric tensor nodes.'
  },
  {
    id: 'modern-bauhaus-code',
    name: 'Modernist Compiler Geometry',
    category: 'modern',
    isPixelArt: false,
    description: 'Architectural Bauhaus monoliths, golden-ratio gridlines, and subtle coordinate ticks.'
  },
  {
    id: 'modern-topographic-mesh',
    name: 'Algorithmic Elevation Isolines',
    category: 'modern',
    isPixelArt: false,
    description: 'Smooth procedural terrain contours paired with precision CAD rangefinder crosshairs.'
  },
  {
    id: 'modern-glass-prism',
    name: 'Spectral Dot-Matrix Studio',
    category: 'modern',
    isPixelArt: false,
    description: 'Minimalist architectural dot matrix bathed in circadian refractive light gradients.'
  },
  {
    id: 'retro-amber-terminal',
    name: 'Mainframe Phosphor Horizon',
    category: 'retro',
    isPixelArt: false,
    description: 'Synth-horizon perspective wireframe, subtle CRT scanlines, and warm phosphor gauges.'
  },
  {
    id: 'space-orbital-telemetry',
    name: 'Lagrange Orbital Telemetry',
    category: 'space',
    isPixelArt: false,
    description: 'Deep-space gravity-assist trajectories, planetary rings, and star-chart ephemeris.'
  }
];

/**
 * Time-of-day circadian palettes driving sky, grid, primary/secondary accents,
 * celestial bodies, and high-contrast ambient scrims across every scene.
 *
 * Uses deep, low-glare studio bases with time-of-day circadian lighting
 * so foreground cards, headers, and typography maintain high contrast.
 */
export const CIRCADIAN_BG_PALETTES = {
  morning: {
    id: 'morning',
    label: '🌅 Morning Sunrise',
    skyTop: '#1D1716',
    skyMid: '#2D211E',
    skyBottom: '#1A1514',
    horizon: '#523328',
    structureDark: '#120E0D',
    structureMid: '#261E1B',
    structureLight: '#6E564B',
    accentPrimary: '#E57C58',
    accentSecondary: '#639C85',
    accentGlow: '#F6B16A',
    gridLine: 'rgba(246, 177, 106, 0.16)',
    celestialType: 'sunrise',
    celestialColor: '#F6B16A',
    windowLit: '#FFE3AD',
    tintCss: 'radial-gradient(circle at 50% 35%, rgba(20, 17, 16, 0.56) 0%, rgba(14, 12, 11, 0.80) 100%)',
    customFilter: 'saturate(1.02) sepia(0.08) brightness(0.68) contrast(1.06)'
  },
  'deep-work': {
    id: 'deep-work',
    label: '🧘 Daylight Deep-Work',
    skyTop: '#121B1A',
    skyMid: '#1A2825',
    skyBottom: '#111716',
    horizon: '#28403A',
    structureDark: '#0C1211',
    structureMid: '#1D2B28',
    structureLight: '#4D6B63',
    accentPrimary: '#5B9E87',
    accentSecondary: '#5496B8',
    accentGlow: '#82C9B0',
    gridLine: 'rgba(130, 201, 176, 0.15)',
    celestialType: 'day-sun',
    celestialColor: '#F0CE73',
    windowLit: '#D4F5E9',
    tintCss: 'radial-gradient(circle at 50% 35%, rgba(15, 22, 20, 0.58) 0%, rgba(11, 15, 14, 0.82) 100%)',
    customFilter: 'saturate(0.95) brightness(0.66) contrast(1.05)'
  },
  evening: {
    id: 'evening',
    label: '🍵 Twilight Wind-Down',
    skyTop: '#16131F',
    skyMid: '#281E29',
    skyBottom: '#171312',
    horizon: '#54322A',
    structureDark: '#0F0C0C',
    structureMid: '#241D1B',
    structureLight: '#54433B',
    accentPrimary: '#E3935B',
    accentSecondary: '#7CA392',
    accentGlow: '#F4A261',
    gridLine: 'rgba(227, 147, 91, 0.15)',
    celestialType: 'crescent',
    celestialColor: '#F6BD60',
    windowLit: '#F4A261',
    tintCss: 'radial-gradient(circle at 50% 35%, rgba(20, 17, 16, 0.60) 0%, rgba(12, 10, 10, 0.84) 100%)',
    customFilter: 'saturate(0.96) sepia(0.12) brightness(0.64) contrast(1.06)'
  },
  night: {
    id: 'night',
    label: '🌌 Midnight Phosphor',
    skyTop: '#0B0F14',
    skyMid: '#121922',
    skyBottom: '#0E0E0E',
    horizon: '#1D2B38',
    structureDark: '#080A0E',
    structureMid: '#171F28',
    structureLight: '#334354',
    accentPrimary: '#64B6AC',
    accentSecondary: '#D49A6A',
    accentGlow: '#7CE0D3',
    gridLine: 'rgba(100, 182, 172, 0.14)',
    celestialType: 'stars-moon',
    celestialColor: '#DCE8F2',
    windowLit: '#FFD166',
    tintCss: 'radial-gradient(circle at 50% 35%, rgba(12, 15, 19, 0.62) 0%, rgba(8, 10, 12, 0.86) 100%)',
    customFilter: 'saturate(0.88) brightness(0.58) contrast(1.08)'
  }
};

/**
 * Format local YYYY-MM-DD for daily deterministic rotation.
 * @param {Date} [now]
 * @returns {string}
 */
export function formatBgDateKey(now = new Date()) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Deterministic 32-bit hash (FNV-1a + avalanche) for daily seed selection.
 * @param {string} seedStr
 * @returns {number}
 */
export function computeDailySeedHash(seedStr) {
  const text = String(seedStr || '2026-01-01');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Resolve the active time-of-day background mood (`morning`, `deep-work`, `evening`, `night`).
 * @param {Date} [now]
 * @param {'auto' | 'morning' | 'deep-work' | 'evening' | 'night'} [moodSync='auto']
 * @param {'auto' | 'morning' | 'deep-work' | 'evening'} [wellnessMoodOverride='auto']
 * @returns {'morning' | 'deep-work' | 'evening' | 'night'}
 */
export function resolveBackgroundTimeMood(now = new Date(), moodSync = 'auto', wellnessMoodOverride = 'auto') {
  if (moodSync === 'morning' || moodSync === 'deep-work' || moodSync === 'evening' || moodSync === 'night') {
    return moodSync;
  }
  if (wellnessMoodOverride === 'morning' || wellnessMoodOverride === 'deep-work' || wellnessMoodOverride === 'evening') {
    return wellnessMoodOverride;
  }

  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const mins = d.getHours() * 60 + d.getMinutes();

  if (mins >= 360 && mins < 600) return 'morning';     // 06:00 - 09:59
  if (mins >= 600 && mins < 1050) return 'deep-work';  // 10:00 - 17:29
  if (mins >= 1050 && mins < 1320) return 'evening';   // 17:30 - 21:59
  return 'night';                                      // 22:00 - 05:59
}

/**
 * Build celestial SVG fragment (sunrise, daylight sun, evening crescent, midnight starfield).
 * @param {any} p
 * @param {boolean} pixelMode
 * @returns {string}
 */
function buildCelestialFragment(p, pixelMode) {
  if (pixelMode) {
    if (p.celestialType === 'sunrise') {
      return `
        <rect x="248" y="42" width="24" height="24" fill="${p.celestialColor}" opacity="0.88"/>
        <rect x="244" y="46" width="32" height="16" fill="${p.celestialColor}" opacity="0.65"/>
        <rect x="44" y="28" width="28" height="4" fill="#FFFFFF" opacity="0.55"/>
        <rect x="52" y="24" width="16" height="4" fill="#FFFFFF" opacity="0.55"/>
      `;
    }
    if (p.celestialType === 'day-sun') {
      return `
        <rect x="256" y="22" width="18" height="18" fill="${p.celestialColor}" opacity="0.82"/>
        <rect x="64" y="26" width="36" height="5" fill="#FFFFFF" opacity="0.6"/>
        <rect x="184" y="34" width="28" height="4" fill="#FFFFFF" opacity="0.5"/>
      `;
    }
    // Evening / Night pixel stars + moon
    return `
      <rect x="258" y="22" width="14" height="14" fill="${p.celestialColor}" opacity="0.9"/>
      <rect x="264" y="24" width="10" height="10" fill="${p.skyTop}"/>
      <rect x="34" y="18" width="2" height="2" fill="${p.celestialColor}" opacity="0.85"/>
      <rect x="78" y="28" width="2" height="2" fill="${p.accentGlow}" opacity="0.8"/>
      <rect x="122" y="14" width="3" height="3" fill="${p.celestialColor}" opacity="0.9"/>
      <rect x="168" y="26" width="2" height="2" fill="${p.celestialColor}" opacity="0.7"/>
      <rect x="212" y="16" width="2" height="2" fill="${p.accentGlow}" opacity="0.85"/>
      <rect x="294" y="32" width="2" height="2" fill="${p.celestialColor}" opacity="0.75"/>
    `;
  }

  if (p.celestialType === 'sunrise') {
    return `
      <circle cx="1220" cy="250" r="110" fill="${p.celestialColor}" opacity="0.32"/>
      <circle cx="1220" cy="250" r="64" fill="${p.celestialColor}" opacity="0.58"/>
    `;
  }
  if (p.celestialType === 'day-sun') {
    return `
      <circle cx="1280" cy="160" r="78" fill="${p.celestialColor}" opacity="0.28"/>
      <circle cx="1280" cy="160" r="42" fill="${p.celestialColor}" opacity="0.48"/>
    `;
  }
  return `
    <circle cx="210" cy="120" r="2" fill="${p.celestialColor}" opacity="0.75"/>
    <circle cx="430" cy="88" r="2.5" fill="${p.accentGlow}" opacity="0.8"/>
    <circle cx="690" cy="144" r="1.8" fill="${p.celestialColor}" opacity="0.65"/>
    <circle cx="940" cy="96" r="2.2" fill="${p.celestialColor}" opacity="0.8"/>
    <circle cx="1140" cy="130" r="2" fill="${p.accentGlow}" opacity="0.7"/>
    <circle cx="1320" cy="150" r="34" fill="${p.celestialColor}" opacity="0.82"/>
    <circle cx="1334" cy="140" r="29" fill="${p.skyTop}"/>
  `;
}

/**
 * Generate pure SVG scene markup tailored to `sceneId` and the circadian `palette`.
 * @param {string} sceneId
 * @param {any} p
 * @returns {string}
 */
export function buildSceneSvgMarkup(sceneId, p) {
  switch (sceneId) {
    case 'pixel-cyber-bonsai':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${p.skyTop}"/>
            <stop offset="65%" stop-color="${p.skyMid}"/>
            <stop offset="100%" stop-color="${p.horizon}"/>
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill="url(#sky)"/>
        ${buildCelestialFragment(p, true)}
        <!-- Distant pixel skyline -->
        <rect x="18" y="92" width="22" height="50" fill="${p.structureMid}" opacity="0.55"/>
        <rect x="44" y="78" width="28" height="64" fill="${p.structureMid}" opacity="0.65"/>
        <rect x="76" y="98" width="18" height="44" fill="${p.structureMid}" opacity="0.5"/>
        <rect x="220" y="84" width="26" height="58" fill="${p.structureMid}" opacity="0.6"/>
        <rect x="250" y="72" width="32" height="70" fill="${p.structureMid}" opacity="0.7"/>
        <rect x="50" y="86" width="4" height="4" fill="${p.windowLit}" opacity="0.8"/>
        <rect x="60" y="96" width="4" height="4" fill="${p.windowLit}" opacity="0.8"/>
        <rect x="258" y="82" width="4" height="4" fill="${p.windowLit}" opacity="0.85"/>
        <rect x="268" y="94" width="4" height="4" fill="${p.windowLit}" opacity="0.75"/>
        <!-- Studio window sill & desk -->
        <rect x="0" y="138" width="320" height="42" fill="${p.structureDark}"/>
        <rect x="0" y="136" width="320" height="3" fill="${p.structureLight}"/>
        <!-- Retro CRT Monitor -->
        <rect x="92" y="88" width="66" height="44" fill="${p.structureMid}"/>
        <rect x="96" y="92" width="58" height="34" fill="${p.structureDark}"/>
        <rect x="100" y="97" width="28" height="3" fill="${p.accentGlow}"/>
        <rect x="100" y="103" width="42" height="2" fill="${p.accentSecondary}"/>
        <rect x="100" y="108" width="36" height="2" fill="${p.accentSecondary}"/>
        <rect x="100" y="114" width="20" height="3" fill="${p.accentPrimary}"/>
        <rect x="116" y="132" width="18" height="4" fill="${p.structureLight}"/>
        <!-- Mechanical Keyboard -->
        <rect x="96" y="144" width="58" height="10" fill="${p.structureMid}"/>
        <rect x="100" y="146" width="6" height="2" fill="${p.accentPrimary}"/>
        <rect x="108" y="146" width="34" height="2" fill="${p.windowLit}"/>
        <rect x="144" y="146" width="6" height="2" fill="${p.accentSecondary}"/>
        <!-- Pixel Cyber-Bonsai Pot & Canopy -->
        <rect x="184" y="124" width="28" height="12" fill="${p.accentPrimary}"/>
        <rect x="180" y="121" width="36" height="4" fill="${p.structureLight}"/>
        <rect x="195" y="102" width="6" height="20" fill="${p.structureMid}"/>
        <rect x="189" y="106" width="8" height="4" fill="${p.structureMid}"/>
        <rect x="199" y="96" width="10" height="4" fill="${p.structureMid}"/>
        <rect x="174" y="92" width="26" height="12" fill="${p.accentSecondary}"/>
        <rect x="186" y="82" width="32" height="12" fill="${p.accentGlow}" opacity="0.88"/>
        <rect x="200" y="90" width="26" height="10" fill="${p.accentSecondary}"/>
      </svg>`;

    case 'pixel-bit-city':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">
        <defs>
          <linearGradient id="sky2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${p.skyTop}"/>
            <stop offset="70%" stop-color="${p.skyMid}"/>
            <stop offset="100%" stop-color="${p.horizon}"/>
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill="url(#sky2)"/>
        ${buildCelestialFragment(p, true)}
        <!-- Back layer towers -->
        <rect x="12" y="76" width="34" height="104" fill="${p.structureMid}" opacity="0.6"/>
        <rect x="52" y="62" width="40" height="118" fill="${p.structureMid}" opacity="0.72"/>
        <rect x="102" y="84" width="36" height="96" fill="${p.structureMid}" opacity="0.58"/>
        <rect x="150" y="54" width="46" height="126" fill="${p.structureMid}" opacity="0.75"/>
        <rect x="206" y="72" width="38" height="108" fill="${p.structureMid}" opacity="0.65"/>
        <rect x="252" y="64" width="52" height="116" fill="${p.structureMid}" opacity="0.7"/>
        <!-- Rooftop antennas & blinking relays -->
        <rect x="70" y="42" width="2" height="20" fill="${p.structureDark}"/>
        <rect x="69" y="40" width="4" height="4" fill="${p.accentPrimary}"/>
        <rect x="170" y="32" width="3" height="22" fill="${p.structureDark}"/>
        <rect x="169" y="29" width="5" height="5" fill="${p.accentGlow}"/>
        <rect x="276" y="46" width="2" height="18" fill="${p.structureDark}"/>
        <rect x="275" y="44" width="4" height="4" fill="${p.accentPrimary}"/>
        <!-- Foreground server blocks -->
        <rect x="0" y="118" width="68" height="62" fill="${p.structureDark}"/>
        <rect x="84" y="110" width="76" height="70" fill="${p.structureDark}"/>
        <rect x="178" y="122" width="68" height="58" fill="${p.structureDark}"/>
        <rect x="258" y="106" width="62" height="74" fill="${p.structureDark}"/>
        <!-- Lit pixel windows & server LEDs -->
        <rect x="60" y="72" width="5" height="5" fill="${p.windowLit}"/>
        <rect x="72" y="72" width="5" height="5" fill="${p.windowLit}"/>
        <rect x="60" y="84" width="5" height="5" fill="${p.accentGlow}"/>
        <rect x="160" y="66" width="6" height="5" fill="${p.windowLit}"/>
        <rect x="174" y="66" width="6" height="5" fill="${p.windowLit}"/>
        <rect x="160" y="78" width="6" height="5" fill="${p.windowLit}"/>
        <rect x="174" y="90" width="6" height="5" fill="${p.accentPrimary}"/>
        <rect x="96" y="122" width="14" height="3" fill="${p.accentGlow}"/>
        <rect x="96" y="130" width="14" height="3" fill="${p.accentSecondary}"/>
        <rect x="96" y="138" width="14" height="3" fill="${p.accentPrimary}"/>
        <rect x="270" y="118" width="18" height="3" fill="${p.windowLit}"/>
        <rect x="270" y="126" width="12" height="3" fill="${p.accentGlow}"/>
      </svg>`;

    case 'pixel-arcade-lab':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">
        <rect width="320" height="180" fill="${p.skyTop}"/>
        <rect x="0" y="0" width="320" height="126" fill="${p.skyMid}" opacity="0.55"/>
        ${buildCelestialFragment(p, true)}
        <!-- Lab Pegboard Grid -->
        <rect x="28" y="24" width="96" height="64" fill="${p.structureMid}" opacity="0.45"/>
        <rect x="36" y="34" width="24" height="8" fill="${p.accentPrimary}"/>
        <rect x="66" y="34" width="24" height="8" fill="${p.accentSecondary}"/>
        <rect x="96" y="34" width="20" height="8" fill="${p.accentGlow}"/>
        <!-- Workbench -->
        <rect x="0" y="132" width="320" height="48" fill="${p.structureDark}"/>
        <rect x="0" y="129" width="320" height="4" fill="${p.structureLight}"/>
        <!-- Pixel Oscilloscope -->
        <rect x="64" y="82" width="84" height="47" fill="${p.structureMid}"/>
        <rect x="70" y="88" width="54" height="35" fill="${p.structureDark}"/>
        <rect x="74" y="104" width="8" height="3" fill="${p.accentGlow}"/>
        <rect x="82" y="96" width="8" height="3" fill="${p.accentGlow}"/>
        <rect x="90" y="112" width="8" height="3" fill="${p.accentGlow}"/>
        <rect x="98" y="94" width="8" height="3" fill="${p.accentGlow}"/>
        <rect x="106" y="104" width="14" height="3" fill="${p.accentGlow}"/>
        <rect x="130" y="92" width="10" height="8" fill="${p.accentPrimary}"/>
        <rect x="130" y="106" width="10" height="8" fill="${p.accentSecondary}"/>
        <!-- Steaming Espresso Mug -->
        <rect x="188" y="111" width="20" height="18" fill="${p.accentPrimary}"/>
        <rect x="208" y="115" width="5" height="10" fill="${p.accentPrimary}"/>
        <rect x="193" y="99" width="3" height="7" fill="${p.windowLit}" opacity="0.75"/>
        <rect x="200" y="95" width="3" height="9" fill="${p.windowLit}" opacity="0.75"/>
      </svg>`;

    case 'pixel-starship-bridge':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">
        <rect width="320" height="180" fill="${p.structureDark}"/>
        <rect x="20" y="14" width="280" height="118" fill="${p.skyTop}"/>
        ${buildCelestialFragment(p, true)}
        <!-- Pixel Ringed Planet -->
        <rect x="138" y="44" width="44" height="44" fill="${p.accentSecondary}"/>
        <rect x="144" y="50" width="32" height="10" fill="${p.accentGlow}" opacity="0.65"/>
        <rect x="112" y="64" width="96" height="6" fill="${p.accentPrimary}" opacity="0.88"/>
        <rect x="122" y="70" width="76" height="3" fill="${p.windowLit}" opacity="0.65"/>
        <!-- Viewport Struts & Console -->
        <rect x="0" y="0" width="320" height="14" fill="${p.structureMid}"/>
        <rect x="0" y="132" width="320" height="48" fill="${p.structureMid}"/>
        <rect x="0" y="14" width="20" height="118" fill="${p.structureMid}"/>
        <rect x="300" y="14" width="20" height="118" fill="${p.structureMid}"/>
        <rect x="44" y="144" width="64" height="22" fill="${p.structureDark}"/>
        <rect x="50" y="150" width="24" height="4" fill="${p.accentGlow}"/>
        <rect x="50" y="158" width="42" height="3" fill="${p.accentSecondary}"/>
        <rect x="128" y="144" width="64" height="22" fill="${p.structureDark}"/>
        <rect x="136" y="150" width="48" height="10" fill="${p.accentPrimary}" opacity="0.8"/>
        <rect x="212" y="144" width="64" height="22" fill="${p.structureDark}"/>
        <rect x="220" y="150" width="12" height="10" fill="${p.windowLit}"/>
        <rect x="238" y="150" width="12" height="10" fill="${p.accentGlow}"/>
      </svg>`;

    case 'tech-pcb-traces':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="pcbBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${p.skyTop}"/>
            <stop offset="100%" stop-color="${p.skyBottom}"/>
          </linearGradient>
          <pattern id="pcbGrid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="${p.gridLine}" stroke-width="1"/>
          </pattern>
        </defs>
        <rect width="1600" height="900" fill="url(#pcbBg)"/>
        <rect width="1600" height="900" fill="url(#pcbGrid)"/>
        ${buildCelestialFragment(p, false)}
        <!-- CPU Package Die -->
        <rect x="690" y="340" width="220" height="220" rx="18" fill="${p.structureMid}" opacity="0.22" stroke="${p.accentPrimary}" stroke-width="2.5"/>
        <rect x="730" y="380" width="140" height="140" rx="10" fill="${p.structureDark}" opacity="0.28" stroke="${p.accentSecondary}" stroke-width="2"/>
        <!-- Bus Traces -->
        <g fill="none" stroke="${p.accentSecondary}" stroke-width="3" opacity="0.55" stroke-linecap="round" stroke-linejoin="round">
          <path d="M 120 180 H 420 L 520 280 H 690"/>
          <path d="M 120 230 H 390 L 490 330 H 690"/>
          <path d="M 180 720 H 460 L 580 540 H 690"/>
          <path d="M 910 390 H 1080 L 1200 260 H 1480"/>
          <path d="M 910 450 H 1140 L 1260 570 H 1500"/>
          <path d="M 760 340 V 180 L 640 80"/>
          <path d="M 840 560 V 740 L 980 840"/>
        </g>
        <g fill="none" stroke="${p.accentPrimary}" stroke-width="2.5" opacity="0.6">
          <path d="M 240 450 H 690"/>
          <path d="M 910 510 H 1340 L 1440 410"/>
          <path d="M 800 340 V 120"/>
        </g>
        <!-- Vias -->
        <g fill="${p.skyBottom}" stroke="${p.accentGlow}" stroke-width="3">
          <circle cx="120" cy="180" r="7"/><circle cx="120" cy="230" r="7"/>
          <circle cx="180" cy="720" r="7"/><circle cx="1480" cy="260" r="7"/>
          <circle cx="1500" cy="570" r="7"/><circle cx="240" cy="450" r="7"/>
          <circle cx="800" cy="120" r="7"/><circle cx="1440" cy="410" r="7"/>
        </g>
      </svg>`;

    case 'tech-isometric-cluster':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="isoBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${p.skyTop}"/>
            <stop offset="100%" stop-color="${p.skyBottom}"/>
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#isoBg)"/>
        ${buildCelestialFragment(p, false)}
        <!-- Isometric Lattice -->
        <g stroke="${p.gridLine}" stroke-width="1.5" fill="none">
          <path d="M 200 650 L 800 320 L 1400 650 L 800 980 Z"/>
          <path d="M 350 568 L 950 898"/><path d="M 500 485 L 1100 815"/><path d="M 650 403 L 1250 733"/>
          <path d="M 1250 568 L 650 898"/><path d="M 1100 485 L 500 815"/><path d="M 950 403 L 350 733"/>
        </g>
        <!-- Isometric Compute Nodes -->
        <g opacity="0.72">
          <polygon points="800,340 890,390 800,440 710,390" fill="${p.accentGlow}"/>
          <polygon points="710,390 800,440 800,540 710,490" fill="${p.accentSecondary}"/>
          <polygon points="890,390 800,440 800,540 890,490" fill="${p.structureMid}"/>

          <polygon points="520,490 600,535 520,580 440,535" fill="${p.accentPrimary}"/>
          <polygon points="440,535 520,580 520,665 440,620" fill="${p.structureMid}"/>
          <polygon points="600,535 520,580 520,665 600,620" fill="${p.structureDark}"/>

          <polygon points="1080,490 1160,535 1080,580 1000,535" fill="${p.accentPrimary}"/>
          <polygon points="1000,535 1080,580 1080,665 1000,620" fill="${p.accentSecondary}"/>
          <polygon points="1160,535 1080,580 1080,665 1160,620" fill="${p.structureDark}"/>
        </g>
        <g stroke="${p.accentGlow}" stroke-width="3" stroke-dasharray="10 8" fill="none" opacity="0.75">
          <path d="M 600 560 L 710 470"/>
          <path d="M 890 470 L 1000 560"/>
        </g>
      </svg>`;

    case 'tech-neural-constellation':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <rect width="1600" height="900" fill="${p.skyTop}"/>
        ${buildCelestialFragment(p, false)}
        <g stroke="${p.accentSecondary}" stroke-width="1.6" opacity="0.38" fill="none">
          <path d="M 260 220 C 520 220, 540 360, 800 360"/>
          <path d="M 260 450 C 520 450, 540 360, 800 360"/>
          <path d="M 260 680 C 520 680, 540 540, 800 540"/>
          <path d="M 260 450 C 520 450, 540 540, 800 540"/>
          <path d="M 800 360 C 1060 360, 1080 280, 1340 280"/>
          <path d="M 800 360 C 1060 360, 1080 600, 1340 600"/>
          <path d="M 800 540 C 1060 540, 1080 280, 1340 280"/>
          <path d="M 800 540 C 1060 540, 1080 600, 1340 600"/>
        </g>
        <g stroke="${p.accentPrimary}" stroke-width="2.2" opacity="0.52" fill="none">
          <path d="M 260 220 C 560 260, 520 540, 800 540"/>
          <path d="M 800 360 C 1040 360, 1100 440, 1340 440"/>
        </g>
        <g fill="${p.accentGlow}" stroke="${p.structureMid}" stroke-width="3">
          <circle cx="260" cy="220" r="14"/><circle cx="260" cy="450" r="14"/><circle cx="260" cy="680" r="14"/>
          <circle cx="800" cy="360" r="18" fill="${p.accentPrimary}"/><circle cx="800" cy="540" r="18" fill="${p.accentSecondary}"/>
          <circle cx="1340" cy="280" r="14"/><circle cx="1340" cy="440" r="16" fill="${p.accentPrimary}"/><circle cx="1340" cy="600" r="14"/>
        </g>
      </svg>`;

    case 'modern-bauhaus-code':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <rect width="1600" height="900" fill="${p.skyBottom}"/>
        <g stroke="${p.gridLine}" stroke-width="1">
          <line x1="320" y1="0" x2="320" y2="900"/><line x1="988" y1="0" x2="988" y2="900"/>
          <line x1="0" y1="344" x2="1600" y2="344"/><line x1="0" y1="556" x2="1600" y2="556"/>
        </g>
        <circle cx="988" cy="344" r="212" fill="${p.accentPrimary}" opacity="0.24"/>
        <path d="M 320 556 A 212 212 0 0 1 532 344 L 532 556 Z" fill="${p.accentSecondary}" opacity="0.32"/>
        <rect x="532" y="344" width="456" height="212" fill="${p.structureMid}" opacity="0.14"/>
        <rect x="988" y="556" width="320" height="212" rx="16" fill="${p.accentGlow}" opacity="0.22"/>
        <circle cx="320" cy="344" r="44" fill="${p.celestialColor}" opacity="0.55"/>
      </svg>`;

    case 'modern-topographic-mesh':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <rect width="1600" height="900" fill="${p.skyTop}"/>
        <g fill="none" stroke="${p.accentSecondary}" stroke-width="1.8" opacity="0.36">
          <ellipse cx="420" cy="520" rx="520" ry="290" transform="rotate(-12 420 520)"/>
          <ellipse cx="420" cy="520" rx="410" ry="220" transform="rotate(-12 420 520)"/>
          <ellipse cx="420" cy="520" rx="300" ry="155" transform="rotate(-12 420 520)"/>
          <ellipse cx="420" cy="520" rx="180" ry="92" transform="rotate(-12 420 520)"/>
          <ellipse cx="1220" cy="340" rx="460" ry="250" transform="rotate(14 1220 340)"/>
          <ellipse cx="1220" cy="340" rx="340" ry="180" transform="rotate(14 1220 340)"/>
          <ellipse cx="1220" cy="340" rx="220" ry="114" transform="rotate(14 1220 340)"/>
        </g>
        <g stroke="${p.accentPrimary}" stroke-width="1.5" opacity="0.45">
          <line x1="1200" y1="340" x2="1240" y2="340"/><line x1="1220" y1="320" x2="1220" y2="360"/>
          <line x1="400" y1="520" x2="440" y2="520"/><line x1="420" y1="500" x2="420" y2="540"/>
        </g>
      </svg>`;

    case 'modern-glass-prism':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="glowA" cx="25%" cy="25%" r="55%">
            <stop offset="0%" stop-color="${p.accentGlow}" stop-opacity="0.42"/>
            <stop offset="100%" stop-color="${p.skyTop}" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="glowB" cx="80%" cy="75%" r="55%">
            <stop offset="0%" stop-color="${p.accentPrimary}" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="${p.skyBottom}" stop-opacity="0"/>
          </radialGradient>
          <pattern id="dots" width="36" height="36" patternUnits="userSpaceOnUse">
            <circle cx="18" cy="18" r="1.6" fill="${p.structureMid}" opacity="0.35"/>
          </pattern>
        </defs>
        <rect width="1600" height="900" fill="${p.skyBottom}"/>
        <rect width="1600" height="900" fill="url(#glowA)"/>
        <rect width="1600" height="900" fill="url(#glowB)"/>
        <rect width="1600" height="900" fill="url(#dots)"/>
      </svg>`;

    case 'retro-amber-terminal':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="crtSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${p.skyTop}"/>
            <stop offset="56%" stop-color="${p.horizon}"/>
            <stop offset="57%" stop-color="${p.structureDark}"/>
            <stop offset="100%" stop-color="${p.skyBottom}"/>
          </linearGradient>
          <pattern id="scan" width="8" height="6" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="8" y2="0" stroke="${p.structureDark}" stroke-width="1" opacity="0.16"/>
          </pattern>
        </defs>
        <rect width="1600" height="900" fill="url(#crtSky)"/>
        <circle cx="800" cy="508" r="150" fill="${p.celestialColor}" opacity="0.55"/>
        <!-- Perspective Synth Horizon -->
        <g stroke="${p.accentPrimary}" stroke-width="1.6" opacity="0.52">
          <line x1="0" y1="512" x2="1600" y2="512"/>
          <line x1="0" y1="555" x2="1600" y2="555"/>
          <line x1="0" y1="615" x2="1600" y2="615"/>
          <line x1="0" y1="695" x2="1600" y2="695"/>
          <line x1="0" y1="800" x2="1600" y2="800"/>
          <line x1="800" y1="512" x2="0" y2="900"/>
          <line x1="800" y1="512" x2="320" y2="900"/>
          <line x1="800" y1="512" x2="640" y2="900"/>
          <line x1="800" y1="512" x2="960" y2="900"/>
          <line x1="800" y1="512" x2="1280" y2="900"/>
          <line x1="800" y1="512" x2="1600" y2="900"/>
        </g>
        <rect width="1600" height="900" fill="url(#scan)"/>
      </svg>`;

    case 'space-orbital-telemetry':
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <rect width="1600" height="900" fill="${p.skyTop}"/>
        ${buildCelestialFragment(p, false)}
        <g fill="none" stroke="${p.accentSecondary}" stroke-width="1.6" opacity="0.45">
          <ellipse cx="800" cy="450" rx="620" ry="240" transform="rotate(-14 800 450)"/>
          <ellipse cx="800" cy="450" rx="440" ry="170" transform="rotate(-14 800 450)" stroke-dasharray="12 8"/>
          <ellipse cx="800" cy="450" rx="250" ry="96" transform="rotate(-14 800 450)"/>
        </g>
        <circle cx="800" cy="450" r="54" fill="${p.accentPrimary}" opacity="0.65"/>
        <circle cx="1210" cy="350" r="16" fill="${p.accentGlow}" opacity="0.85"/>
        <circle cx="385" cy="552" r="11" fill="${p.celestialColor}" opacity="0.85"/>
      </svg>`;
  }
}

/**
 * Encode an SVG markup string safely into a `data:image/svg+xml;charset=utf-8,...` URI.
 * @param {string} svgMarkup
 * @returns {string}
 */
export function encodeSvgDataUri(svgMarkup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup.trim())}`;
}

/**
 * Resolve the active wallpaper descriptor for the current calendar date, time of day,
 * and user configuration (`state.background`).
 *
 * @param {any} bgSettings
 * @param {Date} [now]
 * @param {'auto' | 'morning' | 'deep-work' | 'evening'} [wellnessMoodOverride='auto']
 */
export function resolveActiveBackground(bgSettings = {}, now = new Date(), wellnessMoodOverride = 'auto') {
  const mode = typeof bgSettings?.mode === 'string' ? bgSettings.mode : 'daily-random';
  const timeMood = resolveBackgroundTimeMood(now, bgSettings?.moodSync || 'auto', wellnessMoodOverride);
  const palette = CIRCADIAN_BG_PALETTES[timeMood] || CIRCADIAN_BG_PALETTES.morning;

  const rawOpacity = Number(bgSettings?.opacity);
  const opacity = Number.isFinite(rawOpacity) ? Math.min(0.92, Math.max(0.08, rawOpacity)) : 0.42;
  const rawBlur = Number(bgSettings?.blurPx);
  const blurPx = Number.isFinite(rawBlur) ? Math.min(20, Math.max(0, Math.round(rawBlur))) : 0;
  const glassCards = bgSettings?.glassCards !== false;

  if (mode === 'off') {
    return {
      enabled: false,
      mode: 'off',
      dateKey: formatBgDateKey(now),
      timeMood,
      timeMoodLabel: palette.label,
      palette,
      item: null,
      imageUri: '',
      isPixelArt: false,
      opacity,
      blurPx,
      glassCards: false
    };
  }

  const customImages = Array.isArray(bgSettings?.customImages) ? bgSettings.customImages : [];
  const enabledCats = Array.isArray(bgSettings?.categories) && bgSettings.categories.length > 0
    ? new Set(bgSettings.categories)
    : new Set(BACKGROUND_CATEGORIES.map((c) => c.id));

  const dateKey = formatBgDateKey(now);
  const nonce = Number.isFinite(bgSettings?.shuffleNonce) ? Math.floor(bgSettings.shuffleNonce) : 0;
  const dailyHash = computeDailySeedHash(`${dateKey}#${nonce}`);

  let selected = null;

  if (mode === 'pinned') {
    const targetId = bgSettings?.pinnedId || 'pixel-cyber-bonsai';
    selected = BACKGROUND_PACK.find((s) => s.id === targetId)
      || customImages.find((c) => c.id === targetId)
      || BACKGROUND_PACK[0];
  } else if (mode === 'custom-only') {
    if (customImages.length > 0) {
      selected = customImages[dailyHash % customImages.length];
    } else {
      selected = BACKGROUND_PACK[dailyHash % BACKGROUND_PACK.length];
    }
  } else {
    // 'daily-random': build candidate pool from enabled built-in categories + custom images
    const builtInPool = BACKGROUND_PACK.filter((scene) => enabledCats.has(scene.category));
    const pool = [...builtInPool, ...customImages];
    const effectivePool = pool.length > 0 ? pool : BACKGROUND_PACK;
    selected = effectivePool[dailyHash % effectivePool.length];
  }

  const isCustomUrl = Boolean(selected?.url && !BACKGROUND_PACK.some((b) => b.id === selected.id));
  const svgMarkup = isCustomUrl ? '' : buildSceneSvgMarkup(selected.id, palette);
  const imageUri = isCustomUrl ? selected.url : encodeSvgDataUri(svgMarkup);

  return {
    enabled: true,
    mode,
    dateKey,
    timeMood,
    timeMoodLabel: palette.label,
    palette,
    item: selected,
    imageUri,
    svgMarkup,
    isCustomUrl,
    isPixelArt: Boolean(selected?.isPixelArt),
    opacity,
    blurPx,
    glassCards
  };
}

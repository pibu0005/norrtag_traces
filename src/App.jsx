import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent } from 'framer-motion'
import './App.css'
import plusIcon from './assets/plus.svg'
import leaveIcon from './assets/leave.svg'
import imgMidsommar from './assets/img/midsommar.png'
import imgBand from './assets/img/band.png'
import imgGoahti from './assets/img/goahti.png'
import imgTrain1 from './assets/img/train1.png'
import imgTrain2 from './assets/img/train2.png'
import imgTrain3 from './assets/img/train3.png'
import imgHelena from './assets/img/helena.png'
import imgAudio1 from './assets/img/audio1.png'
import imgAudio2 from './assets/img/audio2.png'
import imgAudio3 from './assets/img/audio3.png'
import symTravellerText from './assets/img/traces_symbols/traveller_text.png'
import symTravellerImage from './assets/img/traces_symbols/traveller_image.png'
import symTravellerAudio from './assets/img/traces_symbols/traveller_audio.png'
import symPartnerText from './assets/img/traces_symbols/partner_text.png'
import symPartnerImage from './assets/img/traces_symbols/partner_image.png'
import symPartnerAudio from './assets/img/traces_symbols/partner_audio.png'
import symPartnerCoupon from './assets/img/traces_symbols/partner_coupon.png'

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

const parseTraceDate = (value) => {
  if (!value) return new Date()
  if (value instanceof Date) return value
  if (typeof value !== 'string') return new Date()

  // Accept ISO strings directly.
  if (value.includes('T')) {
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d : new Date()
  }

  // Accept "DD.MM.YY" or "DD.MM.YYYY".
  const m = value.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2])
    const y = Number(m[3])
    const year = m[3].length === 2 ? 2000 + y : y
    const d = new Date(Date.UTC(year, month - 1, day))
    return Number.isFinite(d.getTime()) ? d : new Date()
  }

  // Fallback: try Date parsing, then default.
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : new Date()
}

const traceTypeSymbol = (type, origin) => {
  const o = String(origin ?? '').toLowerCase()
  const isPartner = o === 'partner' || o.startsWith('partner')
  const t = String(type ?? '').toLowerCase()

  if (isPartner) {
    if (t === 'image') return symPartnerImage
    if (t === 'audio') return symPartnerAudio
    if (t === 'coupon') return symPartnerCoupon
    return symPartnerText
  }

  if (t === 'image') return symTravellerImage
  if (t === 'audio') return symTravellerAudio
  return symTravellerText
}

/**
 * A honeycomb coordinate system (axial hex coords) mapped to pixels.
 * This gives the Apple Watch-like staggered grid with consistent neighbor spacing.
 */
// Spacing between bubble centers (tuned so neighbors don't overlap at max scale).
const GRID_X_STEP = 140
const AXIAL_SIZE = GRID_X_STEP / Math.sqrt(3)
const axialToPx = (q, r) => ({
  x: Math.sqrt(3) * AXIAL_SIZE * (q + r / 2),
  y: 1.5 * AXIAL_SIZE * r,
})
const axialDistance = (q, r) =>
  Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r))

const BUBBLE_SIZE = 104
const TRACE_JITTER_PX = 0
const TRACE_PLACES = ['train', 'museum']

const FIXED_PLACE = 'Gammlia Friluftmuseum'
const FIXED_TRAIN_PLACE = 'Norrtag  7104'

const AXIAL_DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

const CONTEXT_FOCUS_TWEAKS = {
  DISPLACE_DELAY_MS: 140,
  SETTLE_DELAY_MS: 70,
  PUSH_NUDGE_PX: 22,
  FOCUS_NUDGE_PX: 16,
  RAY_SEARCH_STEPS: 10,
}

const CONTEXTUAL_TRACE_CUES = {
  museum: {
    triggerId: 't9',
    resetId: 't36',
    sequence: [
      { traceId: 't39', anchorId: 't10' },
      { traceId: 't30', anchorId: 't6' },
      { traceId: 't33', anchorId: 't34' },
    ],
    firstDelayMs: 2000,
    stepDelayMs: 1000,
    affectAll: true,
    // Keep the whole field floating until the *last* contextual trace arrives.
    holdFloatingUntilEnd: true,
  },
  train: {
    triggerId: 't11',
    sequence: [
      { traceId: 't2', anchorId: 't1' },
      { traceId: 't7', anchorId: 't18' }
      
    ],
    firstDelayMs: 2000,
    stepDelayMs: 5000,
    affectAll: true,
  },
}

// Opacity falloff by "circle"/ring around the current focused trace.
// 0 = focused trace, 1 = first ring, 2 = second ring, 3 = third ring.
// Larger rings (4+) use the last value.
const RING_OPACITY_MULT = [1, 0.5, 0.3, 0.2, 0.1]

// Motion tuning constants (make the system feel "physical").
const SLOT_SPRING = {
  type: 'spring',
  stiffness: 180,
  damping: 58,
  mass: 1.25,
}

const BUBBLE_SPRING = {
  type: 'spring',
  stiffness: 170,
  damping: 56,
  mass: 1.25,
}

const PAN_SNAP_SPRING = {
  type: 'spring',
  stiffness: 520,
  damping: 52,
  mass: 0.8,
}

const CARD_STACK_ANIM = {
  DURATION: 0.44,
  EASE: [0.22, 1, 0.36, 1],
  OUTGOING_X: -0,
  OUTGOING_Y: -0,
  OUTGOING_ROTATE: -0,
  STACK_OFFSET_Y: 12,
  STACK_ROTATE: 5,
  MIDDLE_SCALE: 0.985,
  BOTTOM_SCALE: 0.955,
  BOTTOM_FADE_DELAY: 0,
  CONTENT_FADE_DURATION: 0.7,
  CONTENT_FADE_DELAY: 0.08,
  CONTENT_FADE_Y: 2,
  CONTENT_FADE_EASE: [0.16, 1, 0.3, 1],
}

const RESLOT_ANIM = {
  // Phase 1 (fluid): traces float freely, repel, and drift toward targets.
  FLUID_MS: 1100,
  // Phase 2 (settle): after fluid motion, lock cleanly back into slots.
  SETTLE_MS: 820,

  // Physics-ish parameters (tweak to taste).
  REPULSE: 0.18,
  ATTRACT: 0.01,
  ATTRACT_FOCUSED: 0.018,
  DAMPING: 0.82,
  MAX_SPEED: 11,
  MIN_DIST: BUBBLE_SIZE * 1.22,
  NEIGHBOR_CUTOFF: GRID_X_STEP * 2.8,

  // Subtle drift to avoid "UI-perfect" straight lines (keep tiny).
  DRIFT: 0.08,
}

const axialKey = (q, r) => `${q},${r}`
const axialMul = (a, k) => ({ q: a.q * k, r: a.r * k })
const axialAdd = (a, b) => ({ q: a.q + b.q, r: a.r + b.r })
const axialSub = (a, b) => ({ q: a.q - b.q, r: a.r - b.r })

const hashString = (s) => {
  // Small deterministic hash for stable per-trace shades.
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const traceJitter = (id) => {
  const h = hashString(id)
  const angle = ((h % 360) / 360) * Math.PI * 2
  const amount = (((h >>> 9) % 1000) / 1000) * TRACE_JITTER_PX
  return {
    x: Math.cos(angle) * amount,
    y: Math.sin(angle) * amount,
  }
}

const ringCoords = (radius) => {
  const out = []
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (axialDistance(q, r) !== radius) continue
      out.push({ q, r })
    }
  }
  // Stable order helps the "magnetic fill" feel consistent.
  out.sort((a, b) => a.r - b.r || a.q - b.q)
  return out
}

const ringCoordsAt = (center, radius) =>
  ringCoords(radius).map((o) => axialAdd(center, o))

function generateHoneycombCoords(count, maxRadius = 6) {
  const coords = []

  for (let r = -maxRadius; r <= maxRadius; r++) {
    for (let q = -maxRadius; q <= maxRadius; q++) {
      const dist = axialDistance(q, r)
      if (dist > maxRadius) continue
      const p = axialToPx(q, r)
      coords.push({ q, r, dist, angle: Math.atan2(p.y, p.x) })
    }
  }

  // Closest-to-center first, then spiral around by angle.
  coords.sort((a, b) => a.dist - b.dist || a.angle - b.angle)
  return coords.slice(0, count)
}

const packTracesIntoCenterSlots = (traces) => {
  const coords = generateHoneycombCoords(traces.length, 6)

  return traces.map((t, idx) => {
    const c = coords[idx]
    const p = axialToPx(c.q, c.r)
    return {
      ...t,
      relevanceRank: c.dist + 1,
      gridX: c.q,
      gridY: c.r,
      px: p.x + t.jitterX,
      py: p.y + t.jitterY,
    }
  })
}

function buildTraces() {

  // Trace content library (edit these directly).
  // Format matches:
  // {
  //   id: 't1',
  //   quote: '...',
  //   date: '12.05.22',
  // }
  const TRACE_LIBRARY = [
    {
      id: 't1',
      name: 'Yadu',
      quote:
        'First place on the trip that actually felt far away from home. The air smelled like wet wood and old paint, and for once I stopped checking the time.',
      date: '11.03.26',
      type: 'image',
      mediaSrc: imgTrain1,
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't2',
      name: 'Elisa',
      quote:
        'We hit a stretch of pale birch and sudden open water. For one clean minute the whole carriage looked up, like the view had asked for silence.',
      date: '14.02.28',
      type: 'image',
      mediaSrc: imgTrain2,
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't3',
      name: 'Jonas',
      quote:
        'The station was almost empty except for one person playing music. It wasn’t loud, just steady, like a private soundtrack for whoever bothered to arrive early.',
      date: '21.07.28',
      type: 'image',
      mediaSrc: imgTrain3,
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't4',
      name: 'Elin',
      quote:
        'With kids, I can really recommend the old farm area. Ours spent almost an hour just running between the wooden houses, looking at the animals, and peeking into all the tiny buildings. It felt much more alive and playful than we expected from a museum.',
      date: '18.09.26',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't5',
      name: 'Noah',
      quote:
        'The lake was completely still when we arrived. It looked staged, as if someone had arranged the surface to hold the sky without spilling.',
      date: '20.06.27',
      type: 'image',
      mediaSrc: imgMidsommar,
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't6',
      name: 'Hugo',
      quote:
        'A low roof, a dark doorway, and then the smell of smoke that seemed older than the building itself. It followed me back into the daylight.',
      date: '18.06.29',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't7',
      name: 'Norrtåg',
      quote:
        'Audio: next stop in a few minutes. If you look right now, the river bends back on itself and the roofs start to thin out.',
      date: '19.08.25',
      type: 'audio',
      mediaSrc: imgAudio1,
      place: 'train',
      origin: 'partner',
    },
    {
      id: 't8',
      name: 'Sanna',
      quote:
        'A thin line of sunlight slid under the clouds and turned the snow pink for a moment. The whole carriage felt like it was holding its breath.',
      date: '03.03.27',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't9',
      name: 'Västerbotten museum',
      quote:
        'A traditional Sámi shelter designed to withstand the harsh climate of northern Scandinavia.',
      date: '25.02.28',
      type: 'coupon',
      place: 'museum',
      origin: 'partner',
    },
    {
      id: 't10',
      name: 'Västerbotten museum',
      quote:
        'Originally built in the countryside around Umeå, this church was later moved to Gammlia to preserve its history.',
      date: '08.03.28',
      type: 'audio',
      mediaSrc: imgHelena,
      place: 'museum',
      origin: 'partner',
    },
    {
      id: 't11',
      name: 'Norrtåg',
      quote:
        'Coupon: show this in the café car for a free coffee refill. It’s small, but it makes the long stretch between stops feel lighter.',
      date: '03.11.26',
      type: 'coupon',
      place: 'train',
      origin: 'partner',
    },
    {
      id: 't12',
      name: 'Alma',
      quote:
        'I kept watching the reflection in the window, half my face and half forest moving in the same direction. It made the journey feel strangely doubled.',
      date: '18.06.25',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't13',
      name: 'Elias',
      quote:
        'Someone opened a thermos and the smell of coffee made the whole row feel less like strangers.',
      date: '27.04.29',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't14',
      name: 'Sofia',
      quote:
        'The train slowed near the water, and for a few seconds the lake seemed to be travelling beside us. Then the trees closed again and the view became a rumor.',
      date: '28.09.27',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't15',
      name: 'Leo',
      quote:
        'A child counted every red house from the seat behind me, then lost track and started laughing.',
      date: '09.08.26',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't16',
      name: 'Freja',
      quote:
        'The conductor said the next stop softly, as if naming a place could disturb the snow outside.',
      date: '11.01.29',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't17',
      name: 'Theo',
      quote:
        'My phone lost signal and the map disappeared, which made the window feel suddenly more useful. I started naming places by color instead of coordinates.',
      date: '20.11.28',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't18',
      name: 'Norrtåg',
      quote:
        'Audio: look out to the left—water and forest trade places here. The land is still lifting itself up, slowly, like it remembers the ice.',
      date: '07.04.28',
      type: 'audio',
      mediaSrc: imgAudio2,
      place: 'train',
      origin: 'partner',
    },
    {
      id: 't19',
      name: 'Arvid',
      quote:
        'The rails clicked in a rhythm I stopped hearing after a while, until the silence at the stop felt huge.',
      date: '03.12.29',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't20',
      name: 'Iris',
      quote:
        'A woman across the aisle folded her scarf into a pillow and slept through the prettiest part.',
      date: '04.10.29',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't21',
      name: 'Vera',
      quote:
        'The sky changed color behind the pines, slow enough that nobody noticed until it was already evening. The whole carriage seemed to dim with it.',
      date: '23.11.25',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't22',
      name: 'Otto',
      quote:
        'At the platform, everyone moved at once, then settled into the carriage like water finding shape.',
      date: '14.01.26',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't23',
      name: 'Lina',
      quote:
        'The seat fabric was worn smooth at the window edge, polished by years of elbows and waiting. I liked touching that small history more than I expected.',
      date: '05.03.27',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't24',
      name: 'Elsa',
      quote:
        'We crossed a bridge just as the sun hit the river, and the whole carriage turned briefly gold.',
      date: '11.03.25',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't25',
      name: 'Isak',
      quote:
        'Someone had drawn a tiny heart in the fog on the glass, and it survived three stations. By the fourth, it had blurred into something almost like a map.',
      date: '02.05.26',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't26',
      name: 'Tilda',
      quote:
        'The landscape kept opening and closing: forest, house, field, water, forest again.',
      date: '21.06.27',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't27',
      name: 'Axel',
      quote:
        'I almost missed my stop because the window had become more interesting than the destination. The announcement arrived like someone interrupting a thought.',
      date: '12.08.28',
      type: 'text',
      place: 'train',
      origin: 'travellers',
    },
    {
      id: 't28',
      name: 'Ella',
      quote:
        'Came here by accident. Returned intentionally. The second time, the streets felt like they were waiting for me to remember the good parts.',
      date: '27.07.26',
      type: 'image',
      mediaSrc: imgBand,
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't29',
      name: 'Klara',
      quote:
        'A path between the buildings curved just enough to make the next doorway feel like a small reveal.',
      date: '09.10.27',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't30',
      name: 'Västerbotten museum',
      quote:
        'A traditional Sámi shelter designed to withstand the harsh climate of northern Scandinavia.',
      date: '25.02.28',
      type: 'audio',
      mediaSrc: imgAudio3,
      place: 'museum',
      origin: 'partner',
    },
    {
      id: 't31',
      name: 'Phil',
      quote:
        'The grass was still wet around the benches, and my shoes carried the park with me for an hour.',
      date: '04.07.27',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't32',
      name: 'Maya',
      quote:
        'I liked the windows most, their uneven glass bending the trees into something almost painted. The outside world looked handmade through them.',
      date: '12.05.26',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't33',
      name: 'Ida',
      quote:
        'My grandmother grew up in a Sámi family further north, and seeing the inside of the Goahti reminded me of the stories she used to tell us as kids.',
      date: '21.04.25',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't34',
      name: 'Ella',
      quote:
        'The outdoor paths made history feel less like a timeline and more like something you could walk around. Each turn changed the scale of the story.',
      date: '02.02.29',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't35',
      name: 'Noah',
      quote:
        'A child ran ahead to the next building, then stopped at the threshold like the room had asked politely.',
      date: '11.12.28',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't36',
      name: 'Lea',
      quote:
        'The painted door had faded unevenly, and somehow that made it feel more present than restored things do. Its worn edge felt like a handprint left by time.',
      date: '19.11.27',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't37',
      name: 'Oskar',
      quote:
        'We sat near the fence while wind moved through the birches, making the whole park sound occupied.',
      date: '28.09.26',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't38',
      name: 'Ava',
      quote:
        'The exhibition label was short, but it opened a whole life in the space between two sentences. I read it twice and still felt there was more behind it.',
      date: '09.08.25',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't39',
      name: 'Mark',
      quote:
        'This former holding prison once detained travelers, workers, and locals passing through the region.',
      date: '09.10.28',
      type: 'image',
      mediaSrc: imgGoahti,
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't40',
      name: 'Nora',
      quote:
        'The park was quiet enough that every footstep on the gravel felt like it belonged in the display.',
      date: '27.08.26',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't41',
      name: 'Liam',
      quote:
        'I kept circling back to the same window, not for the view, but for the way it held the afternoon light. It made the room feel briefly inhabited again.',
      date: '18.10.27',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't42',
      name: 'Alma',
      quote:
        'The old tools were arranged neatly, but the scratches on them were the part that felt alive.',
      date: '17.05.29',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't43',
      name: 'Elias',
      quote:
        'A bench outside the main path became the best part, because nothing there was asking to be seen. Sitting there made the museum feel less arranged.',
      date: '08.07.25',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't44',
      name: 'Sofia',
      quote:
        'The courtyard felt staged at first, then softened when someone laughed from behind the next house.',
      date: '20.03.25',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
    {
      id: 't45',
      name: 'Leo',
      quote:
        'I left with one detail I did not expect to keep: the sound of wind moving under an old wooden eave. It was quieter than a memory, but it stayed.',
      date: '11.05.26',
      type: 'text',
      place: 'museum',
      origin: 'travellers',
    },
  ]

  const coords = generateHoneycombCoords(TRACE_LIBRARY.length, 6)

  return TRACE_LIBRARY.map((t, idx) => {
    const c = coords[idx]
    const p = axialToPx(c.q, c.r)
    const jitter = traceJitter(t.id)
    return {
      ...t,
      subtitle: undefined,
      relevanceRank: c.dist + 1,
      gridX: c.q,
      gridY: c.r,
      jitterX: jitter.x,
      jitterY: jitter.y,
      px: p.x + jitter.x,
      py: p.y + jitter.y,
    }
  })
}

function App() {
  const allTraces = useMemo(() => buildTraces(), [])
  const [activeTracePlace, setActiveTracePlace] = useState('train')
  const traces = useMemo(() => {
    const filtered = allTraces.filter((t) => t.place === activeTracePlace)
    return packTracesIntoCenterSlots(filtered)
  }, [activeTracePlace, allTraces])
  const traceById = useMemo(
    () => new Map(traces.map((t) => [t.id, t])),
    [traces],
  )

  // Each trace lives in a "slot" on the honeycomb surface (axial coords).
  // We keep this as state so we can re-arrange slots with animations (context focus).
  const [slotById, setSlotById] = useState(() => {
    return new Map(traces.map((t) => [t.id, { q: t.gridX, r: t.gridY }]))
  })
  const slotByIdRef = useRef(slotById)

  useEffect(() => {
    slotByIdRef.current = slotById
  }, [slotById])

  // Temporary per-trace nudges used to create a physical "make room" feeling.
  const [nudgeById, setNudgeById] = useState(() => new Map())
  const nudgeByIdRef = useRef(nudgeById)
  useEffect(() => {
    nudgeByIdRef.current = nudgeById
  }, [nudgeById])
  const [reslotPhase, setReslotPhase] = useState('idle') // 'idle' | 'fluid' | 'settle'
  const isReslotting = reslotPhase !== 'idle'
  const isFluidPhase = reslotPhase === 'fluid'
  const fluidRafRef = useRef(0)

  const tracesWithPos = useMemo(() => {
    return traces.map((t) => {
      const slot = slotById.get(t.id) ?? { q: t.gridX, r: t.gridY }
      const p = axialToPx(slot.q, slot.r)
      return {
        ...t,
        gridX: slot.q,
        gridY: slot.r,
        px: p.x + t.jitterX,
        py: p.y + t.jitterY,
      }
    })
  }, [slotById, traces])

  // Grid offset (the whole surface moves; bubbles do NOT drag individually).
  const panX = useMotionValue(0)
  const panY = useMotionValue(0)

  // We mirror motion values into React state (throttled to rAF) so we can
  // compute distance-based scale/opacity cheaply for all bubbles.
  const [renderPan, setRenderPan] = useState({ x: 0, y: 0 })
  const rafRef = useRef(0)
  const nextPanRef = useRef({ x: 0, y: 0 })

  // While snapping, we "lock" the focused trace so it doesn't flicker as
  // other bubbles pass near the slot during the spring.
  const [lockedId, setLockedId] = useState(traces[0]?.id ?? null)
  const [isSnapping, setIsSnapping] = useState(false)
  const snapAnimationsRef = useRef([])

  const phoneRef = useRef(null)
  const [phoneSize, setPhoneSize] = useState({ w: 390, h: 844 })
  const [stageScale, setStageScale] = useState(1)

  const slot = useMemo(() => {
    return {
      x: phoneSize.w * 0.5,
      y: phoneSize.h * 0.69,
    }
  }, [phoneSize.w, phoneSize.h])

  useLayoutEffect(() => {
    const el = phoneRef.current
    if (!el) return

    const measure = () => {
      const r = el.getBoundingClientRect()
      setPhoneSize({ w: r.width, h: r.height })

      // Keep JS math in sync with the CSS visual scaling applied via --trace-stage-scale.
      // This ensures the focused bubble stays pinned to the inspection slot even when
      // the stage is visually scaled (e.g. 0.7).
      const s = window.getComputedStyle(el).getPropertyValue('--trace-stage-scale').trim()
      const n = Number.parseFloat(s)
      setStageScale(Number.isFinite(n) && n > 0 ? n : 1)
    }

    measure()

    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Ensure we start with a centered surface (first trace in the slot).
  useEffect(() => {
    if (!traces.length) return
    // Use the initial (static) positions so contextual re-layouts don't re-center the pan.
    panX.set(-traces[0].px)
    panY.set(-traces[0].py)
    nextPanRef.current = { x: panX.get(), y: panY.get() }
    setRenderPan({ ...nextPanRef.current })
    setLockedId(traces[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traces])

  const requestRenderPan = () => {
    if (rafRef.current) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      setRenderPan({ ...nextPanRef.current })
    })
  }

  useMotionValueEvent(panX, 'change', (latest) => {
    nextPanRef.current.x = latest
    requestRenderPan()
  })
  useMotionValueEvent(panY, 'change', (latest) => {
    nextPanRef.current.y = latest
    requestRenderPan()
  })

  const closestId = useMemo(() => {
    if (!tracesWithPos.length) return null

    // Because each bubble's position is defined as:
    //   screenPosition = slotPosition + (bubbleLocalPosition + panOffset)
    // the distance from a bubble to the slot is simply:
    //   distance = |bubbleLocalPosition + panOffset|
    //
    // This makes "closest bubble" calculation independent of screen size.
    let bestId = tracesWithPos[0].id
    let bestD2 = Number.POSITIVE_INFINITY

    for (const t of tracesWithPos) {
      // NOTE: The stage can be visually scaled (CSS transform) while pan remains 1:1.
      // Distances must be computed in screen space: pan + (scale * localPos).
      const dx = renderPan.x + stageScale * t.px
      const dy = renderPan.y + stageScale * t.py
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        bestId = t.id
      }
    }

    return bestId
  }, [renderPan.x, renderPan.y, stageScale, tracesWithPos])

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      if (fluidRafRef.current) window.cancelAnimationFrame(fluidRafRef.current)
    }
  }, [])

  const stopSnapAnimations = () => {
    for (const a of snapAnimationsRef.current) a?.stop?.()
    snapAnimationsRef.current = []
  }

  const stopFluidPhase = useCallback(() => {
    if (fluidRafRef.current) {
      window.cancelAnimationFrame(fluidRafRef.current)
      fluidRafRef.current = 0
    }
    setReslotPhase('idle')
    // Clear any remaining offsets (bubbles will spring back via BUBBLE_SPRING).
    setNudgeById(new Map())
  }, [])

  const snapToClosest = () => {
    if (!tracesWithPos.length) return
    stopSnapAnimations()

    // 1) Find the closest bubble to the inspection slot.
    // 2) Compute the offset that would bring it exactly into the slot.
    // 3) Spring-animate the grid motion values to that offset.
    let best = tracesWithPos[0]
    let bestD2 = Number.POSITIVE_INFINITY
    const currentX = panX.get()
    const currentY = panY.get()

    for (const t of tracesWithPos) {
      const dx = currentX + stageScale * t.px
      const dy = currentY + stageScale * t.py
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        best = t
      }
    }

    // Snap in screen space: pan + (scale * localPos) == 0.
    const targetX = -stageScale * best.px
    const targetY = -stageScale * best.py

    setIsSnapping(true)
    setLockedId(best.id)

    const ax = animate(panX, targetX, {
      ...PAN_SNAP_SPRING,
    })
    const ay = animate(panY, targetY, {
      ...PAN_SNAP_SPRING,
    })

    snapAnimationsRef.current = [ax, ay]

    Promise.all([ax.finished, ay.finished])
      .catch(() => {})
      .finally(() => {
        // Once snapping finishes, resume "closest bubble" tracking.
        setIsSnapping(false)
      })
  }

  const activeId = isSnapping ? lockedId : closestId
  const active = activeId ? traceById.get(activeId) : null
  const quote = active?.quote ?? ''
  const quoteTitle = active?.name ?? FIXED_PLACE
  const quoteDate = useMemo(() => {
    // Mirrors the reference card style (weekday, month day).
    const d = parseTraceDate(active?.date)
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(d)
  }, [active])

  const topTitle = activeTracePlace === 'train' ? FIXED_TRAIN_PLACE : FIXED_PLACE
  const topSubheader = `${traces.length} traces`

  const MAX_INFLUENCE = GRID_X_STEP * 3.25 * stageScale

  // The "circle" system is relative to whichever trace is currently focused.
  const renderCenterSlot = useMemo(() => {
    if (!activeId) return { q: 0, r: 0 }
    const s = slotById.get(activeId)
    if (s) return s
    const t = traceById.get(activeId)
    return t ? { q: t.gridX, r: t.gridY } : { q: 0, r: 0 }
  }, [activeId, slotById, traceById])

  /**
   * Contextual focus: "swim" a trace toward the inspection slot neighborhood.
   *
   * The trick:
   * - We treat axial coords as "slots" on the honeycomb surface.
   * - The inner ring (distance=1 around the inspection slot) stays stable.
   * - We target a slot in the *second ring* (distance=2), so the cluster close to
   *   the inspection area feels anchored.
   * - First, we push a column of traces outward (starting at distance=2) to open
   *   a hole in that ring.
   * - Then we move the focused trace into that hole.
   * - Finally, we apply a "magnetic backfill": if any distance=2 slot becomes empty
   *   (e.g. the focused trace moved out of it), the closest distance=3+ trace
   *   pulls inward to fill it.
   * - During the move, we apply short-lived "nudges" to give a soft collision /
   *   space-making feeling (everything is still spring-driven).
   */
  const focusTimersRef = useRef([])
  const clearFocusTimers = () => {
    for (const id of focusTimersRef.current) window.clearTimeout(id)
    focusTimersRef.current = []
  }

  useEffect(() => {
    return () => clearFocusTimers()
  }, [])

  const focusTrace = useCallback((traceId) => {
    const t = traceById.get(traceId)
    if (!t) return

    clearFocusTimers()
    stopFluidPhase()

    const currentSlots = slotByIdRef.current
    const centerId = activeId
    const centerTrace = centerId ? traceById.get(centerId) : null
    const centerSlot =
      (centerId && currentSlots.get(centerId)) ||
      (centerTrace ? { q: centerTrace.gridX, r: centerTrace.gridY } : { q: 0, r: 0 })

    const current = currentSlots.get(traceId) ?? { q: t.gridX, r: t.gridY }
    const rel = axialSub(current, centerSlot)
    const currentPx = axialToPx(rel.q, rel.r)

    // Pick a direction around the inspection slot in the direction the trace
    // is "coming from" (based on angle from origin). We use one of the 6 axial
    // directions so we can open a clean "column" and let outer rings collapse inward.
    const angle = Math.atan2(currentPx.y, currentPx.x)
    const neighborChoices = AXIAL_DIRS.map((dir) => {
      const p = axialToPx(dir.q, dir.r)
      return { ...dir, angle: Math.atan2(p.y, p.x) }
    })

    // Build occupancy map of current slots.
    const occupied = new Map()
    for (const [id, s] of currentSlots.entries()) {
      // Treat the focused trace as "already removed" so we can safely open a hole
      // even if it currently sits on the chosen ray.
      if (id === traceId) continue
      occupied.set(axialKey(s.q, s.r), id)
    }

    // Choose the best neighbor direction:
    // - Prefer directions closest to the trace's incoming angle
    // - But also ensure we can find an "empty" slot along that ray, so we can
    //   push a line of traces outward and open a hole in the *first ring* (dist=1),
    //   so the focused trace can move into the neighborhood around the inspection slot.
    const angleDelta = (a, b) =>
      Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

    let best = null
    for (const dir of neighborChoices) {
      let emptyStep = null
      // Start at step=1 (inner ring). We'll open a hole at step=1 by shifting the
      // whole ray outward until the first empty slot.
      for (let step = 1; step <= CONTEXT_FOCUS_TWEAKS.RAY_SEARCH_STEPS; step++) {
        const c = axialAdd(centerSlot, axialMul(dir, step))
        if (!occupied.has(axialKey(c.q, c.r))) {
          emptyStep = step
          break
        }
      }

      if (!emptyStep) continue

      const cand = {
        dir,
        emptyStep,
        angleDiff: angleDelta(angle, dir.angle),
      }

      // Pick the ring-1 slot closest to the incoming trace's side first.
      // `emptyStep` is only a tie breaker, so outer traces don't cross over the
      // focused center just because another ray is easier to open.
      if (
        !best ||
        cand.angleDiff < best.angleDiff ||
        (cand.angleDiff === best.angleDiff && cand.emptyStep < best.emptyStep)
      ) {
        best = cand
      }
    }
    if (!best) return

    // First-ring target (distance=1).
    const targetSlot = axialAdd(centerSlot, best.dir)
    // If it's already in that ring-1 slot, nothing to do.
    if (current.q === targetSlot.q && current.r === targetSlot.r) return
    const emptyStep = best.emptyStep

    /**
     * Two-phase re-slot animation:
     * Phase 1 (fluid): we immediately compute the *final* slot assignment, then run a short
     *  physics-like simulation in pixel space (repulsion + attraction + damping). During
     *  this phase, traces are "unlocked" from rigid slot motion and can push/float.
     * Phase 2 (settle): we clear the temporary offsets so everything locks cleanly to the
     *  final slots with a calm spring.
     */

    // ---- Compute final slot assignment (slot logic remains the source of truth) ----
    const finalSlots = new Map(currentSlots)

    // 1) Open a hole in the target ring-1 slot by shifting the ray outward.
    if (emptyStep > 1) {
      for (let step = emptyStep; step >= 2; step--) {
        const from = axialAdd(centerSlot, axialMul(best.dir, step - 1))
        const to = axialAdd(centerSlot, axialMul(best.dir, step))
        const fromId = occupied.get(axialKey(from.q, from.r))
        if (!fromId) continue
        finalSlots.set(fromId, { ...to })
      }
    }

    // 2) Move the focused trace into the newly opened ring-1 slot.
    finalSlots.set(traceId, targetSlot)

    // 3) Magnetic fill: keep the inner neighborhood dense.
    //    Fill ring1 from ring2+; then ring2 from ring3+ (relative to current focus center).
    const ring1Slots = ringCoordsAt(centerSlot, 1)
    const ring2Slots = ringCoordsAt(centerSlot, 2)

    {
      const occ = new Map()
      for (const [id, s] of finalSlots.entries()) occ.set(axialKey(s.q, s.r), id)

      const fillSlot = (s, minDist) => {
        const key = axialKey(s.q, s.r)
        if (occ.has(key)) return

        const relTarget = axialSub(s, centerSlot)
        const tp = axialToPx(relTarget.q, relTarget.r)
        const targetAngle = Math.atan2(tp.y, tp.x)
        let bestId = null
        let bestScore = Number.POSITIVE_INFINITY

        for (const [id, slot] of finalSlots.entries()) {
          if (id === traceId) continue

          const relSlot = axialSub(slot, centerSlot)
          const dist = axialDistance(relSlot.q, relSlot.r)
          if (dist < minDist) continue

          const sp = axialToPx(relSlot.q, relSlot.r)
          const slotAngle = Math.atan2(sp.y, sp.x)
          const angleDiff = angleDelta(targetAngle, slotAngle)
          const dx = sp.x - tp.x
          const dy = sp.y - tp.y
          const d2 = dx * dx + dy * dy

          // Refill open inner slots from the closest side first. This keeps
          // incoming traces moving radially inward instead of cutting across
          // the focused trace in the middle.
          const score = angleDiff * 100000 + dist * 1000 + d2
          if (score < bestScore) {
            bestScore = score
            bestId = id
          }
        }

        if (!bestId) return

        const prev = finalSlots.get(bestId)
        if (prev) occ.delete(axialKey(prev.q, prev.r))
        finalSlots.set(bestId, { q: s.q, r: s.r })
        occ.set(key, bestId)
      }

      for (const s of ring1Slots) fillSlot(s, 2)
      for (const s of ring2Slots) fillSlot(s, 3)
    }

    // ---- Phase 1: fluid simulation (free drift + push) ----
    setReslotPhase('fluid')
    slotByIdRef.current = finalSlots
    setSlotById(finalSlots)

    // Start positions come from the *current* layout, while targets come from finalSlots.
    const ids = traces.map((x) => x.id)
    const pos = new Map()
    const vel = new Map()
    const offsets0 = new Map()

    const centerAbs = axialToPx(centerSlot.q, centerSlot.r)

    for (const id of ids) {
      const from = currentSlots.get(id)
      const to = finalSlots.get(id)
      if (!from || !to) continue

      const fromPx = axialToPx(from.q, from.r)
      const toPx = axialToPx(to.q, to.r)
      pos.set(id, { x: fromPx.x, y: fromPx.y })
      vel.set(id, { x: 0, y: 0 })
      offsets0.set(id, { x: fromPx.x - toPx.x, y: fromPx.y - toPx.y })
    }

    // Keep visuals in place on the first frame (wrapper jumps to target, inner offset cancels).
    setNudgeById(offsets0)

    const startedAt = performance.now()
    let last = startedAt

    const tick = (now) => {
      const elapsed = now - startedAt
      const dtMs = Math.min(48, Math.max(10, now - last))
      last = now
      const dt = dtMs / 16.6667

      const minDist = RESLOT_ANIM.MIN_DIST
      const influence = RESLOT_ANIM.NEIGHBOR_CUTOFF

      // Pairwise repulsion (soft, short range; prevents heavy overlap).
      for (let i = 0; i < ids.length; i++) {
        const aId = ids[i]
        const aPos = pos.get(aId)
        const aVel = vel.get(aId)
        if (!aPos || !aVel) continue

        for (let j = i + 1; j < ids.length; j++) {
          const bId = ids[j]
          const bPos = pos.get(bId)
          const bVel = vel.get(bId)
          if (!bPos || !bVel) continue

          const dx = bPos.x - aPos.x
          const dy = bPos.y - aPos.y
          const dist = Math.hypot(dx, dy) || 0.0001
          if (dist > influence) continue

          // 1 near minDist, 0 at influence
          const near = 1 - smoothstep(minDist, influence, dist)
          const force = RESLOT_ANIM.REPULSE * near * near

          const nx = dx / dist
          const ny = dy / dist
          aVel.x -= nx * force * dt
          aVel.y -= ny * force * dt
          bVel.x += nx * force * dt
          bVel.y += ny * force * dt
        }
      }

      // Attraction toward targets + damping + integration.
      for (const id of ids) {
        const p = pos.get(id)
        const v = vel.get(id)
        const to = finalSlots.get(id)
        if (!p || !v || !to) continue

        const target = axialToPx(to.q, to.r)
        const relNow = { x: p.x - centerAbs.x, y: p.y - centerAbs.y }
        const relTarget = { x: target.x - centerAbs.x, y: target.y - centerAbs.y }

        const movingIn = Math.hypot(relTarget.x, relTarget.y) + 1 < Math.hypot(relNow.x, relNow.y)
        const attractBase = id === traceId ? RESLOT_ANIM.ATTRACT_FOCUSED : RESLOT_ANIM.ATTRACT
        const attract = attractBase * (movingIn ? 1.25 : 1.0)

        // Gentle drift/noise so motion feels less "menu-like" (kept tiny and damped).
        const driftSeed = (hashString(id) % 1000) / 1000
        const driftX = Math.sin((now / 900) + driftSeed * 10) * RESLOT_ANIM.DRIFT
        const driftY = Math.cos((now / 920) + driftSeed * 9) * RESLOT_ANIM.DRIFT

        v.x += (target.x - p.x) * attract * dt + driftX * dt
        v.y += (target.y - p.y) * attract * dt + driftY * dt

        v.x *= RESLOT_ANIM.DAMPING
        v.y *= RESLOT_ANIM.DAMPING

        const speed = Math.hypot(v.x, v.y)
        if (speed > RESLOT_ANIM.MAX_SPEED) {
          const k = RESLOT_ANIM.MAX_SPEED / (speed || 1)
          v.x *= k
          v.y *= k
        }

        p.x += v.x * dt
        p.y += v.y * dt
      }

      // Convert physics positions to per-trace offsets (pos - target).
      setNudgeById(() => {
        const next = new Map()
        for (const id of ids) {
          const p = pos.get(id)
          const to = finalSlots.get(id)
          if (!p || !to) continue
          const target = axialToPx(to.q, to.r)
          next.set(id, { x: p.x - target.x, y: p.y - target.y })
        }
        return next
      })

      if (elapsed < RESLOT_ANIM.FLUID_MS) {
        fluidRafRef.current = window.requestAnimationFrame(tick)
        return
      }

      // ---- Phase 2: lock back to slots (clean, synchronized settle) ----
      fluidRafRef.current = 0
      setReslotPhase('settle')
      setNudgeById(new Map())
      focusTimersRef.current.push(
        window.setTimeout(() => setReslotPhase('idle'), RESLOT_ANIM.SETTLE_MS),
      )
    }

    fluidRafRef.current = window.requestAnimationFrame(tick)
  }, [activeId, stopFluidPhase, traceById, traces])

  const swapTraceSlots = useCallback((traceId, anchorId, options = {}) => {
    if (traceId === anchorId) return
    if (!traceById.has(traceId) || !traceById.has(anchorId)) return

    clearFocusTimers()
    // Cancel any in-progress fluid loop, but don't force a lock/reset here.
    // We want consecutive contextual steps to feel continuous (stay floating).
    if (fluidRafRef.current) {
      window.cancelAnimationFrame(fluidRafRef.current)
      fluidRafRef.current = 0
    }

    const holdFloating = options?.holdFloating === true
    const affectAll = options?.affectAll === true

    const currentSlots = slotByIdRef.current
    const traceSlot = currentSlots.get(traceId)
    const anchorSlot = currentSlots.get(anchorId)
    if (!traceSlot || !anchorSlot) return

    const finalSlots = new Map(currentSlots)
    finalSlots.set(traceId, { ...anchorSlot })
    finalSlots.set(anchorId, { ...traceSlot })

    // Filming cue: keep the swap logic (only two traces change slots).
    // By default we only animate those two traces (more predictable for filming).
    // If `affectAll` is true, we also run a subtle full-field float.
    setReslotPhase('fluid')
    slotByIdRef.current = finalSlots
    setSlotById(finalSlots)

    const ids = traces.map((t) => t.id)
    const movingIds = new Set([traceId, anchorId])
    const pos = new Map()
    const vel = new Map()
    const offsets0 = new Map()
    const existingNudges = nudgeByIdRef.current

    for (const id of ids) {
      const from = currentSlots.get(id)
      const to = finalSlots.get(id)
      if (!from || !to) continue

      const fromPx = axialToPx(from.q, from.r)
      const toPx = axialToPx(to.q, to.r)
      // If we are already in the floating phase (e.g. multi-step contextual cue),
      // preserve the current visual position by starting from slot+offset.
      const existing = existingNudges.get(id) ?? { x: 0, y: 0 }
      const startX = fromPx.x + existing.x
      const startY = fromPx.y + existing.y
      pos.set(id, { x: startX, y: startY })
      vel.set(id, { x: 0, y: 0 })
      offsets0.set(id, { x: startX - toPx.x, y: startY - toPx.y })
    }

    setNudgeById(offsets0)

    const startedAt = performance.now()
    let last = startedAt

    const tick = (now) => {
      const elapsed = now - startedAt
      const dtMs = Math.min(48, Math.max(10, now - last))
      last = now
      const dt = dtMs / 16.6667

      // Pairwise repulsion:
      // - If `affectAll` is enabled, we run across the whole field (subtle "breathing").
      // - Otherwise, we keep it localized: only the moving traces repel each other.
      const repulseIds = affectAll ? ids : [traceId, anchorId]
      for (let i = 0; i < repulseIds.length; i++) {
        const aId = repulseIds[i]
        const aPos = pos.get(aId)
        const aVel = vel.get(aId)
        if (!aPos || !aVel) continue

        for (let j = i + 1; j < repulseIds.length; j++) {
          const bId = repulseIds[j]
          const bPos = pos.get(bId)
          const bVel = vel.get(bId)
          if (!bPos || !bVel) continue

          const dx = bPos.x - aPos.x
          const dy = bPos.y - aPos.y
          const dist = Math.hypot(dx, dy) || 0.0001
          if (dist > RESLOT_ANIM.NEIGHBOR_CUTOFF) continue

          const near = 1 - smoothstep(RESLOT_ANIM.MIN_DIST, RESLOT_ANIM.NEIGHBOR_CUTOFF, dist)
          const force = RESLOT_ANIM.REPULSE * near * near
          const nx = dx / dist
          const ny = dy / dist
          aVel.x -= nx * force * dt
          aVel.y -= ny * force * dt
          bVel.x += nx * force * dt
          bVel.y += ny * force * dt
        }
      }

      // Attraction/drift/inertia:
      // - Always animate the moving traces.
      // - Only animate the rest when `affectAll` is enabled (otherwise keep them still).
      for (const id of ids) {
        const p = pos.get(id)
        const v = vel.get(id)
        const to = finalSlots.get(id)
        if (!p || !v || !to) continue

        const target = axialToPx(to.q, to.r)
        const isMoving = movingIds.has(id)
        if (!affectAll && !isMoving) continue

        const attractBase = isMoving ? RESLOT_ANIM.ATTRACT_FOCUSED : RESLOT_ANIM.ATTRACT
        const driftSeed = (hashString(id) % 1000) / 1000
        const driftX = isMoving
          ? Math.sin((now / 900) + driftSeed * 10) * RESLOT_ANIM.DRIFT
          : 0
        const driftY = isMoving
          ? Math.cos((now / 920) + driftSeed * 9) * RESLOT_ANIM.DRIFT
          : 0

        v.x += (target.x - p.x) * attractBase * dt + driftX * dt
        v.y += (target.y - p.y) * attractBase * dt + driftY * dt
        v.x *= RESLOT_ANIM.DAMPING
        v.y *= RESLOT_ANIM.DAMPING

        const speed = Math.hypot(v.x, v.y)
        if (speed > RESLOT_ANIM.MAX_SPEED) {
          const k = RESLOT_ANIM.MAX_SPEED / (speed || 1)
          v.x *= k
          v.y *= k
        }

        p.x += v.x * dt
        p.y += v.y * dt
      }

      setNudgeById(() => {
        const next = new Map()
        for (const id of ids) {
          const to = finalSlots.get(id)
          if (!to) continue
          const target = axialToPx(to.q, to.r)

          // Keep non-moving traces frozen unless `affectAll` is enabled.
          if (!affectAll && !movingIds.has(id)) {
            const keep = existingNudges.get(id) ?? { x: 0, y: 0 }
            next.set(id, keep)
            continue
          }

          const p = pos.get(id)
          if (!p) continue
          next.set(id, { x: p.x - target.x, y: p.y - target.y })
        }
        return next
      })

      // While "holding" the contextual sequence, keep the field in the fluid
      // state (subtle drift + soft repulsion) until the final step runs.
      if (holdFloating || elapsed < RESLOT_ANIM.FLUID_MS) {
        fluidRafRef.current = window.requestAnimationFrame(tick)
        return
      }

      fluidRafRef.current = 0
      setReslotPhase('settle')
      setNudgeById(new Map())
      focusTimersRef.current.push(
        window.setTimeout(() => setReslotPhase('idle'), RESLOT_ANIM.SETTLE_MS),
      )
    }

    fluidRafRef.current = window.requestAnimationFrame(tick)
  }, [traceById, traces])

  const contextualCueTimeoutsRef = useRef([])
  const contextualCueLastKeyRef = useRef(null)
  const contextualResetActiveRef = useRef(null)

  const clearContextualCueTimers = useCallback(() => {
    for (const id of contextualCueTimeoutsRef.current) window.clearTimeout(id)
    contextualCueTimeoutsRef.current = []
  }, [])

  const resetContextualLayout = useCallback(() => {
    clearContextualCueTimers()
    contextualCueLastKeyRef.current = null
    stopSnapAnimations()
    stopFluidPhase()
    setIsSnapping(false)
    setNudgeById(new Map())
    const initialSlots = new Map(traces.map((t) => [t.id, { q: t.gridX, r: t.gridY }]))
    slotByIdRef.current = initialSlots
    setSlotById(initialSlots)
  }, [clearContextualCueTimers, stopFluidPhase, traces])

  useEffect(() => {
    const cue = CONTEXTUAL_TRACE_CUES[activeTracePlace]
    if (!cue) return

    if (cue.resetId && activeId === cue.resetId) {
      if (contextualResetActiveRef.current !== cue.resetId) {
        contextualResetActiveRef.current = cue.resetId
        resetContextualLayout()
      }
      return
    }
    contextualResetActiveRef.current = null

    if (activeId !== cue.triggerId) return

    const sequence = cue.sequence ?? []
    const sequenceItems = sequence.map((item) =>
      typeof item === 'string'
        ? { traceId: item, anchorId: cue.anchorId }
        : item,
    )
    if (
      !sequenceItems.length ||
      sequenceItems.some((item) => {
        if (!traceById.has(item.traceId)) return true
        return item.anchorId ? !traceById.has(item.anchorId) : false
      })
    ) {
      return
    }

    const cueKey = `${activeTracePlace}:${cue.triggerId}->${sequenceItems
      .map((item) => `${item.traceId}:${item.anchorId ?? ''}`)
      .join(',')}`
    if (contextualCueLastKeyRef.current === cueKey) return
    contextualCueLastKeyRef.current = cueKey

    clearContextualCueTimers()

    // Fixed filming cue: when the yellow trigger is focused, run the same
    // relocation as the plus button, but with a pre-defined trace sequence.
    const scheduleStep = (index, delay) => {
      const timeoutId = window.setTimeout(() => {
        contextualCueTimeoutsRef.current = contextualCueTimeoutsRef.current.filter(
          (id) => id !== timeoutId,
        )
        const item = sequenceItems[index]
        if (item.anchorId) {
          const isLast = index === sequenceItems.length - 1
          swapTraceSlots(item.traceId, item.anchorId, {
            // Only some cues (museum) should keep the fluid phase running across
            // multiple steps. Others (train) should fully settle between steps.
            holdFloating: cue.holdFloatingUntilEnd === true && !isLast,
            affectAll: cue.affectAll === true,
          })
        } else {
          focusTrace(item.traceId)
        }

        const nextIndex = index + 1
        if (nextIndex < sequenceItems.length) {
          scheduleStep(nextIndex, cue.stepDelayMs ?? 500)
        }
      }, delay)

      contextualCueTimeoutsRef.current.push(timeoutId)
    }

    scheduleStep(0, cue.firstDelayMs ?? 0)
  }, [
    activeId,
    activeTracePlace,
    clearContextualCueTimers,
    focusTrace,
    resetContextualLayout,
    swapTraceSlots,
    traceById,
  ])

  useEffect(() => {
    return () => {
      clearContextualCueTimers()
    }
  }, [clearContextualCueTimers])

  const focusCursorRef = useRef(0)
  const triggerContextFocus = useCallback(() => {
    if (!traces.length) return

    // Pick a trace that's not already in the inner neighborhood so the first press
    // always causes a visible re-slotting.
    // Strategy:
    // - Prefer candidates in ring3+ (axialDistance >= 3)
    // - Fall back to ring2 if needed
    // - As a last resort, pick any non-active trace
    const centerId = activeId
    const centerTrace = centerId ? traceById.get(centerId) : null
    const centerSlot =
      (centerId && slotById.get(centerId)) ||
      (centerTrace ? { q: centerTrace.gridX, r: centerTrace.gridY } : { q: 0, r: 0 })

    const distOf = (id) => {
      const s = slotById.get(id)
      if (!s) return Number.POSITIVE_INFINITY
      return axialDistance(s.q - centerSlot.q, s.r - centerSlot.r)
    }

    const prefer = (minDist) =>
      traces
        .map((t) => ({ id: t.id, dist: distOf(t.id) }))
        .filter((t) => t.id !== activeId && t.dist >= minDist)
        .sort((a, b) => b.dist - a.dist)

    const pools = [prefer(3), prefer(2)]
    const fallback = traces
      .map((t) => ({ id: t.id, dist: distOf(t.id) }))
      .filter((t) => t.id !== activeId)
      .sort((a, b) => b.dist - a.dist)

    const pool = pools.find((p) => p.length) ?? fallback
    if (!pool.length) return

    // Cycle within the chosen pool for repeatability.
    const idx = focusCursorRef.current % pool.length
    focusCursorRef.current = (focusCursorRef.current + 1) % pool.length
    focusTrace(pool[idx].id)
  }, [activeId, focusTrace, slotById, traceById, traces])

  // Expose an imperative trigger for prototyping:
  //   window.focusTrace("t17")
  useEffect(() => {
    window.focusTrace = (id) => focusTrace(id)
    return () => {
      delete window.focusTrace
    }
  }, [focusTrace])

  // Prototype switch for the two shoot locations:
  //   window.setTracePlace("train")
  //   window.setTracePlace("museum")
  const setTracePlace = useCallback((place) => {
    if (!TRACE_PLACES.includes(place)) return
    if (place === activeTracePlace) return

    const nextTraces = packTracesIntoCenterSlots(
      allTraces.filter((t) => t.place === place),
    )
    clearContextualCueTimers()
    contextualCueLastKeyRef.current = null
    contextualResetActiveRef.current = null
    stopSnapAnimations()
    stopFluidPhase()
    setIsSnapping(false)
    const initialSlots = new Map(nextTraces.map((t) => [t.id, { q: t.gridX, r: t.gridY }]))
    slotByIdRef.current = initialSlots
    setSlotById(initialSlots)
    setLockedId(nextTraces[0]?.id ?? null)
    setActiveTracePlace(place)
  }, [activeTracePlace, allTraces, clearContextualCueTimers, stopFluidPhase])

  const toggleTracePlace = useCallback(() => {
    setTracePlace(activeTracePlace === 'museum' ? 'train' : 'museum')
  }, [activeTracePlace, setTracePlace])

  useEffect(() => {
    window.setTracePlace = (place) => setTracePlace(place)
    window.getTracePlace = () => activeTracePlace
    return () => {
      delete window.setTracePlace
      delete window.getTracePlace
    }
  }, [activeTracePlace, setTracePlace])

  return (
    <div className="traceApp">
      <div
        ref={phoneRef}
        className="phone"
        role="application"
        aria-label="Trace browser prototype"
      >
        <header
          className="topBar"
          role="button"
          tabIndex={0}
          aria-label="Switch place (train/museum)"
          onClick={toggleTracePlace}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleTracePlace()
            }
          }}
        >
          <div className="placeBlock">
            <div className="place">{topTitle}</div>
            <div className="subtitle">{topSubheader}</div>
          </div>
        </header>

        <main className="quoteArea" aria-hidden="true">
          <div className="quoteStack">
            {/* Two-card cycle: the visible back card stays stable, while each
                new front card starts from that back-card position and rises forward. */}
            <motion.div
              className="quoteCard quoteCardBack quoteCardBack1"
              style={{ zIndex: 1 }}
              animate={{
                opacity: 0.96,
                y: CARD_STACK_ANIM.STACK_OFFSET_Y,
                scale: CARD_STACK_ANIM.MIDDLE_SCALE,
                rotate: CARD_STACK_ANIM.STACK_ROTATE,
              }}
              transition={{
                duration: CARD_STACK_ANIM.DURATION,
                ease: CARD_STACK_ANIM.EASE,
              }}
            />

            <AnimatePresence initial={false}>
              <motion.div
                key={activeId ?? 'empty'}
                className="quoteCard quoteCardFront"
                style={{ zIndex: 2 }}
                initial={{
                  opacity: 1,
                  y: CARD_STACK_ANIM.STACK_OFFSET_Y,
                  scale: CARD_STACK_ANIM.MIDDLE_SCALE,
                  rotate: CARD_STACK_ANIM.STACK_ROTATE,
                }}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
                exit={{
                  opacity: 0,
                  x: CARD_STACK_ANIM.OUTGOING_X,
                  y: CARD_STACK_ANIM.OUTGOING_Y,
                  scale: 0.985,
                  rotate: CARD_STACK_ANIM.OUTGOING_ROTATE,
                }}
                transition={{
                  duration: CARD_STACK_ANIM.DURATION,
                  ease: CARD_STACK_ANIM.EASE,
                }}
              >
                <motion.div
                  className="quoteCardContent"
                  initial={{ opacity: 0, y: CARD_STACK_ANIM.CONTENT_FADE_Y }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -CARD_STACK_ANIM.CONTENT_FADE_Y }}
                  transition={{
                    duration: CARD_STACK_ANIM.CONTENT_FADE_DURATION,
                    ease: CARD_STACK_ANIM.CONTENT_FADE_EASE,
                    delay: CARD_STACK_ANIM.CONTENT_FADE_DELAY,
                  }}
                >
                  <div className="quoteCardHeader">
                    <div className="quoteCardTitle">{quoteTitle}</div>
                    <div className="quoteCardMeta">
                      <span className="quoteCardDate">{quoteDate}</span>
                    </div>
                  </div>

                  <div
                    className={
                      active?.type === 'image' || active?.type === 'audio'
                        ? 'quoteCardBody quoteCardBodyRich'
                        : 'quoteCardBody'
                    }
                  >
                    {active?.type === 'image' ? (
                      <img
                        className="quoteCardMedia"
                        src={active.mediaSrc}
                        alt=""
                        draggable={false}
                      />
                    ) : active?.type === 'audio' ? (
                      <div className="quoteCardAudio">
                        <img
                          className="quoteCardAudioMedia"
                          src={active.mediaSrc}
                          alt=""
                          draggable={false}
                        />
                        <div className="quoteCardAudioText">{quote}</div>
                      </div>
                    ) : (
                      quote
                    )}
                  </div>
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        {/* Interactive stage: visually scaled, but drag physics remain 1:1 (no scaled drag target). */}
        <div className="traceStage">
          {/* Full-screen interactive surface (the grid pans as one surface). */}
          <motion.div
            className="gridPan"
            drag={!isSnapping && !isReslotting}
            dragMomentum={false}
            dragElastic={0.08}
            style={{ x: panX, y: panY }}
            onDragStart={() => {
              // If the user grabs during a snap, cancel and hand control back.
              stopSnapAnimations()
              setIsSnapping(false)
              stopFluidPhase()
            }}
            onDragEnd={() => snapToClosest()}
          >
            <div className="traceStageInner">
            {tracesWithPos.map((t) => {
              const dx = renderPan.x + stageScale * t.px
              const dy = renderPan.y + stageScale * t.py
              const dist = Math.hypot(dx, dy)
              const proximity = Math.pow(clamp01(1 - dist / MAX_INFLUENCE), 1.7)

              const isFocused = t.id === activeId
              const scale = lerp(0.62, 1.18, proximity) + (isFocused ? 0.04 : 0)
              // Opacity: base falloff from screen distance, then an additional
              // ring-based multiplier (circle 1/2/3 around the focused trace).
              const ring = axialDistance(
                t.gridX - renderCenterSlot.q,
                t.gridY - renderCenterSlot.r,
              )
              const ringMult =
                RING_OPACITY_MULT[Math.min(ring, RING_OPACITY_MULT.length - 1)]
              const opacity = lerp(0.16, 0.78, proximity) * ringMult

              const cue = CONTEXTUAL_TRACE_CUES[t.place]
              const isContextTrigger = cue?.triggerId === t.id
              const fill = isContextTrigger
                ? 'var(--trace-fill-context-trigger)'
                : isFocused
                  ? 'var(--trace-fill-focused)'
                  : 'var(--trace-fill)'
              const outline = isContextTrigger
                ? 'var(--trace-border-context-trigger)'
                : isFocused
                  ? 'var(--trace-border-focused)'
                  : 'var(--trace-border)'

                // Larger / closer bubbles float on top.
                const zIndex = Math.round(scale * 1000)

                const nudge = nudgeById.get(t.id) ?? { x: 0, y: 0 }

                return (
                  <motion.div
                    key={t.id}
                    className="traceBubbleWrap"
                    style={{
                      left: slot.x + t.px - BUBBLE_SIZE / 2,
                      top: slot.y + t.py - BUBBLE_SIZE / 2,
                      width: BUBBLE_SIZE,
                      height: BUBBLE_SIZE,
                      zIndex,
                    }}
                    layout={isReslotting ? false : 'position'}
                    transition={SLOT_SPRING}
                  >
                    {/* We animate scale/opacity on the inner node so the wrapper can use
                        Motion's layout projection (moving slots) without transform conflicts. */}
                  <motion.div
                    className="traceBubble"
                    style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: fill,
                      borderColor: outline,
                    }}
                    animate={{
                      opacity,
                      scale,
                      x: nudge.x,
                      y: nudge.y,
                    }}
                    transition={{
                      ...BUBBLE_SPRING,
                      // During the fluid phase we drive x/y every frame from a physics loop,
                      // so we disable interpolation for those axes (prevents laggy springs).
                      x: isFluidPhase ? { duration: 0 } : undefined,
                      y: isFluidPhase ? { duration: 0 } : undefined,
                      opacity: { duration: 0.25 },
                    }}
                  >
                    <img
                      className="traceTypeSymbol"
                      src={traceTypeSymbol(t.type, t.origin)}
                      alt=""
                      draggable={false}
                      aria-hidden="true"
                    />
                  </motion.div>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>

          {/* Fixed “inspection slot” — a target the grid snaps into. */}
          <div className="traceStageInner traceStageOverlay">
            <div
              className="inspectionSlot"
              style={{ left: slot.x, top: slot.y }}
            />
          </div>
        </div>

        

        <button
          type="button"
          className="focusFab"
          aria-label="Trigger contextual focus"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            triggerContextFocus()
          }}
        >
          <img className="focusFabIcon" src={plusIcon} alt="" aria-hidden="true" />
        </button>

        <button
          type="button"
          className="leaveFab"
          aria-label="Reload"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            window.location.reload()
          }}
        >
          <img className="leaveFabIcon" src={leaveIcon} alt="" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export default App

/**
 * Solid kitchen the pan has to respect.
 *
 * The pan is a rigid bowl of revolution, so it is solved as one: only the bowl
 * floor and the rim can touch anything. Every number here is mirrored from the
 * worktop built in `scripts/build_playable_cart.py` and measured from
 * `public/models/playable-cart.glb`, in game coordinates (metres, Y up).
 */

export type Vec3 = [number, number, number]

/** Pan bowl, measured from the exported model. Radius is the outer rim. */
export const WOK_RADIUS = .284
export const WOK_RIM = .1238
/** Underside height relative to the pan origin, from the centre outwards. */
export const wokUnderside = (radius: number) =>
  .122 * Math.pow(Math.min(Math.abs(radius), .28) / .28, 1.75) - .0009
/** Inverse of the profile: the radius whose underside sits `height` above the origin. */
const wokContactRadius = (height: number) =>
  height < wokUnderside(0) ? 0 : height >= wokUnderside(WOK_RADIUS) ? WOK_RADIUS
    : .28 * Math.pow((height + .0009) / .122, 1 / 1.75)

/** Docked pan: the bowl floor sits on the cast-iron ring. */
export const WOK_HOME: Vec3 = [0, 1.1, 0]
/** How far the pan can be carried from the burner, and how far it can be raised. */
export const WOK_TRAVEL = .75
export const WOK_MAX_LIFT = .55
/** Pan floor height when it is set down anywhere on the stainless worktop. */
export const WORKTOP = { top: 1.003, min: [-1.195, -.87], max: [1.195, .49] }
/** The gas knob on the counter front lip, left of the stove. */
export const KNOB = { x: -.39, z: .463 }
/** The pan can be lowered to the worktop, but never through the bench itself. */
const REST_FLOOR = WORKTOP.top - wokUnderside(0)

/**
 * Cast-iron pan support. Built as a surface of revolution that follows the bowl
 * profile 4 mm below it, so the ring only ever meets the pan exactly where it
 * supports it. `level` is the pan height that rests on the ring. The modelled
 * ring stops where the real prongs stop hugging the bowl; further in they drop
 * away towards the burner and are far below the pan floor.
 */
const TRIVET = { x: 0, z: 0, inner: .198, outer: .288, level: WOK_HOME[1] - .004 }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export interface Prop { name: string; min: [number, number]; max: [number, number]; top: number }

/**
 * Trays and bottle shelf, measured from the Blender worktop. The right-hand
 * trays are one bank: the pan cannot fit in the few centimetres between them,
 * and one convex block keeps the pan from being wedged between two trays.
 */
export const PROPS: Prop[] = [
  { name: 'rice tray', min: [-.945, -.19], max: [-.525, .33], top: 1.071 },
  { name: 'right tray bank', min: [.45, -.555], max: [1.06, .43], top: 1.147 },
  { name: 'condiment shelf', min: [-1.2, -1.2], max: [1.2, -.63], top: 1.4 },
]

/** Samples of the pan floor: the bowl is symmetric, so one half is enough. */
const RING_SAMPLES: [number, number][] = (() => {
  const out: [number, number][] = []
  for (let a = 0; a < 12; a++) for (let r = 0; r <= 14; r++) {
    const angle = a / 12 * Math.PI, radius = r / 14 * WOK_RADIUS
    out.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  return out
})()

/** Solid surface at one point: the worktop, or the ring that carries the pan. */
function surfaceUnder(x: number, z: number) {
  const ringRadius = Math.hypot(x - TRIVET.x, z - TRIVET.z)
  if (ringRadius >= TRIVET.inner && ringRadius <= TRIVET.outer) return TRIVET.level + wokUnderside(ringRadius)
  if (x > WORKTOP.min[0] && x < WORKTOP.max[0] && z > WORKTOP.min[1] && z < WORKTOP.max[1]) return WORKTOP.top
  return -Infinity
}

/** Lowest pan height that clears everything solid under this centre. */
function supportLevel(x: number, z: number) {
  let level = -Infinity
  for (const [ox, oz] of RING_SAMPLES) {
    const floor = surfaceUnder(x + ox, z + oz)
    if (floor === -Infinity) continue
    const need = floor - wokUnderside(Math.hypot(ox, oz))
    if (need > level) level = need
  }
  return level
}

/** What stopped the pan: nothing, the stove ring underneath, or a prop beside it. */
export type PanContact = 'free' | 'rack' | 'prop'

interface Hit { prop: string; reach: number; near: [number, number]; away: [number, number] }

/** A prop the pan is inside, plus the direction and distance needed to leave it. */
function propHit(x: number, z: number, y: number): Hit | null {
  for (const prop of PROPS) {
    const reach = wokContactRadius(prop.top - y)
    if (reach <= 0) continue
    const nearX = clamp(x, prop.min[0], prop.max[0]), nearZ = clamp(z, prop.min[1], prop.max[1])
    const dx = x - nearX, dz = z - nearZ, distance = Math.hypot(dx, dz)
    if (distance >= reach) continue
    if (distance > 1e-6) return { prop: prop.name, reach, near: [nearX, nearZ], away: [dx / distance, dz / distance] }
    // Centre is inside the footprint: leave through the nearest face.
    const faces: [number, [number, number], [number, number]][] = [
      [x - prop.min[0], [prop.min[0], z], [-1, 0]], [prop.max[0] - x, [prop.max[0], z], [1, 0]],
      [z - prop.min[1], [x, prop.min[1]], [0, -1]], [prop.max[1] - z, [x, prop.max[1]], [0, 1]],
    ]
    const face = faces.reduce((best, item) => item[0] < best[0] ? item : best)
    return { prop: prop.name, reach, near: face[1], away: face[2] }
  }
  return null
}

/**
 * Where the pan actually ends up for a requested centre. Movement keeps its
 * existing envelope, then solid surfaces lift it and props stop it, so the pan
 * can never be dragged through the stove or the trays. A blocking prop slides
 * the pan along itself instead of shoving it somewhere unexpected.
 */
export function resolvePan(desired: Vec3, from?: Vec3): { position: Vec3; contact: PanContact; prop: string | null } {
  const dx = desired[0] - WOK_HOME[0], dz = desired[2] - WOK_HOME[2]
  const radius = Math.hypot(dx, dz), scale = radius > WOK_TRAVEL ? WOK_TRAVEL / radius : 1
  let x = WOK_HOME[0] + dx * scale, z = WOK_HOME[2] + dz * scale
  const wanted = clamp(desired[1], REST_FLOOR, WOK_HOME[1] + WOK_MAX_LIFT)
  let y = wanted
  let contact: PanContact = 'free'
  let blocked: string | null = null
  for (let pass = 0; pass < 2; pass++) {
    const support = supportLevel(x, z)
    if (y < support) { y = support; contact = 'rack' }
    const hit = propHit(x, z, y)
    if (!hit) break
    contact = 'prop'
    blocked = hit.prop
    if (from && !propHit(from[0], from[2], from[1])) {
      // The pan was clear of everything before this move, so the move may not
      // carry it through: slide along the face, and if that is not enough, stay.
      const into = (x - from[0]) * hit.away[0] + (z - from[2]) * hit.away[1]
      if (into < 0) { x -= hit.away[0] * into; z -= hit.away[1] * into }
      if (propHit(x, z, y)) {
        // Nowhere to go: the pan keeps its place, and never drops below the
        // height it already had, so it can still be pulled up and out.
        x = from[0]; z = from[2]
        y = Math.max(from[1], wanted, supportLevel(x, z))
      }
      break
    }
    // No usable previous state to fall back on: leave by the nearest face.
    x = hit.near[0] + hit.away[0] * hit.reach
    z = hit.near[1] + hit.away[1] * hit.reach
  }
  return { position: [x, y, z], contact, prop: blocked }
}

/** Pan height when it is let go above this spot, or `null` where nothing is below. */
export function settleHeight(x: number, z: number) {
  const support = supportLevel(x, z)
  return Number.isFinite(support) ? support : null
}

/**
 * A safe place to put the pan down, using the nearest clear space under it.
 * The collision solver slides a landing out of tray/shelf footprints. A rim
 * overlapping the counter edge is not enough support: if the centre cannot
 * rest on the worktop, return the pan to its rack.
 */
export function panRestTarget(position: Vec3): Vec3 {
  let [x, , z] = position
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!Number.isFinite(x) || !Number.isFinite(z)
      || x <= WORKTOP.min[0] || x >= WORKTOP.max[0]
      || z <= WORKTOP.min[1] || z >= WORKTOP.max[1]) return [...WOK_HOME]
    const below = settleHeight(x, z)
    if (below === null) return [...WOK_HOME]
    const target = resolvePan([x, below, z]).position
    if (Math.hypot(target[0] - x, target[2] - z) < 1e-6
      && Math.abs(target[1] - below) < 1e-6
      && !propHit(target[0], target[2], target[1])) return target
    ;[x, , z] = target
  }
  return [...WOK_HOME]
}

/** What a pan is sitting on: the stove ring, the worktop, or nothing at all. */
export function panRestingOn(position: Vec3): 'rack' | 'worktop' | 'air' {
  const level = supportLevel(position[0], position[2])
  if (!Number.isFinite(level) || position[1] - level > .012) return 'air'
  const axis = Math.hypot(position[0] - TRIVET.x, position[2] - TRIVET.z)
  // The rack only claims pans resting at ring height. A pan flat on the bench
  // right next to the burner is still on the worktop.
  if (axis < TRIVET.outer + WOK_RADIUS && position[1] > TRIVET.level - .05) return 'rack'
  return 'worktop'
}

/**
 * The single ladle is put down flat on the front strip of the worktop, the same
 * strip the hand releases it over, so what the player sees is where it lies.
 * `y` is the height of the ladle's own pivot in that pose: the bowl and the
 * handle end up level, 1.5 mm above the stainless top.
 */
export const LADLE_REST = { y: 1.023, z: .43, xLimit: .21 }

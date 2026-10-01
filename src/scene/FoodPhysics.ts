import {Euler, Quaternion, Vector3} from 'three'
import type {Ingredient} from '../game/simulation'
import {WORKTOP, WOK_RADIUS, WOK_RIM} from '../game/kitchen'

/**
 * Small ingredients are treated as separate rigid grains. Their positions and
 * velocities are always in world space: lifting or tilting the wok cannot
 * accidentally carry airborne rice along with its scene graph.
 *
 * The collision proxy is the thickness of a piece rather than the length of a
 * carrot strip or bacon slice. The actual Blender geometry is rendered at its
 * original scale, and never rescaled by the physics simulation.
 */
export const FOOD_COLLISION_RADII: Record<Ingredient, number> = {
  rice: .0035, carrot: .0036, onion: .0045, bacon: .0068,
  scallion: .0028, egg: .007, corn: .0041, peas: .0041, ham: .0075,
}

export interface PanPose {
  position: Vector3
  quaternion: Quaternion
}

export interface SpoonContact {
  /** A stable identifier, such as "left" or "right", for deriving velocity. */
  id: string
  /** World position of the ladle bowl's contact point. */
  position: Vector3
  radius?: number
  strength?: number
}

export interface FoodBody {
  readonly kind: Ingredient
  readonly radius: number
  /** Original mesh scale. Cooking changes material colour only. */
  readonly scale: 1
  position: Vector3
  velocity: Vector3
  rotation: Euler
  spin: Vector3
  readonly inverseMass: number
}

export interface FoodStepInput {
  spoons?: readonly SpoonContact[]
  /** A one-frame upward flick, from 0 to 1. Applied once, before fixed steps. */
  toss?: number
}

type ContactSample = {position: Vector3; velocity: Vector3; radius: number; strength: number}
const STEP = 1 / 120
const CELL = .014
const GRID_WIDTH = 2048
const GRID_PLANE = GRID_WIDTH * GRID_WIDTH
const MAX_FRAME = .05
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x))
const panFloor = (radius: number) => .003 + .122 * Math.pow(clamp(radius, 0, .28) / .28, 1.75)

/** Fixed-step granular physics with a moving, concave wok collider. */
export class FoodPhysics {
  private readonly groups = new Map<Ingredient, FoodBody[]>()
  private bodies: FoodBody[] = []
  private previousPan: PanPose
  private readonly previousSpoons = new Map<string, Vector3>()
  private readonly random: () => number
  private readonly gravity: number
  private remainder = 0
  private tick = 0

  // Scratch objects avoid thousands of short-lived allocations per frame.
  private readonly panAt = new Vector3()
  private readonly panRotation = new Quaternion()
  private readonly inversePanRotation = new Quaternion()
  private readonly inverseRenderPan = new Quaternion()
  private readonly panVelocity = new Vector3()
  private readonly panAngularVelocity = new Vector3()
  private readonly local = new Vector3()
  private readonly oldLocal = new Vector3()
  private readonly normal = new Vector3()
  private readonly surfaceVelocity = new Vector3()
  private readonly relativeVelocity = new Vector3()
  private readonly tangent = new Vector3()
  private readonly contactOffset = new Vector3()
  private readonly deltaRotation = new Quaternion()
  private readonly grid = new Map<number, number[]>()
  private readonly gridCells: number[][] = []
  private gridCoordinates = new Int32Array(0)

  constructor(initialPan: PanPose, options: {random?: () => number; gravity?: number} = {}) {
    this.previousPan = {position: initialPan.position.clone(), quaternion: initialPan.quaternion.clone()}
    this.inverseRenderPan.copy(initialPan.quaternion).invert()
    this.random = options.random ?? Math.random
    this.gravity = options.gravity ?? 9.81
  }

  get(kind: Ingredient): readonly FoodBody[] { return this.groups.get(kind) ?? [] }
  get count() { return this.bodies.length }

  /**
   * Synchronise physics bodies with the gameplay amount. New pieces fall from
   * the ladle's world-space position; existing pieces are never recreated.
   */
  setCount(kind: Ingredient, count: number, spawnWorld: Vector3) {
    const wanted = Math.max(0, Math.floor(count))
    let group = this.groups.get(kind)
    if (!group) { group = []; this.groups.set(kind, group) }
    if (wanted < group.length) {
      const removed = new Set(group.splice(wanted))
      this.bodies = this.bodies.filter(body => !removed.has(body))
    }
    const radius = FOOD_COLLISION_RADII[kind]
    while (group.length < wanted) {
      const angle = this.random() * Math.PI * 2
      const spread = Math.sqrt(this.random()) * .036
      const body: FoodBody = {
        kind, radius, scale: 1,
        position: new Vector3(
          spawnWorld.x + Math.cos(angle) * spread,
          spawnWorld.y + this.random() * .05,
          spawnWorld.z + Math.sin(angle) * spread,
        ),
        velocity: new Vector3((this.random() - .5) * .16, -.10, (this.random() - .5) * .16),
        rotation: new Euler(this.random() * Math.PI, this.random() * Math.PI * 2, this.random() * Math.PI),
        spin: new Vector3((this.random() - .5) * 6, (this.random() - .5) * 6, (this.random() - .5) * 6),
        inverseMass: 1 / (radius * radius * radius),
      }
      group.push(body)
      this.bodies.push(body)
    }
  }

  /**
   * The scene supplies the displayed wok pose and real ladle contact points.
   * The caller can read each FoodBody.position to build instance matrices.
   */
  step(frameDelta: number, pan: PanPose, input: FoodStepInput = {}) {
    const dt = clamp(frameDelta, 0, MAX_FRAME)
    if (!dt) return
    const priorPan = this.previousPan
    this.panVelocity.copy(pan.position).sub(priorPan.position).multiplyScalar(1 / dt)
    if (this.panVelocity.length() > 4) this.panVelocity.setLength(4)
    this.deltaRotation.copy(pan.quaternion).multiply(priorPan.quaternion.clone().invert()).normalize()
    if (this.deltaRotation.w < 0) this.deltaRotation.set(-this.deltaRotation.x, -this.deltaRotation.y, -this.deltaRotation.z, -this.deltaRotation.w)
    const angle = 2 * Math.acos(clamp(this.deltaRotation.w, -1, 1))
    const axisLength = Math.hypot(this.deltaRotation.x, this.deltaRotation.y, this.deltaRotation.z)
    this.panAngularVelocity.set(0, 0, 0)
    if (axisLength > 1e-7) {
      this.panAngularVelocity.set(this.deltaRotation.x, this.deltaRotation.y, this.deltaRotation.z)
        .multiplyScalar(Math.min(angle / dt, 14) / axisLength)
    }

    const spoons: ContactSample[] = []
    const present = new Set<string>()
    for (const spoon of input.spoons ?? []) {
      present.add(spoon.id)
      const previous = this.previousSpoons.get(spoon.id)
      const velocity = previous ? spoon.position.clone().sub(previous).divideScalar(dt) : new Vector3()
      if (velocity.length() > 3) velocity.setLength(3)
      spoons.push({position: spoon.position, velocity, radius: spoon.radius ?? .046, strength: clamp(spoon.strength ?? 1, 0, 2)})
      this.previousSpoons.set(spoon.id, spoon.position.clone())
    }
    for (const id of this.previousSpoons.keys()) if (!present.has(id)) this.previousSpoons.delete(id)

    if (input.toss && this.bodies.length) this.applyToss(clamp(input.toss, 0, 1), pan)

    this.remainder += dt
    const steps = Math.min(7, Math.floor(this.remainder / STEP))
    if (steps) this.remainder -= steps * STEP
    for (let substep = 0; substep < steps; substep++) {
      const fraction = (substep + 1) / steps
      this.panAt.lerpVectors(priorPan.position, pan.position, fraction)
      this.panRotation.slerpQuaternions(priorPan.quaternion, pan.quaternion, fraction)
      this.inversePanRotation.copy(this.panRotation).invert()
      this.integrate(STEP, spoons)
      this.tick++
    }
    this.previousPan = {position: pan.position.clone(), quaternion: pan.quaternion.clone()}
    this.inverseRenderPan.copy(pan.quaternion).invert()
  }

  /** World position converted to current wok-local coordinates for InstancedMesh. */
  localPosition(body: FoodBody, out: Vector3) {
    return out.copy(body.position).sub(this.previousPan.position)
      .applyQuaternion(this.inverseRenderPan)
  }

  private applyToss(strength: number, pan: PanPose) {
    const inverse = pan.quaternion.clone().invert()
    const local = new Vector3()
    const up = new Vector3(0, 1, -.10).applyQuaternion(pan.quaternion).normalize()
    for (const body of this.bodies) {
      local.copy(body.position).sub(pan.position).applyQuaternion(inverse)
      const radial = Math.hypot(local.x, local.z)
      const separation = local.y - panFloor(radial) - body.radius
      if (radial > WOK_RADIUS - body.radius || separation < -.01 || separation > .052) continue
      const impulse = .72 + 1.45 * strength
      body.velocity.addScaledVector(up, impulse)
      body.velocity.addScaledVector(this.panVelocity, .32)
      body.spin.x += (this.random() - .5) * 9
      body.spin.z += (this.random() - .5) * 9
    }
  }

  private integrate(dt: number, spoons: readonly ContactSample[]) {
    const damping = Math.exp(-dt * .12)
    for (const body of this.bodies) {
      this.oldLocal.copy(body.position).sub(this.panAt).applyQuaternion(this.inversePanRotation)
      body.velocity.y -= this.gravity * dt
      body.velocity.multiplyScalar(damping)
      this.applySpoons(body, spoons, dt)
      body.position.addScaledVector(body.velocity, dt)
      this.collideWok(body, this.oldLocal)
      this.collideWorktop(body)
      body.rotation.x += body.spin.x * dt
      body.rotation.y += body.spin.y * dt
      body.rotation.z += body.spin.z * dt
      body.spin.multiplyScalar(Math.exp(-dt * 1.8))
    }
    // Pair contacts prevent rice and toppings from collapsing into one sheet.
    // Bowl and spoon contacts run at 120 Hz; grain pairs run at 40 Hz so a
    // loaded wok remains responsive on a portrait phone.
    if (this.tick % 3 === 0 && this.bodies.length > 1) {
      this.collideGrains()
      for (const body of this.bodies) { this.collideWok(body, undefined); this.collideWorktop(body) }
    }
  }

  private applySpoons(body: FoodBody, spoons: readonly ContactSample[], dt: number) {
    for (const spoon of spoons) {
      this.normal.copy(body.position).sub(spoon.position)
      const distance = this.normal.length()
      const reach = spoon.radius + body.radius
      if (distance >= reach) continue
      if (distance < 1e-7) this.normal.set(0, 1, 0)
      else this.normal.multiplyScalar(1 / distance)
      const penetration = reach - distance
      body.position.addScaledVector(this.normal, penetration * .72)
      this.relativeVelocity.copy(body.velocity).sub(spoon.velocity)
      const closing = this.relativeVelocity.dot(this.normal)
      if (closing < 0) body.velocity.addScaledVector(this.normal, -closing * .85 * spoon.strength)
      body.velocity.addScaledVector(spoon.velocity, .16 * spoon.strength * dt * 60)
      body.spin.x += spoon.velocity.z * .4 * spoon.strength
      body.spin.z -= spoon.velocity.x * .4 * spoon.strength
    }
  }

  private collideWok(body: FoodBody, previousLocal?: Vector3) {
    this.local.copy(body.position).sub(this.panAt).applyQuaternion(this.inversePanRotation)
    let radius = Math.hypot(this.local.x, this.local.z)
    const wasInside = previousLocal ? Math.hypot(previousLocal.x, previousLocal.z) < WOK_RADIUS - body.radius : radius < WOK_RADIUS - body.radius
    // The rolled lip stops low grains, but a genuinely airborne grain can fly
    // over it and fall onto the worktop. No radial teleport/clamping in air.
    if (wasInside && radius > WOK_RADIUS - body.radius && this.local.y < WOK_RIM + body.radius) {
      const allowed = WOK_RADIUS - body.radius
      this.local.x *= allowed / radius
      this.local.z *= allowed / radius
      this.normal.set(-this.local.x / allowed, 0, -this.local.z / allowed).applyQuaternion(this.panRotation)
      this.updateVelocityAtContact(body, .12, .12)
      radius = allowed
    }
    // Below the pan or beyond the lip is outside its concave cooking surface.
    if (radius >= WOK_RADIUS || this.local.y < -.03) return
    const floor = panFloor(radius)
    const penetration = floor + body.radius - this.local.y
    if (penetration <= 0) {
      // The rim may have moved the body even without a floor collision.
      if (wasInside && radius >= WOK_RADIUS - body.radius) body.position.copy(this.local).applyQuaternion(this.panRotation).add(this.panAt)
      return
    }
    const slope = radius < 1e-8 ? 0 : .122 * 1.75 / .28 * Math.pow(radius / .28, .75)
    this.normal.set(radius ? -slope * this.local.x / radius : 0, 1,
      radius ? -slope * this.local.z / radius : 0).normalize()
    this.local.addScaledVector(this.normal, penetration / this.normal.y)
    body.position.copy(this.local).applyQuaternion(this.panRotation).add(this.panAt)
    this.normal.applyQuaternion(this.panRotation)
    this.updateVelocityAtContact(body, .08, .35)
  }

  private updateVelocityAtContact(body: FoodBody, restitution: number, friction: number) {
    this.contactOffset.copy(body.position).sub(this.panAt)
    this.surfaceVelocity.copy(this.panAngularVelocity).cross(this.contactOffset).add(this.panVelocity)
    this.relativeVelocity.copy(body.velocity).sub(this.surfaceVelocity)
    const closing = this.relativeVelocity.dot(this.normal)
    if (closing < 0) body.velocity.addScaledVector(this.normal, -(1 + restitution) * closing)
    this.tangent.copy(body.velocity).sub(this.surfaceVelocity)
    this.tangent.addScaledVector(this.normal, -this.tangent.dot(this.normal))
    body.velocity.addScaledVector(this.tangent, -friction)
    body.spin.x += this.tangent.z * .15
    body.spin.z -= this.tangent.x * .15
  }

  private collideWorktop(body: FoodBody) {
    const floor = WORKTOP.top + body.radius
    const aboveCounter = body.position.x >= WORKTOP.min[0] && body.position.x <= WORKTOP.max[0]
      && body.position.z >= WORKTOP.min[1] && body.position.z <= WORKTOP.max[1]
    const support = aboveCounter ? floor : -.027 + body.radius
    if (body.position.y >= support) return
    body.position.y = support
    if (body.velocity.y < 0) body.velocity.y = -body.velocity.y * .07
    body.velocity.x *= .82
    body.velocity.z *= .82
  }

  private collideGrains() {
    this.grid.clear()
    // Reuse bucket arrays to keep the granular pass allocation-light.
    for (const bucket of this.gridCells) bucket.length = 0
    let used = 0
    if (this.gridCoordinates.length < this.bodies.length * 3)
      this.gridCoordinates = new Int32Array(this.bodies.length * 3)
    const coords = this.gridCoordinates
    for (let i = 0; i < this.bodies.length; i++) {
      const p = this.bodies[i].position
      const x = Math.floor(p.x / CELL) + 1024
      const y = Math.floor(p.y / CELL) + 1024
      const z = Math.floor(p.z / CELL) + 1024
      coords[i * 3] = x; coords[i * 3 + 1] = y; coords[i * 3 + 2] = z
      const key = x * GRID_PLANE + y * GRID_WIDTH + z
      let bucket = this.grid.get(key)
      if (!bucket) {
        bucket = this.gridCells[used] ?? []
        this.gridCells[used++] = bucket
        this.grid.set(key, bucket)
      }
      bucket.push(i)
    }
    for (let i = 0; i < this.bodies.length; i++) {
      const at = i * 3, x = coords[at], y = coords[at + 1], z = coords[at + 2]
      let contacts = 0
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.grid.get((x + dx) * GRID_PLANE + (y + dy) * GRID_WIDTH + z + dz)
        if (!bucket) continue
        for (const j of bucket) {
          if (j <= i) continue
          if (this.resolvePair(this.bodies[i], this.bodies[j]) && ++contacts >= 16) break
        }
        if (contacts >= 16) break
      }
    }
  }

  private resolvePair(a: FoodBody, b: FoodBody) {
    const dx = b.position.x - a.position.x
    const dy = b.position.y - a.position.y
    const dz = b.position.z - a.position.z
    const reach = a.radius + b.radius
    const distanceSquared = dx * dx + dy * dy + dz * dz
    if (distanceSquared >= reach * reach) return false
    const distance = Math.sqrt(distanceSquared)
    // An exact overlap needs a horizontal separating axis: a vertical axis
    // would push one grain into the steel and merge it again on the next step.
    const nx = distance > 1e-8 ? dx / distance : 1
    const ny = distance > 1e-8 ? dy / distance : 0
    const nz = distance > 1e-8 ? dz / distance : 0
    const weight = a.inverseMass + b.inverseMass
    const depth = (reach - distance) * .55
    const shiftA = depth * a.inverseMass / weight
    const shiftB = depth * b.inverseMass / weight
    a.position.x -= nx * shiftA; a.position.y -= ny * shiftA; a.position.z -= nz * shiftA
    b.position.x += nx * shiftB; b.position.y += ny * shiftB; b.position.z += nz * shiftB
    const approach = (b.velocity.x - a.velocity.x) * nx +
      (b.velocity.y - a.velocity.y) * ny + (b.velocity.z - a.velocity.z) * nz
    if (approach < 0) {
      const impulse = -approach * 1.08 / weight
      a.velocity.x -= nx * impulse * a.inverseMass
      a.velocity.y -= ny * impulse * a.inverseMass
      a.velocity.z -= nz * impulse * a.inverseMass
      b.velocity.x += nx * impulse * b.inverseMass
      b.velocity.y += ny * impulse * b.inverseMass
      b.velocity.z += nz * impulse * b.inverseMass
    }
    return true
  }
}

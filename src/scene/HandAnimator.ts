import * as THREE from 'three'

export interface HandPoseState {
  held: string | null
  dragging: boolean
  mode: string
  intensity: number
}

type Finger = 'index' | 'middle' | 'ring' | 'little' | 'thumb'
type Curl = readonly [number, number, number]
type Pose = Record<Finger, Curl>
const FINGERS: Finger[] = ['index', 'middle', 'ring', 'little', 'thumb']
const OPEN: Pose = {
  index: [.06, .12, .07], middle: [.09, .16, .10], ring: [.13, .20, .12],
  little: [.18, .23, .13], thumb: [.08, .16, .10],
}
const LADLE: Pose = {
  index: [.56, .75, .48], middle: [.76, 1.02, .64], ring: [.89, 1.08, .68],
  little: [.94, 1.04, .70], thumb: [.35, .65, .42],
}
const WOK: Pose = {
  index: [.96, 1.14, .63], middle: [1.02, 1.18, .67], ring: [1.07, 1.15, .70],
  little: [1.10, 1.10, .73], thumb: [.46, .69, .44],
}
const BOTTLE: Pose = {
  index: [.66, .89, .54], middle: [.73, .96, .58], ring: [.79, 1.01, .62],
  little: [.88, 1.04, .65], thumb: [.25, .52, .35],
}

interface Joint {
  bone: THREE.Bone
  rest: THREE.Quaternion
  finger: Finger
  segment: number
  curl: number
  spread: number
}

/** Animates finger bones only; the scene owns the wrist and tool attachment. */
export class HandAnimator {
  private readonly joints: Joint[] = []
  private readonly mirror: number
  private readonly bend = new THREE.Quaternion()
  private readonly rotation = new THREE.Euler(0, 0, 0, 'XYZ')

  constructor(root: THREE.Object3D) {
    this.mirror = root.name.includes('left') || root.userData.handSide === 'left' ? -1 : 1
    root.traverse(object => {
      if (!(object instanceof THREE.Bone)) return
      const match = object.name.match(/hand_(?:left|right)_(index|middle|ring|little|thumb)_([123])(?:_\d+)?$/)
      if (!match) return
      this.joints.push({
        bone: object, rest: object.quaternion.clone(), finger: match[1] as Finger,
        segment: Number(match[2]) - 1, curl: 0, spread: 0,
      })
    })
  }

  get jointCount() { return this.joints.length }

  /** dt and time are seconds. The exponential blend is independent of frame rate. */
  update(state: HandPoseState, dt: number, time: number) {
    const held = state.held ?? 'none'
    const empty = held === 'none' || held === ''
    const bottle = ['oil', 'soy', 'oyster'].includes(held) || held.includes('bottle')
    const pose = empty ? OPEN : held === 'wok' ? WOK : bottle ? BOTTLE : LADLE
    const intensity = THREE.MathUtils.clamp(state.intensity, 0, 1)
    const working = ['stirring', 'panning', 'pouring', 'scooping'].includes(state.mode)
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(dt, .1)) * (empty ? 12 : 18))
    for (const joint of this.joints) {
      const index = FINGERS.indexOf(joint.finger)
      const thumb = joint.finger === 'thumb'
      // Quiet independent finger motion and pressure changes keep the grip alive
      // without shifting the wrist anchor or making the held utensil slide.
      const breath = Math.sin(time * (1.7 + index * .14) + index * .83) * (empty ? .025 : .007)
      const pressure = working ? intensity * (.025 + .022 * Math.sin(time * 9 + index * .4)) : 0
      let curl = pose[joint.finger][joint.segment] + breath + pressure
      if (empty && state.dragging) curl *= .42
      let spread = 0
      if (joint.segment === 0) {
        if (thumb) spread = this.mirror * (empty ? .12 : held === 'wok' ? -.67 : bottle ? -.42 : -.54)
        else {
          const openSpread = [-.075, -.015, .035, .11][index]
          spread = -this.mirror * openSpread * (empty ? (state.dragging ? 1.4 : 1) : bottle ? .23 : .05)
        }
      }
      joint.curl += (curl - joint.curl) * alpha
      joint.spread += (spread - joint.spread) * alpha
      // Bone local +Y points distally and +Z faces the back of the hand.
      this.rotation.set(-joint.curl, 0, joint.spread)
      this.bend.setFromEuler(this.rotation)
      joint.bone.quaternion.copy(joint.rest).multiply(this.bend)
    }
  }
}

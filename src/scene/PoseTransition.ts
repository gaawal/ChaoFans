import { MathUtils, Quaternion, Vector3 } from 'three'

export interface PoseTarget {
  position: Vector3
  quaternion: Quaternion
  /** A continuous control value such as bottle tilt; measured in radians. */
  tilt?: number
}

export interface PoseTransitionOptions {
  /** Time used when the pose key changes. The default is 0.22 seconds. */
  duration?: number
  /** Optional smoothing for changes to the target within the same pose key. */
  trackingHalfLife?: number
}

export const POSE_TRANSITION_SECONDS = {
  grab: .22,
  pour: .24,
  scoop: .20,
  stir: .16,
  release: .30,
  rest: .30,
} as const

/**
 * Keeps a moving world-space target responsive while easing discontinuous pose
 * changes. The returned pose is reused on every call; copy it into scene nodes.
 * Use a distinct key for each hold/mode (for example `oil:held`, `oil:pouring`).
 */
export class PoseTransition {
  private key: string | undefined
  private elapsed = 0
  private duration = 0
  private readonly positionOffset = new Vector3()
  private readonly rotationOffset = new Quaternion()
  private tiltOffset = 0
  private readonly filteredPosition = new Vector3()
  private readonly filteredRotation = new Quaternion()
  private filteredTilt = 0
  private readonly scratchRotation = new Quaternion()
  private readonly scratchInverse = new Quaternion()
  private readonly scratchContact = new Vector3()

  readonly pose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    tilt: 0,
  }

  get isTransitioning() { return this.elapsed < this.duration }
  get currentKey() { return this.key }

  snap(target: PoseTarget, key = '') {
    this.key = key
    this.elapsed = this.duration = 0
    this.pose.position.copy(target.position)
    this.pose.quaternion.copy(target.quaternion).normalize()
    this.pose.tilt = target.tilt ?? 0
    this.filteredPosition.copy(this.pose.position)
    this.filteredRotation.copy(this.pose.quaternion)
    this.filteredTilt = this.pose.tilt
    this.positionOffset.set(0, 0, 0)
    this.rotationOffset.identity()
    this.tiltOffset = 0
    return this.pose
  }

  step(key: string, target: PoseTarget, dt: number, options: PoseTransitionOptions = {}) {
    if (this.key === undefined) return this.snap(target, key)

    const seconds = Math.max(0, Number.isFinite(dt) ? dt : 0)
    if (key !== this.key) {
      this.key = key
      this.duration = Math.max(0, options.duration ?? .22)
      this.elapsed = 0
      this.filteredPosition.copy(target.position)
      this.filteredRotation.copy(target.quaternion).normalize()
      this.filteredTilt = target.tilt ?? 0
      // The offset is taken from the *rendered* pose. Interrupting a grab or
      // pour therefore cannot jump the hand back to an older animation source.
      this.positionOffset.copy(this.pose.position).sub(this.filteredPosition)
      this.rotationOffset.copy(this.pose.quaternion)
        .multiply(this.scratchInverse.copy(this.filteredRotation).invert()).normalize()
      this.tiltOffset = this.pose.tilt - this.filteredTilt
    } else {
      const halfLife = Math.max(0, options.trackingHalfLife ?? 0)
      const alpha = halfLife === 0 ? 1 : 1 - Math.exp(-Math.LN2 * seconds / halfLife)
      this.filteredPosition.lerp(target.position, alpha)
      this.filteredRotation.slerp(target.quaternion, alpha).normalize()
      this.filteredTilt = MathUtils.lerp(this.filteredTilt, target.tilt ?? 0, alpha)
    }

    this.elapsed = Math.min(this.duration, this.elapsed + seconds)
    const t = this.duration === 0 ? 1 : MathUtils.clamp(this.elapsed / this.duration, 0, 1)
    const residual = 1 - t * t * (3 - 2 * t)
    this.pose.position.copy(this.filteredPosition).addScaledVector(this.positionOffset, residual)
    this.scratchRotation.identity().slerp(this.rotationOffset, residual)
    this.pose.quaternion.copy(this.scratchRotation).multiply(this.filteredRotation).normalize()
    this.pose.tilt = this.filteredTilt + this.tiltOffset * residual
    return this.pose
  }

  /**
   * Recompute the wrist after blending rotation so a held tool's local contact
   * point stays exactly on the food or pan. Call after step() during active
   * scoop/stir contact. The pinned wrist becomes the source of the next mode.
   */
  pinContact(worldContact: Vector3, localContact: Vector3) {
    this.pose.position.copy(worldContact)
      .sub(this.scratchContact.copy(localContact).applyQuaternion(this.pose.quaternion))
    return this.pose
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { Quaternion, Vector3 } from 'three'
import { PoseTransition, POSE_TRANSITION_SECONDS } from './PoseTransition'

const pose = (x: number, angle = 0, tilt = 0) => ({
  position: new Vector3(x, 0, 0),
  quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle),
  tilt,
})

test('grip to pour moves wrist, rotation and tilt together without a first-frame jump', () => {
  const transition = new PoseTransition()
  transition.snap(pose(0), 'oil:held')
  const target = pose(1, Math.PI / 2, 1)
  const start = transition.step('oil:pouring', target, 0, { duration: POSE_TRANSITION_SECONDS.pour })
  assert.equal(start.position.x, 0)
  assert.equal(start.tilt, 0)
  assert.ok(start.quaternion.angleTo(pose(0).quaternion) < 1e-8)

  const middle = transition.step('oil:pouring', target, .12)
  assert.ok(Math.abs(middle.position.x - .5) < 1e-8)
  assert.ok(Math.abs(middle.tilt - .5) < 1e-8)
  assert.ok(Math.abs(middle.quaternion.angleTo(target.quaternion) - Math.PI / 4) < 1e-7)

  const finish = transition.step('oil:pouring', target, .12)
  assert.equal(finish.position.x, 1)
  assert.equal(finish.tilt, 1)
  assert.ok(finish.quaternion.angleTo(target.quaternion) < 1e-8)
  assert.equal(transition.isTransitioning, false)
})

test('interrupting a bottle pour with release starts at its visible pose', () => {
  const transition = new PoseTransition()
  transition.snap(pose(0), 'oil:held')
  transition.step('oil:pouring', pose(2, Math.PI / 2, 1), .08, { duration: .24 })
  const before = {
    position: transition.pose.position.clone(),
    quaternion: transition.pose.quaternion.clone(),
    tilt: transition.pose.tilt,
  }
  transition.step('oil:release', pose(-1, -Math.PI / 3), 0, { duration: .30 })
  assert.ok(transition.pose.position.distanceTo(before.position) < 1e-8)
  assert.ok(transition.pose.quaternion.angleTo(before.quaternion) < 1e-8)
  assert.ok(Math.abs(transition.pose.tilt - before.tilt) < 1e-8)
  transition.step('oil:release', pose(-1, -Math.PI / 3), .30)
  assert.ok(transition.pose.position.distanceTo(pose(-1).position) < 1e-8)
  assert.ok(transition.pose.quaternion.angleTo(pose(-1, -Math.PI / 3).quaternion) < 1e-8)
})

test('moving targets follow during a transition and same-mode motion can be softened', () => {
  const transition = new PoseTransition()
  transition.snap(pose(0), 'ladle:rest')
  transition.step('ladle:grab', pose(2), .1, { duration: .2 })
  const shifted = transition.step('ladle:grab', pose(3), .05, { trackingHalfLife: .04 })
  assert.ok(shifted.position.x > 1.6 && shifted.position.x < 2.8)
  const shiftedX = shifted.position.x
  const after = transition.step('ladle:grab', pose(3), .2, { trackingHalfLife: .04 })
  assert.ok(after.position.x > shiftedX)
  assert.ok(after.position.x <= 3)
})

test('rotation takes the short arc across the plus/minus pi boundary', () => {
  const transition = new PoseTransition()
  transition.snap(pose(0, Math.PI - .02), 'held')
  transition.step('pouring', pose(0, -Math.PI + .02), .12, { duration: .24 })
  assert.ok(transition.pose.quaternion.angleTo(pose(0, Math.PI).quaternion) < .001)
  assert.ok(Math.abs(transition.pose.quaternion.length() - 1) < 1e-12)
})

test('spoon contact stays exact while wrist rotation eases and release starts there', () => {
  const transition = new PoseTransition()
  const bowlInWrist = new Vector3(0, -.087, -.509)
  const foodContact = new Vector3(.2, 1.15, -.1)
  transition.snap(pose(0), 'ladle:scoop')
  transition.step('ladle:stir', pose(.4, Math.PI / 2), .04, { duration: .16 })
  const pinned = transition.pinContact(foodContact, bowlInWrist)
  const actualBowl = pinned.position.clone().add(bowlInWrist.clone().applyQuaternion(pinned.quaternion))
  assert.ok(actualBowl.distanceTo(foodContact) < 1e-10)
  const oldWrist = pinned.position.clone()
  transition.step('ladle:release', pose(-.3), 0, { duration: .30 })
  assert.ok(transition.pose.position.distanceTo(oldWrist) < 1e-10)
})

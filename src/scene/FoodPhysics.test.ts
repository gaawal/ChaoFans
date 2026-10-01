import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Quaternion, Vector3} from 'three'
import {FoodPhysics, type PanPose} from './FoodPhysics'

const home = (): PanPose => ({position: new Vector3(0, 1.1, 0), quaternion: new Quaternion()})
const advance = (physics: FoodPhysics, pan: PanPose, seconds: number) => {
  for (let i = 0; i < Math.ceil(seconds * 120); i++) physics.step(1 / 120, pan)
}

test('rice retains its original size and falls onto the concave steel surface', () => {
  const pan = home()
  const physics = new FoodPhysics(pan, {random: () => .5})
  physics.setCount('rice', 1, new Vector3(0, 1.48, 0))
  const rice = physics.get('rice')[0]
  const radius = rice.radius
  advance(physics, pan, 1.5)
  assert.equal(rice.scale, 1)
  assert.equal(rice.radius, radius)
  assert.ok(rice.position.y < 1.14, `grain should settle inside wok; y=${rice.position.y}`)
  assert.ok(rice.position.y > 1.103, `grain should remain above steel; y=${rice.position.y}`)
})

test('an airborne ingredient stays in world space when the player moves the wok', () => {
  const pan = home()
  const physics = new FoodPhysics(pan, {random: () => .5})
  physics.setCount('carrot', 1, new Vector3(0, 1.72, 0))
  const carrot = physics.get('carrot')[0]
  const originalX = carrot.position.x
  pan.position.x = .55
  physics.step(1 / 60, pan)
  assert.ok(Math.abs(carrot.position.x - originalX) < .015,
    `airborne food moved with the wok by ${carrot.position.x - originalX}m`)
  advance(physics, pan, .55)
  assert.ok(carrot.position.y >= 1.003 + carrot.radius - 1e-5,
    'a spilled piece must collide with the stainless worktop')
})

test('a pan flick gives resting grains upward velocity, then gravity brings them back', () => {
  const pan = home()
  const physics = new FoodPhysics(pan, {random: () => .5})
  physics.setCount('rice', 1, new Vector3(0, 1.20, 0))
  advance(physics, pan, .5)
  const rice = physics.get('rice')[0]
  physics.step(1 / 60, pan, {toss: 1})
  assert.ok(rice.velocity.y > 1, `toss needs an actual upward impulse; vy=${rice.velocity.y}`)
  const peakStart = rice.position.y
  advance(physics, pan, .13)
  assert.ok(rice.position.y > peakStart + .08, 'a tossed grain should visibly rise above the food')
  advance(physics, pan, .6)
  assert.ok(rice.position.y < 1.2, 'gravity should bring the grain back to the wok')
})

test('tilting the wok makes settled food slide down the real bowl curve', () => {
  const pan = home()
  const physics = new FoodPhysics(pan, {random: () => .5})
  physics.setCount('rice', 1, new Vector3(0, 1.25, 0))
  advance(physics, pan, .8)
  const rice = physics.get('rice')[0]
  const originalX = rice.position.x
  pan.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), .35)
  advance(physics, pan, 1)
  assert.ok(rice.position.x < originalX - .035,
    `tilted pan should make a grain move down its slope; dx=${rice.position.x - originalX}`)
})

test('the moving ladle only pushes grains that touch its bowl', () => {
  const pan = home()
  const physics = new FoodPhysics(pan, {random: () => .5, gravity: 0})
  physics.setCount('peas', 1, new Vector3(0, 1.35, 0))
  const pea = physics.get('peas')[0]
  const initial = pea.position.clone()
  const farSpoon = initial.clone().add(new Vector3(.25, 0, 0))
  physics.step(1 / 60, pan, {spoons: [{id: 'right', position: farSpoon}]})
  const withoutContact = pea.position.clone()
  assert.ok(withoutContact.distanceTo(initial) < .01)
  const touchingSpoon = pea.position.clone().add(new Vector3(-.015, 0, 0))
  physics.step(1 / 60, pan, {spoons: [{id: 'right', position: touchingSpoon}]})
  assert.ok(pea.position.x > withoutContact.x + .005,
    'collision with the bowl should displace the pea instead of using a gesture zone')
})

test('separate rice grains repel instead of merging into one surface', () => {
  const pan = home()
  const physics = new FoodPhysics(pan, {random: () => 0})
  physics.setCount('rice', 2, new Vector3(0, 1.18, 0))
  advance(physics, pan, .12)
  const [one, two] = physics.get('rice')
  assert.ok(one.position.distanceTo(two.position) >= .003,
    'two grains should not occupy the same point after contact solving')
  assert.equal(physics.count, 2)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSimulation, priceFor, type Bottle, type CookingSimulation, type HandSide, type Ingredient, type Vec3, type Zone } from './simulation'

const WOK: Vec3 = [0, 1.2, 0]
const HANDLE: Vec3 = [-.43, 1.28, .44]
const TRAY: Vec3 = [.6, 1.15, -.3]
const SERVE: Vec3 = [-.6, 1.15, .1]

function advance(sim: CookingSimulation, seconds: number) {
  const ticks = Math.round(seconds / .05)
  for (let i = 0; i < ticks; i++) sim.update(.05)
}

function start() {
  const sim = createSimulation(() => .3)
  sim.start()
  return sim
}

const KNOB: Vec3 = [-.39, 1.15, .463]

test('the gas knob sets the fire level absolutely, and the burner answers to it', () => {
  const sim = start()
  assert.equal(sim.state.fire, .65)
  // Drag the hand across the knob: the further right, the stronger the flame.
  sim.beginDrag('left')
  sim.moveHand('left', 'knob', [-.495, 1.15, .463], .4)
  assert.equal(sim.state.fire, 0)
  sim.moveHand('left', 'knob', [-.285, 1.15, .463], .4)
  assert.equal(sim.state.fire, 1)
  sim.moveHand('left', 'knob', [-.39, 1.15, .463], .4)
  assert.ok(Math.abs(sim.state.fire - .5) < 1e-8)
  sim.endDrag('left', 'knob')
  assert.match(sim.state.notice, /火力调到 50%/)
  // Off flame, the pan over the burner cools; wide open, it climbs past .8.
  sim.beginDrag('left')
  sim.moveHand('left', 'knob', [-.495, 1.15, .463], .4)
  sim.endDrag('left', 'knob')
  advance(sim, 30)
  const cold = sim.state.temperature
  assert.ok(cold < .2, `burner off should cool the pan, got ${cold}`)
  sim.beginDrag('left')
  sim.moveHand('left', 'knob', [-.285, 1.15, .463], .4)
  sim.endDrag('left', 'knob')
  advance(sim, 30)
  assert.ok(sim.state.temperature > .75, `full flame should be hot, got ${sim.state.temperature}`)
})

test('orders come off a menu of named dishes with matching ingredients', () => {
  // A varied random so the dish book is actually sampled, not one dish ten times.
  let seed = 7
  const random = () => { seed = (seed * 37 + 11) % 97; return seed / 97 }
  const sim = createSimulation(random)
  sim.start()
  // Order 1 still teaches bacon and carrot by name.
  assert.equal(sim.state.order.title, '腊肉胡萝卜炒饭')
  assert.deepEqual(sim.state.order.ingredientKeys, ['bacon', 'carrot'])
  const seen = new Set<string>()
  for (let id = 2; id <= 5; id++) {
    sim.state.completed = id - 1
    sim.state.phase = 'result'
    sim.continue()
    const order = sim.state.order
    assert.ok(order.title.length >= 4, `dish title should be a real name, got ${order.title}`)
    assert.ok(order.ingredientKeys.length >= 1)
    seen.add(order.title)
  }
  assert.ok(seen.size >= 2, 'the menu should serve more than one dish')
})

function ingredient(sim: CookingSimulation, kind: Ingredient, side: HandSide = 'right') {
  sim.beginDrag(side)
  if (sim.state.hands[side].held === 'none') {
    sim.moveHand(side, 'rest', HANDLE, .2)
    sim.endDrag(side, 'rest')
    sim.beginDrag(side)
  }
  scoop(sim, kind, side)
  circle(sim, side)
  sim.endDrag(side, 'wok')
}

function scoop(sim: CookingSimulation, kind: Ingredient, side: HandSide = 'right') {
  for (let i = 0; i < 4; i++) sim.moveHand(side, kind, [TRAY[0] + (i % 2 ? -.05 : .05), TRAY[1], TRAY[2]], .5, { sweep: .26 })
}

function circle(sim: CookingSimulation, side: HandSide) {
  for (let i = 0; i < 4; i++) sim.moveHand(side, 'wok', [.25, 1.35, 0], .3, { circle: .26 })
}

function bottle(sim: CookingSimulation, kind: Bottle, seconds = 2) {
  sim.beginDrag('left')
  sim.moveHand('left', kind, TRAY, .3)
  sim.endDrag('left', kind)
  sim.beginDrag('left')
  circle(sim, 'left')
  advance(sim, seconds)
  sim.endDrag('left', 'wok')
  sim.beginDrag('left')
  sim.moveHand('left', kind, TRAY, .3)
  sim.endDrag('left', kind)
}

function stir(sim: CookingSimulation, intensity = .8) {
  sim.beginDrag('right')
  for (let i = 0; i < 5; i++) sim.moveHand('right', 'wok', [i % 2 ? -.12 : .12, 1.2, 0], intensity)
  sim.endDrag('right', 'wok')
}

function serve(sim: CookingSimulation) {
  sim.beginDrag('right')
  sim.moveHand('right', 'serve', SERVE, .3)
  sim.endDrag('right', 'serve')
}

function cookOrder(sim: CookingSimulation) {
  bottle(sim, 'oil')
  for (const kind of sim.state.order.ingredientKeys) ingredient(sim, kind)
  ingredient(sim, 'rice')
  stir(sim)
  advance(sim, 12)
  bottle(sim, 'soy')
  advance(sim, 28)
  serve(sim)
}

test('start has an empty usable wok, a right ladle, and the four requested prices', () => {
  const sim = createSimulation()
  sim.update(5)
  assert.equal(sim.state.phase, 'menu')
  assert.equal(sim.state.time, 0)
  sim.start()
  assert.equal(sim.state.phase, 'playing')
  assert.ok(Object.values(sim.state.food).every(amount => amount === 0))
  assert.equal(sim.state.hands.right.held, 'ladle')
  assert.equal(sim.state.hands.left.held, 'none')
  assert.deepEqual([[1, 1], [1, 2], [2, 1], [2, 2]].map(([meats, vegetables]) => priceFor(meats, vegetables)), [10, 12, 14, 16])
})

test('passing over objects never acquires bottles, ingredients, or the wok', () => {
  const sim = start()
  for (const side of ['left', 'right'] as const) {
    sim.beginDrag(side)
    for (const zone of ['carrot', 'oil', 'soy', 'oyster', 'handle', 'wok'] as Zone[]) {
      sim.moveHand(side, zone, TRAY, 1)
      assert.equal(sim.state.hands[side].held, side === 'right' ? 'ladle' : 'none')
      assert.equal(sim.state.hands[side].payload, null)
    }
    sim.endDrag(side, null)
  }
  assert.ok(Object.values(sim.state.food).every(amount => amount === 0))
})

test('ingredients require real scoop sweeps and a circle to overturn the loaded spoon', () => {
  const sim = start()
  sim.beginDrag('right')
  sim.moveHand('right', 'carrot', TRAY, .5)
  assert.equal(sim.state.hands.right.payload, null)
  sim.moveHand('right', 'carrot', TRAY, .5, { sweep: .25 })
  assert.equal(sim.state.hands.right.payload, null)
  scoop(sim, 'carrot')
  assert.equal(sim.state.hands.right.payload, 'carrot')
  assert.equal(sim.state.hands.right.held, 'scoop')
  assert.equal(sim.state.food.carrot, 0)
  // Crossing another tray must not turn carrot shreds into onion shreds.
  sim.moveHand('right', 'onion', TRAY, .5)
  assert.equal(sim.state.hands.right.payload, 'carrot')
  sim.moveHand('right', 'wok', WOK, .5)
  advance(sim, 1)
  assert.equal(sim.state.food.carrot, 0)
  sim.endDrag('right', 'wok')
  assert.equal(sim.state.food.carrot, 0)
  assert.equal(sim.state.hands.right.payload, 'carrot')
  sim.beginDrag('right')
  sim.moveHand('right', 'wok', WOK, .5, { circle: .5 })
  assert.equal(sim.state.food.carrot, 0)
  sim.moveHand('right', 'wok', WOK, .5, { circle: .5 })
  assert.equal(sim.state.food.carrot, .7)
  assert.equal(sim.state.food.onion, 0)
  assert.equal(sim.state.hands.right.payload, null)
  assert.equal(sim.state.hands.right.held, 'ladle')
})

test('scooped food stays held between drags until an explicit overturn gesture', () => {
  const sim = start()
  sim.beginDrag('right')
  sim.moveHand('right', 'bacon', TRAY, .2)
  sim.endDrag('right', 'bacon')
  assert.equal(sim.state.hands.right.payload, null)
  sim.beginDrag('right')
  scoop(sim, 'bacon')
  sim.endDrag('right', 'bacon')
  assert.equal(sim.state.hands.right.payload, 'bacon')
  assert.equal(sim.state.food.bacon, 0)
  advance(sim, 2)
  sim.beginDrag('right')
  sim.moveHand('right', 'wok', WOK, .2)
  assert.equal(sim.state.food.bacon, 0)
  circle(sim, 'right')
  sim.endDrag('right', 'wok')
  assert.equal(sim.state.food.bacon, .7)
  ingredient(sim, 'onion')
  assert.equal(sim.state.food.onion, .7)
  assert.equal(sim.state.food.carrot, 0)
})

test('rest puts held food and bottles back without adding anything to the wok', () => {
  const sim = start()
  // A loaded spoon is emptied back into its tray and the ladle is put down.
  sim.beginDrag('right')
  scoop(sim, 'egg')
  sim.endDrag('right', 'egg')
  assert.equal(sim.state.hands.right.payload, 'egg')
  sim.beginDrag('right')
  sim.moveHand('right', 'rest', HANDLE, .2)
  sim.endDrag('right', 'rest')
  assert.equal(sim.state.hands.right.payload, null)
  assert.equal(sim.state.hands.right.held, 'none')
  assert.equal(sim.state.ladle.resting, true)
  for (const kind of ['oil', 'oyster'] as Bottle[]) {
    sim.beginDrag('left')
    sim.moveHand('left', kind, TRAY, .2)
    sim.endDrag('left', kind)
    assert.equal(sim.state.hands.left.held, kind)
    sim.beginDrag('left')
    sim.moveHand('left', 'rest', HANDLE, .2)
    sim.endDrag('left', 'rest')
    assert.equal(sim.state.hands.left.held, 'none')
  }
  assert.ok(Object.values(sim.state.food).every(amount => amount === 0))
})

test('the ladle is one shared object: put it down on the front strip, take it with the other hand', () => {
  const sim = start()
  assert.equal(sim.state.hands.right.held, 'ladle')
  assert.equal(sim.state.ladle.resting, false)

  sim.beginDrag('right')
  sim.moveHand('right', 'rest', [-.3, 1.02, .44], .2)
  sim.endDrag('right', 'rest')
  assert.equal(sim.state.hands.right.held, 'none')
  assert.equal(sim.state.ladle.resting, true)
  assert.ok(Math.abs(sim.state.ladle.spot[0] + .21) < 1e-8)
  assert.match(sim.state.hint, /锅铲放在台面前沿/)

  // The empty right hand cannot pick it up from somewhere else.
  sim.beginDrag('right')
  sim.moveHand('right', 'wok', WOK, .2)
  sim.endDrag('right', 'wok')
  assert.equal(sim.state.hands.right.held, 'none')

  // The left hand takes it instead, and then the right hand finds nothing to take.
  sim.beginDrag('left')
  sim.moveHand('left', 'rest', HANDLE, .2)
  sim.endDrag('left', 'rest')
  assert.equal(sim.state.hands.left.held, 'ladle')
  assert.equal(sim.state.ladle.resting, false)
  sim.beginDrag('right')
  sim.moveHand('right', 'rest', HANDLE, .2)
  sim.endDrag('right', 'rest')
  assert.equal(sim.state.hands.right.held, 'none')
  assert.match(sim.state.notice, /锅铲在另一只手里/)
})

test('a hand without the ladle cannot scoop ingredients', () => {
  const sim = start()
  sim.beginDrag('right')
  sim.moveHand('right', 'rest', HANDLE, .2)
  sim.endDrag('right', 'rest')
  assert.equal(sim.state.ladle.resting, true)
  sim.beginDrag('left')
  sim.moveHand('left', 'carrot', TRAY, .5)
  sim.endDrag('left', 'carrot')
  assert.equal(sim.state.hands.left.held, 'none')
  assert.match(sim.state.notice, /空手铲不起料/)
  sim.beginDrag('left')
  for (let i = 0; i < 4; i++) sim.moveHand('left', 'carrot', TRAY, .5, { sweep: .26 })
  assert.equal(sim.state.hands.left.payload, null)
  assert.equal(sim.state.food.carrot, 0)
  assert.match(sim.state.hint, /锅铲放在台面前沿/)
})

test('reaching for a bottle or the pan handle parks the ladle on the counter', () => {
  const sim = start()
  // The right hand starts the shift with the ladle.
  assert.equal(sim.state.hands.right.held, 'ladle')
  sim.beginDrag('right')
  sim.moveHand('right', 'soy', TRAY, .3)
  sim.endDrag('right', 'soy')
  assert.equal(sim.state.hands.right.held, 'soy')
  // The ladle is not quietly lost: it is on the front strip, ready to be picked up.
  assert.equal(sim.state.ladle.resting, true)
  assert.ok(Math.abs(sim.state.ladle.spot[0] - .21) < 1e-8)
  sim.beginDrag('right')
  sim.moveHand('right', 'soy', TRAY, .3)
  sim.endDrag('right', 'soy')
  assert.equal(sim.state.hands.right.held, 'none')

  // An empty hand takes the ladle back, and grabbing the pan parks it once more.
  sim.beginDrag('right')
  sim.moveHand('right', 'rest', HANDLE, .2)
  sim.endDrag('right', 'rest')
  assert.equal(sim.state.hands.right.held, 'ladle')
  sim.beginDrag('right')
  sim.moveHand('right', 'handle', HANDLE, .2)
  sim.endDrag('right', 'handle')
  assert.equal(sim.state.hands.right.held, 'wok')
  assert.equal(sim.state.ladle.resting, true)
})

test('bottles require confirmed grip and wrist rotation; release stops pouring but keeps the bottle', () => {
  const sim = start()
  for (const kind of ['oil', 'soy', 'oyster'] as const) {
    sim.beginDrag('left')
    sim.moveHand('left', kind, TRAY, 0)
    assert.equal(sim.state.hands.left.held, 'none')
    sim.endDrag('left', kind)
    assert.equal(sim.state.hands.left.held, kind)
    advance(sim, 2)
    assert.equal(sim.state.food[kind], 0)
    sim.beginDrag('left')
    sim.moveHand('left', 'wok', WOK, 0)
    advance(sim, 1)
    assert.equal(sim.state.food[kind], 0)
    sim.moveHand('left', 'wok', WOK, 0, { circle: .5 })
    advance(sim, 1)
    assert.equal(sim.state.food[kind], 0)
    sim.moveHand('left', 'wok', WOK, 0, { circle: .5 })
    advance(sim, 1)
    const firstSecond = sim.state.food[kind]
    assert.ok(firstSecond > 0 && firstSecond < .3)
    if (kind === 'oyster') assert.ok(Math.abs(firstSecond - .14) < 1e-8)
    advance(sim, 1)
    assert.ok(Math.abs(sim.state.food[kind] - firstSecond * 2) < 1e-8)
    sim.endDrag('left', 'wok')
    assert.equal(sim.state.hands.left.held, kind)
    assert.equal(sim.state.hands.left.tilt, 0)
    const finalAmount = sim.state.food[kind]
    advance(sim, 2)
    assert.equal(sim.state.food[kind], finalAmount)
    sim.beginDrag('left')
    assert.equal(sim.state.hands.left.held, kind)
    sim.moveHand('left', kind, TRAY, .2)
    sim.endDrag('left', kind)
    assert.equal(sim.state.hands.left.held, 'none')
  }
})

test('a few pointer strokes teach a stir that keeps going after releasing the hand', () => {
  const sim = start()
  ingredient(sim, 'rice')
  stir(sim, .65)
  assert.equal(sim.state.hands.right.dragging, false)
  assert.equal(sim.state.hands.right.mode, 'stirring')
  const intensity = sim.state.motion
  const before = sim.state.quality[0]
  assert.ok(intensity > .5)
  advance(sim, 10)
  assert.equal(sim.state.motion, intensity)
  assert.equal(sim.state.hands.right.mode, 'stirring')
  assert.ok(sim.state.quality[0] > before + 5)
})

test('grabbing the right hand stops its remembered stir immediately', () => {
  const sim = start()
  ingredient(sim, 'rice')
  stir(sim)
  advance(sim, 1)
  sim.beginDrag('right')
  assert.equal(sim.state.motion, 0)
  assert.equal(sim.state.hands.right.mode, 'holding')
  advance(sim, 2)
  assert.equal(sim.state.motion, 0)
  sim.moveHand('right', 'rest', SERVE, .6)
  sim.endDrag('right', 'rest')
  assert.equal(sim.state.motion, 0)
})

test('holding the mouse still stops manual stirring, while release resumes the learned rhythm', () => {
  const sim = start()
  ingredient(sim, 'rice')
  sim.beginDrag('right')
  for (let i = 0; i < 5; i++) sim.moveHand('right', 'wok', WOK, .8)
  assert.ok(sim.state.motion > .7)
  advance(sim, 1)
  assert.ok(sim.state.motion < .01)
  sim.endDrag('right', 'wok')
  assert.ok(sim.state.motion > .7)
  advance(sim, 2)
  assert.ok(sim.state.motion > .7)
})

test('left-hand pan movement works with continued right stirring and settles after release', () => {
  const sim = start()
  ingredient(sim, 'rice')
  stir(sim)
  const rightIntensity = sim.state.motion
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', HANDLE, .9)
  assert.equal(sim.state.hands.left.held, 'none')
  sim.endDrag('left', 'handle')
  assert.equal(sim.state.hands.left.held, 'wok')
  assert.equal(sim.state.hands.left.mode, 'panning')
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', [HANDLE[0] + .04, HANDLE[1] + .07, HANDLE[2]], .9)
  assert.ok(sim.state.toss > .5)
  assert.equal(sim.state.motion, rightIntensity)
  sim.endDrag('left', 'handle')
  const panMotion = sim.state.hands.left.intensity
  advance(sim, 2)
  assert.equal(sim.state.hands.left.held, 'wok')
  assert.ok(sim.state.hands.left.intensity < panMotion * .01)
  assert.equal(sim.state.motion, rightIntensity)
  assert.equal(sim.state.hands.right.mode, 'stirring')
})

test('the wok stays in the hand, moves off the stove, cools, and can be placed back', () => {
  const sim = start()
  advance(sim, 20)
  const hot = sim.state.temperature
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', HANDLE, .2)
  sim.endDrag('left', 'handle')
  sim.beginDrag('left')
  assert.equal(sim.state.hands.left.held, 'wok')
  sim.moveHand('left', null, [HANDLE[0] + .6, HANDLE[1] + .4, HANDLE[2]], .3)
  assert.ok(Math.abs(sim.state.pan.position[0] - .6) < 1e-8)
  assert.ok(sim.state.pan.lift > .39)
  sim.endDrag('left', null)
  assert.equal(sim.state.hands.left.held, 'wok')
  const carriedPosition = [...sim.state.pan.position]
  advance(sim, 8)
  assert.deepEqual(sim.state.pan.position, carriedPosition)
  assert.ok(sim.state.temperature < hot * .6)
  sim.beginDrag('left')
  assert.equal(sim.state.hands.left.held, 'wok')
  // Over the stove but still up in the hand, so letting go has to lower it.
  sim.moveHand('left', 'handle', [HANDLE[0], HANDLE[1] + .3, HANDLE[2]], .2)
  assert.ok(sim.state.pan.lift > .2)
  sim.endDrag('left', 'handle')
  // The pan travels back down onto the rack rather than teleporting to it.
  assert.ok(sim.state.pan.lift > .2, 'the pan must not teleport back onto the rack')
  advance(sim, 1)
  assert.deepEqual(sim.state.pan.position, [0, 1.1, 0])
  assert.equal(sim.state.pan.lift, 0)
  assert.equal(sim.state.hands.left.held, 'wok')
  assert.match(sim.state.notice, /落在锅架/)
  // Bringing the hand all the way down carries the pan down with it.
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', [HANDLE[0], HANDLE[1] - .3, HANDLE[2]], .2)
  assert.equal(sim.state.pan.lift, 0)
  sim.endDrag('left', 'handle')
  assert.deepEqual(sim.state.pan.position, [0, 1.1, 0])
  assert.match(sim.state.notice, /落在锅架/)
  const cool = sim.state.temperature
  advance(sim, 6)
  assert.ok(sim.state.temperature > cool)
})

test('a released wok finishes falling even if the ticket closes mid-drop', () => {
  const sim = start()
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', HANDLE, .2)
  sim.endDrag('left', 'handle')
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', [HANDLE[0], HANDLE[1] + .3, HANDLE[2]], .2)
  sim.endDrag('left', 'handle')
  assert.ok(sim.state.pan.lift > .2, 'let go of a raised pan so it has to fall')

  // The player pauses (or the ticket runs out) one frame into the drop. A pan in
  // the air belongs to the physics, not to the clock, so it must not hang there.
  const spoken = sim.state.notice
  sim.setPaused(true)
  assert.equal(sim.state.phase, 'paused')
  advance(sim, 1)
  assert.deepEqual(sim.state.pan.position, [0, 1.1, 0], 'the pan froze in mid-air over the stove')
  assert.equal(sim.state.pan.lift, 0)
  assert.equal(sim.state.notice, spoken, 'landing must not talk over the card on screen')
})

test('the wok rides up the pan support and cannot be dragged through the trays or the shelf', () => {
  const sim = start()
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', HANDLE, .2)
  sim.endDrag('left', 'handle')
  sim.beginDrag('left')

  // Sideways at stove height: the bowl climbs the cast-iron ring instead of clipping it.
  for (let i = 1; i <= 4; i++) sim.moveHand('left', null, [HANDLE[0] + i * .05, HANDLE[1], HANDLE[2]], .2)
  assert.ok(Math.abs(sim.state.pan.position[0] - .2) < .005, `slid to ${sim.state.pan.position[0]}`)
  assert.ok(sim.state.pan.position[1] > 1.13, `lifted only to ${sim.state.pan.position[1]}`)

  // Holding it down over the ring: the prongs stop the bowl, it cannot sink through.
  for (let i = 1; i <= 20; i++) sim.moveHand('left', null, [HANDLE[0] + .2, HANDLE[1] - i * .05, HANDLE[2]], .2)
  assert.ok(sim.state.pan.position[1] > 1.19, `the bowl sank to ${sim.state.pan.position[1]}`)

  // Sliding back over the burner lets it down onto the ring, not onto the table.
  for (let i = 4; i >= 0; i--) sim.moveHand('left', null, [HANDLE[0] + i * .05, HANDLE[1] - .3, HANDLE[2]], .2)
  assert.ok(Math.abs(sim.state.pan.position[1] - 1.096) < .01, `docked at ${sim.state.pan.position[1]}`)

  // A hand that jerks sideways at stove height is stopped before the tray bank.
  sim.moveHand('left', null, [HANDLE[0] + 1.3, HANDLE[1], HANDLE[2]], .2)
  assert.ok(sim.state.pan.position[0] < .5, `pan reached ${sim.state.pan.position[0]}`)
  assert.match(sim.state.notice, /备料盘/)

  // Lifted clear of the tray rims, the same sideways move is free.
  for (let i = 1; i <= 6; i++) sim.moveHand('left', null, [HANDLE[0] + .3 + i * .12, HANDLE[1] + .3, HANDLE[2]], .4)
  assert.ok(sim.state.pan.position[0] > .5, `a raised pan only reached ${sim.state.pan.position[0]}`)

  // Set down at working height over the left end, then pushed backwards: the
  // condiment shelf and its bottles keep the pan out.
  sim.moveHand('left', null, [HANDLE[0] - .6, HANDLE[1], HANDLE[2]], .3)
  assert.ok(Math.abs(sim.state.pan.position[0] + .6) < 1e-8)
  for (let i = 1; i <= 8; i++) sim.moveHand('left', null, [HANDLE[0] - .6, HANDLE[1], HANDLE[2] - i * .08], .3)
  assert.ok(sim.state.pan.position[2] >= -.35 && sim.state.pan.position[2] < -.2, `pan reached z ${sim.state.pan.position[2]}`)
  assert.match(sim.state.notice, /调料架/)
  assert.equal(sim.state.hands.left.held, 'wok')
})

test('letting go of a lifted wok puts it down on a real surface', () => {
  const sim = start()
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', HANDLE, .2)
  sim.endDrag('left', 'handle')
  sim.beginDrag('left')
  // Carry it off the stove, above the open worktop left of the tray bank, then
  // open the hand. The bank itself would catch the pan at its own rim height.
  sim.moveHand('left', null, [-.5, 1.78, .89], .3)
  assert.ok(sim.state.pan.lift > .4)
  sim.endDrag('left', 'rest')
  assert.equal(sim.state.hands.left.held, 'none')
  assert.ok(sim.state.pan.lift > .4, 'the pan must not teleport on release')
  advance(sim, 2)
  assert.equal(sim.state.pan.lift, 0)
  assert.ok(Math.abs(sim.state.pan.position[1] - 1.0039) < 1e-6, `landed at ${sim.state.pan.position[1]}`)
  assert.match(sim.state.notice, /台面/)
})

test('wok movement is constrained and crossing a tray never swaps it for ingredients', () => {
  const sim = start()
  sim.beginDrag('left')
  sim.moveHand('left', 'handle', HANDLE, .2)
  sim.endDrag('left', 'handle')
  sim.beginDrag('left')
  sim.moveHand('left', 'carrot', [8, 9, 7], 1, { sweep: 1 })
  assert.equal(sim.state.hands.left.held, 'wok')
  assert.equal(sim.state.hands.left.payload, null)
  assert.ok(Math.hypot(sim.state.pan.position[0], sim.state.pan.position[2]) <= .750001)
  assert.equal(sim.state.pan.lift, .55)
  sim.endDrag('left', 'carrot')
  assert.equal(sim.state.hands.left.held, 'wok')
  assert.equal(sim.state.pan.lift, .55)
})

test('two hands cannot acquire the same physical bottle or wok', () => {
  const sim = start()
  for (const zone of ['oil', 'oyster', 'handle'] as const) {
    sim.beginDrag('left')
    sim.moveHand('left', zone, HANDLE, .2)
    sim.endDrag('left', zone)
    const item = zone === 'handle' ? 'wok' : zone
    assert.equal(sim.state.hands.left.held, item)
    sim.beginDrag('right')
    sim.moveHand('right', zone, HANDLE, .2)
    sim.endDrag('right', zone)
    assert.equal(sim.state.hands.right.held, 'ladle')
    sim.beginDrag('left')
    sim.moveHand('left', 'rest', HANDLE, .2)
    sim.endDrag('left', 'rest')
  }
})

test('two hands crossing the actual wok center interfere without corrupting cooking state', () => {
  const sim = start()
  stir(sim)
  const baseline = sim.state.motion
  sim.beginDrag('left')
  sim.moveHand('left', 'wok', [.1, 1.2, 0], .7)
  sim.update(.1)
  assert.ok(sim.state.motion < baseline)
  assert.match(sim.state.notice, /两只手/)
  sim.moveHand('left', 'handle', HANDLE, .7)
  assert.equal(sim.state.motion, baseline)
})

test('pause freezes pouring, cooking, customers, and input until resumed', () => {
  const sim = start()
  ingredient(sim, 'rice')
  stir(sim)
  advance(sim, 2)
  sim.setPaused(true)
  const frozen = JSON.stringify(sim.state)
  sim.update(10)
  sim.beginDrag('left')
  sim.moveHand('left', 'oil', TRAY, .8)
  sim.endDrag('left', 'wok')
  assert.equal(JSON.stringify(sim.state), frozen)
  sim.setPaused(false)
  sim.update(.1)
  assert.ok(sim.state.time > JSON.parse(frozen).time)
})

test('pausing while pouring oyster sauce keeps the bottle but stops all sauce flow', () => {
  const sim = start()
  sim.beginDrag('left')
  sim.moveHand('left', 'oyster', TRAY, .3)
  assert.equal(sim.state.hands.left.held, 'none')
  sim.endDrag('left', 'oyster')
  assert.match(sim.state.notice, /蚝油瓶/)
  sim.beginDrag('left')
  circle(sim, 'left')
  advance(sim, 1)
  const amount = sim.state.food.oyster
  assert.ok(Math.abs(amount - .14) < 1e-8)
  sim.setPaused(true)
  const paused = JSON.stringify(sim.state)
  advance(sim, 4)
  sim.beginDrag('left')
  sim.moveHand('left', 'wok', WOK, .3, { circle: 1 })
  assert.equal(JSON.stringify(sim.state), paused)
  assert.equal(sim.state.hands.left.held, 'oyster')
  sim.setPaused(false)
  advance(sim, 1)
  assert.equal(sim.state.food.oyster, amount)
  sim.beginDrag('left')
  sim.moveHand('left', 'oyster', TRAY, .3)
  sim.endDrag('left', 'oyster')
  assert.equal(sim.state.hands.left.held, 'none')
  assert.match(sim.state.notice, /蚝油瓶放回/)
})

test('a moderate oyster-sauce addition complements soy sauce without making it mandatory', () => {
  const plain = start(), paired = start()
  for (const sim of [plain, paired]) {
    bottle(sim, 'oil')
    ingredient(sim, 'rice')
    stir(sim)
    advance(sim, 10)
    bottle(sim, 'soy', 1)
  }
  advance(plain, 1)
  bottle(paired, 'oyster', 1)
  assert.ok(paired.state.quality[1] > plain.state.quality[1])
  assert.ok(paired.state.quality[2] > plain.state.quality[2])
  assert.equal(paired.state.food.soy, plain.state.food.soy)
  assert.equal(plain.state.food.oyster, 0)
})

test('food does not burn instantly; leaving it untouched burns while continued stirring protects it', () => {
  const idle = start()
  ingredient(idle, 'rice')
  advance(idle, 20)
  assert.equal(idle.state.burnt, 0)
  advance(idle, 30)
  assert.ok(idle.state.burnt > .1)
  const active = start()
  ingredient(active, 'rice')
  stir(active)
  advance(active, 50)
  assert.equal(active.state.burnt, 0)
})

test('a hand must deliver real rice; a cooked requested order settles once', () => {
  const sim = start()
  serve(sim)
  assert.equal(sim.state.phase, 'playing')
  assert.equal(sim.state.completed, 0)
  cookOrder(sim)
  assert.equal(sim.state.phase, 'result')
  assert.equal(sim.state.completed, 1)
  assert.ok(sim.state.result!.score >= 82)
  assert.equal(sim.state.result!.grade, 'S')
  assert.ok(sim.state.result!.earned >= sim.state.order.price)
  assert.ok(sim.state.quality.every(value => value >= 0 && value <= 100))
  const result = JSON.stringify(sim.state)
  serve(sim)
  advance(sim, 1)
  assert.equal(JSON.stringify(sim.state), result)
})

test('late-added bacon cannot borrow previously cooked rice heat for its doneness', () => {
  const sim = start()
  bottle(sim, 'oil')
  ingredient(sim, 'carrot')
  ingredient(sim, 'rice')
  stir(sim)
  advance(sim, 38)
  assert.equal(sim.state.cooked, 1)
  ingredient(sim, 'bacon')
  assert.equal(sim.state.cooked, 0)
  serve(sim)
  assert.equal(sim.state.phase, 'result')
  assert.match(sim.state.result!.comment, /腊肉还差点火候/)
  assert.ok(sim.state.result!.score < 70)
})

test('fresh rice cannot inherit the stir work done earlier on meat and vegetables', () => {
  const sim = start()
  bottle(sim, 'oil')
  ingredient(sim, 'bacon')
  ingredient(sim, 'carrot')
  stir(sim)
  advance(sim, 40)
  ingredient(sim, 'rice')
  assert.equal(sim.state.cooked, 0)
  assert.ok(sim.state.quality[0] < 25)
})

test('a fresh order clears the previous wok heat, burn, and learned movements', () => {
  const sim = start()
  ingredient(sim, 'rice')
  advance(sim, 50)
  assert.ok(sim.state.burnt > .1)
  serve(sim)
  sim.continue()
  assert.equal(sim.state.phase, 'playing')
  ingredient(sim, 'rice')
  assert.equal(sim.state.burnt, 0)
  assert.equal(sim.state.cooked, 0)
  assert.equal(sim.state.motion, 0)
  advance(sim, 10)
  assert.equal(sim.state.burnt, 0)
})

test('five physical orders progress through upgrades and finish the shift', () => {
  const sim = start()
  for (let order = 1; order <= 5; order++) {
    cookOrder(sim)
    assert.equal(sim.state.phase, 'result')
    assert.equal(sim.state.completed, order)
    sim.continue()
    if ((sim.state.phase as string) === 'upgrade') {
      assert.equal(sim.state.upgrades.length, 3)
      const option = sim.state.upgrades[0]
      const previous = sim.state.skills[option.id]
      sim.chooseUpgrade('not-a-skill')
      assert.equal(sim.state.phase, 'upgrade')
      sim.chooseUpgrade(option.id)
      assert.equal(sim.state.skills[option.id], previous + 1)
    }
    if (order < 5) {
      assert.equal(sim.state.phase, 'playing')
      assert.equal(sim.state.food.rice, 0)
      assert.equal(sim.state.motion, 0)
    }
  }
  assert.equal(sim.state.phase, 'closed')
  // The menu now includes cheap vegetable dishes, so five orders start at ¥40.
  assert.ok(sim.state.coins >= 40)
  assert.ok(sim.state.level >= 2)
  sim.reset()
  assert.equal(sim.state.phase, 'menu')
  assert.equal(sim.state.completed, 0)
  assert.equal(sim.state.coins, 0)
})

test('customer timeout settles only once, awards no coins, and cannot advance cooking', () => {
  const sim = start()
  sim.state.order.patience = .1
  sim.update(.2)
  assert.equal(sim.state.phase, 'result')
  assert.equal(sim.state.result!.failed, true)
  assert.equal(sim.state.result!.earned, 0)
  assert.equal(sim.state.completed, 1)
  sim.update(.2)
  assert.equal(sim.state.completed, 1)
})

test('subscriptions observe new state references and can unsubscribe', () => {
  const sim = createSimulation()
  let calls = 0
  const before = sim.state
  const unsubscribe = sim.subscribe(() => { calls++ })
  sim.start()
  assert.equal(calls, 1)
  assert.notEqual(sim.state, before)
  unsubscribe()
  sim.update(.1)
  assert.equal(calls, 1)
})

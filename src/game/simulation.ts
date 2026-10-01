/** Continuous, pointer-driven cooking. The App owns the only update loop. */
import { WOK_HOME, LADLE_REST, KNOB, resolvePan, panRestTarget, panRestingOn } from './kitchen'
export type HandSide = 'left' | 'right'
export type Ingredient = 'rice' | 'carrot' | 'onion' | 'bacon' | 'scallion' | 'egg' | 'corn' | 'peas' | 'ham'
export type Bottle = 'oil' | 'soy' | 'oyster'
export type Zone = 'wok' | 'handle' | 'knob' | Bottle | Ingredient | 'serve' | 'rest'
export type Vec3 = [number, number, number]
export type Phase = 'menu' | 'playing' | 'paused' | 'result' | 'upgrade' | 'closed'
export type HandMode = 'idle' | 'holding' | 'stirring' | 'panning' | 'pouring' | 'scooping' | 'turning'
export type HeldItem = 'none' | 'ladle' | 'wok' | Bottle | 'scoop' | 'egg'
export type Skill = 'pot' | 'spoon' | 'fire' | 'oil' | 'egg' | 'seasoning' | 'stamina'
/** Gesture recognizer sends progress increments, rather than pointer velocity. */
export interface GestureInput { sweep?: number; circle?: number; tilt?: number; /** Actual bowl-to-food collider overlap. */ contact?: boolean }

export interface HandState {
  mode: HandMode
  held: HeldItem
  /** Food remains in the scoop until the player turns the scoop over the wok. */
  payload: Ingredient | null
  position: Vec3
  dragging: boolean
  zone: Zone | null
  intensity: number
  scoopProgress: number
  circleProgress: number
  tilt: number
  /** Simulation time of the last actual put-down, for a short open-hand pose. */
  releasedAt: number | null
}

export interface CookingOrder {
  id: number
  name: string
  title: string
  ingredients: string[]
  ingredientKeys: Ingredient[]
  price: number
  patience: number
  maxPatience: number
}

export interface CookingResult {
  score: number
  grade: string
  earned: number
  xp: number
  comment: string
  failed: boolean
  quality: [number, number, number]
  order: CookingOrder
}

export interface Upgrade { id: Skill; title: string; description: string }

export interface CookingState {
  phase: Phase
  hands: Record<HandSide, HandState>
  pan: { position: Vec3; tilt: number; lift: number }
  /** There is one ladle. It is either carried by a hand or lying on the worktop. */
  ladle: { resting: boolean; spot: Vec3 }
  /** Bottle resting places can change when a touch releases them on the cart. */
  bottleSpots: Record<Bottle,Vec3>
  food: Record<Ingredient | Bottle, number>
  quality: [number, number, number]
  temperature: number
  /** Brief flare above the food when oil hits an already-hot wok. */
  hotOilFlash: number
  /** Gas knob position, 0 = off. The knob itself is on the counter front lip. */
  fire: number
  /** Short impulse for particle height and pan animation; decays every update. */
  toss: number
  /** Actual stirring rate, including motion the hand repeats after release. */
  motion: number
  /** Visual burn amount and overall cooking progress, both in 0–1. */
  burnt: number
  cooked: number
  time: number
  hint: string
  event: number
  order: CookingOrder
  coins: number
  xp: number
  level: number
  completed: number
  result: CookingResult | null
  upgrades: Upgrade[]
  skills: Record<Skill, number>
  notice: string
}

export const INGREDIENT_LABELS: Record<Ingredient, string> = {
  rice: '米饭', carrot: '胡萝卜丝', onion: '洋葱丝', bacon: '腊肉', scallion: '葱花', egg: '鸡蛋',
  corn: '甜玉米粒', peas: '青豆', ham: '火腿丁',
}
export const BOTTLE_LABELS: Record<Bottle, string> = { oil: '食用油', soy: '酱油', oyster: '蚝油' }
const POUR_RATES: Record<Bottle, number> = { oil: .24, soy: .2, oyster: .14 }

export const UPGRADES: Upgrade[] = [
  { id: 'pot', title: '轻巧颠锅', description: '同样的晃动让饭粒飞得更高，锅气也更足。' },
  { id: 'spoon', title: '勺随心动', description: '翻炒更利落，饭粒更快炒出金黄色。' },
  { id: 'fire', title: '守住锅气', description: '摇锅时香气更足，忘记翻炒时多一点余地。' },
  { id: 'oil', title: '油润生香', description: '同样一圈油，炒出更多油光和香气。' },
  { id: 'egg', title: '金包银', description: '蛋液更容易裹上饭粒，金黄色更饱满。' },
  { id: 'seasoning', title: '酱香入味', description: '酱油、蚝油更容易挂匀，适量搭配更鲜香。' },
  { id: 'stamina', title: '手稳不累', description: '记住的翻炒更有力，双手失误更容易补救。' },
]

const SIDES: HandSide[] = ['left', 'right']
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const isIngredient = (zone: Zone | null): zone is Ingredient => zone !== null && zone in INGREDIENT_LABELS
const isBottle = (item: Zone | HeldItem | null): item is Bottle => item !== null && item in BOTTLE_LABELS
const hand = (side: HandSide): HandState => ({
  mode: side === 'right' ? 'holding' : 'idle',
  held: side === 'right' ? 'ladle' : 'none',
  payload: null,
  position: side === 'left' ? [-.5, 1.12, .9] : [.48, 1.12, .9],
  dragging: false, zone: 'rest', intensity: 0, scoopProgress: 0, circleProgress: 0, tilt: 0, releasedAt: null,
})
const emptyFood = (): CookingState['food'] => ({ rice: 0, carrot: 0, onion: 0, bacon: 0, scallion: 0, egg: 0, corn: 0, peas: 0, ham: 0, oil: 0, soy: 0, oyster: 0 })
const bottleSpots = (): CookingState['bottleSpots'] => ({ oil: [-.91,1.147,-.68], soy: [-.71,1.147,-.68], oyster: [-.50,1.147,-.68] })
const emptySkills = (): CookingState['skills'] => ({ pot: 0, spoon: 0, fire: 0, oil: 0, egg: 0, seasoning: 0, stamina: 0 })

export const priceFor = (meats: number, vegetables: number) => 4 + 4 * meats + 2 * vegetables

/** The menu board. Each dish is a real combination with its own name. */
const DISHES: { title: string; meats: Ingredient[]; vegetables: Ingredient[] }[] = [
  { title: '腊味炒饭', meats: ['bacon'], vegetables: [] },
  { title: '黄金蛋炒饭', meats: ['egg'], vegetables: [] },
  { title: '火腿炒饭', meats: ['ham'], vegetables: [] },
  { title: '田园素炒饭', meats: [], vegetables: ['carrot', 'onion'] },
  { title: '金玉满堂炒饭', meats: ['egg'], vegetables: ['corn'] },
  { title: '腊味双拼炒饭', meats: ['bacon', 'egg'], vegetables: ['onion'] },
  { title: '扬州炒饭', meats: ['ham', 'egg'], vegetables: ['carrot', 'peas'] },
  { title: '什锦炒饭', meats: [], vegetables: ['corn', 'peas', 'carrot'] },
  { title: '五彩腊味炒饭', meats: ['bacon'], vegetables: ['carrot', 'corn', 'peas'] },
  { title: '全料豪华炒饭', meats: ['ham', 'egg'], vegetables: ['onion', 'corn'] },
]

function makeOrder(id: number, random: () => number): CookingOrder {
  // The first customer teaches one distinct meat and one vegetable. Later orders come off the menu.
  const dish = id === 1 ? { title: '腊肉胡萝卜炒饭', meats: ['bacon'] as Ingredient[], vegetables: ['carrot'] as Ingredient[] }
    : DISHES[Math.floor(clamp(random(), 0, .999999) * DISHES.length)]
  const ingredientKeys = [...dish.meats, ...dish.vegetables]
  const names = ['下班的阿杰', '夜跑的小夏', '隔壁摊老陈', '加班的小周', '路过的阿岚', '收摊前的林叔', '写代码的阿棠', '刚下晚自习的小雨']
  const maxPatience = id === 1 ? 210 : 108 + ingredientKeys.length * 23
  return {
    id, name: names[(id - 1) % names.length],
    title: dish.title,
    ingredients: ingredientKeys.map(key => INGREDIENT_LABELS[key]), ingredientKeys,
    price: priceFor(dish.meats.length, dish.vegetables.length), patience: maxPatience, maxPatience,
  }
}

function initialState(random: () => number): CookingState {
  return {
    phase: 'menu', hands: { left: hand('left'), right: hand('right') }, pan: { position: [...WOK_HOME], tilt: 0, lift: 0 },
    ladle: { resting: false, spot: [0, LADLE_REST.y, LADLE_REST.z] }, bottleSpots: bottleSpots(), food: emptyFood(),
    quality: [0, 0, 0], temperature: .25, hotOilFlash: 0, fire: .65, toss: 0, motion: 0, burnt: 0, cooked: 0, time: 0,
    hint: '走近餐车，亲手炒出今晚的第一份饭。', event: 0,
    order: makeOrder(1, random), coins: 0, xp: 0, level: 1, completed: 0,
    result: null, upgrades: [], skills: emptySkills(), notice: '餐车就是你的厨房。',
  }
}

export class CookingSimulation {
  state: CookingState
  private listeners = new Set<() => void>()
  private random: () => number
  private learned: Record<HandSide, number> = { left: 0, right: 0 }
  private lastStirMotion: Record<HandSide, number> = { left: 0, right: 0 }
  private scoopKind: Record<HandSide, Ingredient | null> = { left: null, right: null }
  private panGripOffset: Vec3 = [-.43, .18, .44]
  private stirWork = 0
  private panWork = 0
  private cookTime = 0
  /** Heat follows the food, so a late addition cannot inherit a cooked batch. */
  private ingredientHeat: Record<Ingredient, number> = { rice: 0, carrot: 0, onion: 0, bacon: 0, scallion: 0, egg: 0, corn: 0, peas: 0, ham: 0 }
  private riceStirWork = 0
  private idleHotTime = 0
  private soyWarmth = 0
  private collisionCooldown = 0
  private lastCollisionProp: string | null = null
  private tossCooldown = 0
  private hotOilCooldown = 0
  private hotOilDose = 0
  private milestone = 0
  /** Where a released pan is travelling to; the rack catches it on the way down. */
  private panSettle: Vec3 | null = null

  constructor(random = Math.random) {
    this.random = random
    this.state = initialState(random)
  }

  /** Arrow methods remain safe when passed directly as callbacks to React. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit() {
    this.state = { ...this.state }
    this.listeners.forEach(listener => listener())
  }

  private feedback(notice: string) {
    this.state.notice = notice
    this.state.event++
  }

  private clearPan() {
    this.learned = { left: 0, right: 0 }
    this.lastStirMotion = { left: 0, right: 0 }
    this.scoopKind = { left: null, right: null }
    this.panGripOffset = [-.43, .18, .44]
    this.stirWork = 0
    this.panWork = 0
    this.cookTime = 0
    this.ingredientHeat = { rice: 0, carrot: 0, onion: 0, bacon: 0, scallion: 0, egg: 0, corn: 0, peas: 0, ham: 0 }
    this.riceStirWork = 0
    this.idleHotTime = 0
    this.soyWarmth = 0
    this.collisionCooldown = 0
    this.lastCollisionProp = null
    this.tossCooldown = 0
    this.hotOilCooldown = 0
    this.hotOilDose = 0
    this.milestone = 0
    this.panSettle = null
    this.state.hands = { left: hand('left'), right: hand('right') }
    this.state.pan = { position: [...WOK_HOME], tilt: 0, lift: 0 }
    this.state.ladle = { resting: false, spot: [0, LADLE_REST.y, LADLE_REST.z] }
    this.state.bottleSpots = bottleSpots()
    this.state.food = emptyFood()
    this.state.quality = [0, 0, 0]
    this.state.temperature = .25
    this.state.hotOilFlash = 0
    this.state.toss = 0
    this.state.motion = 0
    this.state.burnt = 0
    this.state.cooked = 0
    this.state.time = 0
    this.state.result = null
  }

  reset = () => {
    this.state = initialState(this.random)
    this.clearPan()
    this.emit()
  }

  start = () => {
    if (this.state.phase === 'playing' || this.state.phase === 'upgrade') return
    if (this.state.phase === 'paused') { this.setPaused(false); return }
    if (this.state.phase === 'result') { this.continue(); return }
    if (this.state.phase === 'closed') this.state = initialState(this.random)
    this.clearPan()
    this.state.phase = 'playing'
    this.feedback(`${this.state.order.name}想吃${this.state.order.title}。先抓起油瓶试试。`)
    this.updateHint()
    this.emit()
  }

  continue = () => {
    if (this.state.phase !== 'result') return
    if (this.state.completed >= 5) {
      this.state.phase = 'closed'
      this.feedback('今晚收摊。手上的功夫，又长了一点。')
      this.emit()
      return
    }
    const threshold = 60 + (this.state.level - 1) * 25
    if (this.state.xp >= threshold) {
      this.state.xp -= threshold
      this.state.level++
      this.state.phase = 'upgrade'
      const options = [...UPGRADES]
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(clamp(this.random(), 0, .999999) * (i + 1))
        ;[options[i], options[j]] = [options[j], options[i]]
      }
      this.state.upgrades = options.slice(0, 3)
      this.emit()
      return
    }
    this.nextOrder()
  }

  private nextOrder() {
    this.clearPan()
    this.state.order = makeOrder(this.state.completed + 1, this.random)
    this.state.phase = 'playing'
    this.state.upgrades = []
    this.feedback(`${this.state.order.name}来了：${this.state.order.title}。`)
    this.updateHint()
    this.emit()
  }

  chooseUpgrade = (id: string) => {
    if (this.state.phase !== 'upgrade' || !this.state.upgrades.some(option => option.id === id)) return
    this.state.skills = { ...this.state.skills, [id]: this.state.skills[id as Skill] + 1 }
    this.nextOrder()
  }

  setPaused = (paused: boolean) => {
    if (paused && this.state.phase === 'playing') {
      this.state.phase = 'paused'
      // A pointer cannot remain captured across opening a modal.
      for (const side of SIDES) {
        const current = this.state.hands[side]
        current.dragging = false
        if (current.mode === 'pouring') {
          current.mode = 'holding'
          current.tilt = 0
          current.circleProgress = 0
          current.intensity = 0
        }
      }
      this.emit()
    } else if (!paused && this.state.phase === 'paused') {
      this.state.phase = 'playing'
      this.emit()
    }
  }

  beginDrag = (side: HandSide) => {
    if (this.state.phase !== 'playing') return
    const current = this.state.hands[side]
    // Grabbing a hand immediately cancels its learned loop, even before movement.
    this.learned[side] = 0
    current.dragging = true
    current.intensity = 0
    current.mode = current.payload ? 'scooping' : current.held === 'none' ? 'idle' : 'holding'
    current.circleProgress = 0
    current.tilt = 0
    if (current.held === 'wok') {
      current.mode = 'panning'
      // Touching the handle again takes the pan back from a settled descent.
      this.panSettle = null
      this.panGripOffset = current.position.map((value, i) => value - this.state.pan.position[i]) as Vec3
    }
    this.refreshMotion()
    this.emit()
  }

  moveHand = (side: HandSide, zone: Zone | null, point: Vec3, motion: number, gesture: GestureInput = {}) => {
    if (this.state.phase !== 'playing') return
    const current = this.state.hands[side]
    if (!current.dragging) return
    current.position = point.map(value => Number.isFinite(value) ? value : 0) as Vec3
    const previousZone = current.zone
    current.zone = zone
    const speed = clamp(Number.isFinite(motion) ? motion : 0)

    const progress = (value?: number) => Number.isFinite(value) ? clamp(value!) : 0
    const spoon = current.held === 'ladle' || current.held === 'scoop'
    if (zone === 'knob') {
      // The knob is absolute: wherever the hand drags across it is the setting.
      current.mode = 'turning'
      current.intensity = 0
      const previous = this.state.fire
      const setting = (point[0] - (KNOB.x - .105)) / .21
      this.state.fire = setting > 1 - 1e-8 ? 1 : clamp(setting)
      if (Math.abs(this.state.fire - previous) > .04 && (this.state.fire === 0 || (previous === 0 && this.state.fire > 0))) {
        this.feedback(this.state.fire === 0 ? '灶关了。往右推旋钮，火就回来。' : '开火了，火苗腾起来。')
      }
    } else if (isBottle(current.held)) {
      if (zone === 'wok') {
        current.circleProgress = clamp(current.circleProgress + progress(gesture.circle))
        current.tilt = clamp(Math.max(current.circleProgress, current.tilt + progress(gesture.tilt)))
        current.mode = current.tilt >= 1 ? 'pouring' : 'holding'
        current.intensity = current.mode === 'pouring' ? 1 : 0
        if (current.mode === 'pouring' && current.circleProgress < 1) current.circleProgress = 1
      } else {
        current.mode = 'holding'
        current.intensity = 0
        current.tilt = 0
        current.circleProgress = 0
      }
    } else if (current.payload) {
      current.mode = 'scooping'
      current.intensity = 0
      if (zone === 'wok') {
        current.circleProgress = clamp(current.circleProgress + progress(gesture.circle))
        current.tilt = current.circleProgress
        if (current.circleProgress >= 1) this.depositFood(side)
      } else {
        current.circleProgress = 0
        current.tilt = 0
      }
    } else if (current.held === 'wok') {
      current.mode = 'panning'
      current.intensity = clamp(current.intensity * .35 + speed * .65)
      this.panSettle = null
      const desired = current.position.map((value, i) => value - this.panGripOffset[i]) as Vec3
      const solved = resolvePan(desired, this.state.pan.position)
      this.state.pan = {
        position: solved.position, lift: clamp(solved.position[1] - WOK_HOME[1], 0, .55),
        tilt: clamp(current.intensity * .24 + progress(gesture.tilt) * .5, 0, .65),
      }
      // Keep the rendered hand attached even if the pointer reaches past the arm.
      current.position = solved.position.map((value, i) => value + this.panGripOffset[i]) as Vec3
      if (solved.contact === 'prop' && (this.collisionCooldown <= 0 || solved.prop !== this.lastCollisionProp)) {
        this.feedback(solved.prop === 'condiment shelf' ? '锅边碰到调料架了，抬起来一点再挪。' : '锅边碰到备料盘了，抬起来一点再挪。')
        this.collisionCooldown = 2
      }
      this.lastCollisionProp = solved.contact === 'prop' ? solved.prop : null
      if (speed > .5 && this.tossCooldown <= 0 && this.state.food.rice > 0) {
        this.state.toss = clamp(.3 + speed * .55 + this.state.skills.pot * .1)
        this.tossCooldown = .65
        this.feedback('锅气翻起来了！')
      }
    } else if (spoon && isIngredient(zone)) {
      current.mode = 'scooping'
      current.intensity = 0
      this.learned[side] = 0
      if (this.scoopKind[side] !== zone) {
        this.scoopKind[side] = zone
        current.scoopProgress = 0
      }
      if (gesture.contact !== false) current.scoopProgress = clamp(current.scoopProgress + progress(gesture.sweep))
      if (current.scoopProgress >= 1) {
        current.payload = zone
        current.held = 'scoop'
        current.circleProgress = 0
        this.feedback(`铲起${INGREDIENT_LABELS[zone]}了。移到锅里画一圈，把勺翻过来。`)
      }
    } else if (spoon && zone === 'wok') {
      current.scoopProgress = 0
      this.scoopKind[side] = null
      if (speed > .08) {
        this.learned[side] = clamp(this.learned[side] * .45 + speed * .55, .35, 1)
        this.lastStirMotion[side] = this.state.time
        current.mode = 'stirring'
        current.intensity = this.learned[side]
      }
    } else {
      current.mode = current.held === 'none' ? 'idle' : 'holding'
      current.intensity = 0
      this.learned[side] = 0
      if (previousZone !== zone) {
        current.scoopProgress = 0
        this.scoopKind[side] = null
      }
    }
    this.refreshMotion()
    this.updateHint()
    this.emit()
  }

  endDrag = (side: HandSide, zone: Zone | null) => {
    if (this.state.phase !== 'playing') return
    const current = this.state.hands[side]
    if (!current.dragging) return
    current.dragging = false
    current.zone = zone
    current.tilt = 0
    current.circleProgress = 0

    if (current.held === 'wok') {
      current.mode = 'panning'
      if (zone === 'wok' || zone === 'handle') {
        // Releasing over the stove puts the pan back on the rack, not on the table.
        current.zone = 'handle'
        if (this.state.pan.lift > .02) this.panSettle = [...WOK_HOME]
        else {
          this.state.pan = { position: [...WOK_HOME], tilt: 0, lift: 0 }
          current.position = WOK_HOME.map((value, i) => value + this.panGripOffset[i]) as Vec3
          this.feedback('锅稳稳落在锅架上了。')
        }
      } else if (zone === 'rest') {
        this.putDown(side)
        return
      } else {
        this.feedback('还提着锅。拖回灶口松手就放回锅架，拖到台面前沿松手就是彻底放手。')
      }
    } else if (zone === 'knob') {
      current.mode = current.held === 'none' ? 'idle' : 'holding'
      this.feedback(this.state.fire <= .02 ? '火力关掉了。' : `火力调到 ${Math.round(this.state.fire * 100)}%。向右推是猛火，向左收是文火。`)
    } else if (isBottle(current.held)) {
      if (zone === current.held || zone === 'rest') {
        this.putDown(side)
        return
      } else {
        current.mode = 'holding'
        current.intensity = 0
        this.feedback(`停止倒${BOTTLE_LABELS[current.held]}，瓶子仍在手里。拖回原瓶位松手，就会放回。`)
      }
    } else if (current.payload) {
      if (zone === 'rest') {
        this.putDown(side)
        return
      } else {
        current.mode = 'scooping'
        current.intensity = 0
        this.feedback(`还拿着${INGREDIENT_LABELS[current.payload]}。在锅里画一圈翻勺，才会下料。`)
      }
    } else if (isBottle(zone)) {
      if (SIDES.some(other => other !== side && this.state.hands[other].held === zone)) {
        this.feedback(`${BOTTLE_LABELS[zone]}瓶在另一只手里。`)
      } else {
        this.parkLadle(current)
        current.held = zone
        current.mode = 'holding'
        current.intensity = 0
        this.feedback(`握住${BOTTLE_LABELS[zone]}瓶了。拖到锅口画一圈，转动手腕倒进去。`)
      }
    } else if (zone === 'handle') {
      if (SIDES.some(other => other !== side && this.state.hands[other].held === 'wok')) {
        this.feedback('锅柄在另一只手里。')
      } else {
        this.parkLadle(current)
        current.held = 'wok'
        current.mode = 'panning'
        current.intensity = 0
        this.panGripOffset = current.position.map((value, i) => value - this.state.pan.position[i]) as Vec3
        this.feedback('握住锅柄了。再拖动这只手，就能把锅拿起来。')
      }
    } else if (isIngredient(zone)) {
      if (this.holdsLadle(current)) {
        current.mode = 'scooping'
        current.intensity = 0
        this.feedback('勺已贴住食材。按住手来回铲几下，真正把料铲起来。')
      } else {
        current.mode = 'idle'
        current.intensity = 0
        this.feedback('空手铲不起料。到台面前沿把锅铲拿起来。')
      }
    } else if (zone === 'serve' && this.holdsLadle(current)) {
      if (this.state.food.rice <= 0) {
        this.feedback('锅里还没有米饭，先盛一勺米饭下锅。')
        current.mode = 'holding'
        current.intensity = 0
      } else {
        this.settle(false)
        this.emit()
        return
      }
    } else if (this.holdsLadle(current) && zone === 'wok' && this.learned[side] > 0) {
      current.mode = 'stirring'
      current.intensity = this.learned[side]
      this.feedback('右手记住了这个节奏，松手也会继续炒。现在可以去抓左手。')
    } else if (zone === 'rest') {
      // The front strip is the shared shelf: put down what is in hand, take the ladle back.
      if (current.held === 'none') this.takeLadle(side)
      else {
        this.putDown(side)
        return
      }
    } else {
      current.mode = current.held === 'none' ? 'idle' : 'holding'
      current.intensity = 0
      this.learned[side] = 0
    }
    this.refreshMotion()
    this.recalculateQuality()
    this.updateHint()
    this.emit()
  }

  /** Explicitly open this hand and safely return its object, with or without a drag. */
  putDown = (side: HandSide, at?: Vec3) => {
    if (this.state.phase !== 'playing') return
    const current = this.state.hands[side]
    if (current.held === 'none') return
    if (current.held === 'wok') {
      this.panSettle = panRestTarget(this.state.pan.position)
      this.releaseObject(side)
      this.feedback(panRestingOn(this.panSettle) === 'rack'
        ? '松开锅柄，正在把锅放回锅架。' : '松开锅柄，正在把锅放到台面上。')
    } else if (isBottle(current.held)) {
      const label = BOTTLE_LABELS[current.held]
      if (at) this.state.bottleSpots[current.held] = [clamp(at[0], -1.11, 1.11), 1.147, clamp(at[2], -.76, .43)]
      this.releaseObject(side)
      this.feedback(at ? `${label}瓶放在台面上。` : `${label}瓶放回架上。`)
    } else if (this.holdsLadle(current)) {
      const notice = current.payload
        ? `${INGREDIENT_LABELS[current.payload]}倒回备料盘，锅铲也搁在台面上了。`
        : '锅铲放在台面前沿了。'
      this.layDownLadle(side, notice)
    } else {
      this.releaseObject(side)
      this.feedback('手里的食材放回备料盘了。')
    }
    this.refreshMotion()
    this.recalculateQuality()
    this.updateHint()
    this.emit()
  }

  private depositFood(side: HandSide) {
    const current = this.state.hands[side], ingredient = current.payload
    if (!ingredient) return
    const oldAmount = this.state.food[ingredient]
    const newAmount = clamp(oldAmount + (ingredient === 'rice' ? .8 : .7))
    this.ingredientHeat[ingredient] *= oldAmount / newAmount
    if (ingredient === 'rice') this.riceStirWork *= oldAmount / newAmount
    this.state.food = { ...this.state.food, [ingredient]: newAmount }
    current.payload = null
    current.held = 'ladle'
    current.mode = 'holding'
    current.scoopProgress = 0
    current.circleProgress = 0
    current.tilt = 0
    this.scoopKind[side] = null
    this.recalculateQuality()
    this.feedback(`${INGREDIENT_LABELS[ingredient]}从勺里翻进锅了。`)
  }

  private releaseObject(side: HandSide) {
    const current = this.state.hands[side]
    current.releasedAt = this.state.time
    current.held = 'none'
    current.payload = null
    current.mode = 'idle'
    current.dragging = false
    current.zone = 'rest'
    current.intensity = 0
    current.scoopProgress = 0
    current.circleProgress = 0
    current.tilt = 0
    this.scoopKind[side] = null
    this.learned[side] = 0
    this.lastStirMotion[side] = 0
  }

  private holdsLadle(current: HandState) {
    return current.held === 'ladle' || current.held === 'scoop'
  }

  /** Put the shared ladle down flat on the front strip of the worktop. */
  private layDownLadle(side: HandSide, notice: string) {
    const current = this.state.hands[side]
    this.state.ladle = {
      resting: true,
      spot: [clamp(current.position[0], -LADLE_REST.xLimit, LADLE_REST.xLimit), LADLE_REST.y, LADLE_REST.z],
    }
    this.releaseObject(side)
    this.feedback(notice)
  }

  /**
   * A hand holds one thing at a time. Reaching for a bottle or the pan handle
   * while the ladle is in that hand parks the ladle on the front strip, so the
   * tool is never quietly lost.
   */
  private parkLadle(current: HandState) {
    if (!this.holdsLadle(current)) return
    this.state.ladle = {
      resting: true,
      spot: [clamp(current.position[0], -LADLE_REST.xLimit, LADLE_REST.xLimit), LADLE_REST.y, LADLE_REST.z],
    }
  }

  /** Take the ladle that is lying on the front strip. */
  private takeLadle(side: HandSide) {    const current = this.state.hands[side]
    if (!this.state.ladle.resting) {
      this.feedback('锅铲在另一只手里。')
      return
    }
    this.state.ladle = { ...this.state.ladle, resting: false }
    current.held = 'ladle'
    current.payload = null
    current.mode = 'holding'
    current.intensity = 0
    current.scoopProgress = 0
    current.circleProgress = 0
    current.tilt = 0
    this.feedback('拿起锅铲了。拖到锅口画圈就能翻炒。')
  }

  private handsCollide() {
    const { left, right } = this.state.hands
    if (left.zone !== 'wok' || right.zone !== 'wok' || left.held === 'wok' || right.held === 'wok') return false
    if (!left.dragging && !right.dragging) return false
    // Pouring at the rim and stirring at the center can coexist; crossing the
    // actual hand positions is what interrupts the motion.
    return Math.hypot(...left.position.map((value, i) => value - right.position[i])) < .2
  }

  private refreshMotion() {
    const stirring = SIDES.reduce((total, side) => total + (this.state.hands[side].mode === 'stirring' ? this.state.hands[side].intensity : 0), 0)
    this.state.motion = clamp(stirring * (this.handsCollide() ? .25 : 1))
  }

  /**
   * A released pan travels back down instead of teleporting. The rack, the
   * worktop and the trays are re-solved every step, so it lands on a real
   * surface rather than passing through one.
   */
  private advanceSettle(dt: number, speak = true) {
    const target = this.panSettle!
    const pan = this.state.pan
    const step = [target[0] - pan.position[0], target[1] - pan.position[1], target[2] - pan.position[2]]
    const distance = Math.hypot(...step)
    const landed = distance <= .001 || distance <= 1.1 * dt
    const next: Vec3 = landed ? [...target] : pan.position.map((value, i) => value + step[i] / distance * 1.1 * dt) as Vec3
    const solved = resolvePan(next)
    this.state.pan = { position: solved.position, lift: clamp(solved.position[1] - WOK_HOME[1], 0, .55), tilt: landed ? 0 : pan.tilt }
    const holder = SIDES.find(side => this.state.hands[side].held === 'wok')
    if (holder) {
      // The gripping hand rides down with the handle it is holding.
      const held = this.state.hands[holder]
      held.position = solved.position.map((value, i) => value + this.panGripOffset[i]) as Vec3
    }
    if (!landed) return
    this.panSettle = null
    if (!speak) return
    const resting = panRestingOn(solved.position)
    if (resting !== 'air') this.feedback(resting === 'rack' ? '锅稳稳落在锅架上了。' : '锅放在台面上了。')
  }

  update = (dt: number) => {
    if (!Number.isFinite(dt) || dt <= 0) return
    dt = Math.min(dt, .25)
    // A released pan keeps falling even after the ticket is over, so it never
    // freezes half-way between the hand and the worktop behind the result card.
    if (this.panSettle) this.advanceSettle(dt, this.state.phase === 'playing')
    if (this.state.phase !== 'playing') return
    const s = this.state
    s.time += dt
    s.order = { ...s.order, patience: Math.max(0, s.order.patience - dt) }
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt)
    this.tossCooldown = Math.max(0, this.tossCooldown - dt)
    this.hotOilCooldown = Math.max(0, this.hotOilCooldown - dt)
    s.hotOilFlash = Math.max(0, s.hotOilFlash - dt * 1.65)
    s.toss = Math.max(0, s.toss - dt * 1.5)
    s.pan = { ...s.pan, tilt: s.pan.tilt * Math.exp(-dt * 3) }

    let hotOilFlow = false
    for (const side of SIDES) {      const current = s.hands[side]
      if (current.mode === 'stirring' && current.dragging && s.time - this.lastStirMotion[side] > .15) {
        // A held mouse controls the spoon directly. Only releasing starts the
        // remembered loop; resting the pointer should not keep cooking by itself.
        current.intensity *= Math.exp(-dt * 8)
      }
      if (current.mode === 'panning') {
        // Wiggling must come from the mouse; releasing keeps the grip, not a loop.
        current.intensity *= Math.exp(-dt * (current.dragging ? 2.2 : 4.2))
      }
      if (current.mode === 'pouring' && current.dragging && current.zone === 'wok' && isBottle(current.held)) {
        const key = current.held
        const oldAmount = s.food[key]
        s.food = { ...s.food, [key]: clamp(oldAmount + dt * POUR_RATES[key]) }
        if (key === 'oil' && s.food.oil > oldAmount) {
          hotOilFlow = true
          if (s.temperature >= .58 && s.fire >= .52 && s.pan.lift < .12) {
            this.hotOilDose += s.food.oil - oldAmount
            if (this.hotOilDose >= .025 && this.hotOilCooldown <= 0) {
              s.hotOilFlash = 1
              this.hotOilCooldown = 2.8
              this.hotOilDose = 0
              this.feedback('热油入锅，锅气轰地炸开！')
            }
          }
        }
        if (key !== 'oil') this.soyWarmth += (s.food[key] - oldAmount) * clamp(this.stirWork / 10) * (key === 'oyster' ? .75 : 1)
      }
    }
    if (!hotOilFlow) this.hotOilDose = 0

    this.refreshMotion()
    if (this.handsCollide() && this.collisionCooldown <= 0) {
      this.feedback('两只手挤在一起了。左手握侧边锅柄，右手留在锅里。')
      this.collisionCooldown = 2.5
    }

    const panIntensity = SIDES.reduce((total, side) => total + (s.hands[side].mode === 'panning' ? s.hands[side].intensity : 0), 0)
    const panDistance = Math.hypot(s.pan.position[0] - WOK_HOME[0], s.pan.position[2] - WOK_HOME[2])
    const fireContact = clamp(1 - panDistance / .42) * clamp(1 - s.pan.lift / .18)
    // The gas knob decides how much heat the burner can deliver at all; knob
    // off means the pan drifts back down to the night air (0.15).
    const heatTarget = .15 + fireContact * s.fire * (.85 + panIntensity * .1 - s.food.rice * .04)
    s.temperature += (heatTarget - s.temperature) * Math.min(1, dt * (fireContact > .5 ? .16 : .25))
    const foodAmount = s.food.rice + s.food.bacon + s.food.egg + s.food.carrot + s.food.onion + s.food.corn + s.food.peas + s.food.ham
    if (foodAmount > 0) {
      this.cookTime += dt * s.temperature
      for (const ingredient of Object.keys(this.ingredientHeat) as Ingredient[]) {
        if (s.food[ingredient] > 0) this.ingredientHeat[ingredient] += dt * s.temperature
      }
      const stirGain = dt * s.motion * (.55 + s.temperature * .45) * (1 + s.skills.spoon * .15 + s.skills.stamina * .06)
      this.stirWork += stirGain
      if (s.food.rice > 0) this.riceStirWork += stirGain
      this.panWork += dt * panIntensity * (1 + s.skills.pot * .25 + s.skills.fire * .15)
      const moving = s.motion > .12 || panIntensity > .2
      if (moving) this.idleHotTime = Math.max(0, this.idleHotTime - dt * 2)
      else if (s.temperature > .62) this.idleHotTime += dt
      // A new player gets a generous window. Burning cannot happen immediately
      // after adding food and stirring actively protects the contents.
      const burnDelay = 17 + s.skills.fire * 5 + s.food.oil * 5
      if (this.idleHotTime > burnDelay && this.cookTime > 20) {
        s.burnt = clamp(s.burnt + dt * .012 / (1 + s.skills.fire * .25))
        if (s.burnt > .035 && this.milestone !== -1) {
          this.feedback('锅底开始发焦了，抓右手回来翻几下。')
          this.milestone = -1
        }
      }
    }
    this.recalculateQuality()
    const average = s.quality.reduce((sum, value) => sum + value, 0) / 3
    if (s.food.rice > 0 && this.milestone >= 0 && average > 40 + this.milestone * 20 && this.milestone < 3) {
      this.milestone++
      this.feedback(['饭粒开始泛金黄了。', '香气出来了，双手配合得漂亮！', '这一锅色香味都到位了，盛给客人吧。'][this.milestone - 1])
    }
    if (s.order.patience <= 0) this.settle(true)
    else this.updateHint()
    this.emit()
  }

  private recalculateQuality() {
    const s = this.state, f = s.food
    const readiness = (Object.keys(this.ingredientHeat) as Ingredient[])
      .filter(ingredient => f[ingredient] > 0)
      .map(ingredient => clamp(this.ingredientHeat[ingredient] / (ingredient === 'rice' ? 20 : ingredient === 'bacon' || ingredient === 'ham' ? 12 : ingredient === 'corn' || ingredient === 'peas' ? 5 : 7)))
    s.cooked = readiness.length ? Math.min(...readiness) : 0
    const hasRice = clamp(f.rice / .65)
    const coating = clamp(f.oil / .35)
    const seasoningAmount = f.soy + f.oyster * .75
    const seasoning = clamp(seasoningAmount / .35)
    const excessSoy = Math.max(0, seasoningAmount - .7) * 28
    const complementarySauce = Math.min(clamp(f.soy / .2), clamp(f.oyster / .15)) * (1 - clamp((seasoningAmount - .55) / .3))
    const cooked = clamp(this.ingredientHeat.rice / 20)
    const baconCooked = clamp(this.ingredientHeat.bacon / 12)
    const eggCooked = clamp(this.ingredientHeat.egg / 7)
    const hamCooked = clamp(this.ingredientHeat.ham / 12)
    const matched = s.order.ingredientKeys.filter(key => f[key] > .3).length / s.order.ingredientKeys.length
    const dryPenalty = this.stirWork > 6 ? (1 - coating) * 9 : 0
    const color = hasRice * (8 + clamp(this.riceStirWork / 18) * 51 + coating * 8 + f.egg * eggCooked * (15 + s.skills.egg * 6) + f.carrot * 8 + f.scallion * 8 + (f.corn + f.peas) * 7 + f.ham * hamCooked * 6) - s.burnt * 80 - excessSoy * .6
    const aroma = hasRice * (clamp(this.riceStirWork / 21) * 44 + baconCooked * f.bacon * 13 + hamCooked * f.ham * 12 + eggCooked * f.egg * 5 + coating * (10 + s.skills.oil * 4) + clamp(this.panWork / 6) * 17 + seasoning * 8 + this.soyWarmth * 7 + complementarySauce * 4) - s.burnt * 60 - dryPenalty
    const taste = hasRice * (cooked * 35 + matched * 21 + coating * 10 + seasoning * (22 + s.skills.seasoning * 5) + clamp(this.riceStirWork / 16) * 12 + complementarySauce * 4 + (f.corn + f.peas) * 5) - s.burnt * 70 - excessSoy - dryPenalty
    s.quality = [color, aroma, taste].map(value => clamp(value, 0, 100)) as [number, number, number]
  }

  private updateHint() {
    const s = this.state
    const carried = SIDES.map(side => s.hands[side]).find(current => current.payload)
    const bottle = SIDES.map(side => s.hands[side]).find(current => isBottle(current.held))
    if (carried) { s.hint = `勺里有${INGREDIENT_LABELS[carried.payload!]}。拖到锅里画一圈，翻勺下料。`; return }
    if (bottle && isBottle(bottle.held)) { s.hint = bottle.mode === 'pouring' ? `正在倒${BOTTLE_LABELS[bottle.held]}，松手就停。再拖回原瓶位松手放好。` : `${BOTTLE_LABELS[bottle.held]}瓶在手里。移到锅口画一圈，转动手腕开始倒。`; return }
    if (s.pan.lift > .12) { s.hint = '锅提在手上。要放回去，把它拖回灶口松手；拖到台面前沿松手就是彻底放手。'; return }
    if (s.ladle.resting && !SIDES.some(side => this.holdsLadle(s.hands[side]))) {
      s.hint = '锅铲放在台面前沿了。拖一只空手盖到铲子上松手，就能重新拿起。'; return
    }
    if (s.food.oil < .15) { s.hint = '手拖到油瓶松开握住；再拖到锅口画一圈，把油倒进去。'; return }
    if (s.fire <= .06) { s.hint = '灶还没开火。拖一只手到煤气旋钮上，向右推就是开火，越往右火越猛。'; return }
    const missing = s.order.ingredientKeys.find(key => s.food[key] < .3)
    if (missing) { s.hint = `客人要${INGREDIENT_LABELS[missing]}：用勺在备料盘里来回铲，再到锅里画圈翻勺。`; return }
    if (s.food.rice <= 0) { s.hint = '勺放进米饭盆，来回铲起米饭；移进锅里画圈翻勺。'; return }
    if (s.motion < .15) { s.hint = '右手拖进锅里，来回划动几下；松开后还会继续炒。'; return }
    if (s.food.soy + s.food.oyster * .75 < .15 && this.stirWork > 4) { s.hint = '趁右手继续炒，左手拿酱油到锅口画圈倒一点；也可搭配少量蚝油增鲜。'; return }
    if (this.stirWork < 15) { s.hint = '右手继续炒。左手在锅柄处松开握住，再拖动就能提锅、晃锅。'; return }
    s.hint = '香气正好。抓住右手，把勺移到出餐碗处松开。'
  }

  private settle(failed: boolean) {
    if (this.state.phase !== 'playing') return
    this.recalculateQuality()
    const s = this.state
    const missing = s.order.ingredientKeys.filter(key => s.food[key] < .3).length
    const undercooked = (s.food.bacon > 0 && this.ingredientHeat.bacon < 12) || (s.food.ham > 0 && this.ingredientHeat.ham < 12)
    const score = failed ? 0 : Math.round(clamp(s.quality.reduce((sum, value) => sum + value, 0) / 3 - missing * 12 - (undercooked ? 15 : 0), 0, 100))
    const earned = failed ? 0 : Math.round(s.order.price * (score >= 82 ? 1.15 : score >= 55 ? 1 : score >= 30 ? .75 : .4))
    const xp = failed ? 5 : 20 + Math.round(score * .7)
    const comment = failed ? '等太久了，这位客人先走了。下一锅慢慢找节奏。'
      : missing > 0 ? '少了客人点的配菜，记得看一眼订单。'
      : undercooked ? '腊肉还差点火候，多翻一会儿会更香。'
      : s.burnt > .3 ? '锅底有点焦，下回记得让右手继续炒。'
      : score >= 82 ? '饭粒分明，锅气真足！下回还来你这摊。'
      : score >= 55 ? '热乎又香，这手艺可以！'
      : '饭有了，再多翻炒一会儿、淋一点酱油，会更好吃。'
    s.result = { score, grade: failed ? '超时' : score >= 82 ? 'S' : score >= 68 ? 'A' : score >= 45 ? 'B' : 'C', earned, xp, comment, failed, quality: [...s.quality], order: { ...s.order } }
    s.coins += earned
    s.xp += xp
    s.completed++
    s.phase = 'result'
    s.motion = 0
    for (const side of SIDES) {
      s.hands[side].dragging = false
      s.hands[side].intensity = 0
      s.hands[side].mode = s.hands[side].held === 'none' ? 'idle' : 'holding'
    }
    this.feedback(failed ? '客人离开了。' : `出锅，收到 ${earned} 元。`)
  }
}

export const createSimulation = (random = Math.random) => new CookingSimulation(random)

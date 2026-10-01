import type { CookingState } from '../game/simulation'

/** Small Web Audio soundscape; every sound is made locally, so it loads with the game. */
export class KitchenAudio {
  readonly context = new AudioContext()
  private readonly master = this.context.createGain()
  private readonly gas = this.context.createGain()
  private readonly sizzle = this.context.createGain()
  private readonly gasSource: AudioBufferSourceNode
  private readonly sizzleSource: AudioBufferSourceNode
  private readonly crackleBuffer: AudioBuffer
  private lastCrackle = 0
  private lastFlash = 0
  private lastToss = 0
  private disposed = false

  constructor() {
    const context = this.context
    this.master.gain.value = .72
    this.master.connect(context.destination)

    // The two filtered loops have different texture: a low gas roar and sharp oil hiss.
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const channel = noise.getChannelData(0)
    let low = 0
    for (let i = 0; i < channel.length; i++) {
      low = low * .975 + (Math.random() * 2 - 1) * .025
      channel[i] = low * 2.4 + (Math.random() * 2 - 1) * .34
    }
    this.gasSource = context.createBufferSource()
    this.gasSource.buffer = noise
    this.gasSource.loop = true
    const gasFilter = context.createBiquadFilter()
    gasFilter.type = 'lowpass'
    gasFilter.frequency.value = 560
    this.gas.gain.value = 0
    this.gasSource.connect(gasFilter).connect(this.gas).connect(this.master)
    this.gasSource.start()

    this.sizzleSource = context.createBufferSource()
    this.sizzleSource.buffer = noise
    this.sizzleSource.loop = true
    const sizzleFilter = context.createBiquadFilter()
    sizzleFilter.type = 'highpass'
    sizzleFilter.frequency.value = 1550
    this.sizzle.gain.value = 0
    this.sizzleSource.connect(sizzleFilter).connect(this.sizzle).connect(this.master)
    this.sizzleSource.start()

    this.crackleBuffer = context.createBuffer(1, Math.round(context.sampleRate * .075), context.sampleRate)
    const pop = this.crackleBuffer.getChannelData(0)
    for (let i = 0; i < pop.length; i++) {
      const t = i / pop.length
      // Short irregular snaps instead of an oscillator beep.
      const envelope = Math.exp(-t * 18) * (i % 27 < 5 ? 1 : .3)
      pop[i] = (Math.random() * 2 - 1) * envelope
    }
  }

  resume() { return this.context.resume() }

  update(state: CookingState, enabled: boolean) {
    if (this.disposed) return
    const context = this.context
    const active = state.phase === 'playing' && enabled
    const fire = active ? state.fire : 0
    const oil = Math.min(1, state.food.oil * 5)
    const hot = Math.max(0, (state.temperature - .33) / .67)
    const cooking = active ? oil * hot : 0
    this.gas.gain.setTargetAtTime(fire * (.055 + .045 * fire), context.currentTime, .07)
    this.sizzle.gain.setTargetAtTime(cooking * (.035 + .045 * state.motion), context.currentTime, .08)

    const flash = state.hotOilFlash
    if (active && flash > .15 && this.lastFlash <= .15) this.hotOilBurst()
    this.lastFlash = flash

    const toss = state.toss
    if (active && toss > .55 && this.lastToss <= .55) this.wokClang()
    this.lastToss = toss

    const now = context.currentTime
    const crackleRate = 1.4 + cooking * 11 + (active ? state.motion * 3 : 0)
    if (active && cooking > .12 && now - this.lastCrackle > 1 / crackleRate) {
      this.crackle(.03 + cooking * .05)
      this.lastCrackle = now + Math.random() * .045
    }
  }

  private crackle(volume: number, when = this.context.currentTime) {
    const source = this.context.createBufferSource()
    source.buffer = this.crackleBuffer
    source.playbackRate.value = .65 + Math.random() * 1.45
    const gain = this.context.createGain()
    gain.gain.value = volume
    source.connect(gain).connect(this.master)
    source.start(when)
    source.stop(when + .16)
  }

  private hotOilBurst() {
    const context = this.context
    const when = context.currentTime
    const whoosh = context.createBufferSource()
    whoosh.buffer = this.gasSource.buffer
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(420, when)
    filter.frequency.exponentialRampToValueAtTime(1800, when + .2)
    const gain = context.createGain()
    gain.gain.setValueAtTime(.001, when)
    gain.gain.exponentialRampToValueAtTime(.32, when + .035)
    gain.gain.exponentialRampToValueAtTime(.001, when + .55)
    whoosh.connect(filter).connect(gain).connect(this.master)
    whoosh.start(when)
    whoosh.stop(when + .58)
    for (let i = 0; i < 5; i++) this.crackle(.14 - i * .012, when + .035 + i * .065)
  }

  private wokClang() {
    const context = this.context
    const when = context.currentTime
    const tone = context.createOscillator()
    tone.type = 'triangle'
    tone.frequency.setValueAtTime(285, when)
    tone.frequency.exponentialRampToValueAtTime(168, when + .13)
    const gain = context.createGain()
    gain.gain.setValueAtTime(.001, when)
    gain.gain.exponentialRampToValueAtTime(.055, when + .009)
    gain.gain.exponentialRampToValueAtTime(.001, when + .17)
    tone.connect(gain).connect(this.master)
    tone.start(when)
    tone.stop(when + .18)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.gasSource.stop()
    this.sizzleSource.stop()
    void this.context.close()
  }
}

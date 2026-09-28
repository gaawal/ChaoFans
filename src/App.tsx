import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react'
import {ArrowRight, Home, Pause, Play, Volume2, VolumeX, X} from 'lucide-react'
import {createSimulation} from './game/simulation'
import {createStreetScene} from './scene/StreetScene'

const handModes: Record<string, string> = {idle:'等待操作',holding:'握持中',stirring:'持续翻炒',panning:'握住锅柄',pouring:'倾倒中',scooping:'取料中',turning:'调火力'}
const objects: Record<string, string> = {none:'空手',ladle:'锅铲',wok:'锅柄',oil:'油壶',soy:'酱油',oyster:'蚝油',scoop:'饭勺',egg:'鸡蛋'}

function createCookingAudio() {
  const context = new AudioContext()
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
  const samples = buffer.getChannelData(0)
  let softNoise = 0
  for (let i = 0; i < samples.length; i++) {
    softNoise = (softNoise + (Math.random() * 2 - 1) * .07) / 1.025
    samples[i] = softNoise * 2 + (Math.random() * 2 - 1) * .1
  }
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 700
  const gain = context.createGain()
  gain.gain.value = 0
  source.connect(filter).connect(gain).connect(context.destination)
  source.start()
  return {context, gain, source}
}

export default function App() {
  const simulation = useMemo(() => createSimulation(), [])
  const state = useSyncExternalStore(simulation.subscribe, () => simulation.state)
  const container = useRef<HTMLDivElement>(null)
  const [renderer, setRenderer] = useState('载入场景')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [sound, setSound] = useState(true)
  const [help, setHelp] = useState(false)
  const resumeAfterHelp = useRef(false)
  const audio = useRef<ReturnType<typeof createCookingAudio> | null>(null)
  const soundEnabled = useRef(sound)
  soundEnabled.current = sound

  function enableAudio() {
    if (!soundEnabled.current) return
    try {
      audio.current ??= createCookingAudio()
      void audio.current.context.resume()
    } catch { /* Audio is optional when unavailable in the browser. */ }
  }

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    void createStreetScene(container.current!, {
      simulation, onRenderer: setRenderer,
      onReady: () => setReady(true), onError: setError,
    }).then(dispose => { if (cancelled) dispose(); else cleanup = dispose })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '场景载入失败，请刷新重试。') })
    return () => { cancelled = true; cleanup?.() }
  }, [simulation])

  useEffect(() => {
    let frame = 0
    let previous = performance.now()
    const advance = (now: number) => {
      simulation.update(Math.min((now - previous) / 1000, .05))
      previous = now
      const s = simulation.state
      if (audio.current) {
        const cooking = s.phase === 'playing' && s.food.oil > 0
        const motion = s.hands.right.mode === 'stirring' ? .09 : .025
        audio.current.gain.gain.setTargetAtTime(soundEnabled.current && cooking ? motion : 0, audio.current.context.currentTime, .12)
      }
      frame = requestAnimationFrame(advance)
    }
    frame = requestAnimationFrame(advance)
    const visibility = () => { if (document.hidden) simulation.setPaused(true) }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', visibility)
      if (audio.current) { audio.current.source.stop(); void audio.current.context.close(); audio.current = null }
    }
  }, [simulation])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return
      if (help) { setHelp(false); if (resumeAfterHelp.current) simulation.setPaused(false) }
      else if (simulation.state.phase === 'playing' || simulation.state.phase === 'paused') simulation.setPaused(simulation.state.phase === 'playing')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [simulation, help])

  const inGame = state.phase !== 'menu'
  const active = state.phase === 'playing' || state.phase === 'paused'
  const openHelp = () => {
    resumeAfterHelp.current = state.phase === 'playing'
    if (resumeAfterHelp.current) simulation.setPaused(true)
    setHelp(true)
  }
  const closeHelp = () => { setHelp(false); if (resumeAfterHelp.current) simulation.setPaused(false) }
  const start = () => { enableAudio(); simulation.start() }
  const returnHome = () => { setHelp(false); simulation.reset() }

  return <main className={`game ${inGame ? 'in-game' : 'in-menu'}`}>
    <div className="scene" ref={container}/><div className="vignette"/>
    <header className="game-header">
      <div className="brand"><span className="brand-mark">炒</span><div><strong>南巷 · 夜炒</strong><small>一辆餐车，一晚烟火。</small></div></div>
      {inGame && <div className="shift-summary"><span>今夜 <b>¥{state.coins}</b></span><i/><span>已出餐 <b>{state.completed}</b></span><i/><span>厨艺 <b>Lv.{state.level}</b></span></div>}
      <div className="header-controls">
        <span className="renderer"><i/>{renderer}</span>
        <button className="icon-button" title={sound ? '关闭声音' : '开启声音'} aria-label={sound ? '关闭声音' : '开启声音'} onClick={() => { if (!sound) { soundEnabled.current = true; enableAudio() } setSound(!sound) }}>{sound ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button>
        {active && <button className="icon-button" title={state.phase === 'paused' ? '继续 · Esc' : '暂停 · Esc'} aria-label={state.phase === 'paused' ? '继续游戏' : '暂停游戏'} onClick={() => simulation.setPaused(state.phase === 'playing')}>{state.phase === 'paused' ? <Play size={17}/> : <Pause size={17}/>}</button>}
        {inGame && <button className="icon-button" title="返回餐车，重新开始" aria-label="返回餐车首页" onClick={returnHome}><Home size={16}/></button>}
      </div>
    </header>
    {!inGame && <>
      <div className="menu-setting"><span>南巷夜市</span><i/><span>夜班 · 21:30</span></div>
      <section className="menu-start"><p>从这辆车，开始今晚的生意。</p><button className="start-button" disabled={!ready || !!error} onClick={start}><span>{error ? '场景载入失败' : ready ? '开始营业' : '正在准备餐车…'}</span>{ready && !error && <ArrowRight size={17}/>}</button><span className="menu-note">鼠标拖动双手 · 自己掌锅掌勺</span></section>
      <footer className="menu-footer"><span>拖动，让手真正做事。</span><button onClick={openHelp}>查看操作说明 <ArrowRight size={13}/></button></footer>
    </>}
    {inGame && <>
      <aside className="order-ticket" aria-label="当前订单">
        <div className="ticket-heading"><span>南巷炒饭</span><span>No. {String(state.order.id).padStart(2, '0')}</span></div>
        <div className="ticket-title"><h1>{state.order.title}</h1><strong>¥{state.order.price}</strong></div>
        <p className="ticket-ingredients">{state.order.ingredients.join(' · ')}</p><div className="ticket-divider"/>
        <div className="customer-line"><span>{state.order.name}</span><span>{Math.max(0, Math.ceil(state.order.patience))} <small>秒</small></span></div>
        <div className={`patience ${state.order.patience < 30 ? 'low' : ''}`}><span style={{width:`${Math.max(0, Math.min(100, state.order.patience / state.order.maxPatience * 100))}%`}}/></div><div className="ticket-footer">现点 · 现炒</div>
      </aside>
      <aside className="quality-panel" aria-label="这一锅的色香味"><span className="quiet-label">这一锅</span>{['色','香','味'].map((label,index) => <div className={`quality-row quality-${index}`} key={label}><span>{label}</span><div className="quality-track"><i style={{width:`${Math.max(0, Math.min(100, state.quality[index]))}%`}}/></div><b>{Math.round(state.quality[index])}</b></div>)}</aside>
      {active && <>
        <div className="work-feedback" key={state.event} role="status">{state.notice}</div>
        <div className="work-guide"><span className="guide-dot"/><p>{state.hint}</p><button onClick={openHelp} aria-label="查看鼠标操作说明">?</button></div>
        <div className="hands-status" aria-label="双手状态">{(['left','right'] as const).map(side => {const hand = state.hands[side];return <div key={side} className={`hand-status ${side} ${hand.mode !== 'idle' ? 'working' : ''}`}><i/><span>{side === 'left' ? '左手' : '右手'}</span><b>{hand.dragging ? '手动控制' : handModes[hand.mode]}</b><small>{objects[hand.held]}</small></div>})}</div>
      </>}
      {state.phase === 'paused' && !help && <div className="modal-backdrop"><section className="modal pause-modal" role="dialog" aria-modal="true" aria-label="游戏已暂停"><span className="quiet-label">暂停营业</span><h2>让锅歇一会儿。</h2><p>火候和客人的等待时间都已暂停。</p><button className="primary" onClick={() => {enableAudio();simulation.setPaused(false)}}>继续 <Play size={15}/></button><button className="text-button" onClick={returnHome}>回到餐车</button></section></div>}
      {state.phase === 'result' && state.result && <div className="modal-backdrop"><section className="modal result-modal" role="dialog" aria-modal="true" aria-label="出餐结果"><span className="quiet-label">本单出餐</span><div className="result-heading"><span className="grade">{state.result.grade}</span><div><h2>{state.result.score} <small>分</small></h2><p>{state.result.comment}</p></div></div><div className="result-quality">{['色','香','味'].map((label,index) => <span key={label}>{label}<b>{Math.round(state.result!.quality[index])}</b></span>)}</div><div className="rewards"><span>收入 <b>+ ¥{state.result.earned}</b></span><span>经验 <b>+ {state.result.xp}</b></span></div><button className="primary" onClick={() => simulation.continue()}>继续营业 <ArrowRight size={16}/></button></section></div>}
      {state.phase === 'upgrade' && <div className="modal-backdrop"><section className="upgrade-modal" role="dialog" aria-modal="true" aria-label="选择厨艺升级"><span className="quiet-label">厨艺精进 · Lv.{state.level}</span><h2>顺手，再练一招。</h2><p>选择接下来想精进的手艺。</p><div className="upgrade-options">{state.upgrades.map((upgrade,index) => <button key={upgrade.id} onClick={() => simulation.chooseUpgrade(upgrade.id)}><small>0{index + 1}</small><h3>{upgrade.title}</h3><p>{upgrade.description}</p><span>选择这项手艺 <ArrowRight size={15}/></span></button>)}</div></section></div>}
      {state.phase === 'closed' && <div className="modal-backdrop"><section className="modal closed-modal" role="dialog" aria-modal="true" aria-label="今晚营业结束"><span className="quiet-label">今夜收摊</span><h2>锅还热着，夜已深了。</h2><p>共完成 {state.completed} 份炒饭。</p><div className="total-earned">¥{state.coins}<small>今晚营业额</small></div><button className="primary" onClick={start}>再摆一晚 <ArrowRight size={16}/></button><button className="text-button" onClick={returnHome}>回到餐车</button></section></div>}
    </>}
    {help && <div className="modal-backdrop"><section className="modal help-modal" role="dialog" aria-modal="true" aria-label="鼠标操作说明"><button className="close-help icon-button" aria-label="关闭操作说明" onClick={closeHelp}><X size={18}/></button><span className="quiet-label">用鼠标，指挥两只手</span><h2>握住，拖动，再松手。</h2><ol className="help-steps"><li><span>01</span><div><h3>右手掌勺</h3><p>拖右手到锅里，来回推拉鼠标。松手后，它会保持翻炒，让你腾出鼠标控制另一只手。</p></div></li><li><span>02</span><div><h3>左手掌锅</h3><p>手拖到锅柄后松开握住。再次抓手，向上拖就能提锅离灶，快推快拉颠锅；下移放回炉上。</p></div></li><li><span>03</span><div><h3>取料、淋油与出餐</h3><p>持勺在食材上来回划动铲料，移到锅口画圈翻勺。瓶子先松手抓住，再在锅口画圈转腕；油、酱油、蚝油都能使用。灶台左前的煤气旋钮按住左右拖动调火力，猛火出锅气、文火防烧焦。炒好后，持勺拖到右边出餐碗松开。</p></div></li></ol><button className="primary" onClick={closeHelp}>回到餐车 <ArrowRight size={16}/></button></section></div>}
    {error && <div className="error-banner" role="alert">{error}</div>}
  </main>
}

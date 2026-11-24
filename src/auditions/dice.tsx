import '@fontsource-variable/manrope'
import '@fontsource-variable/cormorant-garamond'
import '../ui/styles.css'
import './dice.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { playAuditionAudio, prepareSceneAudio, setAudioVolume, stopSceneAudio, unlockAudio } from '../scene/audio'
import { getDieMotionTiming } from '../scene/diceMotion'
import { dieRecordingCues, showcaseDice } from '../scene/showcaseSfx'
import DieThrow from '../scene/DieThrow'
import { Seal } from '../ui/icons'

const choices = {
  D1: { name: 'На дереве', source: 'https://freesound.org/people/aunrea/sounds/485950/', author: 'aunrea' },
  D2: { name: 'На твёрдой поверхности', source: 'https://freesound.org/people/schoman3/sounds/506914/', author: 'schoman3' },
  D3: { name: 'Мягкий лоток', source: 'https://freesound.org/people/WallyDM/sounds/815672/', author: 'WallyDM' },
} as const
const ids = Object.keys(choices) as (keyof typeof choices)[]
type Choice = 'current' | keyof typeof choices
type Audio = { bank: AudioBuffer; alternatives: Map<Choice, AudioBuffer> }

async function prepare(): Promise<Audio> {
  const decoder = new OfflineAudioContext(2, 1, 48000)
  const bytes = await prepareSceneAudio()
  if (!bytes) throw new Error('Missing sound bank')
  const [bank, entries] = await Promise.all([
    decoder.decodeAudioData(bytes.slice(0)),
    Promise.all(ids.map(async id => {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/dice-auditions/${id.toLowerCase()}.mp3`)
      if (!response.ok) throw new Error(`Missing ${id}`)
      return [id, await decoder.decodeAudioData(await response.arrayBuffer())] as const
    })),
  ])
  return { bank, alternatives: new Map(entries) }
}

function DiceComparison() {
  const [audio, setAudio] = useState<Audio>()
  const [message, setMessage] = useState('Загрузка записей…')
  const [choice, setChoice] = useState<Choice>(showcaseDice.id)
  const [volume, setVolume] = useState(Math.round(showcaseDice.level * 100))
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [epoch, setEpoch] = useState(0)
  const [active, setActive] = useState(false)
  const sequence = useRef(0)
  const timer = useRef(0)
  const stop = useCallback(() => {
    ++sequence.current
    clearTimeout(timer.current)
    stopSceneAudio()
    setActive(false)
    setEpoch(0)
  }, [])
  useEffect(() => {
    let mounted = true
    void prepare().then(value => { if (mounted) setAudio(value) }, () => {
      if (mounted) setMessage('Записи не загрузились. Обновите страницу.')
    })
    const hide = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', stop)
    return () => {
      mounted = false
      stop()
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', stop)
    }
  }, [stop])

  async function roll(event: MouseEvent<HTMLButtonElement>) {
    if (!event.isTrusted || !audio || document.hidden) return
    stop()
    const id = sequence.current
    setAudioVolume(.65)
    const unlocked = await unlockAudio(audio.bank)
    if (id !== sequence.current || document.hidden) return
    if (!unlocked) { setMessage('Нажмите «Бросить» ещё раз, чтобы включить звук.'); return }
    const { totalMs } = getDieMotionTiming(reduced)
    const buffer = audio.alternatives.get(choice)
    const level = volume / 100
    const clips = buffer ? dieRecordingCues(buffer, reduced, 0, level) : []
    const startedAt = performance.now() + 60
    if (!playAuditionAudio(buffer ? [] : [{ kind: 'dice', at: 0 }], clips, startedAt, reduced, level)) return
    setMessage('')
    setEpoch(startedAt)
    setActive(true)
    timer.current = window.setTimeout(() => setActive(false), startedAt + totalMs - performance.now())
  }

  return <main className="dice-comparison" data-testid="dice-comparison" data-choice={choice} data-playing={active}>
    <header><Seal /><span>REMORSE</span></header>
    <h1>Звук кубика</h1>
    <div className="dice-comparison-stage">
      <DieThrow face={6} rollKey="dice-comparison" startedAt={epoch} reduced={reduced} quality="high" />
    </div>
    <div className="dice-comparison-controls">
      <div role="group" aria-label="Вариант звука" className="segmented">
        {(['current', ...ids] as const).map(id => <button type="button" aria-pressed={id === choice} key={id}
          onClick={() => { if (id !== choice) { stop(); setChoice(id) } }}>{id === 'current' ? 'Прежний' : id}</button>)}
      </div>
      <p>{choice === 'current' ? 'Штатный звук до замены' : choices[choice].name}</p>
      <div className="dice-comparison-transport">
        <button type="button" className="button primary" disabled={!audio} onClick={event => { void roll(event) }}>Бросить</button>
        <button type="button" className="button" disabled={!epoch} onClick={stop}>Стоп</button>
      </div>
      <div className="dice-comparison-settings">
        <label>Громкость <input type="range" min="0" max="100" value={volume} onChange={event => {
          stop(); setVolume(event.target.valueAsNumber)
        }} /> {volume}%</label>
        <label><input type="checkbox" checked={reduced} onChange={event => { stop(); setReduced(event.target.checked) }} /> Меньше движения</label>
      </div>
      {(!audio || epoch === 0 && message.startsWith('Нажмите')) && <p role="status">{message}</p>}
      {choice !== 'current' && <a href={choices[choice].source} target="_blank" rel="noreferrer">{choices[choice].author} · CC0</a>}
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<DiceComparison />)

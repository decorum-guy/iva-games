import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ABILITIES, commandKey, energyBankSize, legalCommands, transition, type Action, type GameState } from '../core'
import { ABILITY_PRACTICE, QUICK_LESSONS, type QuickLesson, type QuickLessonId } from '../core/quickTeaching'
import type { TeachingFixture } from '../core/teaching'
import { Board2D } from './Board2D'
import { Capacitors } from './Capacitors'
import { PieceIcon } from './PieceIcon'
import { abilityName, lessonText, pieceName, tr, type Language } from './i18n'
import { sceneTiming, type BoardMotion } from './motion'
import type { OverdriveAudio } from './audio'
import { quickLessonText } from './quickLessonText'
import './quick-tutorial.css'

type Track = 'quick' | 'abilities'
type Status = 'ready' | 'showing' | 'opponent' | 'complete'
type Frame = { track: Track; index: number; state: GameState }
const firstFrame = (): Frame => ({ track: 'quick', index: 0, state: QUICK_LESSONS[0].state })
const destination = (action: Action, state: GameState) => action.to ?? state.pieces.find(piece => piece.id === action.targetId)!.square

/** This board has its own ephemeral position. It never writes a match or sends a room command. */
export function QuickTutorial({ language, reduced, audio, onClose, onLanguage }: {
  language: Language; reduced: boolean; audio: OverdriveAudio; onClose(): void; onLanguage(): void;
}) {
  const [frame, setFrame] = useState(firstFrame)
  const [status, setStatus] = useState<Status>('ready')
  const [selected, setSelected] = useState<string | null>(QUICK_LESSONS[0].expected.pieceId)
  const [power, setPower] = useState<'normal' | 'impulse' | 'activate'>('normal')
  const [motion, setMotion] = useState<BoardMotion | null>(null)
  const [notice, setNotice] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const serial = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLElement>(null)
  const steps = frame.track === 'quick' ? QUICK_LESSONS : ABILITY_PRACTICE
  const step = steps[frame.index]
  const copy = frame.track === 'quick' ? quickLessonText[step.id as QuickLessonId][language]
    : lessonText[(step as TeachingFixture).id][language]
  const state = frame.state
  const piece = state.pieces.find(item => item.id === selected)
  const bank = energyBankSize(state.rulesVersion)
  const form = state.forms.white
  const hasForm = !!piece && form?.pieceId === piece.id
  const mode = power === 'impulse' && hasForm ? 'form' : power
  const commands = useMemo(() => legalCommands(state).filter((command): command is Action =>
    (command.type === 'move' || command.type === 'ability') && command.pieceId === selected && command.mode === mode), [state, selected, mode])
  const expectedReady = status === 'ready' && commands.some(action => commandKey(action) === commandKey(step.expected))
  const expectedSquare = destination(step.expected, step.state)
  const target = expectedReady ? [expectedSquare] : []
  const preview = status === 'ready' ? commands.map(action => destination(action, state)) : []
  const basics = frame.track === 'quick' && frame.index < 6
  const formLesson = frame.track === 'quick' && frame.index >= 7
  const remaining = form?.remainingTurns ?? (frame.index === 7 && status === 'ready' ? 3 : 0)
  const complete = status === 'complete'

  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; audio.stop() }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); audio.stop() }, [audio])
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }) }, [frame.track, frame.index])
  function load(track: Track, index: number, continued?: GameState) {
    stop()
    const next = (track === 'quick' ? QUICK_LESSONS : ABILITY_PRACTICE)[index]
    setFrame({ track, index, state: continued ?? next.state }); setSelected(next.expected.pieceId)
    setPower('normal'); setStatus('ready'); setMotion(null); setNotice('')
  }
  function show(before: GameState, action: Action, done: (after: GameState) => void, hold: number) {
    const result = transition(before, action)
    const duration = sceneTiming(result.events, reduced).duration
    setFrame(current => ({ ...current, state: result.state }))
    setMotion({ id: ++serial.current, before, after: result.state, events: result.events, startedAt: performance.now(), duration })
    audio.playEvents(result.events, bank)
    timer.current = setTimeout(() => { setMotion(null); done(result.state) }, duration + hold)
  }
  function perform(action: Action) {
    if (status !== 'ready') return
    if (commandKey(action) !== commandKey(step.expected)) {
      setNotice(tr(language, 'Попробуйте ярко отмеченную клетку.', 'Try the brightly marked square.')); return
    }
    setNotice(''); setStatus('showing')
    show(state, action, after => {
      if (frame.track === 'abilities' || frame.index === QUICK_LESSONS.length - 1) { setStatus('complete'); return }
      const advance = (nextState: GameState) => load('quick', frame.index + 1, QUICK_LESSONS[frame.index + 1].continues ? nextState : undefined)
      const reply = (step as QuickLesson).reply
      if (reply) {
        setStatus('opponent')
        show(after, reply, advance, reduced ? 650 : 900)
      } else advance(after)
    }, basics ? 1300 : 1800)
  }
  function onSquare(square: string) {
    if (status !== 'ready') return
    const expected = commands.find(action => commandKey(action) === commandKey(step.expected) && destination(action, state) === square)
    if (expected) { perform(expected); return }
    const found = state.pieces.find(item => item.square === square)
    if (found?.side === 'white') { setSelected(found.id); setPower('normal'); setNotice(''); return }
    setNotice(tr(language, 'Выберите отмеченную фигуру и яркую клетку.', 'Choose the marked piece and bright square.'))
  }
  const currentHint = status === 'opponent'
    ? tr(language, 'Ход синих: ваш счётчик не уменьшается.', 'Blue moves: your counter stays the same.')
    : status !== 'ready' ? copy[2]
    : !basics && step.expected.mode !== 'normal' && expectedReady
      ? tr(language, `Теперь нажмите ${expectedSquare}.`, `Now tap ${expectedSquare}.`) : copy[1]
  const sourceSquare = state.pieces.find(item => item.id === step.expected.pieceId)?.square
  const completedAbility = frame.track === 'abilities' && complete
    ? abilityName(ABILITIES[step.state.pieces.find(item => item.id === step.expected.pieceId)!.type], language) : null

  return <section className="od-quick-tutorial" ref={root} role="dialog" aria-modal="true" aria-label={tr(language, 'Обучение Форсажу', 'Overdrive tutorial')}
    data-step={step.id} data-track={frame.track} data-status={status} data-turn={state.turnSerial} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); stop(); onClose() }
      if (event.key === 'Tab') {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]') ?? [])]
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
    <header className="od-quick-header"><div><b>OVERDRIVE</b><span>{tr(language, 'Обучение на доске', 'Learn on the board')}</span></div>
      <button type="button" className="od-secondary" onClick={() => { stop(); onClose() }}>{tr(language, 'К партии', 'Back to game')} <span aria-hidden="true">×</span></button></header>
    <div className="od-quick-layout">
      <div className="od-quick-arena">
        <div className="od-quick-energy"><span>{tr(language, 'Ваш заряд', 'Your energy')}</span><Capacitors energy={state.energy.white} bank={bank} language={language}/></div>
        <div className="od-quick-board-space"><Board2D state={state} selected={selected} targets={target} previewTargets={preview} focusSquares={status === 'ready' && sourceSquare ? [sourceSquare, expectedSquare] : []}
          onSquare={onSquare} flipped={false} language={language} motion={motion} reduced={reduced}/></div>
        {formLesson && <div className="od-quick-timer" data-remaining={remaining} aria-label={tr(language, `Форсаж: ${remaining} своих ходов`, `Overdrive: ${remaining} own turns`)}>
          <strong>{remaining ? tr(language, 'Свои ходы', 'Own turns') : tr(language, 'Форсаж закончился', 'Overdrive ended')}</strong>
          <div>{[1, 2, 3].map(value => <span key={value} className={value <= remaining ? 'live' : ''}>{value <= remaining ? '●' : '○'}</span>)}</div><b>{remaining}/3</b>
        </div>}
      </div>
      <div className="od-quick-guide">
        <div className="od-quick-progress"><span>{frame.track === 'quick' ? tr(language, 'Короткий курс', 'Quick course') : tr(language, 'Приёмы фигур', 'Piece abilities')}</span><b>{frame.index + 1}/{steps.length}</b></div>
        <div className="od-progress-track">{steps.map((item, index) => <i key={item.id} className={index <= frame.index ? 'complete' : ''}/>)}</div>
        <h1 ref={heading} tabIndex={-1}>{complete && frame.track === 'quick' ? tr(language, 'Готово. Можно играть.', 'Ready to play.')
          : completedAbility ? tr(language, `${completedAbility} — выполнено`, `${completedAbility} — complete`) : copy[0]}</h1>
        <p className="od-quick-instruction" role="status">{currentHint}</p>
        {!basics && !complete && <div className="od-power-switch" role="group" aria-label={tr(language, 'Режим хода', 'Move mode')}>
          <button type="button" disabled={status !== 'ready' || !piece} aria-pressed={power === 'normal'} onClick={() => setPower('normal')}><span>{tr(language, 'Ход', 'Move')}</span><b>0</b></button>
          <button type="button" disabled={status !== 'ready' || !piece || (!hasForm && state.energy.white < bank)} aria-pressed={power === 'impulse'} onClick={() => setPower('impulse')}><span>{hasForm ? tr(language, 'Приём', 'Ability') : tr(language, 'Импульс', 'Impulse')}</span><b>{hasForm ? 0 : bank}</b></button>
          <button type="button" disabled={status !== 'ready' || !piece || state.energy.white < bank * 2} aria-pressed={power === 'activate'} onClick={() => setPower('activate')}><span>{tr(language, 'Форсаж', 'Overdrive')}</span><b>{bank * 2}</b></button>
        </div>}
        {complete && frame.track === 'quick' && <div className="od-quick-recap"><p>{tr(language, 'Импульс: одна банка, один приём.', 'Impulse: one bank, one ability.')}</p><p>{tr(language, 'Форсаж: две банки, три своих хода — вместе с первым.', 'Overdrive: two banks, three own turns — including the first.')}</p><button type="button" className="od-primary" onClick={onClose}>{tr(language, 'Вернуться к игре', 'Return to game')}</button></div>}
        {basics && <button type="button" className="od-quick-skip" onClick={() => load('quick', 6)}>{tr(language, 'Ходы знаю — к усилениям', 'I know chess — show abilities')} →</button>}
        {notice && <p className="od-quick-notice" role="alert">{notice}</p>}
        {(complete || frame.track === 'abilities') && <section className="od-quick-extras"><h2>{tr(language, 'Попробовать любой приём', 'Try any piece’s ability')}</h2>
          <div className="od-quick-pieces">{ABILITY_PRACTICE.map((fixture, index) => {
            const type = fixture.state.pieces.find(item => item.id === fixture.expected.pieceId)!.type
            return <button key={fixture.id} type="button" aria-label={`${pieceName(type, language)} · ${abilityName(ABILITIES[type], language)}`} aria-pressed={frame.track === 'abilities' && frame.index === index}
              onClick={() => load('abilities', index)}><PieceIcon type={type} size={42}/><span>{pieceName(type, language)}</span></button>
          })}</div>
        </section>}
      </div>
    </div>
    <footer className="od-quick-footer"><button type="button" onClick={() => load('quick', 0)}>{tr(language, 'Сначала', 'Restart')}</button><button type="button" onClick={onLanguage}>{language === 'ru' ? 'English' : 'Русский'}</button></footer>
  </section>
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ABILITIES, commandKey, energyBankSize, legalCommands, RuleError, transition, type Action, type GameState } from '../core'
import { ABILITY_PRACTICE, BASIC_LESSON_COUNT, QUICK_LESSONS, abilityExercise, type PracticeMode, type QuickLesson } from '../tutorial/quickTeaching'
import { Board2D } from './Board2D'
import { Capacitors } from './Capacitors'
import { PieceIcon } from './PieceIcon'
import { abilityDescription, abilityName, lessonText, pieceName, tr, type Language } from './i18n'
import { sceneTiming, type BoardMotion } from './motion'
import type { OverdriveAudio } from './audio'
import { quickLessonText } from './quickLessonText'
import './quick-tutorial.css'

type Status = 'ready' | 'showing' | 'opponent' | 'review' | 'complete'
type Frame =
  | { track: 'quick'; index: number; step: QuickLesson; state: GameState }
  | { track: 'abilities'; index: number; step: ReturnType<typeof abilityExercise>; state: GameState; practiceMode: PracticeMode }
const firstFrame = (): Frame => ({ track: 'quick', index: 0, step: QUICK_LESSONS[0], state: QUICK_LESSONS[0].state })
const destination = (action: Action, state: GameState) => action.to ?? state.pieces.find(piece => piece.id === action.targetId)!.square
const practiceModes: readonly PracticeMode[] = ['impulse', 'activate', 'form']

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
  const { step, state } = frame
  const practice = frame.track === 'abilities'
  const copy = frame.track === 'quick' ? quickLessonText[frame.step.id][language]
    : frame.step.id === 'ram' ? quickLessonText['ram-chain'][language] : lessonText[frame.step.id][language]
  const piece = state.pieces.find(item => item.id === selected)
  const bank = energyBankSize(state.rulesVersion)
  const form = state.forms.white
  const hasForm = !!piece && form?.pieceId === piece.id
  const mode = power === 'impulse' && hasForm ? 'form' : power
  const commands = useMemo(() => legalCommands(state).filter((command): command is Action =>
    (command.type === 'move' || command.type === 'ability') && command.pieceId === selected && command.mode === mode), [state, selected, mode])
  const edgeAttempt = frame.track === 'quick' && frame.step.blockedAttempt === true
  const ready = status === 'ready'
  const isExpected = (action: Action) => commandKey(action) === commandKey(step.expected)
  const expectedReady = ready && commands.some(isExpected)
  const attemptReady = ready && edgeAttempt && mode === step.expected.mode && selected === step.expected.pieceId
  const expectedSquare = destination(step.expected, step.state)
  const targets = expectedReady ? [expectedSquare] : []
  const preview = ready ? commands.filter(action => !practice || action.type === 'ability').map(action => destination(action, state)) : []
  const basics = frame.track === 'quick' && frame.index < BASIC_LESSON_COUNT
  const formLesson = practice ? frame.practiceMode !== 'impulse' : ['activate', 'free', 'expire'].includes(step.id)
  const remaining = form?.remainingTurns ?? (ready && step.expected.mode === 'activate' ? 3 : 0)
  const complete = status === 'complete'
  const practicePiece = step.state.pieces.find(item => item.id === step.expected.pieceId)!
  const ability = practice ? ABILITIES[practicePiece.type] : null
  const chargeOwner = step.id === 'battery-check' ? 'black' : 'white'

  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; audio.stop() }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); audio.stop() }, [audio])
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }) }, [frame.track, frame.index])

  function changeFrame(next: Frame, initialPower: typeof power) {
    stop()
    setFrame(next)
    setSelected(next.step.expected.pieceId)
    setPower(initialPower)
    setStatus('ready')
    setMotion(null)
    setNotice('')
  }
  function loadQuick(index: number, continued?: GameState) {
    const next = QUICK_LESSONS[index]
    changeFrame({ track: 'quick', index, step: next, state: continued ?? next.state }, 'normal')
  }
  function loadAbility(index: number, practiceMode: PracticeMode) {
    const next = abilityExercise(index, practiceMode)
    changeFrame({ track: 'abilities', index, step: next, state: next.state, practiceMode }, practiceMode === 'activate' ? 'activate' : 'impulse')
  }
  function show(before: GameState, action: Action, done: (after: GameState) => void) {
    const result = transition(before, action)
    const duration = sceneTiming(result.events, reduced).duration
    setFrame(current => ({ ...current, state: result.state }))
    setMotion({ id: ++serial.current, before, after: result.state, events: result.events, startedAt: performance.now(), duration })
    audio.playEvents(result.events, bank)
    timer.current = setTimeout(() => { timer.current = null; setMotion(null); done(result.state) }, duration)
  }
  function perform(action: Action) {
    if (!ready) return
    setNotice('')
    if (edgeAttempt) {
      try { transition(state, action) }
      catch (error) {
        if (!(error instanceof RuleError) || error.code !== 'illegalMovement') throw error
        setStatus('review')
        return
      }
      throw new Error('The board-edge Ram must be illegal')
    }

    setStatus('showing')
    show(state, action, after => {
      if (frame.track === 'abilities' || frame.index === QUICK_LESSONS.length - 1) {
        setStatus('complete')
      } else if (frame.step.reply) {
        setStatus('opponent')
        show(after, frame.step.reply, () => setStatus('review'))
      } else {
        setStatus('review')
      }
    })
  }
  function advance() {
    const next = QUICK_LESSONS[frame.index + 1]
    loadQuick(frame.index + 1, next.continues ? state : undefined)
  }
  function onSquare(square: string) {
    if (!ready) return
    if (square === expectedSquare && (expectedReady || attemptReady)) {
      perform(step.expected)
      return
    }
    const found = state.pieces.find(item => item.square === square)
    if (found?.side === 'white' && !practice) { setSelected(found.id); setPower('normal'); setNotice(''); return }
    setNotice(tr(language, 'Выберите отмеченную фигуру и яркую клетку.', 'Choose the marked piece and bright square.'))
  }
  const currentHint = status === 'opponent'
    ? tr(language, 'Ход синих. Ваш счётчик остался прежним.', 'Blue moves. Your counter stays the same.')
    : !ready ? copy[2]
    : attemptReady ? tr(language, 'Нажмите на пешку на h4.', 'Choose the pawn on h4.')
    : practice || (step.expected.mode !== 'normal' && expectedReady)
      ? tr(language, 'Выберите ' + expectedSquare + '.', 'Choose ' + expectedSquare + '.')
      : copy[1]
  const sourceSquare = practicePiece.square
  const focusSquares = ready ? [sourceSquare, expectedSquare, ...(step.focusSquares ?? [])] : []
  const steps = practice ? ABILITY_PRACTICE : QUICK_LESSONS
  const progressTitle = practice ? tr(language, 'Приёмы фигур', 'Piece abilities')
    : basics ? tr(language, 'Ходы фигур', 'Piece moves') : tr(language, 'Заряд и усиления', 'Energy and power')
  const close = () => { stop(); onClose() }

  return <section className="od-quick-tutorial" ref={root} role="dialog" aria-modal="true" aria-label={tr(language, 'Обучение Форсажу', 'Overdrive tutorial')}
    data-step={step.id} data-track={frame.track} data-status={status} data-turn={state.turnSerial} data-attempt={attemptReady} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]') ?? [])]
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
    <header className="od-quick-header">
      <div><b>OVERDRIVE</b><span>{tr(language, 'Обучение на доске', 'Learn on the board')}</span></div>
      <button type="button" className="od-secondary" onClick={close}>{tr(language, 'К партии', 'Back to game')} <span aria-hidden="true">×</span></button>
    </header>
    <div className="od-quick-layout">
      <div className="od-quick-arena">
        <div className="od-quick-energy">
          <span>{chargeOwner === 'white' ? tr(language, 'Ваш заряд', 'Your energy') : tr(language, 'Заряд синих', 'Blue energy')}</span>
          <Capacitors energy={state.energy[chargeOwner]} bank={bank} language={language}/>
        </div>
        <div className="od-quick-board-space">
          <Board2D state={state} selected={selected} targets={targets} previewTargets={preview} focusSquares={focusSquares}
            onSquare={onSquare} flipped={false} language={language} motion={motion} reduced={reduced}/>
        </div>
        {formLesson && <div className="od-quick-timer" data-remaining={remaining} aria-label={tr(language, 'Форсаж: ' + remaining + ' своих ходов', 'Overdrive: ' + remaining + ' own turns')}>
          <strong>{remaining ? tr(language, 'Свои ходы', 'Own turns') : tr(language, 'Форсаж закончился', 'Overdrive ended')}</strong>
          <div>{[1, 2, 3].map(value => <span aria-hidden="true" key={value} className={value <= remaining ? 'live' : ''}>{value <= remaining ? '●' : '○'}</span>)}</div><b>{remaining}/3</b>
        </div>}
      </div>
      <div className="od-quick-guide">
        <div className="od-quick-progress"><span>{progressTitle}</span><b>{frame.index + 1}/{steps.length}</b></div>
        {practice && <div className="od-quick-pieces" role="group" aria-label={tr(language, 'Выберите фигуру', 'Choose a piece')}>
          {ABILITY_PRACTICE.map((fixture, index) => {
            const type = fixture.state.pieces.find(item => item.id === fixture.expected.pieceId)!.type
            return <button key={fixture.id} type="button" aria-label={pieceName(type, language) + ' · ' + abilityName(ABILITIES[type], language)}
              aria-pressed={frame.index === index} onClick={() => loadAbility(index, frame.practiceMode)}>
              <PieceIcon type={type} size={36}/><span>{pieceName(type, language)}</span>
            </button>
          })}
        </div>}
        <h1 ref={heading} tabIndex={-1}>{complete && !practice ? tr(language, 'Курс пройден', 'Course complete')
          : ability ? abilityName(ability, language) : copy[0]}</h1>
        {practice && <div className="od-power-switch" role="group" aria-label={tr(language, 'Заряд для упражнения', 'Practice energy')}>
          {practiceModes.map(option => <button key={option} type="button" aria-pressed={frame.practiceMode === option}
            onClick={() => loadAbility(frame.index, option)}>
            <span>{option === 'impulse' ? tr(language, 'Импульс', 'Impulse') : option === 'activate' ? tr(language, 'Форсаж', 'Overdrive') : tr(language, 'В форме', 'In form')}</span>
            <b>{option === 'impulse' ? bank : option === 'activate' ? bank * 2 : 0}</b>
          </button>)}
        </div>}
        {ready && ability && <p className="od-quick-explanation">{abilityDescription(ability, language, state.rulesVersion)}</p>}
        <p className="od-quick-instruction" role="status">{currentHint}</p>
        {frame.track === 'quick' && step.expected.mode !== 'normal' && !complete && <div className="od-power-switch" role="group" aria-label={tr(language, 'Режим хода', 'Move mode')}>
          <button type="button" disabled={!ready || !piece} aria-pressed={power === 'normal'} onClick={() => setPower('normal')}><span>{tr(language, 'Ход', 'Move')}</span><b>0</b></button>
          <button type="button" disabled={!ready || !piece || (!hasForm && state.energy.white < bank)} aria-pressed={power === 'impulse'} onClick={() => setPower('impulse')}><span>{hasForm ? tr(language, 'Приём', 'Ability') : tr(language, 'Импульс', 'Impulse')}</span><b>{hasForm ? 0 : bank}</b></button>
          <button type="button" disabled={!ready || !piece || state.energy.white < bank * 2} aria-pressed={power === 'activate'} onClick={() => setPower('activate')}><span>{tr(language, 'Форсаж', 'Overdrive')}</span><b>{bank * 2}</b></button>
        </div>}
        {status === 'review' && <button type="button" className="od-primary od-quick-next" onClick={advance}>{tr(language, 'Дальше', 'Next')}</button>}
        {complete && frame.track === 'quick' && <button type="button" className="od-primary" onClick={close}>{tr(language, 'Вернуться к игре', 'Return to game')}</button>}
        {complete && practice && <button type="button" className="od-secondary" onClick={() => loadAbility(frame.index, frame.practiceMode)}>{tr(language, 'Повторить приём', 'Try again')}</button>}
        {basics && ready && <button type="button" className="od-quick-skip" onClick={() => loadQuick(BASIC_LESSON_COUNT)}>{tr(language, 'Ходы знаю — к усилениям', 'I know chess — show abilities')} →</button>}
        {notice && <p className="od-quick-notice" role="alert">{notice}</p>}
      </div>
    </div>
    <footer className="od-quick-footer">
      <button type="button" onClick={() => loadQuick(0)}>{tr(language, 'К началу курса', 'Restart course')}</button>
      {!practice && <button type="button" onClick={() => loadAbility(0, 'impulse')}>{tr(language, 'Приёмы всех фигур', 'All piece abilities')}</button>}
      <button type="button" onClick={onLanguage}>{language === 'ru' ? 'English' : 'Русский'}</button>
    </footer>
  </section>
}

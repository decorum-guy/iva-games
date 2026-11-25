import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ABILITIES, commandKey, createInitialState, isInCheck, legalCommands, resign, transition, type Action, type ActionMode, type Command, type GameEvent, type GameState, type Side } from '../core'
import { TEACHING_FIXTURES } from '../core/teaching'
import { legacyLessonText } from './legacyLessonText'
import { LEGACY_TEACHING_FIXTURES } from '../core/legacyTeaching'
import { PRESETS } from '../engine/presets'
import { OnlineRoomClient, createOnlineRoom, ensureOnlineGuest, fetchOnlineRoom, joinOnlineRoom, refreshOnlineInvite, type OnlineTransportState } from '../online/client'
import type { OnlineAction, OnlineCommand, RoomSnapshot } from '../online/protocol'
import { clearRoomLocation, lastRoom, onlineLocation, rememberRoom, roomLink } from '../online/location'
import { Board2D } from './Board2D'
import { PieceIcon } from './PieceIcon'
import { abilityDescription, abilityName, lessonText, onlineErrorText, outcomeReason, outcomeText, pieceName, sideName, tr, type Language } from './i18n'
import { checkmateEdge, type FallPlayback } from './finale'
import { sceneTiming, readingDuration, type BoardMotion } from './motion'
import { loadLocalSession, loadOverdriveSettings, saveLocalSession, saveOverdriveSettings, type LocalSessionRecord } from './session'
import { useBot } from './useBot'
import { OverdriveAudio } from './audio'
import { canInteractOnline } from './presentation'

const Board3D = lazy(()=>import('./Board3D'))
type Panel = 'setup'|'rules'|'settings'|'history'|'online'|null
type PlayMode = 'bot'|'local'|'tutorial'|'online'
const administrativeLabel = (command:Command,language:Language) => command.type==='resign'?tr(language,'Сдача','Resignation'):command.type==='agreeDraw'?tr(language,'Ничья по соглашению','Draw by agreement'):tr(language,'Заявление ничьей','Draw claim')
const identity = commandKey
const newRecord = (mode:LocalSessionRecord['mode']='bot',level=4,humanSide:Side='white'):LocalSessionRecord => ({version:1,root:createInitialState(),actions:[],mode,level,humanSide,lessonIndex:0,lessonAck:false})
const targetSquare = (action:Action,state:GameState) => action.to ?? state.pieces.find(p=>p.id===action.targetId)?.square ?? ''

function Capacitors({energy,language,bank}:{energy:number;language:Language;bank:number}) {
  return <div className="od-capacitors" aria-label={tr(language,`Энергия: ${energy} из ${bank * 2}`,`Energy: ${energy} of ${bank * 2}`)}>
    {[0,1].map(cell=><span className={`od-capacitor ${energy>=bank*(cell+1)?'full':''}`} key={cell}>
      {Array.from({length:bank},(_,i)=><i key={i} className={energy>cell*bank+i?'charged':''}/>)}
    </span>)}<strong>{energy}<span>/{bank * 2}</span></strong>
  </div>
}
function PlayerRail({state,side,language,name,connected,thinking}:{state:GameState;side:Side;language:Language;name:string;connected?:boolean;thinking?:boolean}) {
  const form=state.forms[side],piece=form&&state.pieces.find(p=>p.id===form.pieceId)
  return <div className={`od-player-rail ${side} ${state.side===side&&!state.outcome?'active':''}`}>
    <div className="od-player-identity"><span className="od-side-disc"/><div><strong>{name}</strong><small>{thinking?tr(language,'Рассчитывает ход…','Thinking…'):piece?`${pieceName(piece.type,language)} · ${tr(language,'форсаж','overdrive')} ${form.remainingTurns}`:sideName(side,language)}{connected===false&&` · ${tr(language,'не в сети','offline')}`}</small></div></div>
    <Capacitors energy={state.energy[side]} language={language} bank={state.rulesVersion === 'overdrive-v1' ? 5 : 3}/>
  </div>
}
class SceneBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?this.props.fallback:this.props.children}
}
function commandLabel(action:Action,state:GameState,language:Language) {
  const piece=state.pieces.find(p=>p.id===action.pieceId), target=state.pieces.find(p=>p.id===action.targetId)
  if(!piece)return ''
  const title=action.type==='ability'?abilityName(ABILITIES[piece.type],language):pieceName(piece.type,language)
  const destination=action.to??target?.square??piece.square
  return `${title}: ${piece.square} → ${destination}${target?` · ${pieceName(target.type,language)} ${target.square}`:''}${action.promotion?` · ${pieceName(action.promotion,language)}`:''}`
}

export function OverdriveApp() {
  const [initial]=useState(()=>{const saved=loadLocalSession();return saved??{record:newRecord(),state:createInitialState()}})
  const [record,setRecord]=useState<LocalSessionRecord>(initial.record)
  const [localState,setLocalState]=useState(initial.state)
  const [gameId,setGameId]=useState(()=>crypto.randomUUID())
  const [settings,setSettings]=useState(loadOverdriveSettings)
  const language=settings.lang
  const [mode,setMode]=useState<PlayMode>(initial.record.mode)
  const [panel,setPanel]=useState<Panel>(()=>onlineLocation(location.hash)?'online':initial.record.actions.length||initial.record.mode==='tutorial'||initial.state.outcome?null:'setup')
  const [selected,setSelected]=useState<string|null>(null)
  const [power,setPower]=useState<'normal'|'impulse'|'activate'>('normal')
  const [choices,setChoices]=useState<readonly Action[]>([])
  const [flipped,setFlipped]=useState(false)
  const [motion,setMotion]=useState<BoardMotion|null>(null)
  const [locked,setLocked]=useState(false)
  const lockedRef=useRef(false)
  const motionId=useRef(0)
  const arenaReady=useRef(false)
  const finale=useRef<FallPlayback|null>(null)
  const lastMate=useRef<string|null>(null)
  const onArenaMounted=useCallback((ready:boolean)=>{
    arenaReady.current=ready
    if(!ready&&finale.current)finale.current.settled=true
  },[])
  const motionTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const [notice,setNotice]=useState('')
  const [recentEvents,setRecentEvents]=useState<readonly GameEvent[]>([])
  const [setupMode,setSetupMode]=useState<'bot'|'local'>('bot')
  const [setupLevel,setSetupLevel]=useState(record.level)
  const [setupSide,setSetupSide]=useState<Side>(record.humanSide)
  const [confirmResign,setConfirmResign]=useState(false)
  const [name,setName]=useState('')
  const [inviteInput,setInviteInput]=useState('')
  const [invite,setInvite]=useState('')
  const [busy,setBusy]=useState(false)
  const [room,setRoom]=useState<RoomSnapshot|null>(null)
  const [onlineDisplay,setOnlineDisplay]=useState<GameState|null>(null)
  const [transport,setTransport]=useState<OnlineTransportState>({status:'idle',pending:false,attempt:0})
  const client=useRef<OnlineRoomClient|null>(null)
  const roomRef=useRef<RoomSnapshot|null>(null)
  const queue=useRef<{snapshot:RoomSnapshot;action:OnlineAction}[]>([])
  const drainRef=useRef<()=>void>(()=>{})
  const displayRef=useRef<GameState|null>(null)
  const displayedGame=useRef<{id:string;revision:number}|null>(null)
  const [audio]=useState(()=>new OverdriveAudio())
  const [systemReduced,setSystemReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)
  const reduced=settings.reduced??systemReduced
  const state=mode==='online'?(onlineDisplay??localState):localState
  const lessons=record.root.rulesVersion==='overdrive-v1'?LEGACY_TEACHING_FIXTURES:TEACHING_FIXTURES
  const lesson=mode==='tutorial'?lessons[record.lessonIndex]:null
  const lessonCopy=lesson?(record.root.rulesVersion==='overdrive-v1'?legacyLessonText:lessonText)[lesson.id]?.[language]:null
  const stateRef=useRef(state);stateRef.current=state
  const languageRef=useRef(language);languageRef.current=language

  useEffect(()=>{document.documentElement.lang=language;document.title=tr(language,'Форсаж / OVERDRIVE — Chess 2','OVERDRIVE — Chess 2')},[language])
  useEffect(()=>{saveOverdriveSettings(settings)},[settings])
  useLayoutEffect(()=>{audio.setOptions({mute:settings.mute,volume:settings.volume,reducedMotion:reduced})},[settings.mute,settings.volume,audio,reduced])
  useEffect(()=>{const unlock=()=>{void audio.unlock()};document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);return()=>{document.removeEventListener('pointerdown',unlock);document.removeEventListener('keydown',unlock)}},[audio])
  useEffect(()=>()=>{audio.dispose();client.current?.destroy();if(motionTimer.current)clearTimeout(motionTimer.current)},[audio])
  useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)');const listener=()=>setSystemReduced(query.matches);query.addEventListener('change',listener);return()=>query.removeEventListener('change',listener)},[])
  useEffect(()=>{if(!saveLocalSession(record))setNotice(tr(languageRef.current,'Не удалось сохранить партию на устройстве. Освободите место или разрешите хранение данных.','Could not save this game on your device. Free space or enable local storage.'))},[record])
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setChoices([]);setSelected(null);setPower('normal');setConfirmResign(false);if(panel!=='setup')setPanel(null)}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape)},[panel])
  useEffect(()=>{
    if(!panel&&!choices.length&&!confirmResign)return
    const dialogs=document.querySelectorAll<HTMLElement>('.od-overlay [role="dialog"]')
    const dialog=dialogs[dialogs.length-1];if(!dialog)return
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
    const controls=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]'))
    controls()[0]?.focus({preventScroll:true})
    const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const items=controls();if(!items.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus()}}
    dialog.addEventListener('keydown',trap)
    return()=>{dialog.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus({preventScroll:true})}
  },[panel,choices.length,confirmResign])


  const animate=useCallback((before:GameState,after:GameState,events:readonly GameEvent[],scope:string=gameId)=>{
    const timing=sceneTiming(events,reduced)
    const duration=timing.duration
    const startedAt=performance.now()
    const key=checkmateEdge(scope,before,after,events)
    if(key&&key===lastMate.current)return
    if(motionTimer.current)clearTimeout(motionTimer.current)
    if(key)lastMate.current=key
    finale.current=key&&arenaReady.current&&!document.hidden&&!reduced?{
      key,startsAt:startedAt+timing.result,elapsed:0,previousFrame:null,settled:false,onContact:audio.contactPlayer(),
    }:null
    lockedRef.current=true;setLocked(true)
    setMotion({id:++motionId.current,before,after,events,startedAt,duration})
    setRecentEvents(events);audio.playEvents(events,before.rulesVersion==='overdrive-v1'?5:3)
    motionTimer.current=setTimeout(()=>{setMotion(null);lockedRef.current=false;setLocked(false);drainRef.current()},duration+readingDuration(events,reduced))
  },[audio,reduced,gameId])
  const resetMotion=useCallback(()=>{if(finale.current)finale.current.settled=true;finale.current=null;if(motionTimer.current)clearTimeout(motionTimer.current);motionTimer.current=null;setMotion(null);setLocked(false);lockedRef.current=false;audio.stop();setSelected(null);setPower('normal');setChoices([]);setRecentEvents([])},[audio])
  useEffect(()=>{
    const visible=()=>{
      if(!document.hidden){drainRef.current();return}
      if(finale.current)finale.current.previousFrame=null
      const snapshot=roomRef.current
      if(!snapshot||!queue.current.length)return
      // Catch up silently to the last authoritative position while hidden.
      queue.current=[];resetMotion();displayRef.current=snapshot.game.state
      displayedGame.current={id:snapshot.game.id,revision:snapshot.game.revision}
      setOnlineDisplay(snapshot.game.state)
    }
    document.addEventListener('visibilitychange',visible)
    return ()=>document.removeEventListener('visibilitychange',visible)
  },[resetMotion])
  const motionPreference=useRef(reduced)
  useLayoutEffect(()=>{
    if(motionPreference.current===reduced)return
    motionPreference.current=reduced
    if(finale.current)finale.current.settled=true
    if(!lockedRef.current)return
    // A preference change ends the old visual/audio clock without undoing its committed action.
    // Layout cleanup prevents a frame rendered with new durations and old scheduled sound.
    resetMotion();drainRef.current()
  },[reduced,resetMotion])
  const leaveOnline=useCallback(()=>{client.current?.destroy();client.current=null;queue.current=[];roomRef.current=null;displayRef.current=null;displayedGame.current=null;setRoom(null);setOnlineDisplay(null);clearRoomLocation()},[])
  const start=useCallback((next:LocalSessionRecord,nextState=next.root)=>{
    leaveOnline();resetMotion();setRecord(next);setLocalState(nextState);setMode(next.mode);setGameId(crypto.randomUUID());setFlipped(next.mode==='bot'&&next.humanSide==='black');setPanel(null);setNotice('');setConfirmResign(false)
  },[leaveOnline,resetMotion])

  const applyLocal=useCallback((command:Command)=>{
    if(lockedRef.current)return
    const before=stateRef.current
    if(mode==='tutorial'&&lesson&&(record.lessonAck||identity(command)!==identity(lesson.expected))){setNotice(tr(language,'Попробуйте отмеченный приём из задания.','Try the marked action in this exercise.'));return}
    try {
      const next=transition(before,command)
      setLocalState(next.state);setRecord(old=>({...old,actions:[...old.actions,command],lessonAck:mode==='tutorial'}))
      setSelected(null);setPower('normal');setChoices([]);setNotice('');animate(before,next.state,next.events)
    }catch{setNotice(tr(language,'Этот ход недоступен. Выберите подсвеченную клетку.','This move is unavailable. Choose a highlighted square.'))}
  },[animate,mode,lesson,record.lessonAck,language])
  const botError=useCallback(()=>setNotice(tr(languageRef.current,'Движок не смог завершить расчёт. Откройте меню и продолжите партию.','The engine could not complete its search. Open the menu and resume the game.')),[])
  const thinking=useBot({state:localState,gameId,level:record.level,humanSide:record.humanSide,enabled:mode==='bot'&&!locked&&!panel&&!choices.length&&!confirmResign&&!localState.outcome,onCommand:applyLocal,onError:botError})

  const drain=useCallback(()=>{
    if(lockedRef.current||document.hidden)return
    const pending=queue.current.shift();if(!pending)return
    const before=displayRef.current??pending.snapshot.game.root
    displayRef.current=pending.snapshot.game.state;setOnlineDisplay(pending.snapshot.game.state)
    displayedGame.current={id:pending.snapshot.game.id,revision:pending.snapshot.game.revision}
    setSelected(null);setPower('normal');setChoices([])
    animate(before,pending.snapshot.game.state,pending.action.events,pending.snapshot.game.id)
  },[animate]);drainRef.current=drain
  const connectRoom=useCallback((snapshot:RoomSnapshot,invitation='')=>{
    leaveOnline();resetMotion();setMode('online');setRoom(snapshot);roomRef.current=snapshot;displayRef.current=snapshot.game.state;displayedGame.current={id:snapshot.game.id,revision:snapshot.game.revision};setOnlineDisplay(snapshot.game.state);setFlipped(snapshot.you==='black');setInvite(invitation);setPanel(null);setNotice('');rememberRoom(snapshot.id)
    const connection=new OnlineRoomClient(snapshot.id,{
      onTransport:setTransport,
      onError:code=>setNotice(onlineErrorText(code,languageRef.current)),
      onSnapshot:(next,kind,action)=>{
        const previous=roomRef.current
        setRoom(next);roomRef.current=next
        if(kind==='welcome'&&previous?.game.id===next.game.id&&previous.game.revision===next.game.revision&&!document.hidden)return
        if(kind==='welcome'||!previous||previous.game.id!==next.game.id||document.hidden){queue.current=[];resetMotion();displayRef.current=next.game.state;displayedGame.current={id:next.game.id,revision:next.game.revision};setOnlineDisplay(next.game.state);setFlipped(next.you==='black');return}
        if(next.game.revision>previous.game.revision){
          if(action&&next.game.revision===previous.game.revision+1){queue.current.push({snapshot:next,action});drainRef.current()}
          else {queue.current=[];resetMotion();displayRef.current=next.game.state;displayedGame.current={id:next.game.id,revision:next.game.revision};setOnlineDisplay(next.game.state)}
        }
      },
    });client.current=connection;connection.connect()
  },[leaveOnline,resetMotion])
  const openOnline=async(kind:'create'|'join'|'resume')=>{
    if(busy)return;setBusy(true);setNotice('')
    try{
      await ensureOnlineGuest()
      if(kind==='create'){
        const result=await createOnlineRoom({name:name.trim(),side:setupSide,requestId:crypto.randomUUID()});connectRoom(result.snapshot,result.invite)
      }else if(kind==='join'){
        let parsed=onlineLocation(location.hash)
        if(inviteInput.trim()){try{parsed=onlineLocation(new URL(inviteInput.trim()).hash)}catch{parsed=onlineLocation(inviteInput.trim())}}
        if(!parsed?.invite)throw new Error('inviteInvalid')
        const result=await joinOnlineRoom(parsed.roomId,{name:name.trim(),invite:parsed.invite});connectRoom(result.snapshot)
      }else{
        const roomId=onlineLocation(location.hash)?.roomId??lastRoom();if(!roomId)throw new Error('roomMissing')
        const result=await fetchOnlineRoom(roomId);connectRoom(result.snapshot)
      }
    }catch(error){setNotice(onlineErrorText(error&&typeof error==='object'&&'code'in error?String(error.code):error instanceof Error?error.message:'serverError',language))}
    finally{setBusy(false)}
  }
  const sendOnline=(command:OnlineCommand)=>{
    if(!client.current?.send(command))setNotice(tr(language,'Дождитесь синхронизации комнаты.','Wait for the room to synchronise.'))
  }
  const allCommands=useMemo(()=>state.outcome?[]:legalCommands(state),[state])
  const piece=state.pieces.find(p=>p.id===selected)??null
  const hasForm=piece!==null&&state.forms[piece.side]?.pieceId===piece.id
  const actionMode:ActionMode=power==='impulse'&&hasForm?'form':power
  const selectedActions=useMemo(()=>allCommands.filter((c):c is Action=>(c.type==='move'||c.type==='ability')&&c.pieceId===selected&&c.mode===actionMode),[allCommands,selected,actionMode])
  const targets=[...new Set(selectedActions.map(c=>targetSquare(c,state)))]
  const inputAllowed=!locked&&!panel&&!confirmResign&&!state.outcome&&!(mode==='bot'&&state.side!==record.humanSide)&&!(mode==='tutorial'&&record.lessonAck)&&(mode!=='online'||canInteractOnline({room,displayedGame:displayedGame.current,side:state.side,transport,queuedActions:queue.current.length}))
  const perform=(command:Command)=>{if(!inputAllowed)return;if(mode==='online'){if(command.type!=='agreeDraw')sendOnline(command)}else applyLocal(command)}
  const onSquare=(square:string)=>{
    if(!inputAllowed)return
    const found=state.pieces.find(p=>p.square===square)
    if(found?.id===selected){setSelected(null);setPower('normal');setChoices([]);return}
    const possible=selectedActions.filter(c=>targetSquare(c,state)===square)
    if(possible.length===1){perform(possible[0]);return}
    if(possible.length>1){setChoices(possible);return}
    if(found?.side===state.side){setSelected(found.id);setPower('normal');setChoices([]);setNotice('')}
    else {setSelected(null);setPower('normal')}
  }
  const nextLesson=()=>{
    const next=record.lessonIndex+1;if(next>=TEACHING_FIXTURES.length)return
    const root=lessons[next].state;resetMotion();setRecord({...record,root,actions:[],lessonIndex:next,lessonAck:false});setLocalState(root);setNotice('')
  }
  const tutorialStart=()=>{const next={...newRecord('tutorial'),root:TEACHING_FIXTURES[0].state};start(next)}
  const undo=()=>{
    if(mode==='online'||mode==='tutorial'||locked)return
    let commands=record.actions.slice(0,-1)
    let rebuilt=record.root;for(const command of commands)rebuilt=transition(rebuilt,command).state
    if(mode==='bot'&&rebuilt.side!==record.humanSide&&commands.length){commands=commands.slice(0,-1);rebuilt=record.root;for(const command of commands)rebuilt=transition(rebuilt,command).state}
    resetMotion();setGameId(crypto.randomUUID());setLocalState(rebuilt);setRecord({...record,actions:commands})
  }
  const replay=useMemo(()=>{
    if(panel!=='history')return []
    if(mode==='online'&&room){let before=room.game.root;return room.game.actions.map(a=>{const label=(a.command.type==='move'||a.command.type==='ability')?commandLabel(a.command,before,language):administrativeLabel(a.command,language);before=transition(before,a.command).state;return {label,side:a.actor}})}
    let before=record.root;return record.actions.map(command=>{const side=before.side;const label=(command.type==='move'||command.type==='ability')?commandLabel(command,before,language):administrativeLabel(command,language);before=transition(before,command).state;return {label,side}})
  },[panel,mode,room,record,language])
  const check=isInCheck(state,state.side)
  const lastEnergy=recentEvents.find(e=>e.type==='energy')
  const lastAbility=recentEvents.find(e=>e.type==='ability')
  const owner=(side:Side)=>mode==='online'?room?.players[side]?.name??tr(language,'Ожидаем игрока','Waiting for player'):mode==='bot'?(side===record.humanSide?tr(language,'Вы','You'):`${tr(language,'Движок','Engine')} ${record.level}`):sideName(side,language)
  const form=state.forms[state.side]
  const energy=state.energy[state.side]
  const bank=state.rulesVersion === 'overdrive-v1' ? 5 : 3
  const claim=allCommands.find(c=>c.type==='claimDraw')
  const boardProps={state,selected,targets,focusSquares:lesson&&!record.lessonAck?lesson.focusSquares:[],onSquare,flipped,motion,reduced}
  const focusableBoard=<Board2D {...boardProps} language={language}/>

  return <main className="od-app" data-mode={mode} data-turn={state.turnSerial} data-rules-version={state.rulesVersion} data-locked={locked}>
    <header className="od-header">
      <button className="od-wordmark" onClick={()=>setPanel('setup')} aria-label={tr(language,'Форсаж — меню','Overdrive menu')}><span className="od-emblem"><i/><i/></span>OVERDRIVE<span className="od-brand-family">Chess 2</span></button>
      <div className="od-header-actions"><button className="od-text-button" onClick={()=>setPanel('rules')}>{tr(language,'Приёмы','Move book')}</button><button className="od-icon-button" onClick={()=>setSettings({...settings,mute:!settings.mute})} aria-label={settings.mute?tr(language,'Включить звук','Unmute sound'):tr(language,'Выключить звук','Mute sound')} title={settings.mute?tr(language,'Звук выключен','Sound off'):tr(language,'Звук включён','Sound on')}>{settings.mute?<svg viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3zm13 0 5 6m0-6-5 6"/></svg>:<svg viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3zm13-1q5 4 0 8m3-11q8 7 0 14"/></svg>}</button><button className="od-icon-button" onClick={()=>setPanel('settings')} aria-label={tr(language,'Настройки','Settings')}><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18m-12-15v6m6 0v6m-8 0v6"/></svg></button><button className="od-text-button od-menu-button" onClick={()=>setPanel('setup')}>{tr(language,'Меню','Menu')}</button></div>
    </header>
    <section className="od-game-layout">
      <div className="od-arena-column">
        <PlayerRail state={state} side={flipped?'white':'black'} language={language} name={owner(flipped?'white':'black')} connected={mode==='online'?room?.players[flipped?'white':'black']?.connected:undefined} thinking={thinking&&state.side===(flipped?'white':'black')}/>
        <div className={`od-board-host ${settings.view==='3d'?'is-3d':''}`}>
          <div className="od-arena-stamp" aria-hidden="true">{tr(language,'Форсаж','Overdrive')}</div>
          {settings.view==='3d'?<SceneBoundary fallback={focusableBoard}><Suspense fallback={focusableBoard}><Board3D {...boardProps} playback={finale.current} onArenaMounted={onArenaMounted}/></Suspense></SceneBoundary>:focusableBoard}
          {settings.view==='3d'&&<Board2D {...boardProps} language={language} accessibleOnly/>}
        </div>
        <div className="od-board-tools"><button onClick={()=>setFlipped(!flipped)} aria-label={tr(language,'Перевернуть доску','Flip board')}><svg viewBox="0 0 24 24"><path d="M4 9a8 8 0 0 1 14-3l2 3m0-6v6h-6M20 15a8 8 0 0 1-14 3l-2-3m0 6v-6h6"/></svg></button><button onClick={()=>setSettings({...settings,view:settings.view==='3d'?'2d':'3d'})}>{settings.view==='3d'?'2D':'3D'}</button></div>
        <PlayerRail state={state} side={flipped?'black':'white'} language={language} name={owner(flipped?'black':'white')} connected={mode==='online'?room?.players[flipped?'black':'white']?.connected:undefined} thinking={thinking&&state.side===(flipped?'black':'white')}/>
      </div>
      <aside className="od-workbench">
        <div className="od-match-line"><span>{mode==='tutorial'?`${tr(language,'Учебник','Move book')} ${record.lessonIndex+1}/${TEACHING_FIXTURES.length}`:mode==='online'?tr(language,'Сетевая партия','Online game'):mode==='local'?tr(language,'Вдвоём за доской','Two at the board'):tr(language,'Тренировка с движком','Engine practice')}</span><button onClick={()=>setPanel('history')}>{tr(language,'Ходы','Moves')} <b>{Math.floor(state.turnSerial/2)+1}</b></button></div>
        {state.outcome?<div className="od-result" role="status"><span className="od-result-glyph">{state.outcome.winner==='white'?'1:0':state.outcome.winner==='black'?'0:1':'½:½'}</span><h1>{outcomeText(state.outcome,language)}</h1><p>{outcomeReason(state.outcome.reason,language)}</p>{mode==='online'?<><button className="od-primary" onClick={()=>sendOnline({type:'rematch',accept:true})} disabled={room?.rematchVotes.includes(room.you)}>{room?.rematchVotes.includes(room.you)?tr(language,'Ждём реванша','Waiting for rematch'):tr(language,'Реванш','Rematch')}</button><small>{tr(language,'В реванше стороны меняются.','Colours swap in the rematch.')}</small></>:<button className="od-primary" onClick={()=>start(newRecord(record.mode==='tutorial'?'bot':record.mode,record.level,record.humanSide))}>{tr(language,'Новая партия','New game')}</button>}</div>:
        mode==='online'&&room?.status==='waiting'?<div className="od-lobby"><h1>{tr(language,'Встречаемся за доской','Meet at the board')}</h1><p>{room.players.white&&room.players.black?tr(language,'Оба игрока на месте. Подтвердите готовность.','Both players are here. Confirm you are ready.'):tr(language,'Отправьте приглашение второму игроку.','Send the invitation to the second player.')}</p>{invite&&<><label>{tr(language,'Ссылка на комнату','Room invitation')}<input readOnly value={roomLink(room.id,invite)} onFocus={e=>e.currentTarget.select()}/></label><button className="od-secondary" onClick={()=>{void navigator.clipboard.writeText(roomLink(room.id,invite)).then(()=>setNotice(tr(language,'Приглашение скопировано.','Invitation copied.'))).catch(()=>setNotice(tr(language,'Выделите ссылку и скопируйте её.','Select and copy the invitation link.')))}}>{tr(language,'Скопировать','Copy invitation')}</button></>}{!invite&&!(room.players.white&&room.players.black)&&<button className="od-secondary" onClick={()=>{void refreshOnlineInvite(room.id).then(r=>setInvite(r.invite)).catch(()=>setNotice(onlineErrorText('serverError',language)))}}>{tr(language,'Показать приглашение','Show invitation')}</button>}<div className="od-ready-list">{(['white','black']as const).map(side=><span key={side}>{owner(side)}<b>{room.players[side]?.ready?'✓':tr(language,'ожидаем','waiting')}</b></span>)}</div><button className="od-primary" disabled={transport.status!=='connected'||transport.pending} onClick={()=>sendOnline({type:'ready',ready:!room.players[room.you]?.ready})}>{room.players[room.you]?.ready?tr(language,'Отменить готовность','Not ready'):tr(language,'Я готов','I’m ready')}</button></div>:
        <>
          {lessonCopy?<div className="od-lesson"><div className="od-progress-track">{TEACHING_FIXTURES.map((f,i)=><i key={f.id} className={i<=record.lessonIndex?'complete':''}/>)}</div><h1>{lessonCopy[0]}</h1><p>{record.lessonAck?lessonCopy[2]:lessonCopy[1]}</p>{record.lessonAck&&!locked&&(record.lessonIndex<TEACHING_FIXTURES.length-1?<button className="od-primary" onClick={nextLesson}>{tr(language,'Следующий приём','Next exercise')}</button>:<div className="od-finish-lesson"><button className="od-primary" onClick={()=>start({...newRecord('bot',4,'white'),root:state})}>{tr(language,'Продолжить с движком','Continue with the engine')}</button><button className="od-secondary" onClick={()=>start(newRecord('bot',4,'white'))}>{tr(language,'Играть с начала','Play from the start')}</button></div>)}</div>:<div className="od-turn-heading"><span className={`od-turn-indicator ${check?'check':''}`}/><h1>{thinking?tr(language,'Движок думает','Engine thinking'):check?tr(language,'Шах','Check'):`${tr(language,'Ход','To move:')} ${tr(language,state.side==='white'?'белых':'синих',sideName(state.side,language))}`}</h1><p>{check?tr(language,'Защитите короля. Усиления тоже могут помочь.','Protect your king. Abilities can also provide an escape.'):tr(language,'Выберите фигуру. Заряд меняет её возможности.','Choose a piece. Energy changes what it can do.')}</p></div>}
          <div className={`od-piece-control ${piece?'selected':''}`}>
            <div className="od-piece-title">{piece?<><PieceIcon type={piece.type} side={piece.side} size={62}/><div><h2>{pieceName(piece.type,language)} <span>{piece.square}</span></h2><p>{abilityName(ABILITIES[piece.type],language)}</p></div><button className="od-clear-selection" aria-label={tr(language,'Снять выделение','Clear selection')} onClick={()=>{setSelected(null);setPower('normal')}}>×</button></>:<><span className="od-empty-selection"><svg viewBox="0 0 50 50"><path d="M7 18V7h11m14 0h11v11M7 32v11h11m14 0h11V32M25 16v18m-9-9h18"/></svg></span><div><h2>{tr(language,'Выберите фигуру','Choose a piece')}</h2><p>{tr(language,'Её приём появится здесь','Its ability will appear here')}</p></div></>}</div>
            <div className="od-power-switch" role="group" aria-label={tr(language,'Режим хода','Move mode')}>
              <button aria-pressed={power==='normal'} onClick={()=>setPower('normal')} disabled={!piece||!inputAllowed}><span>{tr(language,'Ход','Move')}</span><b>0</b></button>
              <button aria-pressed={power==='impulse'} onClick={()=>setPower('impulse')} disabled={!piece||!inputAllowed||(!hasForm&&energy<bank)}><span>{hasForm?tr(language,'Приём','Ability'):tr(language,'Импульс','Impulse')}</span><b>{hasForm?'0':bank}</b></button>
              <button aria-pressed={power==='activate'} onClick={()=>setPower('activate')} disabled={!piece||!inputAllowed||energy<bank*2}><span>{tr(language,'Форсаж','Overdrive')}</span><b>{bank*2}</b></button>
            </div>
            <p className="od-ability-description">{piece?(power==='normal'?tr(language,'Обычный шахматный ход. Чтобы применить особый приём, выберите импульс.','A normal chess move. Choose Impulse to use this piece’s ability.'):power==='activate'?tr(language,'Эта фигура выполнит ход и получит приём на три своих хода, включая текущий.','This piece acts now and keeps its ability for three of your turns, including this one.'):abilityDescription(ABILITIES[piece.type],language)):bank===5?tr(language,'Взятие даёт +1, шах — +2. Приём стоит 5.','Captures give +1, check +2. An ability costs 5.'):tr(language,'Пешка +1, конь и слон +2, ладья +3, ферзь +4. Шах +2.','Pawn +1, knight and bishop +2, rook +3, queen +4. Check +2.')}</p>
            {piece&&power!=='normal'&&selectedActions.length===0&&<p className="od-inline-hint">{tr(language,'Для этого приёма сейчас нет законной цели.','There is no legal target for this ability right now.')}</p>}
            {hasForm&&<div className="od-form-label">{tr(language,'Форсаж: осталось своих ходов','Overdrive: own turns remaining')} <b>{form?.remainingTurns}</b></div>}
          </div>
          <div className="od-event-strip" aria-live="polite">{lastAbility?<><span className="od-event-mark"/>{abilityName(lastAbility.ability,language)}{lastEnergy&&lastEnergy.type==='energy'&&<small>{lastEnergy.spent?`−${lastEnergy.spent}`:''}{lastEnergy.captureEarned+lastEnergy.checkEarned?` +${lastEnergy.captureEarned+lastEnergy.checkEarned}`:''} {tr(language,'энергии','energy')}</small>}</>:lastEnergy&&lastEnergy.type==='energy'&&(lastEnergy.captureEarned+lastEnergy.checkEarned)>0?<><span className="od-event-mark"/>+{lastEnergy.captureEarned+lastEnergy.checkEarned} {tr(language,'энергии','energy')}</>:<span>{tr(language,'Приём занимает один ход.','An ability takes one turn.')}</span>}</div>
        </>}
        {notice&&<div className="od-notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label={tr(language,'Закрыть сообщение','Dismiss message')}>×</button></div>}
        {mode==='online'&&transport.status!=='connected'&&<div className="od-connection" role="status"><span/>{transport.status==='replaced'?tr(language,'Управление в другой вкладке','Active in another tab'):tr(language,'Соединяемся с комнатой…','Connecting to the room…')}<button onClick={()=>{if(room)connectRoom(room,invite)}}>{tr(language,'Подключиться','Reconnect')}</button></div>}
        {mode==='online'&&room?.drawOffer&&room.drawOffer.from!==room.you&&<div className="od-draw-offer"><p>{tr(language,'Соперник предлагает ничью.','Your opponent offers a draw.')}</p><button onClick={()=>sendOnline({type:'answerDraw',offerId:room.drawOffer!.id,accept:true})}>{tr(language,'Принять','Accept')}</button><button onClick={()=>sendOnline({type:'answerDraw',offerId:room.drawOffer!.id,accept:false})}>{tr(language,'Играть дальше','Play on')}</button></div>}
        <div className="od-match-actions">{mode!=='tutorial'&&!state.outcome&&<><button disabled={locked||record.actions.length===0||mode==='online'} onClick={undo}>{tr(language,'Назад','Undo')}</button>{claim&&<button disabled={!inputAllowed} onClick={()=>perform(claim)}>{tr(language,'Заявить ничью','Claim draw')}</button>}{mode==='online'&&room?.status==='playing'&&<button disabled={!!room.drawOffer||transport.pending} onClick={()=>sendOnline({type:'offerDraw'})}>{tr(language,'Ничья','Offer draw')}</button>}<button onClick={()=>setConfirmResign(true)}>{tr(language,'Сдаться','Resign')}</button></>}<button onClick={()=>setPanel('setup')}>{tr(language,'Новая партия','New game')}</button></div>
      </aside>
    </section>
    <footer className="od-footer"><span>{tr(language,'Атака создаёт энергию. Энергия создаёт ходы.','Attack creates energy. Energy creates moves.')}</span><button onClick={()=>setSettings({...settings,lang:language==='ru'?'en':'ru'})}>{language==='ru'?'English':'Русский'}</button></footer>

    {choices.length>0&&<div className="od-overlay"><section className="od-dialog od-command-dialog" role="dialog" aria-modal="true" aria-labelledby="od-choice-title"><button className="od-close" onClick={()=>setChoices([])} aria-label={tr(language,'Отменить выбор','Cancel choice')}>×</button><h2 id="od-choice-title">{choices.some(a=>a.promotion)?tr(language,'Выберите превращение','Choose a promotion'):tr(language,'Уточните приём','Choose the action')}</h2><p>{tr(language,'Все перемещения выполнятся одним ходом.','All movements resolve as one turn.')}</p><div className="od-action-choices">{choices.map((action,i)=><button key={i} onClick={()=>{setChoices([]);perform(action)}}>{action.promotion&&<PieceIcon type={action.promotion} side={state.side}/>}<span>{commandLabel(action,state,language)}</span></button>)}</div></section></div>}
    {confirmResign&&<div className="od-overlay"><section className="od-dialog" role="dialog" aria-modal="true" aria-labelledby="od-resign-title"><h2 id="od-resign-title">{tr(language,'Завершить партию сдачей?','Resign this game?')}</h2><p>{tr(language,'Победа достанется сопернику.','Your opponent will win.')}</p><div className="od-dialog-actions"><button className="od-secondary" onClick={()=>setConfirmResign(false)}>{tr(language,'Продолжить','Keep playing')}</button><button className="od-primary" onClick={()=>{setConfirmResign(false);if(mode==='online')sendOnline({type:'resign'});else {const old=stateRef.current;const own=mode==='bot'?record.humanSide:old.side;const next=resign(old,own);resetMotion();setLocalState(next.state);setRecord({...record,resignedBy:own});animate(old,next.state,next.events)}}}>{tr(language,'Сдаться','Resign')}</button></div></section></div>}
    {panel&&<div className="od-overlay"><section className={`od-dialog od-panel-${panel}`} role="dialog" aria-modal="true" aria-labelledby="od-panel-title"><button className="od-close" onClick={()=>setPanel(null)} aria-label={tr(language,'Закрыть','Close')}>×</button>
      {panel==='setup'&&<><div className="od-dialog-brand">OVERDRIVE</div><h1 id="od-panel-title">{tr(language,'Заряди следующую комбинацию','Charge your next combination')}</h1><p className="od-dialog-lead">{tr(language,'Знакомые фигуры. Шесть новых приёмов. Энергия, которую приносит атака.','Familiar pieces. Six new abilities. Energy earned through attack.')}</p><div className="od-setup-tabs"><button aria-pressed={setupMode==='bot'} onClick={()=>setSetupMode('bot')}>{tr(language,'С движком','With the engine')}</button><button aria-pressed={setupMode==='local'} onClick={()=>setSetupMode('local')}>{tr(language,'За одной доской','At one board')}</button></div>{setupMode==='bot'&&<><label className="od-level-label">{tr(language,'Сложность','Difficulty')}<strong>{setupLevel}<span>/10</span></strong><input type="range" min="1" max="10" value={setupLevel} onChange={e=>setSetupLevel(Number(e.target.value))}/></label><div className="od-level-caption"><span>≈{PRESETS[setupLevel-1].anchor} {tr(language,'Elo Форсажа','Overdrive Elo')}</span><small>{tr(language,'Предварительная внутренняя шкала','Provisional internal scale')}</small></div><div className="od-side-choice"><span>{tr(language,'Ваша сторона','Your side')}</span><button aria-pressed={setupSide==='white'} onClick={()=>setSetupSide('white')}><i className="white"/>{tr(language,'Белые','White')}</button><button aria-pressed={setupSide==='black'} onClick={()=>setSetupSide('black')}><i className="black"/>{tr(language,'Синие','Blue')}</button></div></>}<button className="od-primary od-start" onClick={()=>start(newRecord(setupMode,setupLevel,setupSide))}>{tr(language,'Начать партию','Start game')}<svg viewBox="0 0 24 24"><path d="m8 5 10 7-10 7z"/></svg></button><div className="od-setup-links"><button onClick={tutorialStart}><svg viewBox="0 0 24 24"><path d="M3 4h7l2 2 2-2h7v16h-7l-2-2-2 2H3zm9 2v12"/></svg><span>{tr(language,'Освоить приёмы','Learn the abilities')}<small>{tr(language,'9 коротких упражнений','9 short exercises')}</small></span></button><button onClick={()=>setPanel('online')}><svg viewBox="0 0 24 24"><path d="M7 8a4 4 0 1 0 0-.1M3 21v-3a4 4 0 0 1 8 0v3m6-13a3 3 0 1 0 0-.1m-3 13v-3a4 4 0 0 1 7 0v3"/></svg><span>{tr(language,'Играть по сети','Play online')}<small>{tr(language,'Пригласите друга ссылкой','Invite a friend with a link')}</small></span></button></div>{(record.actions.length>0||mode==='online')&&<button className="od-resume" onClick={()=>setPanel(null)}>{tr(language,'Вернуться к текущей партии','Return to the current game')}</button>}</>}
      {panel==='rules'&&<><h1 id="od-panel-title">{tr(language,'Учебник приёмов','Move book')}</h1><p className="od-dialog-lead">{tr(language,'Мат остаётся целью. Энергию приносит атака.','Checkmate is still the goal. Attack earns energy.')}</p><div className="od-rules-energy"><div><b>{bank===5?'+1':'+1–4'}</b><span>{tr(language,'за взятие','for a capture')}</span></div><div><b>+2</b><span>{tr(language,'за новый шах','for a new check')}</span></div><div><b>{bank}</b><span>{tr(language,'один приём','one ability')}</span></div><div><b>{bank*2}</b><span>{tr(language,'форма на 3 хода','form for 3 turns')}</span></div></div><div className="od-rules-scroll">{(['pawn','knight','bishop','rook','queen','king']as const).map(type=><article className="od-rule" key={type}><PieceIcon type={type} size={54}/><div><h2>{abilityName(ABILITIES[type],language)} <span>{pieceName(type,language)}</span></h2><p>{abilityDescription(ABILITIES[type],language)}</p></div></article>)}<details><summary>{tr(language,'Шах, сроки и особые случаи','Check, duration and special cases')}</summary><p>{bank===5?tr(language,'Две банки по пять. Любое взятие +1, новый шах +2.','Two banks of five. Any capture +1, a new check +2.'):tr(language,'Две банки по три. Пешка +1, конь и слон +2, ладья +3, ферзь +4; новый шах +2. Повтор шаха за ту же расстановку энергию не приносит.','Two banks of three. Pawn +1, knight and bishop +2, rook +3, queen +4; a new check +2. Repeating the same checking position gives no extra energy.')}</p><p>{tr(language,'При полной банке или действующей форме конь угрожает королю на пролёте, слон — за одним заслоном. Эти угрозы учитываются сразу, включая рокировку и мат.','With a full bank or an active form, the knight threatens the king along a raid and the bishop behind one screen. These threats immediately count for castling and mate.')}</p><p>{tr(language,'Форсаж расходует две банки и включает текущий ход в срок из трёх своих ходов. В этот ход действует усиленная фигура. На следующих можно ходить другими, но срок всё равно уменьшается. Форма следует за фигурой при превращении и исчезает, если её взяли.','Overdrive costs two banks and includes the current turn in its three-turn duration. The activated piece must act now. Moving another piece later still uses a turn of the form. The form survives promotion and ends if the piece is captured.')}</p><p>{tr(language,'Свою пешку на последней горизонтали можно превратить в любую из четырёх фигур. Принудительно перемещённая чужая пешка превращается в ферзя. Сдвиг снимает прежнее право двойного хода и рокировки; на проходе создаётся только обычным двойным шагом.','Choose any of the four promotions for your pawn on its last rank. A forced enemy promotion always becomes a queen. Displacement removes original double-step and castling rights. Only a normal double pawn step creates en passant.')}</p><p>{tr(language,'Королей нельзя брать или толкать. Составной приём проверяется целиком. Третье повторение или 50 ходов без сброса позволяют заявить ничью; пятое повторение и 75 ходов завершают партию автоматически. Мат имеет приоритет.','Kings cannot be captured or pushed. A compound ability is checked as one complete action. Claim a draw after three repetitions or 50 moves without a reset; five repetitions or 75 moves draw automatically. Mate takes priority.')}</p></details></div><button className="od-primary" onClick={tutorialStart}>{tr(language,'Попробовать на доске','Try on the board')}</button></>}
      {panel==='settings'&&<><h1 id="od-panel-title">{tr(language,'Настройки','Settings')}</h1><label className="od-setting-row"><span>{tr(language,'Язык','Language')}</span><select value={language} onChange={e=>setSettings({...settings,lang:e.target.value as Language})}><option value="ru">Русский</option><option value="en">English</option></select></label><label className="od-setting-row"><span>{tr(language,'Объёмная доска','3D board')}</span><input type="checkbox" checked={settings.view==='3d'} onChange={e=>setSettings({...settings,view:e.target.checked?'3d':'2d'})}/></label><label className="od-setting-row"><span>{tr(language,'Звук','Sound')}</span><input type="checkbox" checked={!settings.mute} onChange={e=>setSettings({...settings,mute:!e.target.checked})}/></label><label className="od-setting-row"><span>{tr(language,'Громкость','Volume')}</span><input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={e=>setSettings({...settings,volume:Number(e.target.value)})}/></label><label className="od-setting-row"><span>{tr(language,'Спокойные анимации','Reduced motion')}</span><input type="checkbox" checked={reduced} onChange={e=>setSettings({...settings,reduced:e.target.checked})}/></label><p className="od-settings-note">{tr(language,'Настройки Форсажа независимы от REMORSE.','Overdrive settings are independent of REMORSE.')}</p><button className="od-primary" onClick={()=>setPanel(null)}>{tr(language,'Вернуться к доске','Return to the board')}</button></>}
      {panel==='history'&&<><h1 id="od-panel-title">{tr(language,'История партии','Game history')}</h1><ol className="od-history">{replay.length?replay.map((a,i)=><li key={i}><span>{i+1}</span><i className={a.side}/><p>{a.label}</p></li>):<li>{tr(language,'Первый ход ещё впереди.','The first move is still ahead.')}</li>}</ol><button className="od-primary" onClick={()=>setPanel(null)}>{tr(language,'Вернуться к доске','Return to the board')}</button></>}
      {panel==='online'&&<><h1 id="od-panel-title">{tr(language,'Встретимся за доской','Meet at the board')}</h1><p className="od-dialog-lead">{tr(language,'Создайте комнату и отправьте другу приглашение.','Create a room and send your friend the invitation.')}</p><label className="od-field">{tr(language,'Ваше имя','Your name')}<input maxLength={24} autoComplete="nickname" value={name} onChange={e=>setName(e.target.value)} placeholder={tr(language,'Как вас зовут?','What’s your name?')}/></label><div className="od-side-choice"><span>{tr(language,'Ваша сторона','Your side')}</span><button aria-pressed={setupSide==='white'} onClick={()=>setSetupSide('white')}>{tr(language,'Белые','White')}</button><button aria-pressed={setupSide==='black'} onClick={()=>setSetupSide('black')}>{tr(language,'Синие','Blue')}</button></div><button className="od-primary" disabled={busy||!name.trim()} onClick={()=>void openOnline('create')}>{busy?tr(language,'Соединяемся…','Connecting…'):tr(language,'Создать комнату','Create room')}</button><div className="od-join-section"><label className="od-field">{tr(language,'Уже есть приглашение?','Already have an invitation?')}<input value={inviteInput} onChange={e=>setInviteInput(e.target.value)} placeholder={onlineLocation(location.hash)?.invite?tr(language,'Приглашение из открытой ссылки','Invitation from the opened link'):'https://…'}/></label><button className="od-secondary" disabled={busy||!name.trim()||(!inviteInput.trim()&&!onlineLocation(location.hash)?.invite)} onClick={()=>void openOnline('join')}>{tr(language,'Присоединиться','Join room')}</button></div>{(lastRoom()||onlineLocation(location.hash))&&<button className="od-resume" disabled={busy} onClick={()=>void openOnline('resume')}>{tr(language,'Вернуться в свою комнату','Return to your room')}</button>}{notice&&<div className="od-notice" role="status">{notice}</div>}</>}
    </section></div>}
  </main>
}

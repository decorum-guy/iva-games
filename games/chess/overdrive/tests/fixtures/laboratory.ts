// Served only by the separate loopback Vite configuration. Production has one entry.
import { finaleFixtures } from './finale'
import { OverdriveAudio, type OverdriveCueName } from '../../src/ui/audio'
import { saveLocalSession, saveOverdriveSettings } from '../../src/ui/session'

const sound = document.querySelector<HTMLInputElement>('#sound')!
const volume = document.querySelector<HTMLInputElement>('#volume')!
const audio = new OverdriveAudio()
const options = () => ({mute:!sound.checked,volume:Number(volume.value)})
let audition = 0
sound.checked = false
sound.onchange = () => {audition++;audio.setOptions(options());void audio.unlock()}
volume.oninput = () => audio.setOptions(options())
window.addEventListener('pagehide',()=>{audition++;audio.stop()})
const names:Record<string,string> = {corner:'Мат в углу',capture:'Мат взятием','white-edge':'Мат белым',crowded:'Опора на соседа',
  ability:'Батарея с матом',promotion:'Ферзь с матом','promotion-rook':'Ладья с шахом','promotion-bishop':'Превращение в слона',
  'promotion-knight':'Превращение в коня','forced-promotion':'Чужая пешка',check:'Шах',raid:'Налёт со взятием'}
function button(container:string,label:string,action:()=>void) {
  const button=document.createElement('button')
  button.textContent=label
  button.onclick=action
  document.querySelector(container)!.append(button)
}
for(const {id,before,command} of finaleFixtures) {
  const from=before.pieces.find(p=>p.id===command.pieceId)!.square
  const to=command.to??before.pieces.find(p=>p.id===command.targetId)!.square
  const hint = command.type==='ability'?' · Импульс':''
  button('#positions',names[id]+' · '+from+' → '+to+hint,()=>{
    if(!import.meta.env.DEV || location.hostname!=='127.0.0.1' || location.port!=='4198')throw new Error('Use the isolated local QA port 4198')
    saveLocalSession({version:1,root:before,actions:[],mode:'local',level:1,humanSide:'white',lessonIndex:0,lessonAck:false})
    saveOverdriveSettings({lang:'ru',view:'3d',reduced:false,...options()})
    location.assign('/')
  })
}
const samples:Record<string,OverdriveCueName>={'Ход':'move','Взятие':'capture','Превращение':'promotion','Шах':'check','Мат':'mate',
  'Доска':'board-contact','Сосед':'piece-contact','Энергия':'energy','Банка':'cellfull','Форма':'activate'}
for(const [label,cue] of Object.entries(samples))button('#cues',label,async()=>{
  const request=++audition
  audio.stop();audio.setOptions(options())
  if(!sound.checked){document.querySelector('#status')!.textContent='Включите звук для прослушивания.';return}
  await audio.unlock();if(request!==audition||!sound.checked)return
  audio.playCue(cue);document.querySelector('#status')!.textContent=label
})

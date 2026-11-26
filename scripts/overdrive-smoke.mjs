/** Exercise the built Node server and its production files, without a browser. */
import { spawn } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { WebSocket } from 'ws'

const port=Number(process.env.OVERDRIVE_SMOKE_PORT??5197)
if(!Number.isSafeInteger(port)||port<1024||port>65535||port===4173)throw new Error('Use an isolated test port, not 4173')
const origin=`http://127.0.0.1:${port}`
const directory=resolve('.qa/overdrive/production-'+randomUUID().slice(0,8))
await mkdir(directory,{recursive:true})
const env={...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'production',PUBLIC_ORIGIN:origin,
  DATABASE_PATH:directory+'/remorse.sqlite',OVERDRIVE_DATABASE_PATH:directory+'/overdrive.sqlite',STATIC_DIR:resolve('dist')}
let child=null
let output=''
const checks=[]
const sockets=[]
const assert=(condition,name)=>{if(!condition)throw new Error(name);checks.push(name)}
const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(2500)})
async function boot(){
  output=''
  child=spawn(process.execPath,['dist-server/main.js'],{env,stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',data=>{output+=String(data)});child.stderr.on('data',data=>{output+=String(data)})
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw new Error('Server exited: '+output)
    if(output.includes('REMORSE HTTP/WebSocket listening on 127.0.0.1:'+port)){
      if((await request(origin+'/api/overdrive/health')).ok&&child.exitCode===null)return
    }
    await pause(75)
  }
  throw new Error('Production server startup timeout: '+output)
}
async function stop(){
  if(!child||child.exitCode!==null)return
  const processToClose=child
  const done=new Promise(resolveExit=>processToClose.once('exit',resolveExit))
  processToClose.kill('SIGTERM');await Promise.race([done,pause(4000,undefined,{ref:false})])
  if(processToClose.exitCode===null){processToClose.kill('SIGKILL');await done}
}
async function api(path,cookie,body){
  const response=await request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const json=await response.json()
  if(!response.ok)throw new Error(`${path}: ${response.status} ${JSON.stringify(json)}`)
  const setCookie=response.headers.get('set-cookie')
  return {json,cookie:setCookie?.split(';')[0],setCookie}
}
async function connect(cookie,roomId){
  const ws=new WebSocket(origin.replace('http:','ws:')+'/overdrive-online',{handshakeTimeout:3000,headers:{Origin:origin,Cookie:cookie}})
  const state={ws,snapshot:null,acks:new Map(),errors:[]}
  sockets.push(ws)
  ws.on('message',data=>{const m=JSON.parse(String(data));if(m.snapshot)state.snapshot=m.snapshot;if(m.type==='ack')state.acks.set(m.commandId,m);if(m.type==='error')state.errors.push(m)})
  await new Promise((resolveOpen,reject)=>{ws.once('open',resolveOpen);ws.once('error',reject)})
  ws.send(JSON.stringify({type:'hello',protocol:'overdrive-online-v2',roomId}))
  await until(()=>state.snapshot!==null)
  return state
}
async function until(predicate){for(let i=0;i<150;i++){if(predicate())return;await pause(20)}throw new Error('Expected network state did not arrive')}
async function send(player,command){
  const id=randomUUID(),game=player.snapshot.game
  player.ws.send(JSON.stringify({type:'command',commandId:id,gameId:game.id,expectedRevision:game.revision,command}))
  await until(()=>player.acks.has(id)||player.errors.length>0)
  if(player.errors.length)throw new Error('Unexpected command rejection '+JSON.stringify(player.errors))
  return id
}
try{
  await boot()
  const rem=await request(origin+'/');const remHtml=await rem.text()
  assert(rem.ok&&remHtml.includes('<title>REMORSE</title>'),'REMORSE production entry preserved')
  const response=await request(origin+'/overdrive/');const html=await response.text()
  assert(response.ok&&html.includes('OVERDRIVE'),'OVERDRIVE production entry served')
  const source=html.match(/<script[^>]+src="([^"]+)"/)?.[1]
  if(!source)throw new Error('Missing Overdrive production module')
  const sourceUrl=new URL(source,origin+'/overdrive/')
  const moduleResponse=await request(sourceUrl);const moduleBytes=Buffer.from(await moduleResponse.arrayBuffer())
  assert(moduleResponse.ok&&moduleResponse.headers.get('content-type')?.includes('javascript'),'Hashed production module served as JavaScript')
  assert((await request(origin+'/assets/does-not-exist.glb')).status===404,'Missing asset returns 404 rather than HTML')
  const modelManifest=JSON.parse(await readFile('games/chess/overdrive/public/assets/overdrive/models/manifest.json','utf8'))
  for(const [type,model] of Object.entries(modelManifest.models)){
    const r=await request(origin+'/assets/overdrive/models/'+model.file);const bytes=Buffer.from(await r.arrayBuffer())
    assert(r.ok&&bytes.subarray(0,4).toString()==='glTF'&&createHash('sha256').update(bytes).digest('hex')===model.sha256,`Production GLB matches manifest: ${type}`)
  }
  const audioManifest=JSON.parse(await readFile('games/chess/overdrive/public/assets/overdrive/audio/manifest.json','utf8'))
  const audioEntries=audioManifest.cues??audioManifest.files
  if(!audioEntries)throw new Error('Unknown audio manifest schema')
  for(const [name,entry]of Object.entries(audioEntries)){
    const r=await request(origin+'/assets/overdrive/audio/'+(entry.file??name+'.wav'));const bytes=Buffer.from(await r.arrayBuffer())
    assert(r.ok&&bytes.subarray(0,4).toString()==='RIFF'&&createHash('sha256').update(bytes).digest('hex')===entry.sha256,`Production WAV matches manifest: ${name}`)
  }
  for(const file of ['RussoOne-Regular.ttf','GolosText.ttf']){
    const r=await request(origin+'/assets/overdrive/fonts/'+file);const bytes=Buffer.from(await r.arrayBuffer())
    const expected=await readFile('games/chess/overdrive/public/assets/overdrive/fonts/'+file)
    assert(r.ok&&r.headers.get('content-type')==='font/ttf'&&bytes.equals(expected),`Production font served intact with correct MIME: ${file}`)
  }
  const whiteGuest=await api('/api/overdrive/guest',null,{}),blackGuest=await api('/api/overdrive/guest',null,{})
  const whiteCookie=whiteGuest.cookie,blackCookie=blackGuest.cookie
  assert(whiteCookie&&blackCookie&&whiteCookie!==blackCookie&&[whiteGuest,blackGuest].every(g=>g.setCookie.includes('HttpOnly')&&g.setCookie.includes('SameSite=Strict')),'Two independent HttpOnly guest sessions with SameSite=Strict')
  const created=(await api('/api/overdrive/rooms',whiteCookie,{name:'Smoke White',side:'white',requestId:randomUUID()})).json
  const roomId=created.snapshot.id
  await api(`/api/overdrive/rooms/${roomId}/join`,blackCookie,{invite:created.invite,name:'Smoke Blue'})
  const white=await connect(whiteCookie,roomId),black=await connect(blackCookie,roomId)
  await send(white,{type:'ready',ready:true});await send(black,{type:'ready',ready:true})
  await until(()=>white.snapshot.status==='playing'&&black.snapshot.status==='playing')
  const move=async(player,from,to)=>{const piece=player.snapshot.game.state.pieces.find(p=>p.square===from);if(!piece)throw new Error('Missing mover '+from);await send(player,{type:'move',mode:'normal',pieceId:piece.id,to});await until(()=>white.snapshot.game.revision===black.snapshot.game.revision)}
  await move(white,'e2','e4');await move(black,'d7','d5');await move(white,'e4','d5')
  assert(white.snapshot.game.state.energy.white===1&&white.snapshot.game.state.pieces.length===31,'Production rules award capture energy once')
  assert(JSON.stringify(white.snapshot.game)===JSON.stringify(black.snapshot.game),'Independent socket game snapshots agree')
  await send(black,{type:'offerDraw'});await until(()=>white.snapshot.drawOffer!==null)
  await send(white,{type:'answerDraw',offerId:white.snapshot.drawOffer.id,accept:true})
  await until(()=>black.snapshot.status==='finished')
  assert(white.snapshot.game.state.outcome?.reason==='agreement','Draw offer accepted by the other seat')
  const oldGameId=white.snapshot.game.id
  await send(white,{type:'rematch',accept:true});await send(black,{type:'rematch',accept:true})
  await until(()=>white.snapshot.game.id!==oldGameId&&black.snapshot.game.id===white.snapshot.game.id)
  assert(white.snapshot.you==='black'&&black.snapshot.you==='white'&&white.snapshot.game.state.pieces.length===32,'Rematch creates a new game and swaps seats')
  const persisted=white.snapshot.game
  for(const ws of sockets)ws.close()
  await stop();await boot()
  const restored=(await api(`/api/overdrive/rooms/${roomId}`,whiteCookie)).json.snapshot
  assert(restored.you==='black'&&JSON.stringify(restored.game)===JSON.stringify(persisted),'Built server restart restores the exact game and original session seat')
  const report={browser:false,checks:checks.length,passed:checks,clientModule:sourceUrl.pathname,clientSha256:createHash('sha256').update(moduleBytes).digest('hex'),sourceRevision:'working tree; see final Git tree in VALIDATION.md'}
  await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({...report,report:directory+'/report.json'},null,2))
}finally{for(const ws of sockets)ws.terminate();await stop()}

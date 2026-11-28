/** Isolated real HTTP/SQLite quotes. Prepared four-seat position; no external messages. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {chromium,expect} from '@playwright/test';
import {createFeedbackHarness} from './district-feedback-fixtures.mjs';

const h=await createFeedbackHarness({scenarioIds:['patrol']});
const artifacts=join(process.cwd(),'.qa','district-compact-trade');
await mkdir(artifacts,{recursive:true});
const [a,b]=h.clients, results=[];
let browser;
const stock=values=>({wood:0,brick:0,grain:0,wool:0,ore:0,...values});
const current=async client=>(await client.request(`/rooms/${room.roomId}/match`)).view;
async function post(client,payload) {
  for(let i=0;i<3;i++) {
    const v=await current(client);
    try {return (await client.request(`/rooms/${room.roomId}/actions`,{actionId:randomUUID(),expectedRevision:v.revision,payload:{phaseId:v.phaseId,...payload}})).view;}
    catch(error) {if(i===2 || !/STALE_REVISION/.test(error.message)) throw error;}
  }
}
let room;
try {
  room=(await a.request('/rooms',{gameId:'district',capacity:4,title:'TEST compact quotes',settings:{mapId:'two-shores',mapVersion:'2',newsPreset:'medium'}})).room;
  const path='/rooms/'+room.roomId;
  for(let i=0;i<2;i++) room=(await a.request(path+'/bots',{difficulty:'normal',expectedRevision:room.revision})).room;
  const invitation=(await a.request(path+'/invitations',{playerId:b.user.playerId})).invitation;
  await b.request('/invitations/'+invitation.invitationId+'/accept',{});
  room=(await b.request(path+'/join',{})).room;
  for(const c of [a,b]) await c.request(path+'/ready',{ready:true,expectedRevision:room.revision});
  room=(await a.request(path+'/start',{expectedRevision:room.revision})).room;
  await h.stop();
  const database=join(h.directory,'runtime.sqlite');
  let db=new Database(database);
  const baseline=JSON.parse(db.prepare('SELECT state_json FROM district_territorial_matches WHERE match_id=?').pluck().get(room.matchId));
  db.close();
  const owner=baseline.participants.find(p=>p.controller.playerId===a.user.playerId).participantId;
  const other=baseline.participants.find(p=>p.controller.playerId===b.user.playerId).participantId;
  const bots=baseline.participants.filter(p=>p.controller.kind==='bot');
  async function reset(noneAgree=false) {
    await h.stop();
    const s=structuredClone(baseline);
    s.phase='play';s.turn=1;s.round=1;s.activeIndex=0;s.deadlineAt=Date.now()+150_000;
    s.offers=[];s.offerHistory=[];s.history=[];s.offerNumber=0;delete s.botSchedule;
    s.news.processedRound=1;s.news.nextRound=1000;
    for(const p of s.participants) s.players[p.participantId].hand=stock({});
    s.players[owner].hand=stock({wood:1,brick:1,ore:1});
    s.players[other].hand=stock({brick:1});if(!noneAgree) s.players[bots[0].participantId].hand=stock({brick:1});
    for(const key of Object.keys(s.bank)) s.bank[key]=24-Object.values(s.players).reduce((n,p)=>n+p.hand[key],0);
    // Stable wide gap between the two bot replies makes the delayed-POST regression deterministic.
    let seed=0;
    const draw=(offer,id)=>parseInt(createHash('sha256').update(JSON.stringify([String(seed),offer,id])).digest('hex').slice(0,8),16)%401;
    while(draw('offer-5',bots[0].participantId)>20 || draw('offer-6',bots[1].participantId)<380)seed++;
    db=new Database(database);db.prepare('UPDATE district_territorial_matches SET state_json=?,bot_seed=? WHERE match_id=?').run(JSON.stringify(s),String(seed),room.matchId);db.close();
    await h.start();
    return s;
  }
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const cases=['en','ru'].flatMap(lang=>[1280,390].map(width=>({lang,width,noneAgree:false}))); cases.push({lang:'en',width:1280,noneAgree:true},{lang:'en',width:1280,noneAgree:false,conflictCancel:true});
  for(const {lang,width,noneAgree,conflictCancel=false} of process.env.COMPACT_ACCESSIBILITY_ONLY==='1'?[]:cases) {
    const before=await reset(noneAgree);
    const context=await browser.newContext({storageState:h.manifest.accounts[0].storageState,viewport:{width,height:width===390?844:800},hasTouch:width===390});
    await context.addInitScript(language=>localStorage.setItem('iva.portal.language',language),lang);
    const page=await context.newPage();await page.goto(h.origin+path);
    await expect(page.locator('.territorial-board')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
    const geometry=()=>page.locator('.tb-surface').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scrollY};});
    const boardBefore=await geometry();
    const labels=lang==='ru'?{give:'Отдаю',receive:'Получаю',wood:'Древесина',ore:'Руда',brick:'Кирпич',send:'Отправить'}:{give:'I give',receive:'I receive',wood:'Wood',ore:'Ore',brick:'Brick',send:'Send offer'};
    await page.locator('.ta-trade-open').click();
    for(const [side,key] of [[labels.give,'wood'],[labels.give,'ore'],[labels.receive,'brick']]) await page.getByRole('button',{name:`${side} + ${labels[key]}`,exact:true}).click();
    const sentResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/actions'));
    await page.getByRole('button',{name:labels.send,exact:true}).click();
    const sent=(await (await sentResponse).json()).view;
    const group=sent.offers[0].groupId;
    const panel=page.locator(`[data-group-id="${group}"]`);
    await expect(panel.locator('.ta-response-list>article,.ta-response-list>.ta-closed-response')).toHaveCount(3);
    await expect(panel.getByRole('button',{name:new RegExp(lang==='ru'?'Обменяться':'Trade with')})).toHaveCount(noneAgree?0:1);
    await expect(panel.locator('.ta-closed-response')).toHaveCount(noneAgree?2:1);
    await expect(panel.getByRole('img',{name:lang==='ru'?'Ждём ответа':'Awaiting response',exact:true})).toBeVisible();
    const layout=await panel.evaluate(el=>{
      const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      return{panel:rect(el),cells:[...el.querySelectorAll('.ta-response-list>article,.ta-response-list>.ta-closed-response')].map(cell=>({box:rect(cell),avatar:rect(cell.querySelector('.ta-player-dot')),emoji:rect(cell.querySelector('button,span[role=img]'))})),terms:[...el.querySelectorAll('.ta-offer-terms>div')].map(rect),text:el.innerText};
    });
    assert.equal(layout.cells.length,3);assert.ok(layout.cells.every(c=>c.avatar.bottom<=c.emoji.y&&c.emoji.width>=44&&c.emoji.height>=44));
    assert.ok(layout.cells.every(c=>c.box.y===layout.cells[0].box.y),'Three recipients fit on one row');
    assert.ok(layout.terms.every(row=>row.width>=layout.panel.width*.6),'Terms use the full available column');
    assert.ok(!/awaiting|agreed|declined|You →|\d+\s?s\b/.test(layout.text));
    assert.deepEqual(await geometry(),boardBefore);
    await page.screenshot({path:join(artifacts,`compact-${lang}-${width}${noneAgree?'-all-expire':conflictCancel?'-conflict-cancel':''}.png`)});
    const humanOffer=sent.offers.find(o=>o.targetId===other);
    const positions=layout.cells.map(c=>c.box);
    await expect.poll(async()=>{const v=await current(a);return v.offerHistory?.some(o=>o.id===humanOffer.id&&o.responseExpired);},{timeout:12_000}).toBe(true);
    await expect(panel.locator('.ta-closed-response')).toHaveCount(noneAgree?3:2);
    const afterPositions=await panel.locator('.ta-response-list>article,.ta-response-list>.ta-closed-response').evaluateAll(cells=>cells.map(cell=>{const r=cell.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};}));
    assert.deepEqual(afterPositions,positions,'Response expiry keeps every slot in place');
    assert.deepEqual((await current(a)).you.hand,before.players[owner].hand);
    if(!noneAgree) {
    await panel.getByRole('button',{name:lang==='ru'?'Отменить предложение всем':'Withdraw offer for everyone',exact:true}).click();
    await expect(panel).toHaveCount(0);assert.deepEqual(await geometry(),boardBefore);
    assert.deepEqual((await current(a)).you.hand,before.players[owner].hand);
    if(lang==='en' && width===1280) {
      await page.locator('.ta-trade-open').click();
      const reply=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/actions'));
      await page.getByRole('button',{name:'Send offer',exact:true}).click();
      const next=(await (await reply).json()).view;
      const quote=next.offers.find(o=>o.targetId===other);
      let frozen, releaseView;
      const viewReady=new Promise(resolve=>{releaseView=resolve;});
      const matchRoute=async route=>{await viewReady;await route.fulfill({json:{view:frozen}});};
      await page.route('**/match',matchRoute);
      await post(b,{type:'accept',offerId:quote.id});
      await expect.poll(async()=>{frozen=await current(a);return frozen.offers.filter(o=>o.groupId===quote.groupId&&o.agreedAt!==undefined).length;},{intervals:[10],timeout:5000}).toBe(2);
      assert.ok(frozen.offers.some(o=>o.groupId===quote.groupId&&o.targetId===bots[1].participantId&&o.agreedAt===undefined),'Third bot is still deciding at the rendered snapshot');
      releaseView();

      const nextPanel=page.locator(`[data-group-id="${quote.groupId}"]`);
      await expect(nextPanel.getByRole('button',{name:/^Trade with/})).toHaveCount(2);
      const attempts=[];
      let delayed=false;
      const actionType=conflictCancel?'cancel':'accept';
      const delayDecision=async route=>{
        const command=route.request().postDataJSON();
        if(command.payload.type===actionType&&!delayed) {
          delayed=true;
          await expect.poll(async()=>{const v=await current(a);return v.offerHistory?.some(o=>o.groupId===quote.groupId&&o.targetId===bots[1].participantId);},{intervals:[20],timeout:5000}).toBe(true);
          await page.unroute('**/match',matchRoute);
        }
        if(command.payload.type===actionType&&delayed) {
          assert.deepEqual((await current(a)).you.hand,before.players[owner].hand,'No resources move before a successful author decision');
          assert.deepEqual((await current(b)).you.hand,before.players[other].hand);
        }
        await route.continue();
      };
      await page.route('**/actions',delayDecision);
      page.on('response',async response=>{
        if(response.request().method()==='POST'&&response.url().endsWith('/actions')&&response.request().postDataJSON().payload.type===actionType) {
          const data=await response.json();
          attempts.push({command:response.request().postDataJSON(),status:response.status(),data});
        }
      });
      const button=conflictCancel?nextPanel.getByRole('button',{name:'Withdraw offer for everyone',exact:true}):nextPanel.getByRole('button',{name:'Trade with '+baseline.participants.find(p=>p.participantId===other).displayName,exact:true});
      await button.click(); // Exactly one player click; the UI owns the safe stale retry.
      await expect(nextPanel).toHaveCount(0);
      await expect.poll(()=>attempts.length).toBe(2);
      assert.equal(attempts[0].status,409);assert.equal(attempts[0].data.error.code,'STALE_REVISION');
      assert.equal(attempts[1].status,200);
      assert.equal(attempts[0].command.actionId,attempts[1].command.actionId,'Explicitly rejected attempt preserves action identity');
      if(!conflictCancel) assert.deepEqual(attempts[0].command.payload,attempts[1].command.payload);
      else assert.ok(frozen.offers.some(o=>o.id===attempts[1].command.payload.offerId&&o.groupId===quote.groupId),'Cancellation stays within its original group');
      assert.ok(attempts[1].command.expectedRevision>attempts[0].command.expectedRevision);
      assert.deepEqual((await current(a)).you.hand,conflictCancel?before.players[owner].hand:stock({brick:2}));
      assert.deepEqual((await current(b)).you.hand,conflictCancel?before.players[other].hand:stock({wood:1,ore:1}));
      // Replay a committed command through the authoritative idempotency receipt.
      const replay=(await a.request(`/rooms/${room.roomId}/actions`,attempts[1].command)).view;
      assert.deepEqual(replay.you.hand,attempts[1].data.view.you.hand);
      assert.deepEqual((await current(a)).you.hand,replay.you.hand);
      await page.unroute('**/actions',delayDecision);

    }
    } else {
      const rect=await panel.boundingBox();
      assert.equal(rect.height,layout.panel.height,'A fully expired group retains its dimensions');
      assert.deepEqual(await geometry(),boardBefore);
    }
    results.push({lang,width,noneAgree,layout,board:boardBefore,expiryStable:true,cancelNoPayment:true,twoConsentsSelected:lang==='en'&&width===1280&&!noneAgree&&!conflictCancel,conflictCancel});
    await context.close();
  }
  const accessibleBefore=await reset();
  const touch=await browser.newContext({storageState:h.manifest.accounts[1].storageState,viewport:{width:390,height:844},hasTouch:true});
  await touch.addInitScript(()=>localStorage.setItem('iva.portal.language','en'));
  const recipient=await touch.newPage();await recipient.goto(h.origin+path);
  const offered=await post(a,{type:'offer',targetId:other,give:stock({wood:1}),receive:stock({brick:5})});
  const incoming=recipient.locator(`[data-offer-id="${offered.offers.find(o=>o.targetId===other).id}"]`);
  const accept=incoming.getByRole('button',{name:'Accept',exact:true});
  await expect(accept).toBeDisabled();
  await expect(accept).toHaveAccessibleDescription('Missing: 4 Brick');
  await expect(incoming).not.toContainText('Missing');
  let submitted=0;
  recipient.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/actions')) submitted++;});
  const hit=await accept.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const target=document.elementFromPoint(x,y);return{x,y,visible:target===el||el.contains(target)};});
  assert.ok(hit.visible);await recipient.touchscreen.tap(hit.x,hit.y);await recipient.waitForTimeout(150);
  assert.equal(submitted,0,'Native touch on unfunded consent submits no command');
  assert.deepEqual((await current(b)).you.hand,accessibleBefore.players[other].hand);
  await touch.close();
  await writeFile(join(artifacts,process.env.COMPACT_ACCESSIBILITY_ONLY==='1'?'result-accessibility.json':'result.json'),JSON.stringify({gitHead:h.manifest.gitHead,sourceHasWorkingChanges:!!h.manifest.gitStatus,build:h.manifest.buildHashes,syntheticPosition:true,realHttp:true,externalMessages:0,accessibleOwnShortage:true,nativeDisabledNoSubmit:true,results},null,2));
  console.log(JSON.stringify({passed:true,artifacts,variants:results.length}));
} finally {if(browser) await browser.close();await h.dispose();}

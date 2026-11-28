/** Isolated real HTTP/SQLite quotes. Prepared four-seat position; no external messages. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
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
    db=new Database(database);db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(JSON.stringify(s),room.matchId);db.close();
    await h.start();
    return s;
  }
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const cases=['en','ru'].flatMap(lang=>[1280,390].map(width=>({lang,width,noneAgree:false}))); cases.push({lang:'en',width:1280,noneAgree:true});
  for(const {lang,width,noneAgree} of cases) {
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
    await page.screenshot({path:join(artifacts,`compact-${lang}-${width}${noneAgree?'-all-expire':''}.png`)});
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
      await post(b,{type:'accept',offerId:quote.id});
      const nextPanel=page.locator(`[data-group-id="${quote.groupId}"]`);
      await expect(nextPanel.getByRole('button',{name:/^Trade with/})).toHaveCount(2);
      await nextPanel.getByRole('button',{name:'Trade with '+baseline.participants.find(p=>p.participantId===other).displayName,exact:true}).click();
      await expect(nextPanel).toHaveCount(0);
      assert.deepEqual((await current(a)).you.hand,stock({brick:2}));
      assert.deepEqual((await current(b)).you.hand,stock({wood:1,ore:1}));
    }
    } else {
      const rect=await panel.boundingBox();
      assert.equal(rect.height,layout.panel.height,'A fully expired group retains its dimensions');
      assert.deepEqual(await geometry(),boardBefore);
    }
    results.push({lang,width,noneAgree,layout,board:boardBefore,expiryStable:true,cancelNoPayment:true,twoConsentsSelected:lang==='en'&&width===1280&&!noneAgree});
    await context.close();
  }
  await writeFile(join(artifacts,'result.json'),JSON.stringify({gitHead:h.manifest.gitHead,sourceHasWorkingChanges:!!h.manifest.gitStatus,build:h.manifest.buildHashes,syntheticPosition:true,realHttp:true,externalMessages:0,results},null,2));
  console.log(JSON.stringify({passed:true,artifacts,variants:results.length}));
} finally {if(browser) await browser.close();await h.dispose();}

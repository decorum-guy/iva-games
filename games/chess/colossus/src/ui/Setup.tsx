import { useState } from 'react';
import { BASE_DECK,BOSSES,HUNT_BOSSES,BOSS_CARD_LIST,CARD_LIST,DIFFICULTIES,STARTER_CARDS,validateDeck } from '../core';
import type { HuntBossId,CardId,CreateOptions,Difficulty,Language } from '../core';
import { copy } from './i18n';
import { Card } from './Card';
import { BossIcon } from './PieceIcon';
import { Modal } from './Modal';
import type { ResultRecord } from './records';
export interface SetupProps {
 lang:Language;initial:CreateOptions;records:ResultRecord[];tutorialDone:boolean;hasSave:boolean;hasPractice:boolean;onContinue:(practice:boolean)=>void;
 onStart:(options:CreateOptions,network:boolean)=>void;onTutorial:()=>void;onJoin:(link:string,name:string)=>void;busy:boolean;error:string;
}
export function Setup(p:SetupProps){
 const c=copy[p.lang];const [boss,setBoss]=useState<HuntBossId>(p.initial.boss??'regent');const [difficulty,setDifficulty]=useState<Difficulty>(p.initial.difficulty??'knight');
 const [mode,setMode]=useState<'hunt'|'campaign'|'practice'|'coop'>(p.initial.coop?'coop':p.initial.mode??'hunt');const [network,setNetwork]=useState(false);
 const [deck,setDeck]=useState<CardId[]>(p.initial.deck??BASE_DECK);const [cards,setCards]=useState(p.initial.bossCards??true);
 const [deckOpen,setDeckOpen]=useState(false);const [joinOpen,setJoinOpen]=useState(false);const [link,setLink]=useState('');const [name,setName]=useState('');
 const [coopCampaign,setCoopCampaign]=useState(false);const [bestiary,setBestiary]=useState<HuntBossId|null>(null);
 const option:CreateOptions={boss:mode==='campaign'||coopCampaign&&mode==='coop'?'regent':boss,difficulty,mode:mode==='coop'?(coopCampaign?'campaign':'hunt'):mode,coop:mode==='coop',deck,bossCards:cards};
 const valid=validateDeck(deck).length===0;
 const chosen=BOSSES[option.boss??boss];
 const bossWins=(id:HuntBossId)=>new Set(p.records.filter(r=>r.winner==='army'&&!r.assisted&&r.mode!=='practice'&&(r.boss===id||r.mode==='campaign')).map(r=>r.difficulty));
 return <section className="setup-screen">
 <div className="setup-world"><div className="reliquary-ring"/><BossIcon id={chosen.id} className="setup-monument"/>
 <h1>{c.title}</h1><p>{c.tagline}</p><div className="setup-boss-name"><h2>{chosen.name[p.lang]}</h2><p>{chosen.description[p.lang]}</p>
 <div className="boss-vitals"><span>⬡ {Math.ceil(chosen.armor*DIFFICULTIES[difficulty].numerator/DIFFICULTIES[difficulty].denominator)} {c.armour.toLowerCase()}</span><span>♥ {Math.ceil(chosen.hp*DIFFICULTIES[difficulty].numerator/DIFFICULTIES[difficulty].denominator)} HP</span></div><button type="button" className="bestiary-button" onClick={()=>setBestiary(chosen.id as HuntBossId)}>{c.bestiary}</button></div>
 <div className="boss-choices">{HUNT_BOSSES.map(id=>BOSSES[id]).map(b=><button type="button" key={b.id} className={chosen.id===b.id?'active':''} disabled={mode==='campaign'||mode==='coop'&&coopCampaign} onClick={()=>setBoss(b.id as HuntBossId)} aria-pressed={chosen.id===b.id}><BossIcon id={b.id}/><span>{b.name[p.lang]}</span></button>)}</div></div>
 <div className="setup-controls"><h2>{c.newHunt}</h2><p className="setup-premise">{p.lang==='ru'?'Восемь фигур. Три команды. Каждый удар босса известен заранее.':'Eight pieces. Three commands. Every boss strike is announced in advance.'}</p><div className="mode-tabs" role="group" aria-label={c.mode}>{(['hunt','campaign','coop','practice'] as const).map(m=><button type="button" key={m} className={mode===m?'active':''} onClick={()=>setMode(m)} aria-pressed={mode===m}>{c[m]}</button>)}</div>
 <label className="field-label">{c.difficulty}<select value={difficulty} onChange={e=>setDifficulty(e.target.value as Difficulty)}>{Object.entries(DIFFICULTIES).map(([id,d])=><option value={id} key={id}>{d.name[p.lang]}</option>)}</select></label>
 <div className="difficulty-explainer">{DIFFICULTIES[difficulty].commands} {c.commands.toLowerCase()} · {p.lang==='ru'?'3 боевых ответа и восстановление':'3 combat responses, then recovery'}</div>
 {mode==='coop'&&<div className="coop-choice"><div className="segmented"><button type="button" className={!network?'active':''} onClick={()=>setNetwork(false)}>{c.localCoop}</button><button type="button" className={network?'active':''} onClick={()=>setNetwork(true)}>{c.online}</button></div><label className="check-row"><input type="checkbox" checked={coopCampaign} onChange={e=>setCoopCampaign(e.target.checked)}/>{c.campaign}</label></div>}
 <label className="check-row"><input type="checkbox" checked={cards} onChange={e=>setCards(e.target.checked)}/><span><b>{c.bossCards}</b><small>{c.bossCardRule}</small></span></label>
 <button type="button" className="deck-button" onClick={()=>setDeckOpen(true)}><span className="deck-fan"><i className="common"/><i className="rare"/><i className="epic"/><i className="legendary"/></span><span><b>{c.deck}</b><small>{deck.length}/12 · {c.collection}</small></span></button>
 {!valid&&<p className="error-text">{c.deckError}</p>}{p.error&&<p className="error-text" role="alert">{p.error}</p>}
 <div className="start-actions"><button type="button" className="primary-button" disabled={!valid||p.busy} onClick={()=>p.onStart(option,mode==='coop'&&network)}>{p.busy?c.pending:mode==='coop'&&network?c.createRoom:c.play}</button>
 {(mode==='practice'?p.hasPractice:p.hasSave)&&<button type="button" className="secondary-button" disabled={p.busy} onClick={()=>p.onContinue(mode==='practice')}>{c.continue}</button>}</div>
 <button type="button" className="tutorial-invitation" onClick={p.onTutorial}><span className="training-emblem" aria-hidden="true">◇</span><span><b>{p.tutorialDone?c.learnAgain:c.learn}</b><small>{p.lang==='ru'?'Смотритель · короткий учебный бой':'The Warden · a short guided battle'}</small></span></button><div className="setup-links"><button type="button" onClick={()=>setJoinOpen(true)}>{c.joinRoom} · {c.online}</button></div>
 </div>
 {bestiary&&<Modal title={c.bestiary+' · '+BOSSES[bestiary].name[p.lang]} onClose={()=>setBestiary(null)} className="bestiary-modal"><div className="bestiary-intro"><BossIcon id={bestiary}/><div><p>{BOSSES[bestiary].description[p.lang]}</p><span>{DIFFICULTIES[difficulty].name[p.lang]} · {BOSSES[bestiary].width} × {BOSSES[bestiary].height} · {Math.ceil(BOSSES[bestiary].armor*DIFFICULTIES[difficulty].numerator/DIFFICULTIES[difficulty].denominator)} {c.armour.toLowerCase()} · {Math.ceil(BOSSES[bestiary].hp*DIFFICULTIES[difficulty].numerator/DIFFICULTIES[difficulty].denominator)} HP</span></div></div><div className="bestiary-progress"><h3>{c.defeatedOn}</h3><div>{Object.entries(DIFFICULTIES).map(([id,d])=><span key={id} className={bossWins(bestiary).has(id as Difficulty)?'earned':''}><i aria-hidden="true">{bossWins(bestiary).has(id as Difficulty)?'✦':'◇'}</i>{d.name[p.lang]}<small>{bossWins(bestiary).has(id as Difficulty)?c.earned:c.notDefeated}</small></span>)}</div></div><p>{c.bossCardRule}</p><div className="boss-card-catalog">{BOSS_CARD_LIST.filter(card=>card.boss===bestiary).map(card=><Card key={card.id} card={card} lang={p.lang}/>)}</div><div className="bestiary-nav">{HUNT_BOSSES.map(id=>BOSSES[id]).map(b=><button type="button" className={b.id===bestiary?'active':''} key={b.id} onClick={()=>setBestiary(b.id as HuntBossId)}>{b.name[p.lang]}</button>)}</div></Modal>}
 {deckOpen&&<Modal title={c.deck} onClose={()=>setDeckOpen(false)} className="collection-modal"><p>{c.deckHint}</p><div className="collection-counter">{c.chosenDeck}: <b>{deck.length}/12</b></div><div className="card-collection">{CARD_LIST.map(card=><Card card={card} lang={p.lang} key={card.id} selected={deck.includes(card.id)} onClick={()=>{if(STARTER_CARDS.includes(card.id))return;setDeck(old=>old.includes(card.id)?old.filter(x=>x!==card.id):[...old,card.id]);}}>{STARTER_CARDS.includes(card.id)&&<span className="card-status">{c.mandatory}</span>}</Card>)}</div><button type="button" className="primary-button" onClick={()=>setDeckOpen(false)} disabled={!valid}>{c.apply}</button></Modal>}
 {joinOpen&&<Modal title={c.joinRoom} onClose={()=>setJoinOpen(false)}><label className="field-label">{c.name}<input value={name} onChange={e=>setName(e.target.value)} maxLength={32} autoComplete="nickname"/></label><label className="field-label">{c.pasteLink}<input value={link} onChange={e=>setLink(e.target.value)} autoComplete="off"/></label><button type="button" className="primary-button" disabled={!link.trim()||p.busy} onClick={()=>p.onJoin(link,name.trim()|| (p.lang==='ru'?'Командир':'Commander'))}>{c.joinRoom}</button>{p.error&&<p className="error-text">{p.error}</p>}</Modal>}
 </section>
}

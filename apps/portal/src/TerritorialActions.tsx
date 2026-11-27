import { useState } from 'react';
import { RESOURCES, emptyStock } from '@iva-games/district/territorial';
import type { CardKind, Resource, Stock, TerritoryAction, TerritoryOffer, TerritoryView } from '@iva-games/district/territorial';
import type { BoardSelection } from './TerritorialBoard';
import './territorial-actions.css';

type Lang = 'ru' | 'en';
type Props = {
  view: TerritoryView; lang: Lang; selection: BoardSelection | null; busy: boolean;
  onAction: (action: TerritoryAction) => void;
};
const names: Record<Resource, [string,string]> = {
  wood: ['Древесина','Wood'], brick: ['Кирпич','Brick'], grain: ['Зерно','Grain'], wool: ['Шерсть','Wool'], ore: ['Руда','Ore'],
};
const cardNames: Record<CardKind, [string,string]> = {
  patrol: ['Патруль','Patrol'], survey: ['Подряд','Survey'], supply: ['Снабжение','Supply'], charter: ['Грамота','Charter'],
};
const cardHelp: Record<CardKind, [string,string]> = {
  patrol: ['Перенесите блокаду и возьмите один ресурс у соседа клетки.', 'Move the blockade and take one resource from a neighbour of the tile.'],
  survey: ['Два следующих пути в этот ход бесплатны по обычной цене.', 'The regular cost of your next two routes this turn is covered.'],
  supply: ['Получите две выбранные единицы из банка.', 'Take two resources of your choice from the bank.'],
  charter: ['Грамота уже принесла вам одно скрытое очко.', 'This charter already counts as one hidden point.'],
};
const total = (s: Partial<Stock>) => RESOURCES.reduce((sum, r) => sum + (s[r] ?? 0), 0);
const missing = (hand: Stock, cost: Partial<Stock>) => Object.fromEntries(RESOURCES.map(r => [r,Math.max(0,(cost[r] ?? 0)-hand[r])])) as Stock;
const nameOf = (view: TerritoryView, id: string) => view.players.find(p=>p.participantId===id)?.displayName;
const word = (lang: Lang, ru: string, en: string) => lang === 'ru' ? ru : en;

export function ResourceStock({ stock, lang, showZero = false }: { stock: Partial<Stock>; lang: Lang; showZero?: boolean }) {
  const entries = RESOURCES.filter(r=>showZero || stock[r]);
  if (!entries.length) return <span className="ta-free">{word(lang,'Бесплатно','Free')}</span>;
  return <span className="ta-resources">{entries.map(r=><span key={r} data-resource={r}>
    <i aria-hidden="true"/>{names[r][lang==='ru'?0:1]} <b>{stock[r]??0}</b>
  </span>)}</span>;
}

function Cost({ cost, hand, lang }: { cost: Partial<Stock>; hand: Stock; lang: Lang }) {
  const short=missing(hand,cost);
  return <div className="ta-cost"><div>{word(lang,'Цена','Cost')} · <ResourceStock lang={lang} stock={cost}/></div>
    {total(short)>0&&<div className="ta-short">{word(lang,'Не хватает','Missing')} · <ResourceStock lang={lang} stock={short}/></div>}</div>;
}

function Amounts({value,onChange,lang,max,label}:{value:Stock;onChange:(next:Stock)=>void;lang:Lang;max?:Stock;label:string}){
  return <fieldset className="ta-amounts"><legend>{label}</legend>{RESOURCES.map(r=><label key={r}>
    <span>{names[r][lang==='ru'?0:1]}</span><input type="number" min={0} max={max?.[r]??100}
      inputMode="numeric" aria-label={label+' · '+names[r][lang==='ru'?0:1]} value={value[r]||''} placeholder="0"
      onChange={e=>onChange({...value,[r]:Math.max(0,Math.min(max?.[r]??100,Math.floor(Number(e.target.value)||0)))})}/>
  </label>)}</fieldset>;
}

function ResourceChoice({ value, set, label, lang }: {value:Resource;set:(r:Resource)=>void;label:string;lang:Lang}) {
  return <label className="ta-select">{label}<select aria-label={label} value={value} onChange={e=>set(e.target.value as Resource)}>
    {RESOURCES.map(r=><option key={r} value={r}>{names[r][lang==='ru'?0:1]}</option>)}</select></label>;
}

function SelectedAction({view, selection, busy, onAction, lang}:Props) {
  if(!selection) return null;
  const ru=lang==='ru', id=selection.id;
  const node=selection.kind==='node'?view.map.nodes.find(n=>n.id===id):undefined;
  const edge=selection.kind==='edge'?view.map.edges.find(e=>e.id===id):undefined;
  const tile=selection.kind==='tile'?view.map.tiles.find(t=>t.id===id):undefined;
  if(!node&&!edge&&!tile) return null;
  const options=view.legal.options.filter(o=>o.id===id&&(selection.kind==='edge'?o.kind==='route':selection.kind==='node'&&o.kind!=='route'));
  const building=node&&view.buildings[id], route=edge&&view.routes[id];
  const owner=building?.ownerId||route;
  const ownerName=owner?nameOf(view,owner):undefined;
  const sector=view.map.sectors.find(s=>s.id===(node??edge)?.eventSectorId);
  const port=node&&view.map.ports.find(p=>p.nodeId===id);
  const actionName=(kind:typeof options[number]['kind'])=>{
    if(kind==='route') return edge?.kind==='sea'?word(lang,'Проложить морской путь','Open sea lane'):word(lang,'Построить дорогу','Build road');
    if(kind==='upgrade')return word(lang,'Улучшить до уровня 2','Upgrade to level 2');
    return word(lang,'Построить дом','Build house');
  };
  const title=node?(building?(ru?'Дом':'Building')+' · '+building.level:word(lang,'Участок для дома','Building site')):
    edge?edge.kind==='sea'?word(lang,'Морской путь','Sea lane'):word(lang,'Дорога','Road'):
    tile?.resource?names[tile.resource][ru?0:1]:word(lang,'Местность','Terrain');
  let note='';
  if(tile) note=tile.id===view.blockedTileId?word(lang,'Производство заблокировано.','Production is blocked.'):
    tile.number?word(lang,'Производство при броске ','Produces on a roll of ')+tile.number+'.':'';
  else if(view.activeParticipantId===view.you.participantId&&!options.length){
    if(edge&&route)note=word(lang,'Путь уже построен.','This route is already built.');
    else if(building&&building.ownerId!==view.you.participantId)note=word(lang,'Дом принадлежит другому игроку.','Another player owns this building.');
    else if(building?.level===2)note=word(lang,'Достигнут высший уровень.','This building is fully upgraded.');
    else if(view.phase==='setup-route')note=word(lang,'Выберите свободную дорогу у только что поставленного дома.','Choose a free road beside the home you just placed.');
    else if(view.phase==='setup-home')note=word(lang,'Стартовому дому нужен свободный участок вдали от соседнего дома.','Choose an empty starting site with no neighbouring house.');
    else if(view.phase==='play'&&node&&!building)note=word(lang,'Нужен свободный участок у своего пути с интервалом в одно ребро от других домов и свободная фигура.','Use a free house piece at a site on your route, away from adjacent houses.');
    else if(view.phase==='play'&&edge)note=word(lang,'Продолжите свой путь или начните его у своего дома. Для стройки нужен свободный сегмент.','Use an available route piece to extend your network or start at your own house.');
  }
  return <section className="ta-selected" aria-label={word(lang,'Выбранное место','Selected location')}><h4>{title}{ownerName?' · '+ownerName:''}</h4>
    {sector&&<small>{sector.name[lang]}</small>}
    {port&&<p>{word(lang,'Порт','Port')} · {port.resource?names[port.resource][ru?0:1]:word(lang,'любые ресурсы','any resource')}</p>}
    {node&&node.exposureTags.length>0&&<small>{node.exposureTags.map(tag=>({coastal:['Побережье','Coast'],floodplain:['Пойма','Floodplain'],woodland:['Лесная зона','Woodland']}[tag][ru?0:1])).join(' · ')}</small>}
    {note&&<p>{note}</p>}
    {options.map(o=><div key={o.kind}><Cost cost={o.cost} hand={view.you.hand} lang={lang}/>
      <button type="button" className="ta-primary" disabled={busy||total(missing(view.you.hand,o.cost))>0}
        onClick={()=>onAction(o.kind==='route'?{type:'route',edgeId:o.id}:{type:o.kind,nodeId:o.id})}>{actionName(o.kind)}</button></div>)}
    {view.you.protected.includes(id)&&<p>{word(lang,'Дом защищён.','Building protected.')}</p>}
    {view.legal.protect&&building?.ownerId===view.you.participantId&&!view.you.protected.includes(id)&&<div>
      <Cost cost={view.legal.protectionCost} hand={view.you.hand} lang={lang}/>
      <button type="button" disabled={busy} onClick={()=>onAction({type:'protect',nodeId:id})}>{word(lang,'Защитить этот дом','Protect this building')}</button></div>}
  </section>;
}

function BankTrade({view,lang,busy,onAction}:Props){
  const [give,setGive]=useState<Resource>('wood'),[receive,setReceive]=useState<Resource>('brick');
  const rate=view.legal.bank[give], cost={[give]:rate};
  const available=view.bank[receive]>0;
  return <details className="ta-section"><summary>{word(lang,'Обмен с банком','Bank exchange')}</summary>
    <div className="ta-form"><div className="ta-pair"><ResourceChoice lang={lang} value={give} set={setGive} label={word(lang,'Отдать','Give')+' '+rate}/>
      <ResourceChoice lang={lang} value={receive} set={setReceive} label={word(lang,'Получить','Take')+' 1'}/></div>
      {give===receive?<p>{word(lang,'Выберите разные ресурсы.','Choose different resources.')}</p>:
        !available?<p>{word(lang,'Этот ресурс закончился в банке.','The bank has run out of this resource.')}</p>:
        view.you.hand[give]<rate?<p>{word(lang,'Не хватает','Missing')} · <ResourceStock stock={missing(view.you.hand,cost)} lang={lang}/></p>:null}
      <button type="button" disabled={busy||give===receive||!available||view.you.hand[give]<rate}
        onClick={()=>onAction({type:'bank',give,receive})}>{word(lang,'Обменять','Exchange')} {rate} → 1</button>
    </div></details>;
}

function PlayerTrade({view,lang,busy,onAction}:Props){
  const own=view.you.participantId, active=view.activeParticipantId;
  const targets=view.players.filter(p=>p.participantId!==own&&!p.left&&(own===active||p.participantId===active));
  const [target,setTarget]=useState(targets[0]?.participantId??'');
  const [give,setGive]=useState<Stock>(emptyStock),[receive,setReceive]=useState<Stock>(emptyStock);
  const [counter,setCounter]=useState<string|null>(null);
  const [editing,setEditing]=useState(false);
  const recipient=targets.some(p=>p.participantId===target)?target:(targets[0]?.participantId??'');
  const parent=view.offers.find(o=>o.id===counter&&o.authorId===recipient&&o.targetId===own);
  const ready=recipient&&total(give)>0&&total(receive)>0&&!total(missing(view.you.hand,give))&&RESOURCES.every(r=>!(give[r]&&receive[r]));
  function edit(offer?:TerritoryOffer){
    setCounter(offer?.id??null);setTarget(offer?.authorId??targets[0]?.participantId??'');
    setGive(offer?{...offer.receive}:emptyStock());setReceive(offer?{...offer.give}:emptyStock());setEditing(true);
  }
  return <section className="ta-trades">
    {view.offers.map(offer=>{
      const mine=offer.authorId===own, other=mine?offer.targetId:offer.authorId;
      const required=mine?offer.give:offer.receive, short=missing(view.you.hand,required);
      return <article className="ta-offer" key={offer.id}><h4>{word(lang,mine?'Вы предлагаете':'Предложение игрока',mine?'Your offer to':'Offer from')} · {nameOf(view,other)}</h4>
        <div>{word(lang,'Отдаёте','You give')} · <ResourceStock stock={required} lang={lang}/></div>
        <div>{word(lang,'Получаете','You receive')} · <ResourceStock stock={mine?offer.receive:offer.give} lang={lang}/></div>
        {!mine&&total(short)>0&&<div>{word(lang,'Не хватает','Missing')} · <ResourceStock stock={short} lang={lang}/></div>}
        <div className="ta-buttons">{!mine&&<><button type="button" disabled={busy||total(short)>0} onClick={()=>onAction({type:'accept',offerId:offer.id})}>{word(lang,'Принять','Accept')}</button>
          <button type="button" disabled={busy} onClick={()=>edit(offer)}>{word(lang,'Другие условия','Counteroffer')}</button></>}
          <button type="button" disabled={busy} onClick={()=>onAction({type:mine?'cancel':'decline',offerId:offer.id})}>{mine?word(lang,'Отозвать','Withdraw'):word(lang,'Отклонить','Decline')}</button></div>
      </article>;
    })}
    {!editing?<button type="button" disabled={busy||!targets.length} onClick={()=>edit()}>{word(lang,'Предложить обмен','Offer a trade')}</button>:
      <div className="ta-form"><label className="ta-select">{word(lang,'Кому','Trade with')}<select value={recipient} disabled={!!parent} onChange={e=>setTarget(e.target.value)}>
        {targets.map(p=><option key={p.participantId} value={p.participantId}>{p.displayName}</option>)}</select></label>
        <Amounts lang={lang} label={word(lang,'Отдаю','I give')} value={give} onChange={setGive} max={view.you.hand}/>
        <Amounts lang={lang} label={word(lang,'Прошу','I request')} value={receive} onChange={setReceive}/>
        {RESOURCES.some(r=>give[r]&&receive[r])&&<p>{word(lang,'Каждый ресурс должен быть только на одной стороне.','Put each resource on only one side of the trade.')}</p>}
        {counter&&!parent&&<p>{word(lang,'Предложение закрыто. Начните новый обмен.','This offer has closed. Start a new trade.')}</p>}
        <div className="ta-buttons"><button type="button" disabled={busy||!ready||Boolean(counter&&!parent)} onClick={()=>{
          onAction({type:'offer',targetId:recipient,give,receive,...(parent?{parentId:parent.id}:{})});setEditing(false);
        }}>{word(lang,'Отправить','Send offer')}</button>
          <button type="button" onClick={()=>setEditing(false)}>{word(lang,'Закрыть','Close')}</button></div>
      </div>}
  </section>;
}

function TacticalCards({view,lang,busy,onAction}:Props){
  const [first,setFirst]=useState<Resource>('wood'),[second,setSecond]=useState<Resource>('brick');
  const cost=view.legal.buyCard, i=lang==='ru'?0:1;
  const supplyReady=view.bank[first]>0&&view.bank[second]>0&&(first!==second||view.bank[first]>=2);
  return <details className="ta-section"><summary>{word(lang,'Тактические карты','Tactic cards')} · {view.you.cards.length}</summary>
    <div className="ta-form">{cost&&<div><Cost lang={lang} cost={cost} hand={view.you.hand}/>
      <button type="button" disabled={busy||total(missing(view.you.hand,cost))>0} onClick={()=>onAction({type:'buy-card'})}>{word(lang,'Купить карту','Buy a card')}</button></div>}
      {view.you.cards.map(card=><article className="ta-tactic" key={card.id}><h4>{cardNames[card.kind][i]}</h4><p>{cardHelp[card.kind][i]}</p>
        {card.kind==='supply'&&card.playable&&<div className="ta-pair"><ResourceChoice lang={lang} value={first} set={setFirst} label={word(lang,'Первый ресурс','First resource')}/>
          <ResourceChoice lang={lang} value={second} set={setSecond} label={word(lang,'Второй ресурс','Second resource')}/></div>}
        {card.kind!=='charter'&&(card.playable?<button type="button" disabled={busy||(card.kind==='supply'&&!supplyReady)}
          onClick={()=>onAction({type:'play-card',cardId:card.id,...(card.kind==='supply'?{resources:[first,second]}:{})})}>{word(lang,'Сыграть карту','Play card')}</button>:
          <small>{word(lang,'Одна карта за ход после броска, начиная со следующего хода после покупки.','Play one card per turn after rolling, starting on the turn after purchase.')}</small>)}
      </article>)}
      {!view.cardsAvailable&&<p>{word(lang,'Колода закончилась.','The deck is empty.')}</p>}
    </div></details>;
}

function Discard({view,lang,busy,onAction}:Props){
  const [stock,setStock]=useState<Stock>(emptyStock);
  return <section className="ta-form"><Amounts lang={lang} value={stock} onChange={setStock} max={view.you.hand}
    label={word(lang,'Верните ресурсы в банк','Return resources to the bank')}/>
    <button type="button" className="ta-primary" disabled={busy||total(stock)!==view.you.discard||total(missing(view.you.hand,stock))>0}
      onClick={()=>onAction({type:'discard',resources:stock})}>{word(lang,'Вернуть','Discard')} {total(stock)} / {view.you.discard}</button></section>;
}

function Block({view,lang,busy,onAction,selection}:Props){
  const [target,setTarget]=useState('');
  const tile=selection?.kind==='tile'&&view.legal.block.find(b=>b.tileId===selection.id);
  if(!tile) return <p>{word(lang,'Выберите клетку для блокады.','Choose a tile for the blockade.')}</p>;
  const chosen=tile.targets.includes(target)?target:tile.targets[0];
  return <div className="ta-form">{tile.targets.length>0&&<label className="ta-select">{word(lang,'Взять ресурс у игрока','Take a resource from')}
    <select value={chosen} onChange={e=>setTarget(e.target.value)}>{tile.targets.map(id=><option key={id} value={id}>{nameOf(view,id)}</option>)}</select></label>}
    <button type="button" className="ta-primary" disabled={busy} onClick={()=>onAction({type:'block',tileId:tile.tileId,...(chosen?{targetId:chosen}:{})})}>
      {word(lang,'Перенести блокаду','Move blockade')}</button></div>;
}

export function TerritorialActions(props:Props){
  const {view,lang,busy,onAction,selection}=props;
  const mine=view.activeParticipantId===view.you.participantId;
  if(view.phase==='finished') return null;
  return <div className="territorial-actions">
    {view.legal.roll&&<button type="button" className="ta-primary" disabled={busy} onClick={()=>onAction({type:'roll'})}>{word(lang,'Бросить кубики','Roll dice')}</button>}
    {view.you.discard>0&&<Discard {...props}/>}
    {mine&&view.phase==='setup-home'&&!selection&&<p>{word(lang,'Выберите участок для стартового дома.','Choose a site for your starting house.')}</p>}
    {mine&&view.phase==='setup-route'&&!selection&&<p>{word(lang,'Выберите дорогу рядом с новым домом.','Choose a road beside your new house.')}</p>}
    {view.phase==='play'&&mine&&!selection&&<p>{word(lang,'Выберите участок или путь на карте.','Select a site or route on the map.')}</p>}
    <SelectedAction {...props}/>
    {view.legal.block.length>0&&<Block {...props}/>}
    {view.phase==='play'&&mine&&<BankTrade {...props}/>}
    {view.legal.trade&&<PlayerTrade key={view.turn} {...props}/>}
    {(view.legal.buyCard||view.you.cards.length>0)&&<TacticalCards {...props}/>}
    {view.legal.end&&<button type="button" className="ta-end" disabled={busy} onClick={()=>onAction({type:'end'})}>{word(lang,'Завершить ход','End turn')}</button>}
  </div>;
}

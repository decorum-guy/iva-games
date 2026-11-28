import type { BossCardDefinition,CardDefinition,Language } from '../core/types';
import { rarityNames } from './i18n';
const ranks={common:1,rare:2,epic:3,legendary:4};
export function Card({card,lang,onClick,selected=false,unavailable=false,compact=false,status,children}:{
 card:CardDefinition|BossCardDefinition;lang:Language;onClick?:()=>void;selected?:boolean;unavailable?:boolean;compact?:boolean;status?:string;children?:React.ReactNode;
}){
 const boss='boss' in card;
 return <button type="button" className={['relic-card',card.rarity,selected?'chosen':'',unavailable?'unavailable':'',compact?'compact':'',boss?'boss-relic':''].join(' ')}
 aria-label={card.name[lang]+', '+rarityNames[card.rarity][lang]+('cost' in card?', '+card.cost+' '+(lang==='ru'?'фокус':'focus'):'')+': '+card.description[lang]}
 aria-pressed={onClick?selected:undefined} onClick={onClick} data-card={card.id} data-rarity={card.rarity}>
 <span className="card-grain" aria-hidden="true"/><span className="card-corner top-left" aria-hidden="true"/><span className="card-corner top-right" aria-hidden="true"/>
 <span className="card-price">{'cost'in card?card.cost:<span aria-label={lang==='ru'?'Карта босса':'Boss card'}>♛</span>}</span>
 <span className="card-illustration"><img src={'/assets/colossus/cards/'+card.id+'.svg'} alt="" draggable="false"/></span>
 <span className="card-name">{card.name[lang]}</span>
 <span className="card-rarity"><span aria-hidden="true">{'✦'.repeat(ranks[card.rarity])}</span> {rarityNames[card.rarity][lang]}</span>
 {!compact&&<span className="card-description">{card.description[lang]}</span>}
 {status&&<span className="card-status">{status}</span>}{children}
 </button>
}

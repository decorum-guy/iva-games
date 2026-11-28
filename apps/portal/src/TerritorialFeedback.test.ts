import { describe, expect, it } from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import { applyTerritory, createTerritory, emptyStock, territoryMaps, viewTerritory } from '@iva-games/district/territorial';
import { advanceTerritory } from '../../../games/district/src/territorial/core';
import { historyTitle, TerritorialTurn } from './TerritorialFeedback';

describe('Trade response expiry history', () => {
  it('keeps the active actor and hint when another bot is only answering a quote',()=>{
    const state=createTerritory({matchId:'reply-actor',roomId:'reply-actor',map:territoryMaps[0],preset:'medium',seed:'actor',now:1000,
      participants:['a','b','c'].map((id,seatIndex)=>({participantId:id,playerId:id,displayName:id==='a'?'Active player':id==='c'?'Replying bot':id,seatIndex,controller:{kind:'human',playerId:id}}))});
    state.phase='play';
    const view=viewTerritory(state,'b',1000);
    view.botParticipantId='c';view.botActionAt=2000;
    for(const lang of ['en','ru'] as const) {
      const html=renderToStaticMarkup(createElement(TerritorialTurn,{view,lang}));
      expect(html).toContain('>Active player</strong>');
      expect(html).not.toContain('Replying bot');
      expect(html).not.toContain(lang==='ru'?'Бот выбирает ход':'Bot is choosing a move');
      const active=renderToStaticMarkup(createElement(TerritorialTurn,{view:{...view,activeParticipantId:'c'},lang}));
      expect(active).toContain('>Replying bot</strong>');
      expect(active).toContain(lang==='ru'?'Бот выбирает ход':'Bot is choosing a move');
    }
  });
  it('distinguishes ten-second response expiry from turn end in RU and EN', () => {
    let state=createTerritory({matchId:'reply-history',roomId:'reply-history',map:territoryMaps[0],preset:'medium',seed:'history',now:1000,
      participants:['a','b'].map((id,seatIndex)=>({participantId:id,playerId:id,displayName:id,seatIndex,controller:{kind:'human',playerId:id}}))});
    state.phase='play'; state.players.a.hand={...emptyStock(),wood:1}; state.players.b.hand={...emptyStock(),brick:1};
    state=applyTerritory(state,'a',{type:'offer',targetId:'b',give:{...emptyStock(),wood:1},receive:{...emptyStock(),brick:1}},1000);
    state=advanceTerritory(state,11_000);
    const view=viewTerritory(state,'a',11_000), entry=view.history!.find(item=>item.reason==='response-timeout')!;
    expect(entry.source).toBe('timeout');
    expect(historyTitle(entry,view,'en')).toContain('No response in 10 seconds');
    expect(historyTitle(entry,view,'en')).not.toContain('Turn ended');
    expect(historyTitle(entry,view,'ru')).toContain('Нет ответа за 10 секунд');
    expect(historyTitle({...entry,reason:'expired'},view,'en')).toContain('Turn ended');
    expect(historyTitle({...entry,reason:'expired'},view,'ru')).toContain('Ход закончился');
  });
});

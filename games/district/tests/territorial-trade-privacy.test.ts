import { describe, expect, it } from 'vitest';
import type { Participant } from '@iva-games/session-kit';
import { applyTerritory, createTerritory, viewTerritory } from '../src/territorial/core';
import { grant } from '../src/territorial/economy';
import { territoryMaps } from '../src/territorial/maps';
import { emptyStock } from '../src/territorial/types';

const human = (id: string, seatIndex: number): Participant => ({
  participantId:id, playerId:id, displayName:id, seatIndex, controller:{kind:'human',playerId:id},
});

function offered(recipientHasBrick: boolean) {
  let state = createTerritory({matchId:'private-offer',roomId:'private-offer-room',map:territoryMaps[0],
    participants:[human('author',0),human('target',1),human('observer',2)],seed:'private-offer-seed',preset:'medium',now:1_000});
  state.phase='play';state.turn=1;
  grant(state,'wood','author',1);
  grant(state,recipientHasBrick ? 'brick' : 'ore','target',1);
  state=applyTerritory(state,'author',{type:'offer',targetId:'target',
    give:{...emptyStock(),wood:1},receive:{...emptyStock(),brick:1}},1_100);
  return state;
}

describe('Unanswered trade proposals preserve hidden recipient hands', () => {
  it('gives the sender identical complete views for equal-size recipient hands that can or cannot pay', () => {
    const canPay=offered(true),cannotPay=offered(false);
    const authorCanPay=viewTerritory(canPay,'author',1_200);
    const authorCannotPay=viewTerritory(cannotPay,'author',1_200);
    expect(authorCanPay.offers).toHaveLength(2);
    expect(authorCanPay).toEqual(authorCannotPay);
    expect(authorCannotPay.offers[0]).not.toHaveProperty('unavailableReason');
    expect(JSON.stringify(authorCannotPay)).not.toContain('target-resources');
    // Closed terms and their authorised history cannot retroactively disclose it.
    const closedCanPay=applyTerritory(canPay,'author',{type:'end'},1_300);
    const closedCannotPay=applyTerritory(cannotPay,'author',{type:'end'},1_300);
    expect(viewTerritory(closedCanPay,'author',1_400)).toEqual(viewTerritory(closedCannotPay,'author',1_400));
  });

  it('keeps the recipient’s own shortage and the validity of the sender’s promised resources useful', () => {
    const canPay=offered(true),cannotPay=offered(false);
    expect(viewTerritory(canPay,'target',1_200).offers[0]).toMatchObject({canAccept:true});
    expect(viewTerritory(cannotPay,'target',1_200).offers[0]).toMatchObject({canAccept:false,unavailableReason:'target-resources'});
    grant(canPay,'wood','author',-1);
    expect(viewTerritory(canPay,'target',1_300).offers[0]).toMatchObject({canAccept:false,unavailableReason:'author-resources'});
  });

  it('sends neither the quote nor its closure history to an uninvolved participant', () => {
    const state=offered(false);
    // Persisted pre-broadcast quote: old rooms keep their private addressed offer.
    state.offers = state.offers.filter(offer => offer.targetId === 'target');
    state.history = state.history?.filter(entry => entry.targetId !== 'observer');
    delete state.offers[0].groupId;
    const observer=viewTerritory(state,'observer',1_200);
    expect(observer.offers).toEqual([]);
    expect(observer.history?.some(item=>item.kind==='offer')).toBe(false);
    const closed=applyTerritory(state,'target',{type:'decline',offerId:state.offers[0].id},1_300);
    const after=viewTerritory(closed,'observer',1_400);
    expect(after.offerHistory).toEqual([]);
    expect(after.history?.some(item=>item.kind==='decline')).toBe(false);
  });
});

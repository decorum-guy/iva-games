import type { Participant } from '@iva-games/session-kit';
import { applyTerritory, createTerritory, currentId, fallbackTerritory, viewTerritory } from './core';
import { grant } from './economy';
import { getTerritoryMap } from './maps';
import { exposedThreat, tutorialNews } from './news';
import { TERRITORY_BOT } from './types';
import type { TerritoryAction, TerritoryState, TerritoryView } from './types';

const learner = 'apprentice';
const guide = 'mira';
const participants: Participant[] = [
  { participantId: learner, displayName: 'Iva', seatIndex: 0, playerId: learner, controller: { kind: 'human', playerId: learner } },
  { participantId: guide, displayName: 'Mira', seatIndex: 1, playerId: null,
    controller: { kind: 'bot', botProfileId: 'mira', botVersion: TERRITORY_BOT, difficulty: 'normal' } },
];
// Named landmarks in the pinned teaching map. Published matches use their own map and seed.
const home = 'v1_1', junction = 'v2_2', extension = 'v3_1';
const openingRoad = 'r' + [home, junction].sort().join('~');
const newRoad = 'r' + [junction, extension].sort().join('~');
const sector = 'pine-cape';
const supplyId = 'lesson-supply';
const tr = (ru: string, en: string) => ({ ru, en });
type Text = ReturnType<typeof tr>;
export type TutorialStep = 'place' | 'opening-road' | 'production' | 'road' | 'trade' | 'build' | 'good-news'
  | 'tactic' | 'score' | 'protect' | 'advance-round' | 'threat-result' | 'complete';
export interface TerritoryTutorial { step: TutorialStep; state: TerritoryState }
export interface TutorialFrame {
  step: TutorialStep; view: TerritoryView; title: Text; body: Text; button: Text;
  target?: { kind: 'node' | 'edge' | 'sector'; id: string };
}

const lessons: Record<TutorialStep, [Text, Text, Text]> = {
  place: [tr('Первый дом', 'Your first home'), tr('Выберите точку у пастбища с числом 6. Первый дом бесплатный. Бросок 6 принесёт шерсть.', 'Choose the junction by pasture 6. Your first home is free. A roll of 6 brings wool.'), tr('Поставить дом', 'Place home')],
  'opening-road': [tr('Выход в город', 'A way into town'), tr('Проведите первую дорогу от своего дома. Она бесплатна. Мира завершит расстановку и поставит ваш второй учебный дом.', 'Lay the first road out of your home for free. Mira will finish setup, including your second practice home.'), tr('Провести дорогу', 'Lay road')],
  production: [tr('Бросок на производство', 'Roll for production'), tr('В учебном резерве есть материалы для стройки и обмена. Бросьте кубики и посмотрите, какое поле даст доход.', 'Your practice stock includes materials for building and trading. Roll and watch which field produces.'), tr('Бросить кубики', 'Roll dice')],
  road: [tr('Шерсть с пастбища', 'Wool from the pasture'), tr('На кубиках 6. Дом у пастбища принёс вам шерсть. Продлите дорогу к свободному перекрёстку за 1 древесину и 1 кирпич.', 'The roll was 6. Your pasture paid wool. Extend your road to the open junction for 1 wood and 1 brick.'), tr('Продлить дорогу', 'Extend road')],
  trade: [tr('Зерно для стройки', 'Grain for your next home'), tr('Дому нужны древесина, кирпич, шерсть и зерно. Обменяйте 4 руды на 1 зерно в банке. С игроком можно договориться о своей цене.', 'A home takes wood, brick, wool and grain. Trade 4 ore for 1 grain at the bank. Players may negotiate their own rate.'), tr('Обменять руду на зерно', 'Trade ore for grain')],
  build: [tr('Застроить перекрёсток', 'Build at the junction'), tr('Выберите конец новой дороги. Дом стоит по 1 единице древесины, кирпича, шерсти и зерна.', 'Select the end of your new road. A home costs 1 wood, 1 brick, 1 wool and 1 grain.'), tr('Построить дом', 'Build home')],
  'good-news': [tr('Помощь приехала', 'The aid trucks arrived'), tr('Откройте на карте Сосновый мыс. Владельцы домов в этом секторе уже получили по 1 древесине и 1 кирпичу.', 'Find Pine Cape on the board. Each local owner has just received 1 wood and 1 brick.'), tr('Показать сектор', 'Show sector')],
  tactic: [tr('Карта снабжения', 'Supply card'), tr('В руке уже есть «Снабжение». Сыграйте карту и возьмите из банка зерно и руду. В партии купленная карта доступна со следующего хода.', 'A Supply card is already in hand. Play it to take grain and ore from the bank. A newly bought card becomes playable on a later turn.'), tr('Взять зерно и руду', 'Take grain and ore')],
  score: [tr('Ваши первые очки', 'Your first points'), tr('Три дома приносят 3 очка. Улучшение приносит ещё 1, награда за маршрут — 2. Цель партии — 10 очков.', 'Three homes give you 3 points. An upgrade adds 1, and the route award adds 2. Reach 10 to win.'), tr('Завершить тренировку', 'Finish practice')],
  protect: [tr('Приготовиться к угрозе', 'Prepare for the threat'), tr('В этой позиции есть улучшенный дом и резерв. Сектор угрозы указан в новости. Выберите свой дом второго уровня в этом секторе и заплатите 1 кирпич и 1 руду за защиту. Иногда события происходят внезапно.', 'This position has an upgraded home and a reserve. Read the announced sector, then choose your level-two home there. Protection costs 1 brick and 1 ore. Some events strike without warning.'), tr('Защитить свой дом', 'Protect your home')],
  'advance-round': [tr('Дождаться события', 'Wait for the event'), tr('Защита установлена. Проведите один полный круг обоих игроков. Срок в новости отсчитывается по кругам.', 'Protection is in place. Play through one full round for both seats. The news deadline counts full rounds.'), tr('Провести один круг', 'Play one round')],
  'threat-result': [tr('Удар завершился', 'The strike is over'), tr('Откройте итог в журнале. Защита сохранила уровень дома. Расходы и последствия видны в состоявшихся действиях.', 'Read the report in the journal. Protection kept your home at level two. The report shows the actual result.'), tr('Завершить эпизод', 'Finish episode')],
  complete: [tr('Тренировка пройдена', 'Practice complete'), tr('Теперь можно сыграть обычную партию.', 'You can now play a regular match.'), tr('Играть', 'Play')],
};

const targets: Partial<Record<TutorialStep, TutorialFrame['target']>> = {
  place: { kind: 'node', id: home }, 'opening-road': { kind: 'edge', id: openingRoad },
  road: { kind: 'edge', id: newRoad }, build: { kind: 'node', id: extension }, 'good-news': { kind: 'sector', id: sector },
};

export function createTutorial(): TerritoryTutorial {
  return { step: 'place', state: createTerritory({ matchId: 'practice-bay', roomId: 'practice', participants,
    preset: 'medium', seed: 'district-tutorial-3', map: getTerritoryMap('azure-bay', '2'), now: 0 }) };
}

export function tutorialFrame(session: TerritoryTutorial): TutorialFrame {
  const [title, body, button] = lessons[session.step];
  const target = targets[session.step];
  return { step: session.step, title, body, button, ...(target ? { target } : {}),
    view: viewTerritory(session.state, learner, session.state.revision) };
}

function act(s: TerritoryState, action: TerritoryAction, who = currentId(s)) {
  return applyTerritory(s, who, action, s.revision + 1);
}

function finishOpening(s: TerritoryState) {
  // Complete the three remaining pairs in the normal two-seat snake order.
  for (const nodeId of ['v9_-1', 'v7_13', 'v0_14']) {
    s = act(s, { type: 'place', nodeId });
    const edge = viewTerritory(s, currentId(s), s.revision).legal.options[0];
    s = act(s, { type: 'route', edgeId: edge.id });
  }
  grant(s, 'wood', learner, 2);
  grant(s, 'brick', learner, 2);
  grant(s, 'ore', learner, 4);
  const card = s.deck.indexOf('supply');
  s.deck.splice(card, 1);
  s.players[learner].cards.push({ id: supplyId, kind: 'supply', bought: 0 });
  return s;
}

function finishRound(s: TerritoryState) {
  const target = s.round + 1;
  while (s.round < target) {
    const who = s.phase === 'discard' ? s.participants.find(p => s.discard[p.participantId] > 0)!.participantId : currentId(s);
    const action = fallbackTerritory(viewTerritory(s, who, s.revision));
    if (!action) throw new Error('Incomplete tutorial turn');
    s = act(s, action, who);
  }
  return s;
}

export function startTutorialThreat(): TerritoryTutorial {
  let s = createTutorial().state;
  s = act(s, { type: 'place', nodeId: home });
  s = finishOpening(act(s, { type: 'route', edgeId: openingRoad }));
  // A mid-game practice position isolates this one chain and the following two rounds.
  s.round = 7;
  s.turn = 15;
  s.news.processedRound = 7;
  s.news.nextRound = 11;
  s.phase = 'play';
  grant(s, 'grain', learner, 2);
  grant(s, 'ore', learner, 3);
  s = act(s, { type: 'upgrade', nodeId: home });
  tutorialNews(s, 'H04', sector, () => s.news.profile.warningWeights[0]);
  return { step: 'protect', state: s };
}

export function advanceTutorial(session: TerritoryTutorial, targetId?: string): TerritoryTutorial {
  const { step } = session;
  let s = session.state;
  const target = targets[step];
  if (target && target.id !== targetId) return session;
  switch (step) {
    case 'place': return { step: 'opening-road', state: act(s, { type: 'place', nodeId: home }) };
    case 'opening-road': return { step: 'production', state: finishOpening(act(s, { type: 'route', edgeId: openingRoad })) };
    case 'production': return { step: 'road', state: act(s, { type: 'roll' }) };
    case 'road': return { step: 'trade', state: act(s, { type: 'route', edgeId: newRoad }) };
    case 'trade': return { step: 'build', state: act(s, { type: 'bank', give: 'ore', receive: 'grain' }) };
    case 'build':
      s = act(s, { type: 'settle', nodeId: extension });
      tutorialNews(s, 'G02', sector, () => 0);
      return { step: 'good-news', state: s };
    case 'good-news': return { step: 'tactic', state: s };
    case 'tactic': return { step: 'score', state: act(s, { type: 'play-card', cardId: supplyId, resources: ['grain', 'ore'] }) };
    case 'score': case 'threat-result': return { step: 'complete', state: s };
    case 'protect':
      if (!targetId || s.buildings[targetId]?.ownerId !== learner || !exposedThreat(s, targetId)) return session;
      return { step: 'advance-round', state: act(s, { type: 'protect', nodeId: targetId }) };
    case 'advance-round': {
      const state = finishRound(s);
      return { step: state.news.chains.length ? 'advance-round' : 'threat-result', state };
    }
    case 'complete': return session;
  }
}

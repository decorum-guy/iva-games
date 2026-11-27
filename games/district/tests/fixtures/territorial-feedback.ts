/** Synthetic acceptance positions only. This module is never imported by production. */
import { randomStream } from '../../src/random';
import { applyTerritory, createTerritory, viewTerritory } from '../../src/territorial/core';
import { hasRoom } from '../../src/territorial/graph';
import { newsBoundary, tutorialNews } from '../../src/territorial/news';
import { emptyStock, RESOURCES } from '../../src/territorial/types';
import type { Stock, TerritoryState } from '../../src/territorial/types';

export const feedbackScenarios = [
  { id: 'seven-discard', title: 'ТЕСТ · Семёрка и сброс', checks: ['Бросить кубики: настоящие грани и сумма 7.', 'Оба аккаунта сбрасывают четыре карты; затем первый переносит блокаду.', 'После следующего хода и reconnect прежний бросок и причина блокады остаются.'] },
  { id: 'patrol', title: 'ТЕСТ · Патруль и карты', checks: ['В личной руке патруль, подряд, снабжение и грамота.', 'Сыграть патруль; перенос и кража проходят без сброса.', 'Причина блокады остаётся «патруль» после завершения хода.'] },
  { id: 'coupon-free', title: 'ТЕСТ · Купон и три пути', checks: ['Из новости показать подходящие дороги.', 'Сверить бесплатную дорогу, соседний сектор и морской путь.', 'Купон списывается только при применимой стройке.'] },
  { id: 'coupon-surcharge', title: 'ТЕСТ · Купон с доплатой', checks: ['Проверить базовую цену, скидку купона и доплату древесиной.', 'Фактическое списание равно итоговой цене сервера.'] },
  { id: 'coupon-expiry', title: 'ТЕСТ · Истечение купона', checks: ['Второй участник завершает последний ход круга.', 'Первый бросает кубики; купон исчез и дороги снова имеют обычную цену.'] },
  { id: 'long-news', title: 'ТЕСТ · Длинный выпуск', checks: ['Открыть тестовую длинную новость, прокрутить до последнего абзаца и кнопок.', 'Выбрать дом: новость остаётся доступной.', 'Свернуть, вернуться из журнала; проверить клавиатуру, касание, короткое окно и увеличение.'] },
  { id: 'epidemic-risk', title: 'ТЕСТ · Эпидемия: риск', checks: ['Локальное событие уже произошло, отдельно есть прогноз риска для всей карты.', 'У прогноза нет будущих пострадавших, домов или количества ущерба.', 'Риск охватывает всю карту пунктиром, факт локального события — свой сектор.'] },
  { id: 'epidemic-applied', title: 'ТЕСТ · Эпидемия: факт', checks: ['Факт распространения показан отдельно от старого прогноза.', 'Общегородская рамка сплошная; последствия только у применившейся стадии.'] },
  { id: 'production-flight', title: 'ТЕСТ · Доход с клетки', checks: ['Полететь из фактической клетки в руку; не повторять после reload.'] },
  { id: 'atmosphere-expiry', title: 'ТЕСТ · Эффект района', checks: ['Применённый эффект виден до окончания срока.'] },
  { id: 'trade-draft', title: 'ТЕСТ · Встречная сделка', checks: ['Второй аккаунт редактирует встречные условия входящего предложения.', 'Первый завершает ход: сервер закрывает предложение как expired.', 'Второй сохраняет черновик и может вручную использовать его в новом законном контексте.'] },
] as const;
export type FeedbackScenarioId = typeof feedbackScenarios[number]['id'];
const stock = (values: Partial<Stock>): Stock => ({ ...emptyStock(), ...values });
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error('Feedback fixture: ' + message); }

function setDice(s: TerritoryState, number: number, turn = s.turn) {
  for (let index = 0; index < 1_000; index++) {
    const seed = `feedback-dice-${number}-${index}`;
    const random = randomStream(seed, 'roll:' + turn);
    const dice = [random(6) + 1, random(6) + 1];
    if (dice[0] + dice[1] === number) { s.seed = seed; return dice; }
  }
  throw new Error('Could not prepare deterministic dice');
}

function prepareRoads(s: TerritoryState) {
  const ownerId = s.participants[0].participantId;
  const otherId = s.participants[1].participantId;
  const land = s.map.edges.find(edge => edge.kind === 'land' && s.map.nodes.find(node => node.id === edge.a)?.eventSectorId === edge.eventSectorId)!;
  ensure(land, 'first legal road');
  s.buildings = { [land.a]: { ownerId, level: 1 } };
  const adjacent = s.map.edges.find(edge => edge.kind === 'land' && edge.eventSectorId !== land.eventSectorId && hasRoom(s, edge.a))!;
  ensure(adjacent, 'neighbouring sector road');
  s.buildings[adjacent.a] = { ownerId, level: 1 };
  const sea = s.map.edges.find(edge => edge.kind === 'sea' && (s.buildings[edge.a]?.ownerId === ownerId || hasRoom(s, edge.a)))!;
  ensure(sea, 'sea path');
  s.buildings[sea.a] = { ownerId, level: 1 };
  const opponent = s.map.nodes.find(node => hasRoom(s, node.id) && node.tileIds.some(tileId => s.map.tiles.find(tile => tile.id === tileId)?.resource))!;
  ensure(opponent, 'opponent house');
  s.buildings[opponent.id] = { ownerId: otherId, level: 1 };
  return { land: land.id, adjacent: adjacent.id, sea: sea.id, zone: land.eventSectorId, ownerId, otherId, house: land.a, opponentHouse: opponent.id };
}

export function prepareFeedbackFixture(baseline: TerritoryState, scenario: FeedbackScenarioId, now: number) {
  const index = feedbackScenarios.findIndex(item => item.id === scenario);
  ensure(index !== -1, 'unknown scenario');
  let s = createTerritory({ matchId: baseline.matchId, roomId: baseline.roomId, map: baseline.map,
    participants: baseline.participants, preset: 'medium', seed: 'synthetic-feedback-' + scenario, now });
  s.revision = 1_000 + index * 100;
  s.phase = 'play'; s.round = 4; s.turn = 9; s.news.processedRound = 4; s.news.nextRound = 1_000;
  const board = prepareRoads(s);
  for (const player of Object.values(s.players)) player.hand = stock({ wood: 4, brick: 4, grain: 3, wool: 3, ore: 3 });
  const conserveBank = () => { s.bank = Object.fromEntries(RESOURCES.map(resource => [resource,
    s.rules.stockPerResource - Object.values(s.players).reduce((total, player) => total + player.hand[resource], 0),
  ])) as Stock; };
  conserveBank();
  const metadata: Record<string, unknown> = { ...board, synthetic: true, phase: s.phase, round: s.round,
    owners: s.participants.map(participant => ({ participantId: participant.participantId, playerId: participant.playerId })) };
  const apply = (id: string, action: Parameters<typeof applyTerritory>[2]) => { s = applyTerritory(s, id, action, now); };
  const news = (template: string, draws: number[] = []) => {
    let cursor = 0;
    tutorialNews(s, template, board.zone, max => {
      const draw = draws[cursor++] ?? 0;
      ensure(draw < max, 'out-of-range news fixture draw'); return draw;
    });
  };
  if (scenario === 'seven-discard') {
    s.players[board.ownerId].hand = stock({ wood: 5, brick: 4 });
    s.players[board.otherId].hand = stock({ grain: 8 });
    conserveBank();
    s.phase = 'roll'; metadata.dice = setDice(s, 7); metadata.expectedSum = 7;
    metadata.expectedDiscard = { [board.ownerId]: 4, [board.otherId]: 4 };
  } else if (scenario === 'patrol') {
    s.phase = 'roll'; setDice(s, 5); apply(board.ownerId, { type: 'roll' });
    s.players[board.ownerId].cards = ['patrol', 'survey', 'supply', 'charter'].map((kind, cardIndex) => ({
      id: 'fixture-card-' + cardIndex, kind: kind as 'patrol' | 'survey' | 'supply' | 'charter', bought: 0,
    }));
    for (const card of s.players[board.ownerId].cards) s.deck.splice(s.deck.indexOf(card.kind), 1);
    metadata.patrolCardId = 'fixture-card-0'; metadata.expectedBlockadeReason = 'patrol';
  } else if (scenario.startsWith('coupon-') || scenario === 'long-news') {
    news('G06');
    if (scenario === 'coupon-surcharge') news('B06');
    if (scenario === 'coupon-expiry') {
      s.activeIndex = s.participants.length - 1; s.turn = 10;
      metadata.nextDice = setDice(s, 4, s.turn + 1); metadata.expiryRound = s.round + 1;
    }
    if (scenario === 'long-news') {
      const issue = s.news.messages.at(-1)!;
      ensure('changes' in issue, 'applied coupon issue');
      issue.headline = { ru: 'ТЕСТ · Длинный выпуск районных новостей', en: 'TEST · Long district news issue' };
      issue.description = {
        ru: Array.from({ length: 18 }, (_, n) => `Тестовый абзац ${n + 1}. Этот текст создан только для проверки прокрутки. Купон действует в указанном секторе; выберите подходящую дорогу и проверьте итоговую цену.`).join('\n\n') + '\n\nКОНЕЦ ТЕСТОВОГО ВЫПУСКА',
        en: Array.from({ length: 18 }, (_, n) => `Test paragraph ${n + 1}. This text exists only to check scrolling. The coupon applies in its announced sector; select an eligible road and check the final price.`).join('\n\n') + '\n\nEND OF TEST ISSUE',
      };
      metadata.lastParagraph = 'КОНЕЦ ТЕСТОВОГО ВЫПУСКА';
    }
    const v = viewTerritory(s, board.ownerId, now);
    metadata.coupons = v.you.coupons;
    metadata.prices = v.legal.options.filter(option => option.kind === 'route' && [board.land, board.adjacent, board.sea].includes(option.id));
  } else if (scenario === 'epidemic-risk' || scenario === 'epidemic-applied') {
    news('E01', [99, 0, 0]);
    if (scenario === 'epidemic-applied') {
      const due = s.news.chains[0].at;
      while (s.round < due) { s.round++; newsBoundary(s); }
      s.turn = s.round * s.participants.length + 1;
    }
    metadata.publicMessages = s.news.messages;
  } else if (scenario === 'production-flight') {
    const house=s.map.nodes.find(node=>node.id===board.house)!;
    const tile=house.tileIds.map(id=>s.map.tiles.find(t=>t.id===id)!).find(t=>t.resource&&t.number!==null)!;
    ensure(tile,'producing tile adjacent to owned house');
    s.blockedTileId=null; s.phase='roll';
    metadata.dice=setDice(s,tile.number!); metadata.tileId=tile.id; metadata.resource=tile.resource;
  } else if (scenario === 'atmosphere-expiry') {
    news('B02');
    s.activeIndex=s.participants.length-1; s.turn=10;
  } else if (scenario === 'trade-draft') {
    apply(board.ownerId, { type: 'offer', targetId: board.otherId, give: stock({ wood: 1 }), receive: stock({ brick: 1 }) });
    metadata.offerId = s.offers[0].id;
  }
  metadata.phase = s.phase; metadata.round = s.round; metadata.revision = s.revision;
  metadata.actorId = s.participants[s.activeIndex].participantId;
  return { state: s, metadata };
}

export { applyTerritory, viewTerritory };

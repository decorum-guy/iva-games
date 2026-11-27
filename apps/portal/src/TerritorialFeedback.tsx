import { useState } from 'react';
import type { TerritoryBlockade, TerritoryHistoryEntry, TerritoryView } from '@iva-games/district/territorial';
import { ResourceStock } from './TerritorialActions';
import type { BoardSelection } from './TerritorialBoard';
import type { Language } from './types';
import { Modal } from './ui';

const pips: Record<number, [number, number][]> = {
  1: [[12,12]], 2: [[6,6],[18,18]], 3: [[6,6],[12,12],[18,18]],
  4: [[6,6],[18,6],[6,18],[18,18]], 5: [[6,6],[18,6],[12,12],[6,18],[18,18]],
  6: [[6,6],[18,6],[6,12],[18,12],[6,18],[18,18]],
};
export function DieFace({ value }: { value: number }) {
  return <svg className="territory-die" viewBox="0 0 24 24" role="img" aria-label={String(value)}>
    <rect x=".8" y=".8" width="22.4" height="22.4" rx="4.4"/>
    {(pips[value] ?? []).map(([x,y], index) => <circle key={index} cx={x} cy={y} r="1.8"/>)}
  </svg>;
}
export const playerName = (view: TerritoryView, id?: string) => view.players.find(player => player.participantId === id)?.displayName;
export function blockadeText(blockade: TerritoryBlockade | null | undefined, view: TerritoryView, lang: Language) {
  const ru = lang === 'ru';
  if (!blockade || blockade.reason === 'unknown') return ru ? 'Причина прежней блокады не сохранена.' : 'The earlier blockade cause was not recorded.';
  const cause = blockade.reason === 'seven' ? (ru ? 'Семёрка' : 'Seven') : (ru ? 'Патруль' : 'Patrol');
  const who = playerName(view, blockade.actorId);
  return [cause, who, blockade.round === undefined ? null : (ru ? 'круг ' : 'round ') + (blockade.round + 1)].filter(Boolean).join(' · ');
}
const terrain = {
  wood: ['Лес', 'Forest'], brick: ['Карьер', 'Clay pit'], grain: ['Пашня', 'Cropland'],
  wool: ['Пастбище', 'Pasture'], ore: ['Рудник', 'Mine'],
};
export function tileName(view: TerritoryView, id: string, lang: Language) {
  const tile = view.map.tiles.find(item => item.id === id);
  return tile ? (tile.resource ? terrain[tile.resource][lang === 'ru' ? 0 : 1] : lang === 'ru' ? 'Пустошь' : 'Heath')
    + (tile.number ? ' ' + tile.number : '') : (lang === 'ru' ? 'Клетка' : 'Tile');
}

export function phaseText(view: TerritoryView, lang: Language) {
  const ru = lang === 'ru', mine = view.you.participantId === view.activeParticipantId;
  switch (view.phase) {
    case 'setup-home': return mine ? (ru ? 'Поставьте стартовый дом' : 'Place your starting home') : (ru ? 'Ставит стартовый дом' : 'Placing a starting home');
    case 'setup-route': return mine ? (ru ? 'Проведите стартовую дорогу' : 'Connect your starting road') : (ru ? 'Проводит стартовую дорогу' : 'Connecting a starting road');
    case 'roll': return mine ? (ru ? 'Бросьте кубики' : 'Roll the dice') : (ru ? 'Готовится бросить кубики' : 'Getting ready to roll');
    case 'discard': return view.you.discard ? (ru ? `Семёрка: верните ${view.you.discard} карты` : `Seven: return ${view.you.discard} cards`)
      : (ru ? 'Семёрка: ждём сброса ресурсов' : 'Seven: waiting for discards');
    case 'block': return (view.pendingBlockade?.reason === 'patrol' ? (ru ? 'Патруль' : 'Patrol') : (ru ? 'Семёрка' : 'Seven'))
      + (mine ? (ru ? ': перенесите блокаду' : ': move the blockade') : (ru ? ': переносит блокаду' : ': moving the blockade'));
    case 'play': return mine ? (ru ? 'Стройте, обменивайтесь или завершите ход' : 'Build, trade or end your turn') : (ru ? 'Строит и торгуется' : 'Building and trading');
    case 'finished': return ru ? 'Партия завершена' : 'Match complete';
  }
}

export function TerritorialTurn({ view, lang }: { view: TerritoryView; lang: Language }) {
  const ru = lang === 'ru';
  const mine = view.activeParticipantId === view.you.participantId;
  const seconds = Math.max(0, Math.ceil(((view.deadlineAt ?? view.serverNow) - view.serverNow) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const actor = playerName(view, view.botParticipantId ?? view.activeParticipantId);
  return <div className={'territory-phase' + (mine ? ' is-yours' : '')}>
    <div className="territory-phase-heading"><strong>{view.outcome ? (ru ? 'Итог' : 'Result') : mine ? (ru ? 'Ваш ход' : 'Your turn') : actor}</strong>
      <span>{view.turn === 0 ? (ru ? 'Расстановка' : 'Setup') : `${ru ? 'Круг' : 'Round'} ${view.round + 1}`}</span>
      {!view.outcome && <time className="territory-clock" aria-label={(ru ? 'На действие осталось ' : 'Time left ') + clock}>{clock}</time>}
    </div>
    <p>{phaseText(view, lang)}</p>
    <small>{view.botActionAt && !view.outcome ? `${actor} ${ru ? 'обдумывает действие' : 'is considering a move'}`
      : view.legal.end ? (ru ? 'Можно завершить ход' : 'You can end your turn')
        : view.phase === 'finished' ? (ru ? 'Карта и журналы доступны' : 'The map and journals remain available')
          : !mine && !view.you.discard ? (ru ? 'Ход другого игрока' : 'Another player is taking their turn')
          : (ru ? 'Сначала выполните обязательный шаг' : 'Complete the required step first')}
      <span>{ru ? 'Цель: ' : 'Goal: '}{view.goal}</span></small>
  </div>;
}

export function TerritorialRoll({ view, lang, onSelect }: { view: TerritoryView; lang: Language; onSelect: (value: BoardSelection) => void }) {
  const [details, setDetails] = useState(false);
  const ru = lang === 'ru', roll = view.latestRoll;
  const dice = roll?.dice ?? view.lastRoll;
  const income = roll?.production.find(item => item.ownerId === view.you.participantId);
  const sum = dice ? dice[0] + dice[1] : null;
  return <section className={'territory-roll' + (sum === 7 ? ' is-seven' : '')} aria-label={ru ? 'Последний бросок' : 'Latest roll'}>
    <div className="territory-dice" aria-label={dice ? `${dice[0]} + ${dice[1]} = ${sum}` : ru ? 'Кубики ещё не брошены' : 'No roll yet'}>
      {dice ? <><DieFace value={dice[0]}/><DieFace value={dice[1]}/><strong className="territory-dice-total">{sum}</strong></>
        : <><span className="territory-die-empty">?</span><span className="territory-die-empty">?</span></>}
    </div>
    <div className="territory-roll-copy">
      <strong>{roll ? playerName(view, roll.actorId) : ru ? 'Последний бросок' : 'Latest roll'}</strong>
      <small>{roll ? `${ru ? 'Круг' : 'Round'} ${roll.round + 1} · ${ru ? 'ход' : 'turn'} ${roll.turn}`
        : dice ? (ru ? 'Автор прежнего броска не сохранён' : 'Earlier roll author was not recorded') : (ru ? 'Доход придёт после броска' : 'Production follows the roll')}</small>
      {roll && <span className="territory-roll-income">{sum === 7 ? (ru ? 'Семёрка: дохода нет' : 'Seven: no production') : income ? <>
        {ru ? 'Вам: ' : 'You: '}<ResourceStock stock={income.resources} lang={lang}/></> : (ru ? 'Вам: +0 ресурсов' : 'You: +0 resources')}</span>}
    </div>
    {roll && <button type="button" className="territory-roll-details" onClick={() => setDetails(true)}>{ru ? 'Раздача' : 'Production'}<small>{roll.triggeredTileIds.length} {ru ? 'клеток' : 'tiles'}</small></button>}
    {details && roll && <Modal title={ru ? 'Бросок и раздача' : 'Roll and production'} onClose={() => setDetails(false)}>
      <div className="territory-roll-report">
        <div className="territory-dice"><DieFace value={roll.dice[0]}/><DieFace value={roll.dice[1]}/><strong>{roll.sum}</strong></div>
        <p>{playerName(view, roll.actorId)} · {ru ? 'Круг' : 'Round'} {roll.round + 1} · {ru ? 'Ход' : 'Turn'} {roll.turn}</p>
        <h4>{ru ? 'Совпавшие клетки' : 'Matching tiles'}</h4>
        <div className="territory-chip-list">{roll.triggeredTileIds.map(id => <button type="button" key={id}
          onClick={() => { onSelect({ kind: 'tile', id }); setDetails(false); }}>{tileName(view, id, lang)}</button>)}</div>
        {!roll.triggeredTileIds.length && <p>{ru ? 'Нет совпавших клеток.' : 'No matching tiles.'}</p>}
        <h4>{ru ? 'Полученные ресурсы' : 'Resources received'}</h4>
        {roll.production.length ? roll.production.map(row => <div className="territory-income-row" key={row.ownerId}>
          <strong>{playerName(view, row.ownerId)}</strong><ResourceStock stock={row.resources} lang={lang}/></div>)
          : <p>{roll.sum === 7 ? (ru ? 'Семёрка не производит ресурсы.' : 'A seven produces no resources.') : (ru ? 'Никто не получил ресурсов.' : 'No resources were distributed.')}</p>}
        {roll.blocked.length > 0 && <><h4>{ru ? 'Почему дохода не было' : 'Why production was blocked'}</h4>
          {roll.blocked.map((row, index) => <p key={index}>{tileName(view, row.tileId, lang)}: {row.reason === 'blockade'
            ? blockadeText(row.blockade ?? view.blockade, view, lang)
            : (view.news.find(news => news.eventInstanceId === row.eventInstanceId && 'changes' in news)?.headline[lang] ?? (ru ? 'Действует районная новость' : 'An active district news effect'))}</p>)}</>}
      </div>
    </Modal>}
  </section>;
}

const actions: Record<TerritoryHistoryEntry['kind'], [string, string]> = {
  place: ['Поставлен стартовый дом', 'Starting home placed'], settle: ['Построен дом', 'Home built'],
  upgrade: ['Дом улучшен', 'Home upgraded'], protect: ['Дом защищён', 'Home protected'], route: ['Путь построен', 'Route built'],
  roll: ['Бросок', 'Roll'], end: ['Ход завершён', 'Turn ended'], 'buy-card': ['Карта куплена', 'Card bought'],
  leave: ['Место передано боту', 'Seat handed to a bot'], discard: ['Ресурсы возвращены', 'Resources returned'],
  block: ['Блокада перенесена', 'Blockade moved'], bank: ['Обмен с банком исполнен', 'Bank exchange completed'],
  offer: ['Предложен обмен', 'Trade offered'], accept: ['Обмен исполнен', 'Trade completed'],
  decline: ['Обмен отклонён', 'Trade declined'], cancel: ['Предложение отозвано', 'Offer withdrawn'],
  'play-card': ['Карта сыграна', 'Card played'], distribution: ['Ресурсы выданы', 'Resources distributed'],
  'offer-closed': ['Предложение закрыто', 'Offer closed'], win: ['Партия завершена', 'Match complete'],
};
const closed = {
  accepted: ['Согласие: обмен исполнен', 'Accepted: trade completed'], declined: ['Отклонено', 'Declined'],
  withdrawn: ['Отозвано', 'Withdrawn'], expired: ['Ход закончился', 'Turn ended'], replaced: ['Заменено новыми условиями', 'Replaced by new terms'],
  'player-left': ['Участник вышел', 'Player left'], 'match-finished': ['Партия закончилась', 'Match ended'],
};
const cardNames = { patrol: ['Патруль','Patrol'], survey: ['Подряд','Survey'], supply: ['Снабжение','Supply'], charter: ['Грамота','Charter'] };
export function historyTitle(entry: TerritoryHistoryEntry, view: TerritoryView, lang: Language) {
  const i = lang === 'ru' ? 0 : 1;
  let title = actions[entry.kind][i];
  if (entry.dice) title += ` ${entry.dice[0]} + ${entry.dice[1]} = ${entry.sum}`;
  if (entry.nodeId) title += ` · ${lang === 'ru' ? 'участок' : 'site'} ${view.map.nodes.findIndex(node => node.id === entry.nodeId) + 1}`;
  if (entry.edgeId) title += ` · ${lang === 'ru' ? 'ребро' : 'edge'} ${view.map.edges.findIndex(edge => edge.id === entry.edgeId) + 1}`;
  if (entry.tileId) title += ' · ' + tileName(view, entry.tileId, lang);
  if (entry.cardKind) title += ' · ' + cardNames[entry.cardKind][i];
  if (entry.kind === 'block' && entry.reason) title += ' · ' + (entry.reason === 'patrol' ? cardNames.patrol[i] : lang === 'ru' ? 'семёрка' : 'seven');
  if (entry.reason === 'consent') return lang === 'ru' ? 'Согласие на обмен · ждёт выбора' : 'Trade consent · awaiting selection';
  if (entry.offerStatus) title += ' · ' + closed[entry.offerStatus][i];
  if (entry.targetId) title += ' · ' + playerName(view, entry.targetId);
  return title;
}
export function historySelection(entry: TerritoryHistoryEntry): BoardSelection | null {
  return entry.nodeId ? { kind:'node', id:entry.nodeId } : entry.edgeId ? { kind:'edge', id:entry.edgeId } : entry.tileId ? { kind:'tile', id:entry.tileId } : null;
}
function HistoryAmounts({ entry, lang }: { entry: TerritoryHistoryEntry; lang: Language }) {
  const ru = lang === 'ru';
  return <>
    {entry.paid && Object.values(entry.paid).some(Boolean) && <span>{ru ? 'Списано: ' : 'Paid: '}<ResourceStock stock={entry.paid} lang={lang}/></span>}
    {entry.received && Object.values(entry.received).some(Boolean) && <span>{ru ? 'Получено: ' : 'Received: '}<ResourceStock stock={entry.received} lang={lang}/></span>}
    {entry.resources && Object.values(entry.resources).some(Boolean) && <ResourceStock stock={entry.resources} lang={lang}/>}
    {entry.count !== undefined && <span>{entry.count} {ru ? 'рес.' : 'resources'}</span>}
  </>;
}
export function TerritorialHistory({ view, lang, onSelect }: { view: TerritoryView; lang: Language; onSelect: (value: BoardSelection) => void }) {
  const [filter, setFilter] = useState('all');
  const ru = lang === 'ru';
  const categories = [
    ['all', 'Все', 'All'], ['roll', 'Броски', 'Rolls'], ['build', 'Стройка', 'Building'], ['trade', 'Обмен', 'Trading'], ['block', 'Блокада', 'Blockade'], ['cards', 'Карты', 'Cards'],
  ];
  const filterKind = (entry: TerritoryHistoryEntry) => filter === 'all' || (filter === 'roll' && ['roll','distribution'].includes(entry.kind))
    || (filter === 'build' && ['place','settle','route','upgrade','protect'].includes(entry.kind))
    || (filter === 'trade' && ['offer','accept','decline','cancel','offer-closed','bank'].includes(entry.kind))
    || (filter === 'block' && ['block','discard'].includes(entry.kind)) || (filter === 'cards' && ['play-card','buy-card'].includes(entry.kind));
  const entries = [...(view.history ?? [])].reverse().filter(filterKind);
  return <section className="territory-history" aria-label={ru ? 'История ходов' : 'Turn history'}>
    <div className="territory-history-filters" role="group" aria-label={ru ? 'События' : 'Events'}>{categories.map(([id, a, b]) =>
      <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{ru ? a : b}</button>)}</div>
    {view.historyComplete === false && <p className="territory-history-note">{ru ? 'Ранние ходы этой партии не сохранились в журнале.' : 'The early turns of this match were not recorded in the journal.'}</p>}
    <ol>{entries.map(entry => {
      const target = historySelection(entry);
      return <li key={entry.id}><div className="territory-history-meta"><b>{playerName(view, entry.actorId)}</b><span>{entry.turn === 0 ? (ru ? 'Расстановка' : 'Setup') : `${ru ? 'Круг' : 'Round'} ${entry.round + 1}`}</span>
        {entry.source === 'bot' && <span>{ru ? 'Бот' : 'Bot'}</span>}{entry.source === 'timeout' && <span>{ru ? 'По таймеру' : 'Timer action'}</span>}</div>
        <strong>{historyTitle(entry, view, lang)}</strong><div className="territory-history-amounts"><HistoryAmounts entry={entry} lang={lang}/></div>
        {entry.production?.map(row => <div className="territory-income-row" key={row.ownerId}><span>{playerName(view,row.ownerId)}</span><ResourceStock stock={row.resources} lang={lang}/></div>)}
        {entry.blocked?.map((row, index) => <p key={index}>{tileName(view,row.tileId,lang)}: {row.reason === 'blockade' ? blockadeText(row.blockade,view,lang) :
          view.news.find(news => news.eventInstanceId === row.eventInstanceId && 'changes' in news)?.headline[lang] ?? (ru ? 'Остановка по новости' : 'Stopped by a news effect')}</p>)}
        {target && <button type="button" className="text-button" onClick={() => onSelect(target)}>{ru ? 'Показать место' : 'Show place'}</button>}
      </li>;
    })}</ol>
    {!entries.length && <p>{ru ? 'Здесь появятся действия игроков.' : 'Player actions will appear here.'}</p>}
  </section>;
}

export function TerritorialResult({ view, lang }: { view: TerritoryView; lang: Language }) {
  const ru = lang === 'ru';
  const winners = view.players.filter(player => view.outcome?.winnerParticipantIds.includes(player.participantId));
  return <section className="territory-outcome" role="status">
    <small>{view.outcome?.reason === 'abandoned' ? (ru ? 'Партия закрыта' : 'Match closed') : winners.length > 1 ? (ru ? 'Совместная победа' : 'Joint victory') : (ru ? 'Победитель' : 'Winner')}</small>
    <h3>{winners.map(player => player.displayName).join(', ')}</h3>
    <div className="territory-result-table"><table><caption>{ru ? 'Откуда взялись очки' : 'Score breakdown'}</caption>
      <thead><tr><th>{ru ? 'Игрок' : 'Player'}</th><th>{ru ? 'Дома' : 'Homes'}</th><th>{ru ? 'Путь' : 'Route'}</th><th>{ru ? 'Патруль' : 'Patrol'}</th><th>{ru ? 'Грамоты' : 'Charters'}</th><th>{ru ? 'Всего' : 'Total'}</th></tr></thead>
      <tbody>{[...view.players].sort((a,b) => b.points - a.points).map(player => {
        const homes = Object.values(view.buildings).reduce((sum, building) => sum + (building.ownerId === player.participantId ? building.level : 0), 0);
        const route = view.routeHolder === player.participantId ? 2 : 0;
        const patrol = view.patrolHolder === player.participantId ? 2 : 0;
        return <tr key={player.participantId}><th>{player.displayName}</th><td>{homes}</td><td>{route}</td><td>{patrol}</td><td>{player.points - homes - route - patrol}</td><td><strong>{player.points}</strong></td></tr>;
      })}</tbody>
    </table></div>
    <p>{ru ? 'Карта, история ходов и новости остаются доступны.' : 'Keep exploring the map, turn history and news.'}</p>
  </section>;
}

import type { RejectionCode } from '../core';
import type { OnlineErrorCode } from '../online/protocol';
import type { Locale, Translate } from './catalog';

const ru = {
  play: 'Играть по сети', title: 'Партия с другом', mode: 'По сети',
  intro: 'Создайте комнату и отправьте другу приглашение. Партия начнётся, когда оба нажмут «Готов играть».',
  name: 'Имя в игре', side: 'Цвет фигур', random: 'Случайный', create: 'Создать комнату', join: 'Присоединиться',
  joining: 'Вас пригласили сыграть в REMORSE. Укажите имя для этой партии.',
  resume: 'Вернуться в комнату', working: 'Подключаем…', invite: 'Приглашение',
  share: 'Отправьте ссылку другу: по ней он займёт второе место.', copy: 'Скопировать ссылку', copied: 'Ссылка скопирована',
  selectCopy: 'Ссылка выделена. Скопируйте её.', newInvite: 'Создать новую ссылку',
  waiting: 'Ждём второго игрока', preparing: 'Подготовка к партии', ready: 'Готов играть', unready: 'Отменить готовность',
  readyLabel: 'Готов', notReady: 'Не готов', emptySeat: 'Свободное место', you: 'вы',
  connected: 'На связи', connecting: 'Подключаемся…', reconnecting: 'Восстанавливаем связь…',
  opponentOffline: 'Соперник отключился. Партия продолжится после его возвращения.',
  waitingOffline: 'Второй игрок отключился. Его место сохранено.',
  finishedOffline: 'Соперник отключился. Новую партию можно начать после его возвращения.',
  seatOffline: 'Нет связи',
  reconnect: 'Подключиться снова', replaced: 'Комната открыта в другой вкладке.', takeover: 'Играть в этой вкладке',
  room: 'Комната', friendly: 'Дружеская партия · без часов и рейтинга',
  offerDraw: 'Предложить ничью', drawSent: 'Вы предложили ничью.', drawReceived: 'Соперник предлагает ничью.',
  accept: 'Принять', decline: 'Отклонить', rematch: 'Сыграть ещё раз', rematchSent: 'Ждём согласия на новую партию. Цвета поменяются.',
  rematchReceived: 'Соперник предлагает новую партию со сменой цвета.', cancelRematch: 'Отменить запрос',
  expired: 'Комната закрыта: в ней давно не играли. Победа и поражение не начислены.',
  yourTurn: 'Ваш ход', opponentTurn: 'Ход соперника', sending: 'Отправляем ход…', catchingUp: 'Показываем последние ходы…',
  noServer: 'Сервер недоступен. Проверьте соединение и попробуйте снова.',
} as const;

const en: Record<keyof typeof ru, string> = {
  play: 'Play online', title: 'Play a friend', mode: 'Online',
  intro: 'Create a room and send your friend an invitation. The game starts when you both choose “Ready to play”.',
  name: 'Name in game', side: 'Piece colour', random: 'Random', create: 'Create room', join: 'Join game',
  joining: 'You have been invited to play REMORSE. Choose a name for this game.',
  resume: 'Return to room', working: 'Connecting…', invite: 'Invitation',
  share: 'Send this link to your friend. They can use it to take the second seat.', copy: 'Copy link', copied: 'Link copied',
  selectCopy: 'Link selected. Copy it to share.', newInvite: 'Create a new link',
  waiting: 'Waiting for a second player', preparing: 'Getting ready', ready: 'Ready to play', unready: 'Cancel ready',
  readyLabel: 'Ready', notReady: 'Not ready', emptySeat: 'Open seat', you: 'you',
  connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…',
  opponentOffline: 'Your opponent disconnected. Play resumes when they return.',
  waitingOffline: 'The second player disconnected. Their seat is reserved.',
  finishedOffline: 'Your opponent disconnected. You can start another game when they return.',
  seatOffline: 'Offline',
  reconnect: 'Reconnect', replaced: 'This room is open in another tab.', takeover: 'Play in this tab',
  room: 'Room', friendly: 'Friendly game · no clock or rating',
  offerDraw: 'Offer a draw', drawSent: 'You offered a draw.', drawReceived: 'Your opponent offers a draw.',
  accept: 'Accept', decline: 'Decline', rematch: 'Play again', rematchSent: 'Waiting for your opponent to play again. You will swap colours.',
  rematchReceived: 'Your opponent offers another game with colours swapped.', cancelRematch: 'Cancel request',
  expired: 'This room closed after a long period of inactivity. Neither player won or lost.',
  yourTurn: 'Your turn', opponentTurn: 'Opponent’s turn', sending: 'Sending move…', catchingUp: 'Showing the latest moves…',
  noServer: 'The server is unavailable. Check your connection and try again.',
};

export function onlineText(locale: Locale, key: keyof typeof ru): string { return (locale === 'ru' ? ru : en)[key]; }

const errors: Partial<Record<OnlineErrorCode, readonly [string, string]>> = {
  invalidMessage: ['Не удалось подтвердить действие. Обновите страницу.', 'The action could not be confirmed. Reload the page.'],
  invalidName: ['Ник должен содержать от 1 до 24 символов.', 'Use a name between 1 and 24 characters.'],
  protocolMismatch: ['Версия игры изменилась. Обновите страницу.', 'The game version has changed. Reload this page.'],
  guestRequired: ['Для входа в комнату разрешите cookies этого сайта.', 'Allow cookies for this site to enter the room.'],
  roomMissing: ['Комната не найдена или уже удалена.', 'This room was not found or has been deleted.'],
  roomFull: ['Оба места заняты. Попросите друга создать новую комнату.', 'Both seats are taken. Ask your friend to create a new room.'],
  sameGuest: ['Вы уже заняли место в этой комнате. Приглашение нужно открыть на устройстве друга.', 'You already have a seat in this room. Open the invitation on your friend’s device.'],
  inviteInvalid: ['Приглашение уже использовано или заменено. Попросите новую ссылку.', 'This invitation was used or replaced. Ask for a new link.'],
  notYourSeat: ['В этом браузере место в комнате не занято. Откройте приглашение друга.', 'This browser has no seat in the room. Open your friend’s invitation.'],
  replaced: [ru.replaced, en.replaced],
  notReady: ['Дождитесь готовности обоих игроков.', 'Wait until both players are ready.'],
  opponentOffline: [ru.opponentOffline, en.opponentOffline],
  staleRevision: ['Позиция обновилась. Проверьте её перед следующим ходом.', 'The position changed. Check it before your next move.'],
  commandConflict: ['Не удалось подтвердить этот ход. Обновите страницу, чтобы восстановить позицию.', 'This move could not be confirmed. Reload to restore the position.'],
  drawOfferMissing: ['Это предложение ничьей уже не действует.', 'That draw offer is no longer available.'],
  roomExpired: [ru.expired, en.expired],
  rateLimited: ['Слишком много действий подряд. Подождите немного.', 'Too many actions at once. Wait a moment.'],
  serverError: [ru.noServer, en.noServer],
};

export function onlineErrorText(locale: Locale, t: Translate, code: OnlineErrorCode): string {
  const text = errors[code];
  return text ? text[locale === 'ru' ? 0 : 1] : t(`error.${code as RejectionCode}`);
}

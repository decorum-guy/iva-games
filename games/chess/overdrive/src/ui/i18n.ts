import type { Ability, GameOutcome, PieceType, Side } from '../core'
export type Language = 'ru' | 'en'
export const tr = (language: Language, ru: string, en: string) => language === 'ru' ? ru : en
export const pieceName = (type: PieceType, language: Language) => ({
  pawn: ['Пешка', 'Pawn'], knight: ['Конь', 'Knight'], bishop: ['Слон', 'Bishop'],
  rook: ['Ладья', 'Rook'], queen: ['Ферзь', 'Queen'], king: ['Король', 'King'],
}[type][language === 'ru' ? 0 : 1])
export const sideName = (side: Side, language: Language) => side === 'white' ? tr(language, 'Белые', 'White') : tr(language, 'Синие', 'Blue')
export const abilityName = (ability: Ability, language: Language) => ({
  sweep: ['Подсечка', 'Sweep'], raid: ['Налёт', 'Raid'], battery: ['Батарея', 'Battery'],
  ram: ['Таран', 'Ram'], rotation: ['Ротация', 'Rotation'], cover: ['Под прикрытием', 'Covered retreat'],
}[ability][language === 'ru' ? 0 : 1])
export const abilityDescription = (ability: Ability, language: Language) => ({
  sweep: ['Перетяните врага с передней диагонали на свободную клетку перед пешкой. Пешка остаётся на месте.', 'Pull an enemy from a forward diagonal onto the empty square ahead. Your pawn stays put.'],
  raid: ['Прыгните на пустую клетку и возьмите одного врага на пролёте. Сначала выберите приземление, затем цель.', 'Land on an empty knight square and capture one enemy along the jump. Choose the landing, then the target.'],
  battery: ['Возьмите врага по диагонали через ровно одну фигуру. Заслон остаётся на месте.', 'Capture diagonally across exactly one intervening piece. The screen stays in place.'],
  ram: ['Сдвиньте первую фигуру по прямой на одну свободную клетку дальше. Ладья занимает её место. Взятия нет.', 'Push the first piece on a straight line one square into empty space. The rook takes its place. No capture.'],
  rotation: ['Поменяйте ферзя местами с первым союзником по его линии. Король не участвует.', 'Swap the queen with the first friendly piece on a queen line. The king cannot be swapped.'],
  cover: ['Король шагает на пустую соседнюю клетку. Соседний союзный офицер занимает его прежнее место.', 'Step the king onto an empty adjacent square. An adjacent friendly officer fills the king’s old square.'],
}[ability][language === 'ru' ? 0 : 1])
export const outcomeText = (outcome: GameOutcome, language: Language) => {
  if (outcome.winner) return `${sideName(outcome.winner, language)} ${tr(language, 'победили', 'win')}`
  return tr(language, 'Ничья', 'Draw')
}
export const outcomeReason = (reason: GameOutcome['reason'], language: Language) => ({
  checkmate: ['Мат', 'Checkmate'], resignation: ['Сдача', 'Resignation'], stalemate: ['Пат', 'Stalemate'],
  bareKings: ['На доске только короли', 'Only kings remain'], repetition: ['Повторение позиции', 'Repeated position'],
  fiftyMoves: ['Правило 50 ходов', '50-move rule'], seventyFiveMoves: ['Правило 75 ходов', '75-move rule'], agreement: ['По соглашению', 'By agreement'],
}[reason][language === 'ru' ? 0 : 1])

export const lessonText: Record<string, { ru: [string, string, string]; en: [string, string, string] }> = {
  capture: { ru: ['Зарядите атаку', 'За взятие — одно деление энергии. Возьмите отмеченную фигуру обычным ходом.', 'Взятие дало +1. Энергия общая для всей армии; максимум — две ячейки по пять.'], en: ['Charge your attack', 'A capture earns one energy. Capture the marked piece with a normal move.', 'The capture earned +1. Energy belongs to your whole army, up to two cells of five.'] },
  check: { ru: ['Шах даёт больше', 'Поставьте шах отмеченным ходом. Это приносит два деления.', 'Шах дал +2. Взятие с шахом может дать +3. Та же расстановка повторно энергию за шах не приносит.'], en: ['Check earns more', 'Give check with the marked move. It earns two energy.', 'Check earned +2. A capture with check may earn +3. The same checking layout cannot earn the check reward again.'] },
  sweep: { ru: ['Пешка меняет линию', 'В новой позиции уже есть пять энергии. Выберите пешку, включите «Импульс» и подтяните отмеченного врага.', 'Пешка осталась на месте. Чужая фигура жива, но больше не перекрывает прежнюю линию.'], en: ['A pawn opens a line', 'This new position has five energy. Select the pawn, choose Impulse and pull the marked enemy.', 'Your pawn stayed put. The enemy survived, but no longer blocks its former line.'] },
  raid: { ru: ['Взятие на пролёте', 'Включите импульс коня и выберите отмеченное приземление. Если целей несколько, выберите одну.', 'Конь взял фигуру на пролёте и приземлился на пустую клетку. Взятие вернуло одно деление энергии.'], en: ['Capture in flight', 'Use the knight’s Impulse and choose the marked landing. If several targets fit, choose one.', 'The knight captured the enemy along its jump and landed on an empty square. The capture earned one energy back.'] },
  battery: { ru: ['Один заслон помогает', 'Включите импульс слона и возьмите отмеченную цель через одну фигуру.', 'Для батареи нужен ровно один заслон. При пяти энергии или форме слон уже угрожает королю за заслоном.'], en: ['One screen helps', 'Use the bishop’s Impulse and capture the marked target across one piece.', 'Battery needs exactly one screen. With five energy or an active form, this extra attack already threatens the king.'] },
  ram: { ru: ['Освободите позицию', 'Включите импульс ладьи и толкните отмеченную фигуру на свободную клетку.', 'Таран не берёт фигуру. Можно толкать своих и чужих, кроме королей. Цепочку толкнуть нельзя.'], en: ['Displace the defence', 'Use the rook’s Impulse and push the marked piece into the empty square beyond.', 'Ram does not capture. It can push a friendly or enemy piece, except a king. It cannot push a chain.'] },
  rotation: { ru: ['Передайте сильную клетку', 'Включите импульс ферзя и выберите отмеченного союзника для обмена.', 'Обе фигуры переместились одним ходом. Между ними не должно быть препятствий.'], en: ['Hand over a strong square', 'Use the queen’s Impulse and choose the marked friendly piece to swap.', 'Both pieces moved in one turn. There must be no piece between them.'] },
  cover: { ru: ['Отход с прикрытием', 'Король под шахом. Включите импульс и выберите отмеченную клетку. При нескольких вариантах выберите офицера.', 'Офицер закрыл короля в том же действии. Проверяется безопасность всей конечной позиции.'], en: ['Retreat under cover', 'Your king is in check. Use Impulse and choose the marked destination. If there are several guards, choose one.', 'The officer shielded the king in the same action. The complete final position must be safe.'] },
  form: { ru: ['Три своих хода', 'У белых 10 энергии. Выберите коня c3, включите «Форсаж» и нажмите e4. Выберите «Налёт», чтобы взять ладью на d4.', 'Активация — первый из трёх своих ходов. Осталось два. Приём этой фигуры бесплатен, но каждый раз занимает ход. Если ходить другой фигурой, срок тоже сокращается.'], en: ['Three of your turns', 'White has 10 energy. Select the knight on c3, choose Overdrive and select e4. Choose Raid to capture the rook on d4.', 'Activation used the first of three turns. Two remain. This piece’s ability is free, but still takes a turn. Moving another piece also uses one turn of the form.'] },
}

export function onlineErrorText(code: string, language: Language) {
  const messages: Record<string, [string,string]> = {
    serverError: ['Сервер недоступен. Проверьте соединение и повторите.', 'The server is unavailable. Check your connection and retry.'],
    roomFull: ['Оба места уже заняты.', 'Both seats are occupied.'], roomMissing: ['Комната не найдена.', 'Room not found.'],
    inviteInvalid: ['Приглашение недействительно. Попросите новую ссылку.', 'This invitation is invalid. Ask for a new link.'],
    sameGuest: ['Вы уже в этой комнате. Для второго игрока нужен другой браузер или устройство.', 'You already have a seat. The second player needs another browser or device.'],
    staleRevision: ['Позиция обновилась. Выберите ход заново.', 'The position changed. Choose your move again.'],
    opponentOffline: ['Соперник отключился. Ждём возвращения.', 'Your opponent disconnected. Waiting for them to return.'],
    notReady: ['Оба игрока должны подтвердить готовность.', 'Both players must confirm they are ready.'],
    replaced: ['Эта партия открыта в другой вкладке. Верните управление здесь, если нужно.', 'This game is open in another tab. Reconnect here to take control.'],
    roomExpired: ['Срок комнаты истёк. Создайте новую.', 'This room expired. Create a new room.'],
    guestRequired: ['Сессия закончилась. Откройте приглашение ещё раз.', 'Your session ended. Open the invitation again.'],
    rateLimited: ['Слишком много запросов. Повторите чуть позже.', 'Too many requests. Try again shortly.'],
    invalidName: ['Введите имя от 1 до 24 символов.', 'Enter a name of 1 to 24 characters.'],
  }
  return (messages[code] ?? [ 'Не удалось выполнить действие. Обновите соединение.', 'The action could not be completed. Reconnect and retry.' ])[language === 'ru' ? 0 : 1]
}

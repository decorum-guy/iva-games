import type { QuickLessonId } from '../tutorial/quickTeaching'
import type { Language } from './i18n'

export const quickLessonText: Record<QuickLessonId, Record<Language, readonly [string, string, string]>> = {
  pawn: {
    ru: ['Пешка ходит прямо', 'С e2 пешка может пойти на одну или две свободные клетки. Нажмите e4.', 'Две клетки доступны только первым ходом этой пешки.'],
    en: ['Pawns move straight', 'From e2 the pawn can move one or two clear squares. Choose e4.', 'Two squares are available only on this pawn’s first move.'],
  },
  'pawn-capture': {
    ru: ['Пешка берёт наискось', 'Возьмите синюю пешку на соседней диагонали f5.', 'Пешка взята. За взятие пешки вы получили 1 энергию.'],
    en: ['Pawns capture diagonally', 'Capture the blue pawn one square diagonally ahead, on f5.', 'The capture earned 1 energy.'],
  },
  knight: {
    ru: ['Конь — через фигуры', 'Две клетки и одна вбок. Перепрыгните на e4.', 'Конь перепрыгивает через своих и чужих.'],
    en: ['Knight — over pieces', 'Two squares, then one sideways. Jump to e4.', 'Knights jump over either colour.'],
  },
  bishop: {
    ru: ['Слон — по диагонали', 'Пешка на b2 закрывает одну диагональ. По свободной диагонали сходите на f4.', 'Обычным ходом слон не перепрыгивает фигуры и остаётся на клетках одного цвета.'],
    en: ['Bishop — diagonally', 'The pawn on b2 blocks one diagonal. Follow the open diagonal to f4.', 'An ordinary bishop move cannot jump pieces and stays on the same square colour.'],
  },
  rook: {
    ru: ['Ладья — по прямой', 'По вертикали или горизонтали. Возьмите коня на d6.', 'Конь взят: +2 энергии. Новый шах тоже даёт +2.'],
    en: ['Rook — straight lines', 'Along a rank or file. Capture the knight on d6.', 'Knight captured: +2 energy. A fresh check also gives +2.'],
  },
  queen: {
    ru: ['Ферзь — прямо и наискось', 'Ладья и слон в одной фигуре. Перейдите на g6.', 'Ферзь ходит далеко, если путь свободен.'],
    en: ['Queen — straight or diagonal', 'Rook and bishop in one piece. Move to g6.', 'A queen can travel far along an open line.'],
  },
  king: {
    ru: ['Король — на одну клетку', 'На d2 бьёт синяя ладья. Перейдите на безопасную b2.', 'Король ходит на соседнюю клетку в любом направлении, если она вне удара.'],
    en: ['King — one square', 'The blue rook attacks d2. Move to the safe square b2.', 'The king can step one square in any direction if it is safe.'],
  },
  impulse: {
    ru: ['Одна банка — один приём', 'В этом упражнении банка заряжена. Выберите «Импульс».', 'Таран сдвинул коня. Потрачено 3: приём был разовым.'],
    en: ['One bank — one ability', 'This exercise starts charged. Choose Impulse.', 'Ram pushed the knight. It cost 3: a one-time ability.'],
  },
  'battery-check': {
    ru: ['Шах через одну фигуру', 'У синих полная банка. Слон b4 уже даёт шах через коня c3. Поставьте своего слона на d2 и закройте диагональ второй фигурой.', 'Шах снят. Две фигуры закрыли диагональ. Заряд синих не потратился: угроза действует, пока доступен импульс или у слона активен форсаж.'],
    en: ['Check through one piece', 'Blue has a full bank. The bishop on b4 is checking through the knight on c3. Move your bishop to d2 to put a second piece in the way.', 'Check cleared. Two pieces block the line. Blue keeps its energy: the threat is live while Impulse is available or the bishop is in Overdrive.'],
  },
  'ram-edge': {
    ru: ['Таран у края доски', 'Включите «Импульс» и попробуйте толкнуть пешку на h4.', 'За пешкой край доски. Таран невозможен: ладья, пешка и заряд остались на месте.'],
    en: ['Ram at the board edge', 'Choose Impulse and try to push the pawn on h4.', 'There is no square behind the pawn. Ram is blocked: both pieces stay put and no energy is spent.'],
  },
  'ram-chain': {
    ru: ['Таран по цепочке', 'За пешкой c5 стоит конь, а c7 свободна. Выберите «Импульс» и нажмите на пешку.', 'Пешка и конь сдвинулись на клетку, ладья заняла c5. За всей цепочкой должна быть свободная клетка. Королей таранить нельзя.'],
    en: ['Ram a line of pieces', 'The pawn on c5 has a knight behind it and c7 is empty. Choose Impulse and select the pawn.', 'Both pieces shifted one square and the rook took c5. A chain needs an empty square behind it. Kings cannot be pushed.'],
  },
  activate: {
    ru: ['Две банки — форсаж', 'Обе банки полны. Выберите «Форсаж» и выполните таран на c5. В партии можно начать форсаж и обычным ходом.', 'Потрачено 6. Таран стал первым из трёх своих ходов в форсаже.'],
    en: ['Two banks — Overdrive', 'Both banks are full. Choose Overdrive and Ram on c5. In a game, a normal move can also start Overdrive.', '6 spent. Ram used the first of your three turns in Overdrive.'],
  },
  free: {
    ru: ['Приём теперь бесплатный', 'У ладьи ещё два своих хода. Выберите «Приём · 0».', 'Ещё один таран, без оплаты. Остался один свой ход.'],
    en: ['The ability is now free', 'The rook has two own turns left. Choose Ability · 0.', 'Another Ram, at no cost. One own turn remains.'],
  },
  expire: {
    ru: ['Срок идёт и у другой фигуры', 'Теперь сходите пешкой на a3. Счётчик ладьи уменьшится.', 'Форсаж закончился: даже ход пешки израсходовал последний ход.'],
    en: ['Other pieces use the timer too', 'Now move the pawn to a3. The rook’s counter will tick.', 'Overdrive ended: even the pawn move used its last turn.'],
  },
}

import type { QuickLessonId } from '../core/quickTeaching'
import type { Language } from './i18n'

export const quickLessonText: Record<QuickLessonId, Record<Language, readonly [string, string, string]>> = {
  pawn: {
    ru: ['Пешка — вперёд', 'Первый ход: можно сразу на две клетки. Нажмите e4.', 'Пешка бьёт наискось, а ходит вперёд.'],
    en: ['Pawn — forward', 'On its first move it can go two squares. Tap e4.', 'Pawns capture diagonally and move forward.'],
  },
  knight: {
    ru: ['Конь — через фигуры', 'Две клетки и одна вбок. Перепрыгните на e4.', 'Конь перепрыгивает через своих и чужих.'],
    en: ['Knight — over pieces', 'Two squares, then one sideways. Jump to e4.', 'Knights jump over either colour.'],
  },
  bishop: {
    ru: ['Слон — по диагонали', 'По свободной диагонали — до f4.', 'Слон всегда остаётся на своём цвете клеток.'],
    en: ['Bishop — diagonally', 'Follow the open diagonal to f4.', 'A bishop always stays on the same square colour.'],
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
    ru: ['Король — на одну клетку', 'В любую сторону, но не под удар. Перейдите на d2.', 'Короля нужно защищать. Цель партии — мат.'],
    en: ['King — one square', 'Any direction, but never into attack. Move to d2.', 'Protect your king. Checkmate is the goal.'],
  },
  impulse: {
    ru: ['Одна банка — один приём', 'В этом упражнении банка заряжена. Выберите «Импульс».', 'Таран сдвинул коня. Потрачено 3: приём был разовым.'],
    en: ['One bank — one ability', 'This exercise starts charged. Choose Impulse.', 'Ram pushed the knight. It cost 3: a one-time ability.'],
  },
  activate: {
    ru: ['Две банки — форсаж', 'Новая позиция: обе банки полны. Выберите «Форсаж».', 'Потрачено 6. Первый из трёх своих ходов уже использован.'],
    en: ['Two banks — Overdrive', 'New position: both banks are full. Choose Overdrive.', '6 spent. The first of your three turns is already used.'],
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

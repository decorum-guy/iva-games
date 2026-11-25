import type { Locale } from '../i18n/catalog';
import type { Variant } from './audio';
import type { Group } from './demos';

export const groupNames = {
  'reaction.guilt': ['Вина', 'Guilt'],
  'reaction.devastated': ['Опустошение', 'Devastation'],
  'reaction.berserk': ['Ярость', 'Berserk'],
  'reaction.bloodlust': ['Жажда крови', 'Bloodlust'],
  'promotion.formation': ['Слон / конь', 'Bishop / knight'],
  'promotion.rook': ['Ладья', 'Rook'],
  'promotion.queen': ['Ферзь', 'Queen'],
} as const satisfies Record<Group, readonly [string, string]>;

export const words = {
  title: ['Сравнение звуков', 'Compare sounds'],
  scene: ['Игровая сцена', 'Game scene'],
  demo: ['Демонстрационная позиция', 'Demo position'],
  sound: ['Вариант звука', 'Sound variant'],
  current: ['Текущий', 'Current'],
  full: ['Вся сцена', 'Full scene'],
  solo: ['Только звук раскола', 'Fracture sound only'],
  queenLayers: ['Слои звука ферзя', 'Queen sound layers'],
  play: ['Проиграть', 'Play'],
  replay: ['Повторить', 'Replay'],
  stop: ['Стоп', 'Stop'],
  volume: ['Громкость', 'Volume'],
  motion: ['Меньше движения', 'Reduced motion'],
  minor: ['Фигура превращения', 'Promotion piece'],
  bishop: ['Слон', 'Bishop'],
  knight: ['Конь', 'Knight'],
  ready: ['К прослушиванию', 'Ready to play'],
  loading: ['Готовим доску и записи…', 'Loading the board and recordings…'],
  starting: ['Запускаем звук…', 'Starting audio…'],
  playing: ['Воспроизводится', 'Playing'],
  done: ['Прослушивание завершено', 'Playback finished'],
  failed: ['Записи не загрузились. Повторите загрузку.', 'Recordings could not load. Try loading again.'],
  blocked: ['Звук не запустился. Нажмите «Проиграть» ещё раз.', 'Audio did not start. Press Play again.'],
  graphics: ['3D-доска недоступна. Повторите загрузку.', 'The 3D board is unavailable. Try loading again.'],
  retry: ['Повторить загрузку', 'Try loading again'],
  choose: ['Выбрать звук', 'Choose this sound'],
  chosen: ['В списке выбора', 'In your selections'],
  details: ['О записи', 'Recording details'],
  picks: ['Ваш выбор', 'Your selections'],
  copy: ['Копировать выбор', 'Copy selections'],
  copied: ['Выбор скопирован', 'Selections copied'],
  close: ['Закрыть', 'Close'],
  send: ['Отправьте этот список для установки звуков.', 'Send this list to install your selections.'],
  pending: ['Ещё не выбран', 'Undecided'],
  manualCopy: ['Скопируйте выделенный текст вручную.', 'Copy the selected text manually.'],
  shortChant: ['R2 · игровой монтаж 1,54 с', 'R2 · 1.54 s game edit'],
  rawChant: ['Исходное заклинание · 6 с', 'Original chant · 6 s'],
  source: ['Источники и лицензии', 'Sources and licenses'],
  cut: ['Игровой отрезок', 'Game excerpt'],
  level: ['Уровень клипа', 'Clip gain'],
  fades: ['Вход / затухание', 'Fade in / out'],
  offset: ['Старт от хода', 'Start after move'],
  input: ['Исходная запись', 'Source file'],
  stockDetails: ['Штатные звуки из текущей игры. Начала и уровни совпадают с игровыми cue.',
    'The game’s current sounds, with the same cue times and gains.'],
  secondUnit: ['с', 's'],
  fracture: ['Раскол', 'Fracture'],
  stoneInMix: ['каменный слой в миксе', 'stone layer in the mix'],
  decibels: ['дБ', 'dB'],
} as const;

export function variantName(variant: Variant, locale: Locale, group: Group, forChoice = false) {
  if (variant === 'current' || variant === 'CURRENT-STONE-SOLO' && !forChoice) return words.current[locale === 'ru' ? 0 : 1];
  if (forChoice && group === 'reaction.bloodlust' && variant === 'R2') return 'R2-BLOODLUST-SHORT';
  return variant;
}

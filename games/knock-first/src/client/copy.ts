import type { Difficulty, Locale, PlayerView, PublicBattery, RouteId } from '../core/types';
export const copy = (lang: Locale, ru: string, en: string): string => lang === 'ru' ? ru : en;
export function formatMissionTime(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.ceil(Math.max(0, seconds)) : 0;
  return `${Math.floor(whole / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}
export const KNOCK_ACTION_COPY: Record<PlayerView['knockKind'], [string, string]> = {
  resonator: ['Ударить по трубе', 'Strike the pipe'], knock: ['Постучать', 'Knock'],
  click: ['Щелчок', 'Click'], call: ['Позвать', 'Call'],
};
export const CARRY_FEEDBACK: Record<NonNullable<PublicBattery['obstruction']>, [string, string]> = {
  opposed: ['В одну сторону', 'Move in the same direction'],
  angle: ['Двигайтесь вместе', 'Move together'],
  blocked: ['Не проходит угол', 'Cargo is blocked'],
};
export const ROUTE_COPY: Record<RouteId, { name: [string, string]; note: [string, string]; detail: [string, string] }> = {
  archive: { name: ['Затопленный архив', 'Flooded Archive'], note: ['Тихие полки · мокрая галерея', 'Quiet shelves · wet gallery'], detail: ['Два пути к батареям. Вода выдаёт каждый шаг.', 'Two paths to the batteries. Water gives away every step.'] },
  pump: { name: ['Насосный узел', 'Pump Station'], note: ['Верхние площадки · запасной выход', 'Upper landings · alternate exit'], detail: ['Поднимитесь над насосами. Откройте короткий путь домой.', 'Climb above the pumps. Open a shorter route home.'] },
  relay: { name: ['Релейное крыло', 'Relay Wing'], note: ['Смотровой помост · звуковой канал', 'Observation deck · sound duct'], detail: ['Разведите пути шума и груза. Следите за вентиляцией.', 'Separate sound from cargo. Watch the ventilation.'] },
};
export const DIFFICULTY_COPY: Record<Difficulty, [string, string]> = { calm: ['Спокойно', 'Calm'], normal: ['Обычная', 'Normal'], tense: ['Напряжённо', 'Tense'] };
export const BOT_NAMES = ['Кедр', 'Сова', 'Маяк', 'Лён', 'Север'];
export const BOT_NAMES_EN = ['Cedar', 'Owl', 'Beacon', 'Linen', 'North'];
export const label = (tuple: readonly [string, string], lang: Locale): string => tuple[lang === 'ru' ? 0 : 1];
const notices: Record<string, [string, string]> = {
  NETWORK: ['Нет связи. Возвращаемся в вылазку…', 'Connection lost. Returning to the mission…'],
  BUSY: ['Дождитесь действия', 'Wait for the action'],
  STALE_CONTROLLER: ['Управление в другом окне', 'Control is in another window'],
  STALE_REVISION: ['Ситуация изменилась. Попробуйте ещё раз', 'Something changed. Try again'],
  INVALID_INPUT: ['Проверьте управление', 'Check your controls'],
  OUT_OF_RANGE: ['Подойдите ближе', 'Move closer'],
  TOO_FAR: ['Подойдите ближе', 'Move closer'],
  COOLDOWN: ['Дайте эху затихнуть', 'Let the echo fade'],
  HANDS_BUSY: ['Руки заняты. Можно позвать напарника', 'Hands full. You can call your partner'],
  NOT_VISIBLE: ['Нужна прямая видимость', 'You need a clear view'],
  BLOCKED: ['Проём занят', 'The doorway is blocked'],
  DOOR_BLOCKED: ['Проём занят. Закрытие отменено', 'Doorway occupied. Closing cancelled'],
  OPPOSING: ['В одну сторону', 'Move in the same direction'],
  NO_TIMER: ['Возьмите таймер у шкафа в лифте', 'Pick up a timer from the lift cabinet'],
  MATCH_FINISHED: ['Вылазка завершена', 'The mission has ended'],
  FORBIDDEN: ['Это действие сейчас недоступно', 'This action is unavailable'],
  INCOMPATIBLE_VERSION: ['Игра обновилась. Перезагрузите страницу', 'The game has updated. Reload the page'],
  MATCH_CHANGED: ['Началась новая вылазка. Откройте комнату заново', 'A new mission has started. Reopen the room'],
  MATCH_OWNED: ['Сервер восстанавливает вылазку. Подождите', 'The server is restoring the mission. Please wait'],
  STALE_ENTITY: ['Напарник уже изменил предмет. Попробуйте снова', 'Your partner has changed this object. Try again'],
  KNOCK_COOLDOWN: ['Дайте эху затихнуть', 'Let the echo fade'],
  HANDLE_TAKEN: ['Эту рукоять держит напарник', 'Your partner is holding this handle'],
  HANDLE_BLOCKED: ['У рукояти тесно. Подойдите с другой стороны', 'The handle is obstructed. Approach from the other side'],
  DOOR_MOVING: ['Дождитесь двери', 'Wait for the door'],
  NO_BATTERY: ['Сначала возьмите батарею за рукоять', 'Take a battery handle first'],
  SOCKET_FULL: ['Это гнездо уже занято', 'This socket is already occupied'],
  ALREADY_HAVE_TIMER: ['У вас уже есть таймер', 'You already have a timer'],
  CABINET_EMPTY: ['Оба таймера уже взяли', 'Both timers have been taken'],
  NOTHING_NEARBY: ['Подойдите к двери, рукояти или напарнику', 'Approach a door, handle, or teammate'],
  NOT_IN_REACH: ['Подойдите к поверхности ближе', 'Move closer to the surface'],
  NOT_ACTIVE: ['Дождитесь помощи или возврата в лифт', 'Wait for help or a return to the lift'],
  RETURNING: ['Маяк возвращает вас в лифт', 'The beacon is returning you to the lift'],
  NOT_DISCOVERED: ['Сначала осмотрите этот участок', 'Explore this area first'],
  MARK_LIMIT: ['Три метки за десять секунд. Подождите немного', 'Three marks per ten seconds. Wait a moment'],
  NOT_PRACTICE: ['Сетевая вылазка продолжается, пока открыто меню', 'The online mission continues while the menu is open'],
  NEW_MATCH_REQUIRED: ['Повторите урок через новую смену', 'Restart the lesson with another shift'],
  MISSION_FINISHED: ['Вылазка завершена', 'The mission has ended'],
  COMMAND_RATE: ['Слишком много действий сразу. Подождите', 'Too many actions at once. Please wait'],
  RATE_LIMITED: ['Слишком много действий сразу. Подождите', 'Too many actions at once. Please wait'],
  LIVE_SCOPE_MISMATCH: ['Соединение изменилось. Откройте комнату заново', 'The session has changed. Reopen the room'],
  GAME_TIMEOUT: ['Сервер не отвечает. Восстанавливаем связь', 'The server is not responding. Reconnecting'],
  CLOSED: ['', ''],
};
export function noticeText(code: string, lang: Locale): string { return label(notices[code.toUpperCase()] ?? ['Действие сейчас недоступно', 'That action is unavailable right now'], lang); }
export const PROMPTS: Record<string, [string, string]> = {
  door: ['Открыть / закрыть дверь', 'Open / close door'], takeHandle: ['Взять рукоять', 'Take the handle'],
  drop: ['Отпустить рукоять', 'Release the handle'], install: ['Установить батарею', 'Install the battery'],
  revive: ['Помочь напарнику', 'Help your partner'], takeTimer: ['Взять шумовой таймер', 'Take a noise timer'], none: ['Осмотритесь', 'Look around'],
};
export const TUTORIAL_COPY: [string, string, string, string][] = [
  ['Проверьте связь', 'Check your senses', 'Включите звук или выберите подписи. Оба способа покажут направление.', 'Enable audio or choose captions. Both show you the direction.'],
  ['Пройдите тихо', 'Walk quietly', 'Удерживайте C и пройдите несколько шагов. На сенсоре включите «Тихо».', 'Hold C and take a few steps. On touch, enable Quiet.'],
  ['Стукните по трубе', 'Strike the pipe', 'Подойдите к полосатой трубе и нажмите Q. Контур покажет путь.', 'Approach the striped pipe and press Q. The outline reveals a path.'],
  ['Откройте дверь', 'Open the door', 'Найдите дверь по эху. Подойдите и нажмите E.', 'Find the door in the echo. Approach it and press E.'],
  ['Выберите путь', 'Choose a path', 'Осмотритесь и пройдите через проём. Поворачивайте мышью или правой областью экрана.', 'Look around and walk through. Turn with the mouse or the right side of the screen.'],
  ['Возьмите батарею вдвоём', 'Carry together', 'Подойдите к рукояти, нажмите E и дайте метку «Возьми ручку».', 'Approach a handle, press E, then mark Take the handle.'],
  ['Отпустите рукоять', 'Release your handle', 'Нажмите E ещё раз. Напарник продолжит держать батарею.', 'Press E again. Your partner keeps holding the battery.'],
  ['Помогите напарнику', 'Help your partner', 'Подойдите к сбитому боту и удерживайте E две секунды.', 'Approach the downed bot and hold E for two seconds.'],
  ['Обычная поверхность', 'An ordinary surface', 'Обычная стена даёт короткое эхо. Труба открывает больше, но её слышно дальше.', 'A wall gives a short echo. A pipe reveals more, but carries farther.'],
  ['Снова резонатор', 'The resonator again', 'Подойдите к трубе и нажмите Q. Сравните дальность и силу с обычным стуком.', 'Approach the pipe and press Q. Compare its reach and strength with a plain knock.'],
];

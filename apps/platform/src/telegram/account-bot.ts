import type { PlatformService } from '../service.js';
import { AVATARS, PlatformError } from '../types.js';
import type { AvatarStyle, PublicPlayer } from '../types.js';

const PAGE = 12;
const COMMAND = /^\/(start|profile|friends|requests|name)(?:_(\d{1,5}))?(?:@([A-Za-z0-9_]+))?(?: (.*))?$/;
type Button = { text: string; callback_data: string } | { text: string; url: string };
type Language = (ru: string, en: string) => string;
export type BotReply =
  | { ok: true }
  | { method: 'answerCallbackQuery'; callback_query_id: string; text: string }
  | { method: 'sendMessage'; chat_id: string; text: string; protect_content?: true;
      reply_markup?: { inline_keyboard: Button[][] } | { keyboard: { text: string }[][]; resize_keyboard: true } };

const label = (player: PublicPlayer): string =>
  `${player.avatar ? AVATARS[player.avatar] + ' ' : ''}${player.displayName} (@${player.handle})`;

export class TelegramAccountBot {
  constructor(
    private readonly platform: PlatformService,
    private readonly botId: string,
    private readonly botUsername: string,
  ) {}

  private playerId(telegramId: string): string | undefined {
    const row = this.platform.db.prepare('SELECT player_id FROM telegram_login_accounts WHERE bot_id=? AND telegram_user_id=?')
      .get(this.botId, telegramId) as { player_id: string } | undefined;
    return row?.player_id;
  }

  command(telegramId: string, text: string, t: Language): BotReply {
    const match = COMMAND.exec(text);
    if (!match || (match[3] && match[3].toLowerCase() !== this.botUsername.toLowerCase())) return { ok: true };
    const cmd = match[1];
    const playerId = this.playerId(telegramId);
    const send = (text: string, buttons?: Button[][]): BotReply => ({
      method: 'sendMessage', chat_id: telegramId, text,
      ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
    if (!playerId) return send(t('Откройте Iva Games и выберите вход через Telegram.', 'Open Iva Games and choose Telegram sign-in.'),
      [[{ text: 'Iva Games', url: `${this.platform.publicOrigin}/login` }]]);
    if (cmd === 'start') return { method: 'sendMessage', chat_id: telegramId,
      text: t('Что хотите открыть?', 'What would you like to open?'),
      reply_markup: { keyboard: [[{ text: '/profile' }, { text: '/friends' }, { text: '/requests' }]], resize_keyboard: true } };
    if (cmd === 'name') {
      if (!match[4]?.trim()) return send(t('Имя можно сменить командой /name Ваше имя', 'To change your name, use /name Your name'));
      try {
        const changed = this.platform.updateProfile(playerId, { displayName: match[4].trim() });
        return send(t(`Имя сохранено: ${changed.displayName}`, `Name saved: ${changed.displayName}`));
      } catch (error) {
        if (!(error instanceof PlatformError)) throw error;
        return send(t('Укажите имя длиной до 40 символов.', 'Choose a name up to 40 characters.'));
      }
    }
    if (cmd === 'profile') {
      const player = this.platform.publicPlayer(playerId);
      return send(`${label(player)}\n${t('Выберите аватар. Чтобы изменить имя, введите /name и новое имя.', 'Choose an avatar. To change your name, enter /name and your new name.')}`,
        [
          (Object.keys(AVATARS) as AvatarStyle[]).map(avatar => ({ text: AVATARS[avatar], callback_data: `avatar:${avatar}` })),
          [{ text: t('Инициалы', 'Initials'), callback_data: 'avatar:initials' }, { text: t('Профиль на сайте', 'Profile on the website'), url: `${this.platform.publicOrigin}/profile` }],
        ]);
    }
    const { friends, incoming } = this.platform.social(playerId);
    const isFriends = cmd === 'friends';
    const total = isFriends ? friends.length : incoming.length;
    const page = Math.max(1, Math.min(Number(match[2] ?? 1), Math.ceil(total / PAGE)));
    const start = (page - 1) * PAGE;
    if (total === 0) return send(isFriends ? t('Список друзей пока пуст.', 'Your friends list is empty.') : t('Входящих заявок пока нет.', 'You have no incoming requests.'),
      [[{ text: t('Друзья на сайте', 'Friends on the website'), url: `${this.platform.publicOrigin}/friends` }]]);
    const rows = incoming.slice(start, start + PAGE);
    const list = isFriends ? friends.slice(start, start + PAGE).map(label) : rows.map(row => label(row.player));
    const title = isFriends ? t('Друзья', 'Friends') : t('Входящие заявки', 'Incoming requests');
    const next = start + PAGE < total ? `\n\n${t('Следующая страница', 'Next page')}: /${cmd}_${page + 1}` : '';
    const buttons = isFriends ? [] : rows.map(row => [
      { text: t(`Принять @${row.player.handle}`, `Accept @${row.player.handle}`), callback_data: `fr:a:${row.requestId}` },
      { text: t('Отклонить', 'Decline'), callback_data: `fr:d:${row.requestId}` },
    ]);
    return send(`${title} (${total})\n\n${list.join('\n')}${next}`, buttons);
  }

  action(telegramId: string, callbackId: string, data: string, t: Language): BotReply {
    const answer = (text: string): BotReply => ({ method: 'answerCallbackQuery', callback_query_id: callbackId, text });
    const playerId = this.playerId(telegramId);
    if (!playerId) return answer(t('Войдите через Telegram на сайте.', 'Sign in with Telegram on the website.'));
    const friend = /^fr:([ad]):([a-f0-9-]{36})$/.exec(data);
    const avatar = /^avatar:([a-z]+)$/.exec(data);
    try {
      if (friend) {
        const accepted = friend[1] === 'a';
        this.platform.respondFriend(playerId, friend[2], accepted ? 'accept' : 'decline');
        return answer(accepted ? t('Заявка принята. Список обновится по /requests.', 'Request accepted. Refresh it with /requests.')
          : t('Заявка отклонена. Список обновится по /requests.', 'Request declined. Refresh it with /requests.'));
      }
      if (avatar && (avatar[1] === 'initials' || Object.hasOwn(AVATARS, avatar[1]))) {
        this.platform.updateProfile(playerId, { displayName: this.platform.publicPlayer(playerId).displayName,
          avatar: avatar[1] === 'initials' ? null : avatar[1] });
        return answer(t('Аватар сохранён.', 'Avatar saved.'));
      }
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error;
    }
    return answer(t('Это действие уже недоступно.', 'This action is no longer available.'));
  }
}

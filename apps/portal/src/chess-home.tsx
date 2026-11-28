import '@fontsource-variable/manrope';
import './styles.css';
import { chessGames } from '@iva-games/game-registry';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameArt, Icon } from './ui';

type Language = 'ru' | 'en';

function readLanguage(): Language {
  try { return localStorage.getItem('iva.portal.language') === 'en' ? 'en' : 'ru'; }
  catch { return 'ru'; }
}

function ChessHome() {
  const [lang, setLang] = useState<Language>(readLanguage);
  const t = (ru: string, en: string) => lang === 'ru' ? ru : en;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('Шахматы — Iva Games', 'Chess — Iva Games');
    try { localStorage.setItem('iva.portal.language', lang); } catch { /* The page still works without storage. */ }
  }, [lang]);

  return <div className="portal">
    <div className="language-switch" aria-label={t('Язык', 'Language')}>
      <button aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>RU</button>
      <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
    </div>
    <div className="catalogue-shell">
      <header className="catalogue-header">
        <a href="https://iva-games.pro/" className="brand" aria-label="Iva Games">
          <span className="brand-die"><Icon name="games" size={34} /></span>
          <span>Iva<span className="brand-small">games</span></span>
        </a>
        <nav className="catalogue-nav" aria-label={t('Разделы игр', 'Game collections')}>
          <a href="/" aria-current="page">{t('Шахматы', 'Chess')}</a>
          <a href="https://iva-games.pro/games">{t('Другие игры', 'Other games')}</a>
        </nav>
        <div className="catalogue-account">
          <a href="https://iva-games.pro/login" className="button secondary small">{t('Аккаунт', 'Account')}</a>
        </div>
      </header>
      <main className="catalogue-main">
        <div className="catalogue-heading">
          <p className="greeting">{t('Хорошая компания. Твой ход.', 'Good company. Your move.')}</p>
          <h1>{t('Шахматы', 'Chess')}</h1>
          <p>{t('Знакомая доска. Новые возможности.', 'A familiar board. New possibilities.')}</p>
        </div>
        <div className="game-grid catalogue-games">
          {chessGames.map(game => <article className={`game-tile game-${game.gameId}`} key={game.gameId}>
            <GameArt kind={game.gameId} />
            <div className="game-tile-body">
              <div className="game-topline"><h2>{game.title[lang]}</h2>
                <span className="tag success">{t('Можно играть', 'Ready to play')}</span></div>
              <p>{game.description[lang]}</p>
              <div className="game-bottom">
                <span className="game-players"><Icon name="friends" size={18} />
                  {game.minPlayers === game.maxPlayers ? game.minPlayers : `${game.minPlayers}–${game.maxPlayers}`}</span>
                <a className="button small primary" href={game.chess.route}>{t('Играть', 'Play')}</a>
              </div>
            </div>
          </article>)}
        </div>
        <footer className="catalogue-footer">
          <a href="https://iva-games.pro/">Iva Games</a>
          <a href="https://iva-games.pro/login">{t('Аккаунт', 'Account')}</a>
        </footer>
      </main>
    </div>
  </div>;
}

// Existing REMORSE invitation/resume links used the root URL with a fragment.
// Fragments never reach the server, so move them without exposing the invite.
const oldRoom = new URLSearchParams(window.location.hash.slice(1)).get('room');
if (oldRoom && /^[A-Za-z0-9_-]{8,100}$/.test(oldRoom)) {
  window.location.replace(`/remorse/${window.location.search}${window.location.hash}`);
} else {
  createRoot(document.getElementById('root')!).render(<ChessHome />);
}

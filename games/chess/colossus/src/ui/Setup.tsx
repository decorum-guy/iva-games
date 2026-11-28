import { useEffect, useState } from 'react';
import { BASE_DECK, BOSSES, HUNT_BOSSES, CAMPAIGN_BOSSES, CARD_LIST, DIFFICULTIES, STARTER_CARDS, validateDeck } from '../core';
import type { HuntBossId, CardId, CreateOptions, Difficulty, Language } from '../core';
import { copy } from './i18n';
import { Bestiary } from './Bestiary';
import type { SaveNotice } from './localSaves';
import { Card } from './Card';
import { BossIcon } from './PieceIcon';
import { Modal } from './Modal';
import type { ResultRecord } from './records';

export interface SetupProps {
  lang: Language;
  initial: CreateOptions;
  records: ResultRecord[];
  tutorialDone: boolean;
  hasSave: boolean;
  hasPractice: boolean;
  reducedMotion?: boolean;
  onContinue: (practice: boolean) => void;
  saveNotices: { normal: SaveNotice; practice: SaveNotice };
  onDownloadSave: (practice: boolean) => void;
  onStart: (options: CreateOptions, network: boolean) => void;
  onTutorial: () => void;
  onJoin: (link: string, name: string) => void;
  busy: boolean;
  error: string;
}

const modeDescriptions = {
  ru: {
    hunt: 'Один бой с выбранным боссом.',
    campaign: 'Поход через всех боссов с передышками у костра.',
    coop: 'Управляйте одной армией вдвоём, по очереди.',
    practice: 'Свободная тренировка с подсказками и редактором поля.',
  },
  en: {
    hunt: 'A single battle against your chosen boss.',
    campaign: 'Face every boss, with camp stops along the way.',
    coop: 'Share an army and take turns with another commander.',
    practice: 'Train freely with hints and a board editor.',
  },
};

export function Setup(p: SetupProps) {
  const c = copy[p.lang];
  const [boss, setBoss] = useState<HuntBossId>(p.initial.boss ?? 'regent');
  const [difficulty, setDifficulty] = useState<Difficulty>(p.initial.difficulty ?? 'knight');
  const [mode, setMode] = useState<'hunt' | 'campaign' | 'practice' | 'coop'>(p.initial.coop ? 'coop' : p.initial.mode ?? 'hunt');
  const [network, setNetwork] = useState(false);
  const [deck, setDeck] = useState<CardId[]>(p.initial.deck ?? BASE_DECK);
  const [cards, setCards] = useState(p.initial.bossCards ?? true);
  const [deckOpen, setDeckOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [coopCampaign, setCoopCampaign] = useState(false);
  const [bestiary, setBestiary] = useState<HuntBossId | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);

  useEffect(() => {
    // A native select may keep :focus-visible after a pointer selection. Track
    // modality without blurring the field or interrupting keyboard navigation.
    const pointer = () => setKeyboardFocus(false);
    const keyboard = (event: KeyboardEvent) => {
      if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) setKeyboardFocus(true);
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', keyboard, true);
    };
  }, []);

  const campaign = mode === 'campaign' || mode === 'coop' && coopCampaign;
  const option: CreateOptions = {
    boss: campaign ? CAMPAIGN_BOSSES[0] : boss,
    difficulty,
    mode: mode === 'coop' ? (coopCampaign ? 'campaign' : 'hunt') : mode,
    coop: mode === 'coop', deck, bossCards: cards,
  };
  const valid = validateDeck(deck).length === 0;
  const saveNotice = mode === 'practice' ? p.saveNotices.practice : p.saveNotices.normal;
  const chosen = BOSSES[option.boss ?? boss];
  const startLabel = p.busy ? c.pending : mode === 'coop' && network ? c.createRoom : {
    hunt: c.play,
    campaign: p.lang === 'ru' ? 'Начать поход' : 'Begin campaign',
    practice: p.lang === 'ru' ? 'Открыть практику' : 'Open practice',
    coop: p.lang === 'ru' ? 'Начать вдвоём' : 'Play together',
  }[mode];

  return <section className="setup-screen" data-focus-modality={keyboardFocus ? 'keyboard' : 'pointer'}>
    <div className="setup-world">
      <div className="reliquary-ring" aria-hidden="true" />
      <BossIcon id={chosen.id} className="setup-monument" />
      <h1>{c.title}</h1><p>{c.tagline}</p>
      <div className="setup-boss-name">
        <h2>{chosen.name[p.lang]}</h2><p>{chosen.description[p.lang]}</p>
        <div className="boss-vitals">
          <span>⬡ {Math.ceil(chosen.armor * DIFFICULTIES[difficulty].numerator / DIFFICULTIES[difficulty].denominator)} {c.armour.toLowerCase()}</span>
          <span>♥ {Math.ceil(chosen.hp * DIFFICULTIES[difficulty].numerator / DIFFICULTIES[difficulty].denominator)} HP</span>
        </div>
        <button type="button" className="bestiary-button" onClick={() => setBestiary(chosen.id as HuntBossId)}>{c.bestiary}</button>
      </div>
      <div className="boss-choices" role="group" aria-label={p.lang === 'ru' ? 'Противник' : 'Opponent'}>
        {HUNT_BOSSES.map(id => BOSSES[id]).map(b => <button
          type="button" key={b.id} className={chosen.id === b.id ? 'active' : ''} disabled={campaign}
          onClick={() => setBoss(b.id as HuntBossId)} aria-pressed={chosen.id === b.id}
        >
          <BossIcon id={b.id} /><span>{b.name[p.lang]}</span>
          {chosen.id === b.id && <span className="selection-check" aria-hidden="true">✓</span>}
        </button>)}
      </div>
    </div>
    <div className="setup-controls">
      <header className="setup-heading">
        <h2>{p.lang === 'ru' ? 'Новая игра' : 'New game'}</h2>
        <p className="setup-premise">{p.lang === 'ru' ? 'Восемь фигур против великана. Его следующий удар известен заранее.' : 'Eight pieces against a giant. See its next strike before you act.'}</p>
      </header>
      <fieldset className="setup-mode">
        <legend>{c.mode}</legend>
        <div className="mode-tabs">
          {(['hunt', 'campaign', 'coop', 'practice'] as const).map(m => <button
            type="button" key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)} aria-pressed={mode === m}
          ><span>{c[m]}</span><span className="mode-check" aria-hidden="true">{mode === m ? '✓' : ''}</span></button>)}
        </div>
        <p className="mode-description">{modeDescriptions[p.lang][mode]}</p>
      </fieldset>
      <div className="difficulty-field">
        <label className="field-label" htmlFor="colossus-difficulty">{c.difficulty}</label>
        <select id="colossus-difficulty" className="difficulty-select" value={difficulty} aria-describedby="colossus-difficulty-description" onChange={event => setDifficulty(event.target.value as Difficulty)}>
          {Object.entries(DIFFICULTIES).map(([id, d]) => <option value={id} key={id}>{d.name[p.lang]}</option>)}
        </select>
        <p className="difficulty-explainer" id="colossus-difficulty-description">
          {p.lang === 'ru'
            ? `${DIFFICULTIES[difficulty].commands} команды за раунд. Босс отдыхает после 3 боевых ответов.`
            : `${DIFFICULTIES[difficulty].commands} commands per round. The boss rests after 3 combat responses.`}
        </p>
      </div>
      {mode === 'coop' && <div className="coop-choice">
        <div className="segmented" role="group" aria-label={c.coop}>
          <button type="button" className={!network ? 'active' : ''} aria-pressed={!network} onClick={() => setNetwork(false)}>{c.localCoop}</button>
          <button type="button" className={network ? 'active' : ''} aria-pressed={network} onClick={() => setNetwork(true)}>{c.online}</button>
        </div>
        <label className="check-row"><input type="checkbox" checked={coopCampaign} onChange={event => setCoopCampaign(event.target.checked)} />{c.campaign}</label>
      </div>}
      <div className="setup-extras">
        <label className="check-row boss-cards-option">
          <input type="checkbox" checked={cards} onChange={event => setCards(event.target.checked)} />
          <span><b>{c.bossCards}</b><small>{c.bossCardRule}</small></span>
        </label>
        <button type="button" className="deck-button" onClick={() => setDeckOpen(true)}>
          <span className="deck-fan" aria-hidden="true"><i className="common" /><i className="rare" /><i className="epic" /><i className="legendary" /></span>
          <span className="deck-button-copy"><b>{c.deck}</b><small>{deck.length}/12 · {c.collection}</small></span>
          <svg className="deck-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>
        </button>
      </div>
      {!valid && <p className="error-text">{c.deckError}</p>}
      {p.error && <p className="error-text" role="alert">{p.error}</p>}
      {(saveNotice.damaged || saveNotice.archived) && <div className="save-notice">
        <p role={saveNotice.damaged ? 'alert' : 'status'}>{saveNotice.damaged ? c.invalidSave : c.recoveredSave}</p>
        <button type="button" className="secondary-button" onClick={() => p.onDownloadSave(mode === 'practice')}>{c.downloadSave}</button>
      </div>}
      <div className="start-actions">
        <button type="button" data-testid="start-game" className="primary-button" disabled={!valid || p.busy} onClick={() => p.onStart(option, mode === 'coop' && network)}>{startLabel}</button>
        {(mode === 'practice' ? p.hasPractice : p.hasSave) && <button type="button" className="secondary-button" disabled={p.busy} onClick={() => p.onContinue(mode === 'practice')}>{c.continue}</button>}
      </div>
      <button type="button" className="tutorial-invitation" onClick={p.onTutorial}>
        <span className="training-emblem" aria-hidden="true">◇</span>
        <span><b>{p.tutorialDone ? c.learnAgain : c.learn}</b><small>{p.lang === 'ru' ? 'Смотритель · короткий учебный бой' : 'The Warden · a short guided battle'}</small></span>
      </button>
      <div className="setup-links"><button type="button" onClick={() => setJoinOpen(true)}>{c.joinRoom} · {c.online}</button></div>
    </div>
    {bestiary && <Bestiary language={p.lang} difficulty={difficulty} records={p.records} initialBoss={bestiary} onClose={() => setBestiary(null)} reducedMotion={p.reducedMotion} />}
    {deckOpen && <Modal title={c.deck} onClose={() => setDeckOpen(false)} className="collection-modal">
      <p>{c.deckHint}</p><div className="collection-counter">{c.chosenDeck}: <b>{deck.length}/12</b></div>
      <div className="card-collection">{CARD_LIST.map(card => <Card
        card={card} lang={p.lang} key={card.id} selected={deck.includes(card.id)}
        onClick={() => {
          if (STARTER_CARDS.includes(card.id)) return;
          setDeck(old => old.includes(card.id) ? old.filter(x => x !== card.id) : [...old, card.id]);
        }}
      >{STARTER_CARDS.includes(card.id) && <span className="card-status">{c.mandatory}</span>}</Card>)}</div>
      <button type="button" className="primary-button" onClick={() => setDeckOpen(false)} disabled={!valid}>{c.apply}</button>
    </Modal>}
    {joinOpen && <Modal title={c.joinRoom} onClose={() => setJoinOpen(false)}>
      <label className="field-label">{c.name}<input value={name} onChange={event => setName(event.target.value)} maxLength={32} autoComplete="nickname" /></label>
      <label className="field-label">{c.pasteLink}<input value={link} onChange={event => setLink(event.target.value)} autoComplete="off" /></label>
      <button type="button" className="primary-button" disabled={!link.trim() || p.busy} onClick={() => p.onJoin(link, name.trim() || (p.lang === 'ru' ? 'Командир' : 'Commander'))}>{c.joinRoom}</button>
      {p.error && <p className="error-text">{p.error}</p>}
    </Modal>}
  </section>;
}

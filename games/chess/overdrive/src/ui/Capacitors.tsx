import { tr, type Language } from './i18n'

export function Capacitors({ energy, language, bank }: { energy: number; language: Language; bank: number }) {
  return <div className="od-capacitors" aria-label={tr(language, `Энергия: ${energy} из ${bank * 2}`, `Energy: ${energy} of ${bank * 2}`)}>
    {[0, 1].map(cell => <span className={`od-capacitor ${energy >= bank * (cell + 1) ? 'full' : ''}`} key={cell}>
      {Array.from({ length: bank }, (_, i) => <i key={i} className={energy > cell * bank + i ? 'charged' : ''} />)}
    </span>)}<strong>{energy}<span>/{bank * 2}</span></strong>
  </div>
}

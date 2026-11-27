import { RESOURCES } from '@iva-games/district/territorial';
import type { Resource, Stock } from '@iva-games/district/territorial';

type Lang = 'ru' | 'en';
const names: Record<Resource, [string, string]> = {
  wood: ['Древесина', 'Wood'], brick: ['Кирпич', 'Brick'], grain: ['Зерно', 'Grain'],
  wool: ['Шерсть', 'Wool'], ore: ['Руда', 'Ore'],
};
export const resourceName = (resource: Resource, lang: Lang) => names[resource][lang === 'ru' ? 0 : 1];

/** Original vector drawings for District. Shared by the hand, prices and both sides of a trade. */
export function ResourceIcon({ resource, className = '' }: { resource: Resource; className?: string }) {
  return <svg className={`ta-resource-art ${className}`} viewBox="0 0 40 36" aria-hidden="true" focusable="false">
    <ellipse cx="20" cy="30" rx="16" ry="3" fill="#163f43" opacity=".13" />
    {resource === 'wood' && <g stroke="#60452d" strokeWidth="1.1" strokeLinejoin="round">
      <path d="m6 23 18-12 8 5-18 12z" fill="#96613c"/><path d="m9 17 17-11 7 5-17 12z" fill="#b4834b"/>
      <path d="m5 24 17-11v5L5 29z" fill="#795033"/><ellipse cx="10" cy="25" rx="6" ry="4.4" fill="#dfb57a"/>
      <ellipse cx="10" cy="25" rx="2.8" ry="2" fill="none"/><ellipse cx="14" cy="19" rx="5.7" ry="4.2" fill="#edc891"/>
      <path d="m15 18 2 1-3 2m6-7 7-4m-7 11 8-6" fill="none"/>
      <path d="m22 10 6-3 7 1-6 4-6 1" fill="#608358" stroke="#496b44"/>
    </g>}
    {resource === 'brick' && <g stroke="#864b3d" strokeWidth="1.05" strokeLinejoin="round">
      <path d="m4 23 12-6 10 5-12 7z" fill="#dc8b62"/><path d="m4 23 10 6v4L4 27z" fill="#a95943"/><path d="m14 29 12-7v4l-12 7z" fill="#bf6b4d"/>
      <path d="m19 17 12-6 7 4-11 7z" fill="#e9a37b"/><path d="m19 17 8 5v5l-8-5z" fill="#b2644b"/><path d="m27 22 11-7v5l-11 7z" fill="#ca7958"/>
      <path d="m7 14 13-7 10 5-13 7z" fill="#efb084"/><path d="m7 14 10 5v6L7 19z" fill="#b5654b"/><path d="m17 19 13-7v6l-13 7z" fill="#d28b62"/>
    </g>}
    {resource === 'grain' && <g strokeLinecap="round" strokeLinejoin="round">
      <path d="m17 30 1-24m3 24 5-23m-6 23L9 11m11 19 13-14" stroke="#96723b" strokeWidth="1.9"/>
      <g fill="#eac264" stroke="#bc9148" strokeWidth=".8">
        <path d="M18 8q-6-3-4-7 5 1 4 7m0 4q-6-2-5-6 5 0 5 6m0 5q-6-2-5-6 5 0 5 6m1-10q5-3 4-7-5 2-4 7m0 6q5-3 4-7-5 2-4 7m0 5q5-2 5-6-5 1-5 6"/>
        <path d="m26 10q-4-4-2-7 4 2 2 7m0 0q5-2 6-6-5 0-6 6m-1 6q-5-4-3-7 5 2 3 7m1-1q5-1 6-5-5 0-6 5M12 17q-6 0-8-4 5-2 8 4m1 2q1-5-3-7-1 4 3 7m15 4q6-1 7-5-5-1-7 5"/>
      </g><path d="m14 25 10 1-1 3-8-1z" fill="#c1774e" stroke="#916445"/>
    </g>}
    {resource === 'wool' && <g stroke="#b8aaa0" strokeWidth="1.1" fill="none" strokeLinecap="round">
      <path d="M31 24q8 9 2 9-6-2-11-1" stroke="#e7e2d4" strokeWidth="2.3"/>
      <circle cx="19" cy="18" r="13" fill="#fff6e4"/>
      <path d="M10 9q15 2 20 16M7 13q13 0 21 15M6 18q11-1 18 12M10 26q1-15 14-20M15 29q2-15 13-20M20 31q1-14 11-18M8 23q10-1 15 6"/>
    </g>}
    {resource === 'ore' && <g stroke="#53696c" strokeWidth="1" strokeLinejoin="round">
      <path d="m4 28 5-11 11-3 8 14-13 5z" fill="#869c9c"/><path d="m9 17 11-3-4 12L4 28z" fill="#b9c5bd"/>
      <path d="m16 24 5-17 10-3 6 19-11 7z" fill="#667f83"/><path d="m21 7 10-3-5 14-10 6z" fill="#a2b6b2"/>
      <path d="m26 18 5-14 6 19-11 7z" fill="#506c76"/><path d="m23 10 4-2m-15 12 3-1m13 3 2-3" stroke="#deceb2" strokeWidth="2"/>
    </g>}
  </svg>;
}

export function ResourceStock({ stock, lang, showZero = false, appearance = 'inline', delta, bank = false, resources }: {
  stock: Partial<Stock>; lang: Lang; showZero?: boolean; appearance?: 'inline' | 'cards';
  delta?: Partial<Stock>; bank?: boolean; resources?: readonly Resource[];
}) {
  const entries = (resources ?? RESOURCES).filter(resource => showZero || stock[resource] || delta?.[resource]);
  if (!entries.length) return <span className="ta-free">{lang === 'ru' ? 'Бесплатно' : 'Free'}</span>;
  return <span className={`ta-resources${appearance === 'cards' ? ' ta-resource-cards' : ''}`} role="list">
    {entries.map(resource => {
      const amount = stock[resource] ?? 0;
      const change = delta?.[resource] ?? 0;
      const count = bank && amount >= 2 ? '2+' : String(amount);
      return <span key={resource} role="listitem" data-resource={resource} className={amount === 0 ? 'is-empty' : ''}
        aria-label={`${resourceName(resource, lang)}: ${count}${change ? ` (${change > 0 ? '+' : ''}${change})` : ''}`}>
        <ResourceIcon resource={resource}/><span className="ta-resource-name">{resourceName(resource, lang)}</span>
        <b>{count}</b>{change !== 0 && <em className={change > 0 ? 'ta-gain' : 'ta-loss'}>{change > 0 ? '+' : ''}{change}</em>}
      </span>;
    })}
  </span>;
}

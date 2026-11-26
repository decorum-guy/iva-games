import type { PieceType, Side } from '../core'

export function PieceIcon({ type, side = 'white', size = 44 }: { type: PieceType; side?: Side; size?: number }) {
  const body = side === 'white' ? '#f4f5ef' : '#265d88'
  const edge = side === 'white' ? '#214967' : '#d0e1eb'
  return <svg width={size} height={size} viewBox="0 0 64 72" aria-hidden="true" className="od-piece-icon">
    <g fill={body} stroke={edge} strokeWidth="2.5" strokeLinejoin="round">
      <path d="M14 62h36l3 6H11zM20 54h24l6 8H14zM24 34h16l4 20H20z" />
      {type === 'pawn' && <><path d="M20 31h24v7H20z"/><circle cx="32" cy="21" r="12"/></>}
      {type === 'knight' && <path d="M22 36 19 22 27 5l8 8 13 9 4 14-10 3-7-10-8 10z" />}
      {type === 'bishop' && <><path d="M20 36c-5-13 1-22 12-32 12 13 17 20 12 32z"/><path d="m33 10-3 14" stroke="#f4773b" strokeWidth="4"/></>}
      {type === 'rook' && <path d="M19 36V12h7v9h12v-9h7v24zM19 14h-4V8h11v6m12 0V8h11v6h-4" />}
      {type === 'queen' && <><path d="m18 34-5-18 12 6 7-17 7 17 12-6-5 18z"/><circle cx="13" cy="14" r="3"/><circle cx="32" cy="5" r="3"/><circle cx="51" cy="14" r="3"/></>}
      {type === 'king' && <><path d="M20 36V27h24v9zM27 27V15h-8V8h8V1h10v7h8v7h-8v12" /></>}
    </g>
    <path d="M21 48h22" stroke="#ee733e" strokeWidth="4"/>
  </svg>
}

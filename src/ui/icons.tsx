const paths = {
  sound: 'M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  muted: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6',
  menu: 'M3 5h18M3 12h18M3 19h18',
  profile: 'M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  book: 'M4 4h5a3 3 0 0 1 3 3v13a4 4 0 0 0-3-2H4zm16 0h-5a3 3 0 0 0-3 3v13a4 4 0 0 1 3-2h5z',
  settings: 'M5 5h14M5 12h14M5 19h14M9 3v4m6 3v4m-5 3v4',
  flip: 'M8 3 3 8l5 5m-5-5h14m-1 13 5-5-5-5m5 5H7',
  camera: 'M3 6h4l2-3h6l2 3h4v14H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  close: 'm5 5 14 14M19 5 5 19',
  history: 'M3 12a9 9 0 1 1 3 6.7M3 5v7h7m2-5v5l3 2',
  back: 'm14 5-7 7 7 7',
  right: 'm10 5 7 7-7 7',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  helmet: 'M4 19v-7a8 8 0 1 1 16 0v2h-5l-3 5H4Zm0-6h7m-2 0v6',
  local: 'M8 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm8 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM2 20v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3m2-7h2a4 4 0 0 1 4 4v3',
  undo: 'M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12',
  redo: 'm16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
  bookOpen: 'M12 6v14M12 6C8 3 4 4 2 5v14c4-2 8-2 10 1 2-3 6-3 10-1V5c-2-1-6-2-10 1Z',
  folder: 'M3 7V4h7l3 3h8v13H3z',
  check: 'm5 12 4 4L19 6',
  info: 'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
} as const;

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55"
    strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

export function Seal() {
  return <svg aria-hidden="true" className="seal" viewBox="0 0 48 48" fill="none">
    <path d="M24 1.8 46.2 24 24 46.2 1.8 24 24 1.8Z" stroke="currentColor" strokeWidth="1.25"/>
    <path d="M17 13.5h7.5c5.2 0 8.5 2.2 8.5 6 0 3.3-2.5 5.3-5.8 5.7l7 8.8h-4.8l-7.1-9.2H21V34h-4v-20.5Zm4 3.2v5.3h3.4c2.8 0 4.2-.9 4.2-2.7 0-1.7-1.4-2.6-4.3-2.6H21Z" fill="currentColor"/>
    <path d="m13 37.5 5.5-4.8m11-20.8L35 8.5" stroke="currentColor" strokeWidth="1.05"/>
  </svg>;
}

/** Small original line symbols; the enclosing button supplies its localized name. */
export function HudIcon({ kind, muted = false }: { kind: 'map' | 'settings' | 'audio'; muted?: boolean }) {
  return <svg className="kf-hud-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'map' ? <>
      <path d="m9 4-6 2v15l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v15M15 6v15" />
    </> : kind === 'settings' ? <>
      <path d="M10 3h4l.5 2.2 1.8 1 2.1-.7 2 3.5-1.7 1.5v3l1.7 1.5-2 3.5-2.1-.7-1.8 1L14 21h-4l-.5-2.2-1.8-1-2.1.7-2-3.5 1.7-1.5v-3L3.6 9l2-3.5 2.1.7 1.8-1L10 3Z" />
      <circle cx="12" cy="12" r="3" />
    </> : <>
      <path d="m11 5-5 4H3v6h3l5 4V5Z" />
      {muted ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}
    </>}
  </svg>;
}

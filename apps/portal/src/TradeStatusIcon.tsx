/** Original District trade seals. The containing control owns the accessible name. */
export function TradeStatusIcon({ status }: { status: 'accept' | 'decline' | 'waiting' }) {
  return <svg className={`ta-trade-seal ta-trade-seal-${status}`} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    <path className="ta-seal-rim" d="M10 2.5h12l7.5 7.5v12L22 29.5H10L2.5 22V10Z"/>
    <path className="ta-seal-inset" d="M11 5.5h10l5.5 5.5v10L21 26.5H11L5.5 21V11Z"/>
    {status === 'accept' ? <path className="ta-seal-mark" d="m9 16 4.5 4.5L23 11"/>
      : status === 'decline' ? <path className="ta-seal-mark" d="m11 11 10 10m0-10L11 21"/>
      : <><circle className="ta-clock-face" cx="16" cy="16" r="8"/><path className="ta-clock-ticks" d="M16 9v1m7 6h-1m-6 7v-1m-7-6h1"/><path className="ta-seal-mark" d="M16 11v5l-3 2"/><path className="ta-clock-second" d="M16 17v-7"/><circle className="ta-clock-pin" cx="16" cy="16" r="1.4"/></>}
  </svg>;
}

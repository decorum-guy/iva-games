import { useMemo } from 'react';
import type { Point } from '@iva-games/district/territorial';

const between = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const xy = (point: Point) => point.x.toFixed(2) + ',' + point.y.toFixed(2);

/** Decorative shore only. The public hex polygons keep their exact hit geometry. */
function shoreline(loops: Point[][], unit: number) {
  const accents: { x: number; y: number; angle: number; variant: number }[] = [];
  const paths = loops.map((loop, loopIndex) => {
    let path = '';
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length], c = loop[(i + 2) % loop.length];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const nx = dy / length, ny = -dx / length; // Outward on both mainland and inland-water contours.
      const signature = Math.abs(Math.round(a.x * .31 + b.y * .73 + loopIndex * 11));
      const bend = (signature % 5 - 1) * .8 * unit;
      const middle = between(a, b, .48);
      const crest = { x: middle.x + nx * bend, y: middle.y + ny * bend };
      if (i === 0) path += 'M' + xy(between(a, b, .18));
      path += 'Q' + xy(crest) + ' ' + xy(between(a, b, .82)) + 'Q' + xy(b) + ' ' + xy(between(b, c, .18));
      if (signature % 4 === 0) {
        const offset = (9 + signature % 5) * unit;
        accents.push({ x: middle.x + nx * offset, y: middle.y + ny * offset,
          angle: Math.atan2(dy, dx) * 180 / Math.PI, variant: signature % 3 });
      }
    });
    return path + 'Z';
  });
  return { outline: paths.join(' '), accents };
}

export function TerritorialCoast({ loops, unit, id }: { loops: Point[][]; unit: number; id: string }) {
  const { outline, accents } = useMemo(() => shoreline(loops, unit), [loops, unit]);
  return <g aria-hidden="true" pointerEvents="none" fillRule="evenodd" strokeLinejoin="round">
    <defs>
      <pattern id={id + '-water'} width="138" height="94" patternUnits="userSpaceOnUse">
        <g fill="none" strokeLinecap="round">
          <path d="M4 33q9-5 20-2t18-1m38 45q7-4 13-2t11-2" stroke="#69c9ce" opacity=".34" strokeWidth="1.3"/>
          <path d="M15 36q5-2 9-1m62 41 4-1m27-61q4-2 9-1" stroke="#c1e9d6" opacity=".57" strokeWidth="1.15"/>
          <path d="M36 63q10-4 18-1t19-3M86 20q8-4 18-3" stroke="#0e647f" opacity=".32" strokeWidth="1.7"/>
        </g>
      </pattern>
      <linearGradient id={id + '-sand'} x2=".35" y2="1">
        <stop stopColor="#fff0ba"/><stop offset=".55" stopColor="#f0ca8b"/><stop offset="1" stopColor="#d3a572"/>
      </linearGradient>
    </defs>
    <rect x="-300%" y="-300%" width="700%" height="700%" fill={'url(#' + id + '-water)'}/>
    <path d={outline} fill="#246f87" stroke="#227e94" strokeWidth={30 * unit}/>
    <path d={outline} fill="#4ba6a9" stroke="#4ba6a9" strokeWidth={23 * unit}/>
    <path d={outline} fill="#91cfc3" stroke="#91cfc3" strokeWidth={15 * unit}/>
    <path d={outline} fill="#d7dbad" stroke="#d7dbad" strokeWidth={9 * unit}/>
    <path d={outline} fill={'url(#' + id + '-sand)'} stroke="#ffe3a2" strokeWidth={5.4 * unit}/>
    <path d={outline} fill="none" stroke="#835f48" strokeWidth={1.4 * unit}/>
    {accents.map((mark, index) => <g key={index} transform={`translate(${mark.x} ${mark.y}) rotate(${mark.angle}) scale(${unit})`}>
      {mark.variant === 0 ? <g>
        <ellipse cx="1" cy="1" rx="5.5" ry="2.5" fill="#318492"/>
        <path d="m-4 0 2-3 4-1 2 3-2 1Z" fill="#9eaaa0"/><path d="m-3-1 2-2 3-1-2 2Z" fill="#e6d7b7"/>
        <path d="M-7 3q4 2 8 1" stroke="#d2ead4" fill="none"/>
      </g> : mark.variant === 1 ? <g fill="none" strokeLinecap="round">
        <path d="M-8-1q5 3 10 2m2-1 3-1" stroke="#eaf3d7" strokeWidth="1.6"/>
        <path d="M-5-4q5 2 10 1" stroke="#83d0c3" strokeWidth="1.2"/>
      </g> : <g fill="#528f84">
        <path d="M-4 1q-5-3-5-6 4 2 5 6m1 0q-2-5 1-8 1 5-1 8m4 1q1-5 5-6-2 4-5 6Z"/>
        <path d="M-7 3q5 1 12 0" stroke="#b3dccc" fill="none"/>
      </g>}
    </g>)}
  </g>;
}

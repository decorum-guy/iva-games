// Painted isometric miniatures. The map positions each drawing at its ground anchor.
export type DistrictMapArtKind = 'lot' | 'house1' | 'house2' | 'cafe1' | 'cafe2' |
  'workshop1' | 'workshop2' | 'neutral' | 'park-site' | 'park' | 'square';

export function DistrictMapTree({ variant = 0 }: { variant?: number }) {
  const pine = variant % 3 === 0;
  const leaf = variant % 2 ? '#719773' : '#669076';
  return <g>
    <ellipse cx="3" cy="0" rx="5" ry="2" fill="#374e45" opacity=".17"/>
    <path d="M-1 1l.3-10H1l.5 10Z" fill="#7d6851"/>
    {pine ? <>
      <path d="M0-20Q3-18 5-10Q8-4 2-4Q-4-3-5-7Q-4-16 0-20Z" fill="#42796b"/>
      <path d="M0-19Q-5-12-4-8Q0-7 1-15Z" fill={leaf}/>
    </> : <>
      <path d="M-7-9Q-9-14-4-16Q-2-21 3-18Q9-17 7-11Q8-6 3-5Q-4-4-7-9Z" fill="#4d806c"/>
      <path d="M-7-11Q-7-16-3-16Q-1-20 3-17Q5-14 2-12Q1-9-3-10Q-5-8-7-11Z" fill={leaf}/>
    </>}
  </g>;
}

function Shadow({ wide = false }: { wide?: boolean }) {
  return <ellipse cx="4" cy="5" rx={wide ? 28 : 22} ry="7.5" fill="#394c48" opacity=".18"/>;
}

function Cottage({ neutral = false, variant }: { neutral?: boolean; variant: number }) {
  const tile = neutral ? ['#879a94', '#839a97'] : ['#cc795a', '#d88a63'];
  return <g>
    <path d="M-19-3l21 10 17-9v5L2 12-19 2Z" fill="#aaa290"/>
    <path d="M-17-19L1-10V8l-18-8Z" fill="#f1dfb7"/>
    <path d="M1-10l9-15 8 4V0L1 8Z" fill="#d2b896"/>
    <path d="M-20-18l10-15 22 9L2-8Z" fill={tile[variant % 2]}/>
    <path d="M-10-33l8 4 23 10-9-5Z" fill="#f5b38a"/>
    <path d="M12-24l9 5-2 2-7-4L2-7 1-9Z" fill={neutral ? '#687e79' : '#a35c47'}/>
    <path d="M-13-14l5 2v7l-5-2Zm17 9 4-2v7L4 2Z" fill="#607e79"/>
    <path d="M-6-10l4 2v13l-4-2Z" fill="#916c53"/>
    <path d="M10-9l5-2v6l-5 2Z" fill="#668883"/>
    <path d="M-14-7l7 3v1l-7-3Zm23 4 7-3v1L9-2Z" fill="#fae6be"/>
    <path d="M-7-29v-5l3-1 3 1v8Z" fill="#c39577"/>
    <path d="M-8-34l4-2 4 2-4 2Z" fill="#815f50"/>
  </g>;
}

function Cafe({ expanded }: { expanded: boolean }) {
  return <g>
    {expanded && <g>
      <path d="M3-26l12-6 13 7v23l-12 6L3-3Z" fill="#c3ad8c"/>
      <path d="M2-27l12-9 17 8-3 4-13-6-10 6Z" fill="#bd7255"/>
      <path d="M18-16l7-3v9l-7 3Z" fill="#647f76"/>
    </g>}
    <path d="M-23-3l25 12 18-9v4L2 13-23 1Z" fill="#b5a58d"/>
    <path d="M-20-23L2-13V8L-20-2Z" fill="#f5ddb2"/>
    <path d="M2-13l15-7V0L2 8Z" fill="#d1b68e"/>
    <path d="M-23-24l17-8 26 11-18 9Z" fill="#ddaa78"/>
    <path d="M-18-24l12-6 20 9-12 6Z" fill="#bc8c67"/>
    <path d="M-23-24L2-13l18-8v3L2-9l-25-12Z" fill="#f0c699"/>
    <path d="M-17-14l11 5v11l-11-5Zm14 6 4 2v12l-4-2Zm10 0 7-3v8l-7 3Z" fill="#547974"/>
    <path d="M-20-19L3-8l-5 5-23-10Z" fill="#f8e7cb"/>
    {[0, 1, 2, 3].map(i => <path key={i} transform={`translate(${i * 6} ${i * 2.8})`}
      d="M-20-19l3 1.4-5 5-3-1.4Z" fill="#b95946"/>)}
    <path d="M-25-14l23 10v3l-23-10Z" fill="#d58b66"/>
    {expanded && <g>
      <path d="M15 5v5m8-9v5" stroke="#716851" strokeWidth="1.5"/>
      <ellipse cx="15" cy="4" rx="5" ry="2" fill="#f5cb8b"/>
      <ellipse cx="23" cy="0" rx="4" ry="1.8" fill="#efd398"/>
    </g>}
  </g>;
}

function Workshop({ expanded }: { expanded: boolean }) {
  return <g>
    {expanded && <>
      <path d="M3-4l2-37 7 2 1 34Z" fill="#b67e61"/>
      <path d="M8-39l4-1 1 35-4 2Z" fill="#98684f"/>
      <path d="M3-42l5-2 6 2v4l-6 2-5-2Z" fill="#be8d6f"/>
      <path d="M16-19l9-4 6 4v17L17 5Z" fill="#a8aa92"/>
      <path d="M14-20l11-6 7 6-11 5Z" fill="#768e82"/>
    </>}
    <path d="M-23-3L2 9l20-10v4L2 13-23 1Z" fill="#ada38c"/>
    <path d="M-21-20l8-9 1 12 8-9 1 12 6-9v32L-21-2Z" fill="#e4d7ad"/>
    <path d="M3-23l17-8V0L3 9Z" fill="#c2b89b"/>
    <path d="M-21-20l8-9 17-8-8 10Zm9 4 8-10 17-8-8 10Zm9 4 6-11 17-8-6 11Z" fill="#66897f"/>
    <path d="M-13-29L4-37v10l-17 8Zm9 3 17-8v10l-17 8Z" fill="#90a9a1"/>
    <path d="M-16-15l12 6V5l-12-5Z" fill="#797b69"/>
    <path d="M-14-12l9 4m-9 0 9 4m-9 0 9 4" stroke="#aaa88e" strokeWidth="1"/>
    <path d="M7-15l9-4v7l-9 4Z" fill="#577973"/>
    <path d="M-23 0l6-3 5 2v5l-6 2-5-2Z" fill="#b78e62"/>
    <path d="M-23 0l6-3 5 2-6 3Z" fill="#debb88"/>
  </g>;
}

function Park({ site }: { site: boolean }) {
  if (site) return <g>
    <path d="M-15 2Q-9 0-6-4T4-7M3 7q7-1 11-6" fill="none" stroke="#b2a482" strokeWidth="1.4"/>
    <path d="M-10 4v-5m-2 1 2 2 2-4M9-2v-4m-2 1 2 2 2-4" fill="none" stroke="#849467" strokeWidth="1.4"/>
  </g>;
  return <g>
    <ellipse cy="2" rx="27" ry="11" fill="#809a72"/>
    <ellipse cy=".5" rx="27" ry="10.5" fill="#a6b780"/>
    <path d="M-22 6C-18 1-3 7-2 1S6-5 20-5" fill="none" stroke="#ebd6a9" strokeWidth="4.2"/>
    <g transform="translate(-15 -3) scale(1.1)"><DistrictMapTree variant={1}/></g>
    <g transform="translate(-4 -6)"><DistrictMapTree variant={0}/></g>
    <g transform="translate(19 0) scale(.72)"><DistrictMapTree variant={2}/></g>
    <g strokeLinecap="round">
      <path d="M4 3v4m8-1v4" stroke="#6a6e57" strokeWidth="1.7"/>
      <path d="M4 .5l9 3.5M3 3l9 3.5" stroke="#b47d51" strokeWidth="2.4"/>
    </g>
  </g>;
}

function Fountain() {
  return <g>
    <ellipse cy="4" rx="27" ry="10" fill="#b1a999"/>
    <ellipse cy="2" rx="27" ry="10" fill="#d9ceaf"/>
    <ellipse cy="2" rx="21" ry="7.4" fill="none" stroke="#b4b099" strokeWidth="1.2" strokeDasharray="3 2"/>
    <path d="M-15-2q16-10 30 0v4q-15 12-30 0Z" fill="#91a29b"/>
    <ellipse cy="-2" rx="15" ry="6.5" fill="#f1e3c5"/>
    <ellipse cy="-2" rx="12" ry="4.5" fill="#67b4b3"/>
    <path d="M-4-3q3-3 2-9h4q-1 6 2 9-4 3-8 0Z" fill="#ede0bf"/>
    <path d="M-7-15q6-3 14 0-1 6-7 6t-7-6Z" fill="#afb8a9"/>
    <ellipse cy="-15" rx="7" ry="2.7" fill="#d9eddb"/>
    <path d="M0-16q-1-15-4-7m4 7q3-14 6-7M0-16v-11" fill="none" stroke="#9ccfcb" strokeWidth="1.7" strokeLinecap="round"/>
  </g>;
}

export function DistrictMapArt({ kind, variant = 0 }: { kind: DistrictMapArtKind; variant?: number }) {
  if (kind === 'lot') return <path d="M-14 4l-5-2 5-3m27-3 5 2-4 2" fill="none" stroke="#a99e80" opacity=".65" strokeWidth="1.4"/>;
  if (kind === 'park-site' || kind === 'park') return <Park site={kind === 'park-site'}/>;
  if (kind === 'square') return <Fountain/>;
  return <g>
    <Shadow wide={kind.endsWith('2')}/>
    {kind === 'house2' && <g transform="translate(9 -11) scale(.96)"><Cottage variant={variant + 1}/></g>}
    {(kind === 'house1' || kind === 'house2' || kind === 'neutral') &&
      <g transform={kind === 'house2' ? 'translate(-7 1)' : undefined}><Cottage neutral={kind === 'neutral'} variant={variant}/></g>}
    {(kind === 'cafe1' || kind === 'cafe2') && <Cafe expanded={kind === 'cafe2'}/>}
    {(kind === 'workshop1' || kind === 'workshop2') && <Workshop expanded={kind === 'workshop2'}/>}
  </g>;
}

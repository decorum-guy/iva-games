/** Original engraved card illustrations for COLOSSUS. All paths authored here. */
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const out=new URL('../public/assets/colossus/cards/',import.meta.url)
await mkdir(out,{recursive:true})
const shield='<path d="M80 24 125 43 120 92Q111 119 80 139Q49 119 40 92L35 43Z"/><path d="M80 36 112 50 108 88Q102 109 80 124Q58 109 52 88L48 50Z"/><path d="M80 49V109M56 73H104"/>'
const sword='<path d="M76 21 91 12 94 35 66 105 54 101Z"/><path d="m51 93 29 12M60 104l-9 22-8-3 9-22M77 25l6 4-20 59"/>'
const crown='<path d="m35 98-7-49 29 22 23-41 23 41 29-22-7 49ZM35 105h90v16H35Z"/><path d="M47 98 57 71M113 98 103 71M80 47V96"/><circle cx="80" cy="30" r="5"/><circle cx="28" cy="49" r="4"/><circle cx="132" cy="49" r="4"/>'
const square='<rect x="36" y="36" width="88" height="88" rx="3"/><path d="M36 65h88M36 94h88M65 36v88M94 36v88"/>'
const arts={
 bandage:'<path d="m43 30 58 6 25 89-58 8Z"/><path d="m47 45 58-8M51 59l58-8M55 73l58-8M59 87l58-8M63 101l58-8M67 115l58-8"/><path d="m24 79 111-21 4 22L28 101Z"/>',
 'stone-skin':shield,
 'sharp-edge':sword+'<path d="m113 29 3 12 12 3-12 3-3 12-3-12-12-3 12-3ZM36 52v16M28 60h16"/>',
 'armor-tip':'<path d="m80 17 19 45-19-8-19 8Z"/><path d="M80 54v82M73 64v65M86 63v66"/><path d="M30 91h31l-9 15 9 13H28ZM132 91h-31l9 15-9 13h34"/>',
 focus:'<ellipse cx="80" cy="80" rx="58" ry="32"/><circle cx="80" cy="80" r="25"/><circle cx="80" cy="80" r="10"/><path d="M80 19v17M80 124v17M19 39l15 11M126 110l15 11M141 39l-15 11M34 110l-15 11"/>',
 reposition:square+'<path d="M52 110V81h57M98 70l11 11-11 11"/><circle cx="52" cy="110" r="7"/>',
 swap:'<path d="M33 50h94l-14-14M127 111H33l14 14"/><circle cx="49" cy="77" r="15"/><path d="M31 102q0-16 18-16t18 16Z"/><circle cx="112" cy="83" r="15"/><path d="M94 108q0-16 18-16t18 16Z"/>',
 'minor-vow':shield+'<circle cx="80" cy="79" r="62" stroke-dasharray="2 8"/>',
 hospital:'<path d="M39 37h22v18l10 18v52H29V73l10-18ZM99 37h22v18l10 18v52H89V73l10-18Z"/><path d="M37 31h26M97 31h26M50 81v30M37 96h26M110 81v30M97 96h26"/>',
 'hunt-mark':'<circle cx="80" cy="80" r="48"/><circle cx="80" cy="80" r="29"/><path d="M80 14v32M80 114v32M14 80h32M114 80h32M61 79l14 16 28-35"/>',
 wedge:'<path d="M28 31h43L61 70l16 16-13 47H28ZM132 31H88l14 42-14 20 14 40h30Z"/><path d="m76 12 14 0-7 67-7-12Z"/><path d="m47 53 10 9M115 97l-8 14M50 107l8-6"/>',
 formation:'<g transform="translate(29 2) scale(.64)">'+shield+'</g><g transform="translate(-1 51) scale(.64)">'+shield+'</g><g transform="translate(59 51) scale(.64)">'+shield+'</g>',
 disrupt:'<path d="M61 30a54 54 0 0 1 70 60M99 130a54 54 0 0 1-70-60"/><path d="m70 17-9 13 17 5M90 143l9-13-17-5M17 82h32l12-27 22 52 15-25h45"/>',
 counterorder:'<path d="M33 39h94v27H33ZM33 93h94v27H33Z"/><path d="M80 66v27M67 80l13 13 13-13"/><circle cx="48" cy="52" r="4"/><circle cx="64" cy="52" r="4"/><circle cx="80" cy="52" r="4"/><circle cx="48" cy="106" r="4"/><circle cx="64" cy="106" r="4"/><circle cx="80" cy="106" r="4"/><circle cx="96" cy="106" r="4"/>',
 'marble-vow':'<circle cx="80" cy="80" r="64"/><circle cx="80" cy="80" r="56" stroke-dasharray="1 6"/><g transform="translate(19 20) scale(.76)">'+crown+'</g><path d="M80 8v13M80 139v13M8 80h13M139 80h13"/>',
 'shell-break':'<path d="m80 20-5 35 11 11-16 19 13 14-10 39M64 27 31 43l6 52 25 31M96 27l33 16-6 52-25 31"/><path d="m39 14 12 20M121 14l-12 20M17 80h20M123 80h20M44 142l12-20M116 142l-12-20"/>',
 regent_reposition:'<path d="M25 96h39v27H25ZM25 61h39v35H25ZM97 52h39v27H97ZM97 17h39v35H97Z"/><path d="M52 47h59l-12-12M77 53v31M75 89l9-8 9 8"/>',
 regent_far_gong:'<rect x="57" y="57" width="46" height="46"/><rect x="37" y="37" width="86" height="86"/><rect x="15" y="15" width="130" height="130" stroke-dasharray="4 6"/><path d="M80 6v22M80 132v22M6 80h22M132 80h22"/>',
 regent_crossfire:'<rect x="58" y="47" width="44" height="66"/><path d="M57 62H12l12-11M57 98H12l12 11M103 62h45l-12-11M103 98h45l-12 11"/><path d="M69 58v44M91 58v44"/>',
 spire_retreat:'<path d="M29 128V43h83M100 31l12 12-12 12M112 65v49H65M77 102l-12 12 12 12"/><path d="m29 26 10 22H19ZM107 123h10"/>',
 spire_fork:'<circle cx="80" cy="80" r="15"/><path d="M80 65V29h30M95 80h36v30M80 95v36H50M65 80H29V50"/><circle cx="110" cy="29" r="8"/><circle cx="131" cy="110" r="8"/><circle cx="50" cy="131" r="8"/><circle cx="29" cy="50" r="8"/>',
 spire_bent_dash:'<path d="M25 132V41h104M113 25l16 16-16 16"/><path d="M43 126V59h75M61 120V77h50"/><path d="m91 104 16-7 22 35-24-24Z"/>',
 archivist_parallel:'<path d="M48 17v126M112 17v126"/><path d="M36 37q12-22 24 0M100 65q12-22 24 0M36 93q12-22 24 0M100 121q12-22 24 0"/><path d="M24 17h112M24 143h112" stroke-dasharray="2 7"/>',
 archivist_cross:'<path d="M80 17v126M17 80h126"/><path d="M66 40q14-24 28 0M40 66q-24 14 0 28M120 66q-24 14 0 28M66 120q14-24 28 0"/><circle cx="80" cy="80" r="15"/>',
 archivist_border:'<rect x="28" y="28" width="104" height="104"/><path d="M28 117h104M36 117q-7-18 1-31 12 17 14 31M64 117q-7-25 1-40 12 25 14 40M92 117q-7-18 1-31 12 17 14 31M120 117q-7-25 1-40 8 25 9 40"/><path d="M44 44h72M44 60h72" opacity=".4"/>'
}
const manifest={}
for(const [id,art] of Object.entries(arts)){
 const rays=Array.from({length:24},(_,i)=>{const a=i*Math.PI/12;const x=80+Math.sin(a)*67,y=80+Math.cos(a)*67;const xx=80+Math.sin(a)*74,yy=80+Math.cos(a)*74;return '<path d="M'+x.toFixed(2)+' '+y.toFixed(2)+' '+xx.toFixed(2)+' '+yy.toFixed(2)+'"/>'}).join('')
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><radialGradient id="halo"><stop stop-color="#ffe6a8" stop-opacity=".14"/><stop offset="1" stop-color="#ffe6a8" stop-opacity="0"/></radialGradient></defs><circle cx="80" cy="80" r="77" fill="url(#halo)"/><g fill="none" stroke="#f5dfb2" stroke-width="1" opacity=".35">'+rays+'</g><g fill="#0b1724" fill-opacity=".18" stroke="#f5dfb2" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round">'+art+'</g></svg>\n'
 await writeFile(new URL(id+'.svg',out),svg);manifest[id]={file:id+'.svg',sha256:createHash('sha256').update(svg).digest('hex')}
}
await writeFile(new URL('manifest.json',out),JSON.stringify({source:'Original hand-authored SVG paths; no external artwork',generator:'scripts/generate-colossus-cards.mjs',cards:manifest},null,2)+'\n')
console.log('Created '+Object.keys(arts).length+' original card engravings')


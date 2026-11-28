#!/usr/bin/env node
/** Reproduce raw procedural texture bytes from the real TS source, without DOM,
 * WebGL, a browser, a server or a second implementation of the pixel algorithm. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourcePath='games/tyaga/src/client/terrain-materials.ts';
const manifestPath=path.join(root,'games/tyaga/art/RUNTIME_MATERIALS.json');
const source=fs.readFileSync(path.join(root,sourcePath),'utf8');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceSha256=sha(source);
const exports={};
const module={exports};
const require=name=>{if(name==='three')return THREE;throw new Error(`Unexpected terrain dependency: ${name}`);};
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(output,{exports,module,require,Uint8Array,Float32Array,Math,Map},{filename:sourcePath});
const {terrainPixels,TERRAIN_ART_VERSION}=module.exports;
if(typeof terrainPixels!=='function'||typeof TERRAIN_ART_VERSION!=='string')throw new Error('Missing actual terrain exports');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const result=structuredClone(manifest);
const rows=[];
for(const asset of result.assets){
  if(!asset.assetId.startsWith('terrain-'))continue;
  const kind=asset.assetId.slice('terrain-'.length);
  const pixels=terrainPixels(kind),repeat=terrainPixels(kind);
  for(const channel of ['color','detail']){
    if(pixels[channel].byteLength!==256*256*4||!Buffer.from(pixels[channel]).equals(Buffer.from(repeat[channel])))throw new Error(`Non-reproducible ${kind}/${channel}`);
  }
  asset.sourceSha256=sourceSha256;
  asset.version=TERRAIN_ART_VERSION;
  asset.dimensions=[256,256];
  asset.colorSha256=sha(pixels.color);
  asset.detailSha256=sha(pixels.detail);
  asset.acceptance='actual source pixel bytes verified; next-build in-game visual and performance acceptance pending';
  rows.push({kind,colorSha256:asset.colorSha256,detailSha256:asset.detailSha256});
}
if(rows.length!==8)throw new Error('Expected eight terrain pixel pairs');
result.status='source-validated-browser-pending';
result.sourceValidation.textureReproduction={
  script:'scripts/tyaga-runtime-materials.mjs',
  method:'Execute transpiled terrainPixels from the actual TS source twice; hash raw RGBA Uint8Array bytes. No renderer/DOM/simulation.',
  sourceSha256,version:TERRAIN_ART_VERSION,pairs:rows.length,bytesPerChannel:256*256*4,deterministic:true,
  inGameAcceptance:'pending for this source revision',
};
const serialized=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--check')){
  if(serialized!==fs.readFileSync(manifestPath,'utf8')){console.error('RUNTIME_MATERIALS.json is stale relative to actual generated pixels');process.exitCode=1;}
  else console.log(JSON.stringify({status:'MATCH',sourceSha256,version:TERRAIN_ART_VERSION,pairs:rows.length,renderer:false}));
}else{
  fs.writeFileSync(manifestPath,serialized);
  console.log(JSON.stringify({status:'UPDATED',sourceSha256,version:TERRAIN_ART_VERSION,pairs:rows.length,renderer:false,rows}));
}

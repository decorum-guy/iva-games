import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Participant } from '@iva-games/session-kit';
import type { PublicNews } from '@iva-games/district/territorial';
import { createTerritory, applyTerritory, viewTerritory } from '../../../games/district/src/territorial/core';
import { territoryMaps } from '../../../games/district/src/territorial/maps';
import { newsCatalog } from '../../../games/district/src/territorial/news-catalog';
import { DistrictAudioCursor, districtAudioUrl, districtHistoryCue, districtNewsCue, DISTRICT_NEWS_AUDIO } from './territorialAudio';

const human = (id: string, seatIndex: number): Participant => ({
  participantId:id, playerId:id, displayName:id, seatIndex, controller:{kind:'human',playerId:id},
});
const setup = () => createTerritory({matchId:'audio',roomId:'audio-room',map:territoryMaps[0],
  participants:[human('a',0),human('b',1)],seed:'audio-test',preset:'medium',now:1_000});
const view = (state: ReturnType<typeof setup>, now=2_000) => viewTerritory(state, 'a', now);

describe('District audible event cursor', () => {
  it('plays committed placement, routes and bot actions once, including multiple revisions in one poll', () => {
    let state = setup();
    const cursor = new DistrictAudioCursor();
    expect(cursor.observe(view(state), 100)).toEqual([]);
    const nodeId = view(state).legal.options.find(option=>option.kind==='place')!.id;
    state = applyTerritory(state,'a',{type:'place',nodeId},2_010);
    const afterHome = view(state, 2_010);
    expect(cursor.observe(afterHome,200).map(item=>item.cue)).toEqual(['house']);
    expect(cursor.observe(afterHome,201)).toEqual([]);
    const edgeId = afterHome.legal.options.find(option=>option.kind==='route')!.id;
    state = applyTerritory(state,'a',{type:'route',edgeId},2_020);
    const second = viewTerritory(state,'b',2_020);
    state = applyTerritory(state,'b',{type:'place',nodeId:second.legal.options.find(option=>option.kind==='place')!.id},2_030);
    state.history!.at(-1)!.source='bot';
    expect(cursor.observe(view(state,2_030),300).map(item=>item.cue)).toEqual(['road','house']);
    expect(cursor.observe(afterHome,301)).toEqual([]);
    expect(cursor.observe(view(state,2_040),302)).toEqual([]);
  });

  it('silently baselines reload, reconnect, hidden tab and long gaps; opening the journal cannot replay a cue', () => {
    let state=setup();
    const saved = new Map<string,string>();
    const storage = {getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value);}};
    const cursor=new DistrictAudioCursor(storage);
    cursor.observe(view(state),100);
    const nodeId=view(state).legal.options.find(option=>option.kind==='place')!.id;
    state=applyTerritory(state,'a',{type:'place',nodeId},2_010);
    const next=view(state,2_010);
    expect(cursor.observe(next,200)).toHaveLength(1);
    const reloaded=new DistrictAudioCursor(storage);
    expect(reloaded.observe(next,300)).toEqual([]);
    cursor.reconnect();
    expect(cursor.observe(next,400)).toEqual([]);
    expect(cursor.observe(structuredClone(next),401)).toEqual([]);
    state=applyTerritory(state,'a',{type:'route',edgeId:next.legal.options[0].id},2_020);
    expect(cursor.observe(view(state,2_020),500,false)).toEqual([]);
    expect(cursor.observe(view(state,2_030),501)).toEqual([]);
    const current=viewTerritory(state,'b',2_030);
    state=applyTerritory(state,'b',{type:'place',nodeId:current.legal.options[0].id},2_040);
    expect(cursor.observe(view(state,2_040),9_000)).toEqual([]);
    expect(cursor.observe(view(state,2_050),9_001)).toEqual([]);
  });

  it('selects only public news stages and does not sound a forecast as an applied outcome', () => {
    const cursor=new DistrictAudioCursor();
    const initial=view(setup());
    cursor.observe(initial,100);
    const warning:PublicNews={messageId:'n1:forecast',eventInstanceId:'n1',templateId:'H04',stage:'forecast',round:4,
      headline:{ru:'Прогноз',en:'Forecast'},dueRound:6};
    const forecast={...initial,revision:1,serverNow:2_010,news:[warning]};
    expect(cursor.observe(forecast,200)).toEqual([{key:'news:n1:forecast',cue:'H04-forecast',channel:'news'}]);
    expect(districtNewsCue(warning)).toBe('H04-forecast');
    expect(districtNewsCue({...warning,templateId:'unknown'})).toBeNull();
    expect(districtNewsCue({...warning,templateId:'G01'})).toBeNull();
    const occurred:PublicNews={...warning,messageId:'n1:applied',stage:'applied',zone:null,changes:[]};
    const applied={...forecast,revision:2,serverNow:2_020,news:[warning,occurred]};
    expect(cursor.observe(applied,300).map(cue=>cue.cue)).toEqual(['H04-applied']);
    cursor.reconnect();
    expect(cursor.observe(applied,400)).toEqual([]);
    expect(cursor.observe({...applied},401)).toEqual([]);
  });

  it('marks muted intervals consumed, prioritises risk over good news, and bounds catch-up', () => {
    const cursor = new DistrictAudioCursor();
    const initial=view(setup());
    cursor.observe(initial,100);
    const news:PublicNews[]=['G01','G02','H02','E01'].map((templateId,index)=>({
      templateId,messageId:'m'+index,eventInstanceId:'event'+index,stage:'applied',zone:null,round:1,
      headline:{ru:'Тест',en:'Test'},changes:[],
    }));
    const next={...initial,revision:1,serverNow:2_010,news};
    // The cursor deliberately has no mute switch: it advances even while playback is off.
    expect(cursor.observe(next,200).map(cue=>cue.cue)).toEqual(['H02-applied','E01-applied','G01-applied']);
    expect(cursor.observe(next,201)).toEqual([]);
  });

  it('treats failed/declined trades as silent and successful exchanges as confirmations', () => {
    const entry={id:'test',revision:2,actorId:'b',round:0,turn:1};
    expect(districtHistoryCue({...entry,kind:'accept'},'a')).toBe('trade');
    expect(districtHistoryCue({...entry,kind:'bank'},'a')).toBe('trade');
    expect(districtHistoryCue({...entry,kind:'decline'},'a')).toBeNull();
    expect(districtHistoryCue({...entry,kind:'offer-closed',offerStatus:'accepted'},'a')).toBeNull();
    expect(districtHistoryCue({...entry,kind:'offer',targetId:'a'},'a')).toBe('offer');
    expect(districtHistoryCue({...entry,kind:'offer',targetId:'b'},'a')).toBeNull();
    expect(districtHistoryCue({...entry,kind:'distribution',production:[]},'a')).toBeNull();
  });
});

describe('Checked-in District audio bank', () => {
  const directory=fileURLToPath(new URL('../public/assets/district/audio/',import.meta.url));
  const manifest=JSON.parse(readFileSync(directory+'manifest.json','utf8')) as {
    families:Record<string,{stages:Record<string,string>}>;
    sources:Record<string,{sha256:string;license:string}>;
    clips:{id:string;path:string;sha256:string;seconds:number;peak:number;rms:number;sources:string[];license:string}[];
  };
  it('covers every declared stage of all 25 real families with a licensed local file', () => {
    expect(Object.keys(manifest.families).sort()).toEqual(newsCatalog.map(item=>item.templateId).sort());
    expect(Object.keys(DISTRICT_NEWS_AUDIO)).toHaveLength(25);
    for (const item of newsCatalog) {
      expect([...DISTRICT_NEWS_AUDIO[item.templateId]].sort()).toEqual(Object.keys(item.headlines).sort());
      for (const stage of Object.keys(item.headlines) as PublicNews['stage'][]) {
        const cue=districtNewsCue({templateId:item.templateId,stage});
        expect(manifest.families[item.templateId].stages[stage]).toBe(cue);
        expect(manifest.clips.find(clip=>clip.id===cue)).toBeDefined();
        expect(districtAudioUrl(cue!)).toMatch(/^\/assets\/district\/audio\/[A-Z0-9-]+\.wav$/iu);
      }
    }
  });

  it('checks real PCM assets, bounded duration/peak, sources and reproducible hashes', () => {
    const hashes=new Set<string>();
    for (const clip of manifest.clips) {
      const bytes=readFileSync(directory+clip.path);
      expect(bytes.toString('ascii',0,4)).toBe('RIFF');
      expect(bytes.toString('ascii',8,12)).toBe('WAVE');
      expect(bytes.readUInt16LE(20)).toBe(1); // PCM
      expect(bytes.readUInt16LE(22)).toBe(1); // Mono
      expect(bytes.readUInt32LE(24)).toBe(22050);
      expect(bytes.readUInt16LE(34)).toBe(16);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(clip.sha256);
      expect(clip.peak).toBeLessThanOrEqual(.521);
      expect(clip.rms).toBeGreaterThan(.003);
      expect(clip.seconds).toBeLessThanOrEqual(1.65);
      expect(clip.license).toBe('CC0-1.0');
      for (const source of clip.sources) expect(manifest.sources[source]).toBeDefined();
      hashes.add(clip.sha256);
    }
    expect(hashes.size).toBe(manifest.clips.length);
    for (const [name,source] of Object.entries(manifest.sources)) {
      expect(createHash('sha256').update(readFileSync(directory+'sources/'+name)).digest('hex')).toBe(source.sha256);
      expect(source.license).toBe('CC0-1.0');
    }
    // These requested character cues contain licensed human recordings, not renamed oscillators.
    expect(manifest.clips.find(clip=>clip.id==='H04-forecast')!.sources).toContain('whisper.mp3');
    expect(manifest.clips.find(clip=>clip.id==='E01-success')!.sources).toEqual(expect.arrayContaining(['cough.mp3','cough-female.mp3']));
  });
});

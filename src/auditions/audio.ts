import { planSceneCues, prepareSceneAudio } from '../scene/audio';
import type { CueKind, RecordedClip } from '../scene/audio';
import { promotionTiming } from '../scene/promotionMotion';
import type { Demo, Group } from './demos';

export type Variant = 'current' | 'R1' | 'R2' | 'P1' | 'P2' | 'CURRENT-STONE-SOLO' | 'P1-STONE-SOLO';
type Pack = Exclude<Variant, 'current' | 'CURRENT-STONE-SOLO'>;

export interface Candidate {
  readonly id: string;
  readonly file: string;
  readonly source_ids: readonly string[];
  readonly decoded_duration_seconds: number;
  readonly decoded_frames: number;
  readonly sample_rate_hz: number;
  readonly sync: {
    readonly physical_contact_seconds?: number | null;
    readonly physical_contact_reference_seconds?: number;
    readonly main_formation_layer_onset_seconds?: number | null;
  };
  readonly existing_scene_recipe?: { readonly layers: readonly { readonly source: string; readonly at_s: number }[] };
}

interface Source {
  readonly original_filename: string;
  readonly creator?: string;
  readonly author?: string;
  readonly page_url?: string;
  readonly source_url?: string;
  readonly license_url: string;
  readonly license: string;
}

interface Catalog {
  readonly candidates: readonly Candidate[];
  readonly event_candidates: Readonly<Record<Group | 'promotion.queen.fracture', Partial<Record<Pack, string>>>>;
  readonly sources: Readonly<Record<string, Source>>;
}

export interface Library {
  readonly bank: AudioBuffer;
  readonly catalog: Catalog;
  readonly buffers: ReadonlyMap<string, AudioBuffer>;
}

const directory = `${import.meta.env.BASE_URL}assets/audio/auditions/`;
let loading: Promise<Library> | undefined;

export function prepareLibrary() {
  loading ??= loadLibrary().catch((error: unknown) => { loading = undefined; throw error; });
  return loading;
}

async function loadLibrary(): Promise<Library> {
  const Offline = globalThis.OfflineAudioContext ??
    (globalThis as typeof globalThis & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) throw new Error('Offline audio decoding unavailable');
  const decoder = new Offline(2, 1, 48000);
  const [catalog, bankBytes] = await Promise.all([
    fetch(`${directory}catalog.json`).then(response => {
      if (!response.ok) throw new Error('Audition catalog unavailable');
      return response.json() as Promise<Catalog>;
    }),
    prepareSceneAudio(),
  ]);
  if (!bankBytes) throw new Error('Current audio bank unavailable');
  const [bank, entries] = await Promise.all([
    decoder.decodeAudioData(bankBytes.slice(0)),
    Promise.all(catalog.candidates.map(async asset => {
      const response = await fetch(`${directory}${asset.file}`);
      if (!response.ok) throw new Error(`Missing ${asset.file}`);
      const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
      if (buffer.numberOfChannels !== 2 || Math.abs(buffer.duration - asset.decoded_duration_seconds) > .06) {
        throw new Error(`Unexpected decoded length or channels for ${asset.file}`);
      }
      return [asset.id, buffer] as const;
    })),
  ]);
  return { bank, catalog, buffers: new Map(entries) };
}

export function variantsFor(group: Group, solo = false): readonly Variant[] {
  return solo ? ['CURRENT-STONE-SOLO', 'P1-STONE-SOLO'] : group.startsWith('reaction.')
    ? ['current', 'R1', 'R2'] : ['current', 'P1', 'P2'];
}

export function candidateFor(library: Library, group: Group, variant: Variant) {
  if (variant === 'current' || variant === 'CURRENT-STONE-SOLO') return undefined;
  const event = variant === 'P1-STONE-SOLO' ? 'promotion.queen.fracture' : group;
  const id = library.catalog.event_candidates[event][variant];
  return library.catalog.candidates.find(asset => asset.id === id);
}

const reactionEdits: Record<string, [start: number, end: number, decibels: number, tail: number]> = {
  'r1-guilt': [0, 1.40, -8, .23],
  'r1-devastated': [.29, 1.67, -8, .24],
  'r1-berserk': [.40, 1.66, -12, .24],
  'r1-bloodlust': [.57, 1.98, -8, .25],
  'r2-guilt': [.22, 1.433, -8, .25],
  'r2-devastated': [.16, 1.20, -2, .20],
  'r2-berserk': [.36, 1.20, -2, .20],
  // One short phrase ending in the measured low-energy gap. The original is a separate listen button.
  'r2-bloodlust': [0, 1.54, -7, .24],
};
const promotionGain: Record<string, number> = {
  'p1-formation': -8, 'p2-formation': -5, 'p1-rook': -6, 'p2-rook': -8,
  'p1-queen': -6, 'p2-queen': -8, 'p1-queen-fracture-only': -6,
};
const replaceable = {
  'reaction.guilt': ['guilt'], 'reaction.devastated': ['devastated'],
  'reaction.berserk': ['berserk'], 'reaction.bloodlust': ['bloodlust'],
  'promotion.formation': ['promotionFormation'], 'promotion.rook': ['promotionRookApproach', 'promotionRookImpact'],
  'promotion.queen': ['promotionQueenApproach', 'promotionQueenImpact', 'promotionQueenFracture', 'promotionQueenArc'],
} as const satisfies Readonly<Record<Group, readonly CueKind[]>>;

export function clipEdit(asset: Candidate, demo: Demo) {
  const reaction = reactionEdits[asset.id];
  if (reaction) {
    const [offset, end, decibels, fadeOut] = reaction;
    const cue = planSceneCues(demo.events, { plan: demo.plan }).find(value => `reaction.${value.kind}` === demo.group);
    if (!cue) throw new Error(`Reaction cue missing for ${asset.id}`);
    return { at: cue.at, offset, duration: end - offset, decibels, fadeIn: .014, fadeOut };
  }
  const promotion = demo.plan.promotion;
  if (!promotion) throw new Error(`Promotion cue missing for ${asset.id}`);
  const { reduced } = demo.plan;
  const { impact, duration } = promotionTiming(promotion.event.promotion, reduced);
  const formation = asset.sync.main_formation_layer_onset_seconds;
  const marker = formation ?? asset.sync.physical_contact_seconds ?? asset.sync.physical_contact_reference_seconds;
  if (marker === undefined) throw new Error(`Missing contact marker for ${asset.id}`);
  const target = formation != null ? (reduced ? .055 : .15) : impact / 1000;
  const lead = Math.max(0, target - marker);
  const offset = Math.max(0, marker - target);
  return { at: promotion.formationAt / 1000 + lead, offset,
    duration: Math.min(asset.decoded_duration_seconds - offset, duration / 1000 - lead),
    decibels: promotionGain[asset.id], fadeIn: .014,
    fadeOut: reduced ? .14 : promotion.event.promotion === 'queen' ? .32 : .22 };
}

export function makePlayback(library: Library, group: Group, variant: Variant, demo: Demo, chant = false) {
  const stock = planSceneCues(demo.events, { plan: demo.plan });
  const asset = candidateFor(library, group, variant);
  const solo = variant.endsWith('STONE-SOLO');
  if (!asset) {
    return { cues: solo ? stock.filter(cue => cue.kind === 'promotionQueenFracture') : stock,
      clip: undefined, asset: undefined };
  }
  const edit = chant ? { at: 0, offset: 0, duration: asset.decoded_duration_seconds, decibels: -7,
    fadeIn: .014, fadeOut: .12 } : clipEdit(asset, demo);
  const buffer = library.buffers.get(asset.id);
  if (!buffer) throw new Error(`Undecoded ${asset.file}`);
  const replaced: readonly CueKind[] = replaceable[group];
  const clip: RecordedClip = { ...edit, buffer, gain: 10 ** (edit.decibels / 20) };
  return { cues: solo || chant ? [] : stock.filter(cue => !replaced.includes(cue.kind)), clip, asset };
}

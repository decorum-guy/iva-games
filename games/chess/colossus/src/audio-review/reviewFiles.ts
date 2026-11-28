import { SOUND_BANK_VERSION, SOUND_NAMES } from '../ui/audio';
import type { SoundName } from '../ui/audio';

export interface BankManifest { version: number; sounds: Record<SoundName, { sha256: string }> }

export async function loadSoundBank(signal: AbortSignal): Promise<BankManifest> {
  const response = await fetch('/assets/colossus/audio/manifest.json?v=' + SOUND_BANK_VERSION, { signal });
  if (!response.ok) throw new Error('Missing sound bank');
  const bank = await response.json() as BankManifest;
  if (!SOUND_NAMES.every(name => /^[0-9a-f]{64}$/.test(bank.sounds?.[name]?.sha256))) throw new Error('Incomplete sound bank');
  return bank;
}

export function downloadReview(filename: string, lines: string[]) {
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

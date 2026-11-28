"""Reproducible original COLOSSUS Foley and musical cues; no sampled recordings.

The source builds damped modal stone/bronze voices, filtered deterministic noise,
and short tuned motifs. Output is mono 32 kHz / 16-bit PCM with headroom, DC
removal, a zero-crossing envelope at both ends, and a measured manifest.
The two owner-selected auditions are copied byte-for-byte after checksum checks;
the remaining fifteen cues retain their v2 synthesis and random seeds.
"""
from pathlib import Path
import hashlib
import io
import json
import math
import random
import struct
import wave

ROOT = Path(__file__).resolve().parents[1] / 'public/assets/colossus/audio'
VARIANTS = Path(__file__).resolve().parents[1] / 'src/audio-review/variants'
SELECTED = {
    'armour': ('armour-a', '64203aea15ad5b9a58eaadcb54be16688276127b3b8c887137cbf90a7709d852'),
    'shield': ('shield-a', 'fb2f6236305db6799ccde1d20287bc801dfeb31e9da89f16cd32b0200d5cdc7b'),
}
SR = 32_000
# Preserve the v2 source parameters. SELECTED overrides its two historical cues.
SPECS = {
    'move': (.20, .46), 'stone': (.44, .54), 'armour': (.54, .50),
    'wound': (.38, .48), 'shield': (.68, .46), 'card': (.58, .42),
    'fire': (.86, .44), 'victory': (1.90, .48), 'defeat': (1.60, .46),
    'capture': (.84, .53), 'armor-break': (.92, .53),
    'promotion-minor': (1.08, .46), 'promotion-rook': (1.34, .52),
    'promotion-queen': (1.82, .51), 'telegraph': (.72, .44),
    'heal': (.78, .42), 'boss-move': (.68, .53),
}
TAU = math.tau


def mode(t, frequency, decay, weight=1.0):
    return 0.0 if t < 0 else weight * math.sin(TAU * frequency * t) * math.exp(-t / decay)


def bronze(t, hz, decay=.3):
    return sum(mode(t, hz * ratio, decay / (1 + i * .38), weight)
               for i, (ratio, weight) in enumerate([(1, .6), (2.76, .22), (5.40, .12), (8.93, .055)]))


def stone(t, hz=95, decay=.09):
    return sum(mode(t, hz * ratio, decay / (1 + i * .3), weight)
               for i, (ratio, weight) in enumerate([(1, .62), (1.61, .24), (2.48, .11)]))


def motif(t, notes, interval=.13, base=220, decay=.35):
    return sum(bronze(t - i * interval, base * 2 ** (note / 12), decay) * .36
               for i, note in enumerate(notes) if t >= i * interval)


def synth(name, duration):
    rng = random.Random('iva-games/colossus/original-sfx/v2/' + name)
    out = []
    low = 0.0
    prev_noise = 0.0
    for i in range(round(SR * duration)):
        t = i / SR
        noise = rng.uniform(-1, 1)
        low += .13 * (noise - low)
        high = noise - prev_noise
        prev_noise = noise
        if name == 'move':
            sample = stone(t, 390, .028) * .48 + stone(t - .045, 160, .045) * .25
            sample += high * .035 * math.exp(-t / .035)
        elif name == 'stone':
            sample = stone(t, 72, .12) + stone(t - .018, 188, .07) * .28 + low * .25 * math.exp(-t / .10)
        elif name == 'armour':
            sample = bronze(t, 275, .22) + high * .055 * math.exp(-t / .022)
        elif name == 'armor-break':
            sample = stone(t, 66, .18) * .62 + bronze(t, 310, .25) * .52
            for offset, hz in [(.06, 780), (.105, 1150), (.17, 620), (.26, 940)]:
                sample += bronze(t - offset, hz, .16) * .13
            sample += high * .14 * math.exp(-t / .20)
        elif name == 'capture':
            sample = stone(t, 60, .21) * .85 + low * .28 * math.exp(-t / .19)
            for offset, hz in [(.055, 220), (.13, 170), (.23, 130), (.34, 93)]:
                sample += stone(t - offset, hz, .055) * .28
        elif name == 'wound':
            sample = stone(t, 114, .11) * .8 + low * .20 * math.exp(-t / .07)
        elif name == 'shield':
            sample = bronze(t, 550, .36) * .62 + mode(t, 825, .28, .20)
            sample += low * .12 * math.sin(min(1, t / .16) * math.pi / 2) * math.exp(-t / .19)
        elif name == 'card':
            sample = high * .18 * math.exp(-((t - .06) / .08) ** 2) + motif(t, [0, 7], .12, 330, .22)
        elif name == 'fire':
            sample = low * .30 * (.65 + .35 * math.sin(TAU * 7 * t)) * math.exp(-t / .30)
            sample += high * .12 * max(0, math.sin(TAU * 23 * t)) ** 14 * math.exp(-t / .35)
            sample += stone(t, 58, .26) * .25
        elif name == 'victory':
            sample = motif(t, [0, 7, 12, 16, 19, 24], .16, 196, .60)
            sample += sum(mode(t - .48, hz, .65, .09) for hz in [196, 246.94, 293.66, 392])
        elif name == 'defeat':
            sample = motif(t, [7, 3, 0, -5], .22, 146.83, .48)
            sample += stone(t, 49, .50) * .26
        elif name == 'promotion-minor':
            sample = motif(t, [0, 7, 12, 19], .11, 330, .36)
            sample += low * .08 * math.exp(-((t - .14) / .13) ** 2)
        elif name == 'promotion-rook':
            sample = stone(t, 55, .23) * .70 + bronze(t - .07, 165, .50) * .58
            sample += motif(t - .10, [0, 7, 12], .16, 220, .43)
        elif name == 'promotion-queen':
            sample = stone(t, 49, .29) * .78 + bronze(t - .04, 220, .48) * .50
            sample += motif(t - .12, [0, 4, 7, 12, 16, 19], .12, 261.63, .58)
            sample += high * .075 * math.exp(-((t - .12) / .10) ** 2)
        elif name == 'telegraph':
            sample = bronze(t, 110, .21) * .58 + bronze(t - .22, 146.83, .23) * .45
        elif name == 'heal':
            sample = motif(t, [0, 4, 12], .13, 440, .28)
            sample += mode(t, 880, .38, .08)
        else:  # boss-move: two weighty steps, distinct from the expedition pieces.
            sample = stone(t, 49, .15) * .8 + stone(t - .18, 65, .15) * .65
            sample += low * .15 * math.exp(-t / .27)
        # Taper the final 35 ms; no abrupt edge or hidden loop discontinuity.
        attack = min(1.0, t / .0025)
        tail = min(1.0, max(0, (duration - t) / .035))
        out.append(sample * attack * tail)
    # Remove residual DC before final normalization and taper once more.
    dc = sum(out) / len(out)
    out = [(value - dc) * min(1, i / 80, (len(out) - 1 - i) / 1120) for i, value in enumerate(out)]
    return out


def selected_samples():
    """Validate every approved source before writing any game-bank file."""
    selected = {}
    for name, (variant, expected_hash) in SELECTED.items():
        blob = (VARIANTS / (variant + '.wav')).read_bytes()
        if hashlib.sha256(blob).hexdigest() != expected_hash:
            raise ValueError('Owner-selected audio checksum changed: ' + variant)
        with wave.open(io.BytesIO(blob), 'rb') as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, SR, 'NONE'):
                raise ValueError('Unexpected owner-selected audio format: ' + variant)
            frames = wav.getnframes()
            pcm = struct.unpack('<' + 'h' * frames, wav.readframes(frames))
        selected[name] = (blob, pcm, frames / SR)
    return selected


def main():
    selected = selected_samples()
    ROOT.mkdir(parents=True, exist_ok=True)
    sounds = {}
    for name, (duration, target_peak) in SPECS.items():
        path = ROOT / (name + '.wav')
        if name in selected:
            blob, pcm, duration = selected[name]
            path.write_bytes(blob)
        else:
            values = synth(name, duration)
            gain = target_peak / max(abs(value) for value in values)
            pcm = [round(value * gain * 32767) for value in values]
            assert max(abs(value) for value in pcm) < 32767
            with wave.open(str(path), 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(SR)
                wav.writeframes(struct.pack('<' + 'h' * len(pcm), *pcm))
        blob = path.read_bytes()
        peak = max(abs(value) for value in pcm) / 32768
        rms = math.sqrt(sum((value / 32768) ** 2 for value in pcm) / len(pcm))
        sounds[name] = {'file': path.name, 'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest(),
                        'seconds': duration, 'sampleRate': SR, 'channels': 1,
                        'peakDbFS': round(20 * math.log10(peak), 2), 'rmsDbFS': round(20 * math.log10(rms), 2)}
    (ROOT / 'manifest.json').write_text(json.dumps({
        'source': 'Original deterministic modal synthesis; no third-party recordings or samples',
        'generator': 'scripts/generate-colossus-audio.py', 'version': 3, 'sounds': sounds,
    }, indent=2) + '\n')
    print(json.dumps({'sounds': len(sounds), 'bytes': sum(x['bytes'] for x in sounds.values()),
                      'maxPeakDbFS': max(x['peakDbFS'] for x in sounds.values())}))


if __name__ == '__main__':
    main()

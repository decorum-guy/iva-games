"""Build the six original armor and shield auditions outside the game sound bank."""

import hashlib
import json
import math
from pathlib import Path
import random
import struct
import wave

RATE = 32_000
OUT = Path(__file__).resolve().parents[1] / "src/audio-review/variants"
LENGTHS = {
    "armour-a": .36, "armour-b": .41, "armour-c": .30,
    "shield-a": .39, "shield-b": .46, "shield-c": .57,
}


def resonances(time, modes):
    if time < 0:
        return 0
    return sum(amplitude * math.sin(math.tau * frequency * time) * math.exp(-time / decay)
               for frequency, decay, amplitude in modes)


def falling_body(time, start, end, pitch_decay, volume_decay):
    phase = end * time + (start - end) * pitch_decay * (1 - math.exp(-time / pitch_decay))
    return math.sin(math.tau * phase) * math.exp(-time / volume_decay)


def voice(name, time, low, band, bright):
    if name == "armour-a":
        # A centered plate strike, with the wooden backing carrying the body.
        metal = resonances(time, [(376, .058, .33), (638, .11, .27), (1123, .063, .22),
                                  (1841, .035, .14), (2722, .018, .10)])
        backing = resonances(time, [(132, .042, .47), (251, .035, .16)])
        return metal + backing + (.35 * bright + .24 * band) * math.exp(-time / .016)
    if name == "armour-b":
        # The edge hits first, then the low wooden face and a few short rattles.
        face = resonances(time, [(107, .075, .64), (186, .051, .23), (326, .034, .19)])
        rim = resonances(time, [(505, .066, .19), (895, .044, .19), (1517, .028, .13)])
        shake = resonances(time - .032, [(1030, .024, .16), (1487, .014, .10)])
        return face + rim + shake + (.36 * band + .16 * bright) * math.exp(-time / .026)
    if name == "armour-c":
        # A hard glancing contact and brief high metallic rebound.
        plate = resonances(time, [(223, .039, .34), (543, .053, .26), (1151, .048, .24),
                                  (1907, .031, .23), (3033, .016, .13)])
        rebound = resonances(time - .028, [(854, .025, .20), (2249, .018, .13)])
        return plate + rebound + (.52 * bright + .15 * band) * math.exp(-time / .012)
    if name == "shield-a":
        # A rounded body and a muffled rush give a hit a clear stopping point.
        body = falling_body(time, 177, 72, .033, .078)
        pad = resonances(time, [(216, .053, .21), (369, .027, .10)])
        rush = (.54 * low + .15 * band) * (1 - math.exp(-time / .010)) * math.exp(-time / .055)
        return .69 * body + pad + rush
    if name == "shield-b":
        # Dense close thump plus an irregular surface vibration, with no long ring.
        body = resonances(time, [(103, .105, .49), (168, .084, .31), (284, .057, .20),
                                 (483, .027, .12)])
        surface = (.56 * low + .22 * band) * (.8 + .2 * math.sin(math.tau * 33 * time))
        return body + surface * math.exp(-time / .080)
    # A short ward swell over a damp hit, with space for the next cue.
    body = .47 * falling_body(time, 167, 86, .036, .066)
    glass = resonances(time, [(529, .145, .12), (779, .136, .20), (1135, .104, .12),
                              (1581, .083, .075), (2420, .070, .036)])
    swell = 1 - math.exp(-time / .034)
    return body + (glass + .25 * low + .14 * band) * swell * math.exp(-time / .140)


def render(name, duration):
    random_source = random.Random("iva-games/colossus/auditions/2026-11-28/" + name)
    low = mid = previous = 0.0
    output = []
    for step in range(round(duration * RATE)):
        time = step / RATE
        noise = random_source.uniform(-1, 1)
        low += .034 * (noise - low)
        mid += .36 * (noise - mid)
        high = noise - previous
        previous = noise
        signal = voice(name, time, low, mid - low, high)
        output.append(math.tanh(1.65 * signal))
    dc = sum(output) / len(output)
    output = [(value - dc) * min(1, i / 72, (len(output) - 1 - i) / 1024)
              for i, value in enumerate(output)]
    peak = max(abs(value) for value in output)
    rms = math.sqrt(sum(value * value for value in output) / len(output))
    gain = min(.52 / peak, 10 ** (-20.5 / 20) / rms)
    return [round(value * gain * 32767) for value in output]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, seconds in LENGTHS.items():
        location = OUT / f"{name}.wav"
        pcm = render(name, seconds)
        with wave.open(str(location), "wb") as stream:
            stream.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            stream.writeframes(struct.pack(f"<{len(pcm)}h", *pcm))
        assert pcm[0] == pcm[-1] == 0 and max(abs(value) for value in pcm) < 32767
        peak = max(abs(value) for value in pcm) / 32768
        rms = math.sqrt(sum((value / 32768) ** 2 for value in pcm) / len(pcm))
        manifest[name] = {
            "sha256": hashlib.sha256(location.read_bytes()).hexdigest(),
            "seconds": seconds,
            "peakDbFS": round(20 * math.log10(peak), 2),
            "rmsDbFS": round(20 * math.log10(rms), 2),
        }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()

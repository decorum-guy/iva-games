#!/usr/bin/env python3
"""Cut five measured contacts per CC0 source. The renderer schedules their real times."""
from array import array
from math import sqrt
from pathlib import Path
import subprocess
import sys

RATE = 48000
WINDOW = round(RATE * .108)
STRIDE = round(RATE * .128)
TAKES = {
    'd1': (.941, 1.146, 1.247, 1.372, 1.487),
    'd2': (.067, .187, .328, .428, .527),
    'd3': (1.752, 1.871, 1.953, 2.042, 2.128),
}


def build(source, output, transients):
    decoded = array('f')
    decoded.frombytes(subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(source), '-ac', '2', '-ar', str(RATE), '-f', 'f32le', '-',
    ]))
    if sys.byteorder != 'little':
        decoded.byteswap()
    result = array('f')
    for transient, target in zip(transients, (.052, .044, .038, .032, .026)):
        begin = round(RATE * (transient - .009))
        chunk = decoded[begin * 2:(begin + WINDOW) * 2]
        assert len(chunk) == WINDOW * 2
        rms = sqrt(sum(value * value for value in chunk) / len(chunk))
        gain = min(target / rms, .42 / max(map(abs, chunk)))
        for i, value in enumerate(chunk):
            frame = i // 2
            fade = min(1, frame / (RATE * .004), (WINDOW - 1 - frame) / (RATE * .028))
            result.append(value * gain * fade)
        result.extend([0.0] * ((STRIDE - WINDOW) * 2))
    if sys.byteorder != 'little':
        result.byteswap()
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', str(RATE), '-i', '-',
        '-codec:a', 'libmp3lame', '-b:a', '192k', str(output),
    ], input=result.tobytes(), check=True)


if __name__ == '__main__':
    source_dir = Path(sys.argv[1])
    out = Path(__file__).resolve().parents[1] / 'public/assets/audio/dice-auditions'
    out.mkdir(parents=True, exist_ok=True)
    for name, take in TAKES.items():
        build(source_dir / (name + '.mp3'), out / (name + '.mp3'), take)

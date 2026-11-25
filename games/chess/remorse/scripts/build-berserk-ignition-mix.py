#!/usr/bin/env python3
"""Rebuild the selected ignition mix from the public F1 and F2 previews."""
from array import array
from math import sqrt
from pathlib import Path
import subprocess
import sys

RATE = 48000
SOURCE = Path(sys.argv[1])
OUTPUT = Path(__file__).resolve().parents[1] / 'public/assets/audio/showcase/berserk-ignition-f1-f2.mp3'


def excerpt(name, start, length):
    samples = array('f')
    samples.frombytes(subprocess.check_output([
        'ffmpeg', '-v', 'error', '-ss', str(start), '-i', str(SOURCE / (name + '.mp3')),
        '-t', str(length), '-ac', '2', '-ar', str(RATE), '-af', 'highpass=f=78,lowpass=f=7800',
        '-f', 'f32le', '-',
    ]))
    if sys.byteorder != 'little':
        samples.byteswap()
    rms = sqrt(sum(sample * sample for sample in samples) / len(samples))
    gain = min(.054 / rms, .46 / max(map(abs, samples)))
    for i, value in enumerate(samples):
        edge = min(1, i / (RATE * 2 * .012), (len(samples) - 1 - i) / (RATE * 2 * .120))
        samples[i] = value * gain * edge
    return samples


def main():
    mix = array('f', [0]) * round(.88 * RATE) * 2
    for name, start, length, delay, gain in (
        ('f1', 1.760, .568, 0, .68), ('f2', .280, .590, .132, .63),
    ):
        offset = round(delay * RATE) * 2
        for i, value in enumerate(excerpt(name, start, length)):
            mix[offset + i] += gain * value
    # A faint room return closes the two real contact tails together.
    dry = mix[:]
    for delay, gain in ((.041, .085), (.090, .044)):
        offset = round(delay * RATE) * 2
        for i in range(offset, len(mix)):
            mix[i] += dry[i - offset] * gain
    if sys.byteorder != 'little':
        mix.byteswap()
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '2', '-i', '-',
        '-c:a', 'libmp3lame', '-b:a', '192k', str(OUTPUT),
    ], input=mix.tobytes(), check=True)


if __name__ == '__main__':
    main()

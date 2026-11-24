#!/usr/bin/env python3
"""Render the selected steel check from the CC0 source in the audio manifest."""
import argparse
from array import array
from math import sqrt
from pathlib import Path
import subprocess
import sys

RATE = 48000
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / 'public/assets/audio/showcase/royal-check.mp3'


def silence(seconds):
    return array('f', [0]) * round(seconds * RATE) * 2


def add(output, samples, delay=0, gain=1):
    offset = round(delay * RATE) * 2
    for i, sample in enumerate(samples[:len(output) - offset]):
        output[i + offset] += sample * gain


def strike(path):
    samples = array('f')
    samples.frombytes(subprocess.check_output([
        'ffmpeg', '-v', 'error', '-ss', '2.397', '-i', str(path),
        '-af', f'aresample={RATE},asetrate=43680,aresample={RATE},highpass=f=110,lowpass=f=3650',
        '-t', '0.32', '-ac', '2', '-ar', str(RATE), '-f', 'f32le', '-',
    ]))
    if sys.byteorder != 'little':
        samples.byteswap()
    peak = max(map(abs, samples))
    for i, sample in enumerate(samples):
        head = (i + 1) / (RATE * 2 * .0018)
        tail = (len(samples) - 1 - i) / (RATE * 2 * .093)
        samples[i] = sample * min(1, max(0, head), max(0, tail))
    dry = silence(.42)
    add(dry, samples, .004, 1 / peak)
    direct = dry[:]
    add(dry, direct, .041, .052)
    add(dry, direct, .079, .052 * .55)
    peak = max(map(abs, dry))
    return array('f', (sample * .74 / peak for sample in dry))


def steel_room(dry):
    output = silence(.70)
    add(output, dry)
    for channel, delays in enumerate(((.030, .043, .052, .061), (.034, .047, .058, .067))):
        source = output[channel::2]
        combs = [[0.] * round(delay * RATE) for delay in delays]
        damping = [0.] * len(combs)
        wet = array('f')
        predelay = round(.020 * RATE)
        for i in range(len(source)):
            excitation = source[i - predelay] if i >= predelay else 0.
            sum_reflections = 0.
            for j, comb in enumerate(combs):
                index = i % len(comb)
                reflection = comb[index]
                damping[j] = .64 * reflection + .36 * damping[j]
                comb[index] = excitation + (.76 - .035 * j) * damping[j]
                sum_reflections += reflection / len(combs)
            wet.append(sum_reflections)
        scale = .51 * sqrt(sum(value * value for value in source) / sum(value * value for value in wet))
        for i, value in enumerate(wet):
            tail = min(1., (len(wet) - 1 - i) / (.104 * RATE))
            output[2 * i + channel] += value * scale * tail
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='local path to the Sandermotions public preview')
    parser.add_argument('output', type=Path, nargs='?', default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    samples = steel_room(strike(args.source))
    if sys.byteorder != 'little':
        samples.byteswap()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '2', '-i', '-',
        '-c:a', 'libmp3lame', '-b:a', '192k', str(args.output),
    ], input=samples.tobytes(), check=True)


if __name__ == '__main__':
    main()

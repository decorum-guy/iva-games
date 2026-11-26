#!/usr/bin/env python3
"""Render the selected P1/P2 rook mix from the supplied audition MP3s."""

from array import array
import json
from pathlib import Path
import subprocess
import sys

RATE = 48000
ROOT = Path(__file__).resolve().parents[1] / 'public/assets/audio'
CATALOG = json.loads((ROOT / 'auditions/catalog.json').read_text())


def samples(path):
    pcm = array('f')
    pcm.frombytes(subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-ac', '2', '-ar', str(RATE),
        '-f', 'f32le', '-',
    ]))
    if sys.byteorder != 'little':
        pcm.byteswap()
    return pcm


def rook_mix(stereo):
    result = array('f', stereo)
    for channel in range(2):
        dry = stereo[channel::2]
        echo = round(RATE * (.074 if channel == 0 else .081))
        room_delays = ((.019, .027, .035, .041), (.022, .029, .038, .044))[channel]
        combs = [[0.0] * round(RATE * delay) for delay in room_delays]
        tail = [0.0] * len(combs)
        diffusers = [[0.0] * round(RATE * delay) for delay in (.005 + channel * .001, .009)]
        for index, value in enumerate(dry):
            reflections = 0.0
            for step, comb in enumerate(combs):
                address = index % len(comb)
                wet = comb[address]
                tail[step] = .61 * wet + .39 * tail[step]
                comb[address] = value + (.59 - step * .035) * tail[step]
                reflections += wet / len(combs)
            for diffuser in diffusers:
                address = index % len(diffuser)
                wet = diffuser[address] - .55 * reflections
                diffuser[address] = reflections + .55 * wet
                reflections = wet
            repeat = dry[index - echo] if index >= echo else 0.0
            result[2 * index + channel] = value + .135 * repeat + .12 * reflections
    return result


def build():
    by_id = {item['id']: item for item in CATALOG['candidates']}
    p1, p2 = by_id['p1-rook'], by_id['p2-rook']
    assert p1['sync']['physical_contact_seconds'] == p2['sync']['physical_contact_seconds'] == .420
    left, right = (samples(ROOT / 'auditions' / item['file']) for item in (p1, p2))
    assert len(left) == len(right) == 2 * p2['decoded_frames']
    mixed = array('f', (a * 10 ** (-14 / 20) + b * 10 ** (-5 / 20) for a, b in zip(left, right)))
    rendered = rook_mix(mixed)
    peak = max(map(abs, rendered))
    assert peak < .9
    if sys.byteorder != 'little':
        rendered.byteswap()
    output = ROOT / 'showcase/promotion-rook-p1-p2-room.mp3'
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', str(RATE), '-i', '-',
        '-codec:a', 'libmp3lame', '-b:a', '192k', str(output),
    ], input=rendered.tobytes(), check=True)
    assert len(samples(output)) == len(left)
    print(f'{output.name}: {len(left) // 2 / RATE:.3f}s, pre-encode peak {peak:.4f}, contact 0.420s')


if __name__ == '__main__':
    build()

#!/usr/bin/env python3
"""Make the check strike and mate landing from the shipped stone recordings."""
from array import array
import json
from math import exp, sin, tau
from pathlib import Path
import subprocess
import sys
import wave

AUDIO = Path(__file__).resolve().parents[1] / 'public/assets/audio'
RATE = 48_000
WINDOWS = json.loads((AUDIO / 'manifest.json').read_text())['clipFrames']


def board_samples():
    with wave.open(str(AUDIO / 'board.wav'), 'rb') as recording:
        rate = recording.getframerate()
        pcm = array('h')
        pcm.frombytes(recording.readframes(recording.getnframes()))
    if sys.byteorder != 'little':
        pcm.byteswap()
    return {name: (rate, [value / 32768 for value in pcm[start:start + length]])
            for name, (start, length) in WINDOWS.items()}


def add_recording(sound, bank, name, delay, speed, gain, cutoff, highpass):
    rate, source = bank[name]
    start = round(delay * RATE)
    stride = speed * rate / RATE
    length = min(len(sound) - start, int((len(source) - 1) / stride))
    low, floor = 0., 0.
    top_step = 1 - exp(-tau * cutoff / RATE)
    floor_step = 1 - exp(-tau * highpass / RATE)
    for i in range(length):
        source_frame = i * stride
        left = int(source_frame)
        fraction = source_frame - left
        raw = source[left] * (1 - fraction) + source[left + 1] * fraction
        low += (raw - low) * top_step
        floor += (low - floor) * floor_step
        edge = min(1., (i + 1) / (.0018 * RATE), (length - 1 - i) / (.014 * RATE))
        sound[start + i] += (low - floor) * gain * edge


def add_mode(sound, frequency, end, decay, level, delay=0.):
    start = round(delay * RATE)
    phase = 0.
    for i in range(start, len(sound)):
        t = (i - start) / RATE
        f = end + (frequency - end) * exp(-t * 18)
        phase += tau * f / RATE
        sound[i] += sin(phase) * level * (1 - exp(-t * 338)) * exp(-t / decay)


def stereo_room(sound, profile):
    left = sound.copy()
    right = sound.copy()
    for channel, reflections in zip((left, right), profile):
        for delay, gain in reflections:
            frames = round(delay * RATE)
            for i in range(frames, len(sound)):
                channel[i] += gain * sound[i - frames]
    return left, right


def save(name, channels, peak):
    left, right = channels
    scale = peak / max(max(map(abs, left)), max(map(abs, right)))
    length = len(left)
    data = array('f')
    for i, (l, r) in enumerate(zip(left, right)):
        tail = min(1., (length - i - 1) / (.055 * RATE))
        data.extend((l * scale * tail, r * scale * tail))
    if sys.byteorder != 'little':
        data.byteswap()
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '2', '-i', '-',
        '-codec:a', 'libmp3lame', '-b:a', '192k', str(AUDIO / 'showcase' / f'{name}.mp3'),
    ], input=data.tobytes(), check=True)


def main():
    bank = board_samples()
    check = [0.] * round(.42 * RATE)
    add_recording(check, bank, 'capture', 0., .88, .73, 4700, 73)
    add_recording(check, bank, 'stone', .006, .72, .22, 2100, 92)
    add_recording(check, bank, 'fracture', .019, 1.04, .16, 2500, 160)
    for f, decay, gain in ((161, .052, .14), (269, .070, .087), (431, .065, .034), (699, .040, .013)):
        add_mode(check, f, f * .97, decay, gain, .003)
    save('royal-check', stereo_room(check, (
        ((.032, .092), (.073, .042)), ((.041, .088), (.088, .039)),
    )), .56)

    fall = [0.] * round(.92 * RATE)
    add_recording(fall, bank, 'capture', 0., .64, .44, 2450, 45)
    add_recording(fall, bank, 'stone', .008, .65, .25, 1460, 57)
    add_recording(fall, bank, 'fracture', .032, .84, .24, 2150, 125)
    for start, end, decay, gain, delay in (
        (111, 49, .168, .45, .003), (159, 91, .122, .24, .006),
        (231, 146, .096, .122, .009), (377, 277, .059, .047, .012),
    ):
        add_mode(fall, start, end, decay, gain, delay)
    save('royal-mate-ground', stereo_room(fall, (
        ((.041, .10), (.089, .053), (.147, .026)),
        ((.052, .092), (.103, .048), (.169, .023)),
    )), .69)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Render the approved E/G/D landing and the short pressure release."""
import argparse
from math import exp, sqrt
from pathlib import Path
from random import Random
from struct import pack
import subprocess
from tempfile import TemporaryDirectory
import wave

ROOT = Path(__file__).resolve().parents[1]


def write(inputs, filters, output):
    sources = [argument for path in inputs for argument in ('-i', str(path))]
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', *sources, '-filter_complex', filters,
        '-map', '[mix]', '-ac', '2', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '192k', str(output),
    ], check=True)


def write_room_impulse(path):
    rate = 48000
    channels = []
    for channel, predelay in enumerate((.023, .031)):
        noise = Random(4241 + channel)
        filtered = 0
        samples = []
        for index in range(round(rate * 1.38)):
            time = index / rate - predelay
            filtered = .69 * filtered + .31 * noise.uniform(-1, 1)
            decay = 2.1 * max(0, time) + 3.2 * max(0, time - .57) ** 2
            envelope = min(1, max(0, time / .038)) * exp(-decay)
            samples.append(filtered * envelope)
        scale = 32767 / sqrt(sum(sample * sample for sample in samples))
        channels.append([round(sample * scale) for sample in samples])
    with wave.open(str(path), 'wb') as file:
        file.setparams((2, 2, rate, 0, 'NONE', 'not compressed'))
        file.writeframes(b''.join(pack('<hh', left, right) for left, right in zip(*channels)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('blast', type=Path, help='cinematic punch excerpt source from the manifest')
    parser.add_argument('steam', type=Path, help='short steam release source from the manifest')
    parser.add_argument('crack', type=Path, help='previous fragment mix chosen for restoration')
    parser.add_argument('e', type=Path, help='E audition landing master')
    parser.add_argument('g', type=Path, help='G audition landing master')
    parser.add_argument('d', type=Path, help='D audition landing master')
    parser.add_argument('--out', type=Path, default=ROOT / 'public/assets/audio/showcase')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    write([args.e, args.g, args.d],
          '[0:a]highpass=f=52,volume=0.82[e];'
          '[1:a]highpass=f=31,lowpass=f=200,volume=0.67[g];'
          '[2:a]highpass=f=490,lowpass=f=4500,volume=0.49[d];'
          '[e][g][d]amix=inputs=3:duration=shortest:normalize=0,'
          'alimiter=limit=0.90:attack=2:release=80:level=false:latency=true,'
          'afade=t=in:d=0.002,afade=t=out:st=0.84:d=0.08,atrim=duration=0.92[mix]',
          args.out / 'royal-mate-ground.mp3')
    with TemporaryDirectory(prefix='remorse-room-') as directory:
        impulse = Path(directory) / 'room.wav'
        write_room_impulse(impulse)
        write([args.blast, args.steam, args.crack, impulse],
          '[0:a]atrim=start=0.006:duration=0.235,asetpts=PTS-STARTPTS,aresample=48000,'
          'highpass=f=76,lowpass=f=1560,equalizer=f=213:t=q:w=1:g=1.8,volume=0.78,'
          'afade=t=in:d=0.005,afade=t=out:st=0.089:d=0.146[blast];'
          '[1:a]atrim=start=0.011:duration=0.405,asetpts=PTS-STARTPTS,aresample=48000,'
          'aformat=channel_layouts=stereo,highpass=f=515,lowpass=f=5850,'
          'equalizer=f=2400:t=q:w=1:g=1.5,volume=6.9,pan=stereo|c0=c0|c1=0.83*c1,'
          'afade=t=in:d=0.019,afade=t=out:st=0.125:d=0.280,adelay=9|17[steam];'
          '[2:a]highpass=f=140,lowpass=f=6200,volume=0.66[crack];'
          '[blast][steam][crack]amix=inputs=3:normalize=0,asplit=5[dry][repeat1][repeat2][repeat3][diffuse];'
          '[repeat1]lowpass=f=4800,adelay=77|98,volume=0.43[echo1];'
          '[repeat2]lowpass=f=3700,adelay=161|142,volume=0.31[echo2];'
          '[repeat3]lowpass=f=2850,adelay=220|249,volume=0.21[echo3];'
          '[diffuse]highpass=f=136,lowpass=f=4600,apad=pad_dur=1.320[roomInput];'
          '[roomInput][3:a]afir=dry=1:wet=4.65:gtype=none:minp=128:maxp=512,'
          'afade=t=in:d=0.075,volume=12[room];'
          '[dry][echo1][echo2][echo3][room]amix=inputs=5:normalize=0,'
          'alimiter=limit=0.87:attack=2:release=61:level=false:latency=true,'
          'volume=0.81,afade=t=out:st=1.08:d=0.24,atrim=duration=1.32[mix]',
          args.out / 'royal-mate-fragments.mp3')


if __name__ == '__main__':
    main()

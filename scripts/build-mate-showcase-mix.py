#!/usr/bin/env python3
"""Render the approved E/G/D landing and the newly sourced stone-chip release."""
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def write(inputs, filters, output):
    sources = [argument for path in inputs for argument in ('-i', str(path))]
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', *sources, '-filter_complex', filters,
        '-map', '[mix]', '-ac', '2', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '192k', str(output),
    ], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rock', type=Path, help='original rock_break.ogg from the manifest')
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
    write([args.rock],
          '[0:a]atrim=start=0.014,asetpts=PTS-STARTPTS,'
          'aresample=48000,asetrate=45120,aresample=48000,highpass=f=115,lowpass=f=6200,'
          'equalizer=f=2380:t=q:w=1.1:g=2,alimiter=limit=0.82:attack=2:release=65:level=false:latency=true,'
          'afade=t=in:d=0.002,afade=t=out:st=0.325:d=0.095,atrim=duration=0.42[mix]',
          args.out / 'royal-mate-fragments.mp3')


if __name__ == '__main__':
    main()

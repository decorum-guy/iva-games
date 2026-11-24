#!/usr/bin/env python3
"""Render the approved E/G/D landing and the short pressure release."""
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
    write([args.blast, args.steam, args.crack],
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
          '[diffuse]highpass=f=136,lowpass=f=4200,adelay=22|29,'
          'aecho=0.57:0.63:22|37|49|63|83|107|137|179|221:0.49|0.41|0.34|0.29|0.25|0.20|0.17|0.13|0.08,'
          'volume=0.70[room];'
          '[dry][echo1][echo2][echo3][room]amix=inputs=5:normalize=0,'
          'alimiter=limit=0.87:attack=2:release=61:level=false:latency=true,'
          'volume=0.81,afade=t=out:st=0.49:d=0.13,atrim=duration=0.62[mix]',
          args.out / 'royal-mate-fragments.mp3')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Deterministic original surface atlas, echo mask and dry sound bank.

No source audio or textures are sampled. Fonts are unmodified upstream glyphs,
losslessly repackaged as WOFF2 and accompanied by their upstream OFL notices.
Run from any directory: python3 games/knock-first/assets-src/generate_media.py
Use --fonts once to fetch the pinned source names described in font-sources.json.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import urllib.request
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'knock-first'
RATE = 48000
SEED = 271828


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def save_image(image, path, **kwargs):
    temporary = path.with_name(path.stem + '.new' + path.suffix)
    image.save(temporary, **kwargs)
    temporary.replace(path)


def make_atlas():
    rng = np.random.default_rng(SEED)
    # A 4x4 atlas. The UV islands stay eight pixels inside their swatch.
    swatches = [
        ('concrete', (64, 82, 88), .91, .00),
        ('painted-steel', (44, 73, 76), .68, .48),
        ('rust', (117, 78, 51), .86, .18),
        ('paper', (184, 170, 140), .96, .00),
        ('oilskin', (139, 128, 92), .85, .00),
        ('rubber', (33, 38, 37), .92, .00),
        ('brass', (148, 126, 79), .48, .75),
        ('bare-steel', (116, 134, 137), .52, .84),
        ('leather', (75, 61, 47), .82, .00),
        ('archive-blue', (52, 70, 88), .76, .12),
        ('insulation', (77, 89, 71), .95, .00),
        ('ivory-enamel', (206, 197, 175), .56, .35),
        ('warning-amber', (199, 135, 67), .63, .30),
        ('dark-steel', (28, 43, 48), .67, .59),
        ('cyan-paint', (120, 172, 180), .65, .30),
        ('skin', (154, 126, 102), .86, .00),
    ]
    size, tile = 512, 128
    base = np.zeros((size, size, 3), dtype=np.uint8)
    orm = np.zeros_like(base)
    normal = np.zeros_like(base)
    normal[:, :, :] = (128, 128, 255)
    yy, xx = np.mgrid[0:tile, 0:tile]
    for i, (name, color, roughness, metallic) in enumerate(swatches):
        fine = rng.normal(0, 1.3, (tile, tile))
        cloudy = np.array(Image.fromarray(rng.integers(0, 255, (32, 32), dtype=np.uint8)).resize((tile, tile), Image.Resampling.BICUBIC), dtype=float)
        cloudy = (cloudy - 128) * .05
        fibers = np.sin(xx * .47 + yy * .013) * (1.1 if name in ('paper', 'oilskin', 'leather') else .3)
        scratch = np.zeros((tile, tile), dtype=float)
        if 'steel' in name or name in ('rust', 'brass', 'ivory-enamel', 'warning-amber', 'cyan-paint'):
            for _ in range(15):
                px = int(rng.integers(4, tile - 4)); py = int(rng.integers(4, tile - 12))
                scratch[py:py + int(rng.integers(2, 15)), px:px + 1] = rng.uniform(3, 9)
        intensity = fine + cloudy + fibers + scratch
        rgb = np.clip(np.array(color)[None, None, :] + intensity[:, :, None], 0, 255).astype(np.uint8)
        # Deliberate large-scale aging remains readable in a2.6m pool of light;
        # fine pixel noise alone would disappear on the finished geometry.
        edge = np.maximum.reduce([np.exp(-xx / 10), np.exp(-(tile - 1 - xx) / 10),
                                  np.exp(-yy / 10), np.exp(-(tile - 1 - yy) / 10)])
        if name in ('paper', 'oilskin', 'leather', 'insulation'):
            stains = np.clip(cloudy - .5, 0, 4) * 3.8 + edge * 11
            rgb = np.clip(rgb.astype(float) - stains[:, :, None] * np.array([.65,.90,1.0]), 0, 255).astype(np.uint8)
        if name in ('painted-steel', 'bare-steel', 'archive-blue', 'dark-steel', 'warning-amber', 'ivory-enamel'):
            worn = np.clip((cloudy - 2.0) * .10 + np.maximum(edge - .55, 0) * .35, 0, .30)
            rust_color = np.array([107,70,43])
            rgb = np.clip(rgb * (1 - worn[:, :, None]) + rust_color * worn[:, :, None], 0, 255).astype(np.uint8)
        if name == 'concrete':
            pores = rng.random((tile, tile)) < .012
            rgb[pores] = (41, 53, 57)
        if name == 'rust':
            oxidize = np.maximum(0, cloudy)
            rgb[:, :, 0] = np.clip(rgb[:, :, 0] + oxidize * 3, 0, 255)
        y0, x0 = (i // 4) * tile, (i % 4) * tile
        base[y0:y0 + tile, x0:x0 + tile] = rgb
        orm[y0:y0 + tile, x0:x0 + tile, 0] = 255
        orm[y0:y0 + tile, x0:x0 + tile, 1] = np.clip(roughness * 255 + fine * 2, 0, 255)
        orm[y0:y0 + tile, x0:x0 + tile, 2] = int(metallic * 255)
        gy, gx = np.gradient(intensity * .035)
        normal[y0:y0 + tile, x0:x0 + tile, 0] = np.clip(128 - gx * 127, 0, 255)
        normal[y0:y0 + tile, x0:x0 + tile, 1] = np.clip(128 + gy * 127, 0, 255)
    texture_dir = OUT / 'textures'
    texture_dir.mkdir(parents=True, exist_ok=True)
    # JPEG is appropriate for the repeated RGB base; the parameter maps are lossless.
    save_image(Image.fromarray(base), texture_dir / 'archive-atlas-basecolor.jpg', quality=85, optimize=True)
    save_image(Image.fromarray(orm), texture_dir / 'archive-atlas-orm.png', optimize=True)
    save_image(Image.fromarray(normal), texture_dir / 'archive-atlas-normal.png', optimize=True)
    write_json(texture_dir / 'archive-atlas.json', {'version': 1, 'size': size, 'tileSize': tile, 'uvPaddingPixels': 4,
              'swatches': [{'id': name, 'index': i, 'baseColorSrgb': list(color), 'roughness': rough, 'metallic': metal}
                           for i, (name, color, rough, metal) in enumerate(swatches)]})
    # The echo mask is a surface treatment, never a visibility/geometry substitute.
    y, x = np.mgrid[0:256, 0:256] / 255
    stripes = .82 + .18 * np.sin(y * math.tau * 42 + np.sin(x * math.tau * 2))
    edge = np.exp(-((x - .5) / .15) ** 2)
    mask = np.clip(edge * stripes * 255, 0, 255).astype(np.uint8)
    save_image(Image.fromarray(mask), texture_dir / 'echo-front-mask.png', optimize=True)
    ripple = np.sin((x * 17 + y * 23) * math.tau) * .08 + np.sin((x * 7 - y * 11) * math.tau) * .05
    gy, gx = np.gradient(ripple)
    save_image(Image.fromarray(np.stack([np.clip(128 - gx * 420, 0, 255), np.clip(128 + gy * 420, 0, 255), np.full_like(x, 253)], -1).astype(np.uint8)), texture_dir / 'water-normal.png', optimize=True)


def shaped_noise(rng, n, lo=80, hi=4000, rate=RATE):
    noise = rng.standard_normal(n)
    if lo > 0:
        sos = butter(2, [lo, min(hi, rate * .46)], 'bandpass', fs=rate, output='sos')
    else:
        sos = butter(2, min(hi, rate * .46), 'lowpass', fs=rate, output='sos')
    return sosfilt(sos, noise)


def modal(t, frequencies, decays, weights=None, phase=0):
    if weights is None:
        weights = [1 / (i + 1) for i in range(len(frequencies))]
    return sum(w * np.sin(math.tau * f * t + phase) * np.exp(-t / d)
               for f, d, w in zip(frequencies, decays, weights))


def impact(rng, t, freqs, decays, noise=.4, grit=2000):
    return modal(t, freqs, decays) + noise * shaped_noise(rng, len(t), 100, grit) * np.exp(-t / .035)


def tone_sequence(t, notes, interval=.15, decay=.22):
    out = np.zeros_like(t)
    for index, frequency in enumerate(notes):
        tt = t - index * interval
        gate = tt >= 0
        ts = np.maximum(0, tt)
        out += gate * (np.sin(math.tau * frequency * ts) + .14 * np.sin(math.tau * frequency * 2.006 * ts)) * np.exp(-ts / decay) * np.minimum(ts / .008, 1)
    return out


def save_wav(path, value, rate=RATE, peak_db=-10, loop=False):
    value = np.asarray(value, dtype=float)
    if not np.isfinite(value).all():
        raise ValueError(f'Non-finite audio: {path}')
    value -= np.mean(value, axis=0)
    if not loop:
        fade = min(int(rate * .008), len(value) // 4)
        envelope = np.ones(len(value))
        envelope[:fade] = np.linspace(0, 1, fade)
        envelope[-fade:] = np.linspace(1, 0, fade)
        value *= envelope[:, None] if value.ndim == 2 else envelope
    peak = np.max(np.abs(value))
    if peak:
        value *= 10 ** (peak_db / 20) / peak
    pcm = np.round(np.clip(value, -1, 1) * 32767).astype('<i2')
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1 if value.ndim == 1 else value.shape[1])
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(pcm.tobytes())
    return {'file': path.name, 'sampleRate': rate, 'channels': 1 if value.ndim == 1 else value.shape[1],
            'durationSeconds': round(len(value) / rate, 6), 'samplePeakDbfs': round(20 * math.log10(max(np.abs(value).max(), 1e-9)), 2),
            'rmsDbfs': round(20 * math.log10(max(np.sqrt(np.mean(value ** 2)), 1e-9)), 2),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def make_audio():
    rng = np.random.default_rng(SEED + 1)
    audio_dir = OUT / 'audio'
    files = []
    def add(name, duration, generator, peak=-10):
        t = np.arange(int(duration * RATE)) / RATE
        files.append(save_wav(audio_dir / f'{name}.wav', generator(t), peak_db=peak))
    for i in range(1, 5):
        f = 106 + i * 7
        add(f'foot-concrete-{i}', .32, lambda t, f=f: impact(rng, t, [f, f * 2.76, f * 4.81], [.07, .025, .016], .9, 1700) + .25 * shaped_noise(rng, len(t), 900, 3800) * np.exp(-((t - .06) / .055) ** 2), -13)
        add(f'foot-metal-{i}', .48, lambda t, f=f: impact(rng, t, [f * .9, f * 3.43, f * 5.87, f * 9.2], [.12, .10, .08, .045], .55, 3000), -13)
        add(f'foot-water-{i}', .58, lambda t, f=f: .55 * modal(t, [f * .6, f * 1.21], [.09, .05]) + shaped_noise(rng, len(t), 330, 4800) * (np.exp(-((t - .065) / .045) ** 2) + .3 * np.exp(-((t - .22) / .12) ** 2)) + .14 * np.sin(math.tau * (870 * t - 1100 * t * t)) * np.exp(-t / .055), -13)
        add(f'listener-step-{i}', .75, lambda t, f=f: modal(t, [53 + i * 3, f * 1.62, f * 3.19], [.22, .09, .10], [.8, .65, .2]) + .45 * shaped_noise(rng, len(t), 100, 2100) * np.exp(-((t - .045) / .045) ** 2) + .13 * shaped_noise(rng, len(t), 1000, 3800) * np.exp(-((t - .16) / .09) ** 2), -11)
    add('click', .18, lambda t: impact(rng, t, [1000, 2381], [.015, .006], .3, 6000), -18)
    for i in range(1, 4):
        add(f'knock-{i}', .65, lambda t, i=i: impact(rng, t, [153 + i * 11, 367 + i * 18, 592 + i * 22], [.14, .07, .04], .4, 2400), -11)
        add(f'resonator-{i}', 1.8, lambda t, i=i: impact(rng, t, [183 + i * 2, 511 + i * 4, 841 + i * 5, 1393 + i * 8], [.8, .66, .43, .24], .3, 8000), -10)
    add('door', .95, lambda t: .4 * shaped_noise(rng, len(t), 90, 1800) * np.exp(-((t - .35) / .21) ** 2) + modal(t, [110, 242], [.08, .06]) * .3 + modal(np.maximum(t - .68, 0), [74, 193, 352], [.12, .07, .04]) * (t > .68), -12)
    add('door-push', 1.2, lambda t: .55 * shaped_noise(rng, len(t), 65, 2700) * np.exp(-((t - .35) / .25) ** 2) + .22 * np.sin(math.tau * (170 * t + 110 * t * t)) * np.exp(-((t - .42) / .25) ** 2) + modal(np.maximum(t - .76, 0), [58, 139, 337], [.21, .1, .08]) * (t > .76), -10)
    add('drag', 1.02, lambda t: shaped_noise(rng, len(t), 160, 2900) * (np.sin(math.pi * t / 1.02) ** 2) * (.7 + .3 * np.sin(math.tau * 17 * t)) + .3 * modal(t, [73, 189], [.07, .04]), -13)
    add('carry', .44, lambda t: modal(t, [128, 285, 570], [.08, .035, .02]) + .5 * shaped_noise(rng, len(t), 300, 2600) * np.exp(-t / .06), -18)
    add('stop', .5, lambda t: impact(rng, t, [86, 231, 579], [.14, .08, .035], .7, 3000), -12)
    add('drop', 1.1, lambda t: impact(rng, t, [52, 108, 286, 710], [.2, .14, .12, .07], 1.0, 5000) + .32 * modal(np.maximum(t - .14, 0), [109, 282], [.12, .08]) * (t > .14), -10)
    add('timer', 1.5, lambda t: impact(rng, t, [431, 715, 1119], [.68, .4, .21], .35, 3500) + .1 * np.sin(math.tau * 138 * t) * np.exp(-t / .2), -11)
    add('chase', 1.2, lambda t: .6 * shaped_noise(rng, len(t), 110, 1300) * np.exp(-((t - .2) / .19) ** 2) + np.sin(math.tau * (76 * t + 45 * t * t)) * np.exp(-t / .23) + .22 * modal(t, [187, 289], [.3, .14]), -12)
    add('chase-end', .7, lambda t: .45 * shaped_noise(rng, len(t), 180, 1200) * np.exp(-((t - .12) / .13) ** 2) + modal(t, [110, 156], [.14, .16]), -18)
    add('call', .65, lambda t: tone_sequence(t, [523, 392], interval=.12, decay=.18) * .65 + shaped_noise(rng, len(t), 350, 1500) * np.exp(-((t - .14) / .1) ** 2) * .12, -14)
    add('ui-start', 1.1, lambda t: tone_sequence(t, [220, 330, 440], .17, .25), -16)
    add('ui-warning', 1.0, lambda t: tone_sequence(t, [330, 294], .28, .22), -15)
    add('ui-battery', 1.0, lambda t: tone_sequence(t, [261.6, 392], .16, .28), -15)
    add('ui-battery-2', 1.3, lambda t: tone_sequence(t, [261.6, 392, 523.2], .17, .3), -15)
    add('ui-revive', 1.0, lambda t: tone_sequence(t, [196, 293.7, 392], .15, .22), -15)
    add('ui-down', 1.1, lambda t: tone_sequence(t, [293.7, 220, 164.8], .17, .25), -15)
    add('ui-lift', 2.1, lambda t: tone_sequence(t, [196, 261.6, 392, 523.2], .21, .39) + .2 * np.sin(math.tau * 55 * t) * np.exp(-((t - .8) / .65) ** 2), -14)
    add('ui-defeat', 1.8, lambda t: tone_sequence(t, [261.6, 220, 164.8], .27, .39), -17)
    add('ui-grab', .23, lambda t: impact(rng, t, [240, 580], [.035, .021], .14, 2400), -19)
    add('ui-ready', .42, lambda t: tone_sequence(t, [392, 523.2], .11, .1), -19)
    add('timer-arm', .45, lambda t: tone_sequence(t, [659, 523], .10, .09) + .25 * modal(t, [1100, 2077], [.02, .012]), -18)
    # These contain only periodic components; no discontinuity at the loop boundary.
    # Low sample rate is sufficient for the deliberately filtered ambience bus.
    for kind in ('archive', 'pump', 'relay'):
        rate, duration = 24000, 8
        t = np.arange(rate * duration) / rate
        channels = []
        for channel in range(2):
            signal = np.zeros_like(t)
            for j in range(34):
                harmonic = int(rng.integers(110, 5800))
                f = harmonic / duration
                weight = 1 / (1 + f / 100) ** 1.65
                signal += weight * np.sin(math.tau * f * t + rng.uniform(0, math.tau))
            if kind == 'pump':
                signal += 1.2 * np.sin(math.tau * 49 * t + channel * .4) * (.75 + .25 * np.sin(math.tau * .5 * t))
                signal += .4 * np.sin(math.tau * 98 * t + channel * .15)
            if kind == 'relay':
                signal += .5 * np.sin(math.tau * 112 * t) * (.9 + .1 * np.cos(math.tau * 2.5 * t))
                signal += .18 * np.sin(math.tau * 227 * t + channel * .8)
            if kind == 'archive':
                signal += .3 * np.sin(math.tau * 41 * t + channel * .7)
            channels.append(signal)
        files.append(save_wav(audio_dir / f'ambience-{kind}.wav', np.stack(channels, axis=-1), rate, -25, True))
    sounds = {}
    def entry(key, names, bus, gain, loop=False):
        sounds[key] = {'files': [name + '.wav' for name in names], 'bus': bus, 'gain': gain, 'loop': loop}
    feet = [f'foot-concrete-{i}' for i in range(1, 5)]
    entry('quiet-step', feet, 'world', .25)
    entry('step', feet, 'world', .62)
    entry('run', feet, 'world', .82)
    entry('metal-step', [f'foot-metal-{i}' for i in range(1, 5)], 'world', .6)
    entry('water-step', [f'foot-water-{i}' for i in range(1, 5)], 'world', .67)
    entry('listener-step', [f'listener-step-{i}' for i in range(1, 5)], 'threat', .72)
    entry('knock', [f'knock-{i}' for i in range(1, 4)], 'world', .72)
    entry('resonator', [f'resonator-{i}' for i in range(1, 4)], 'world', .67)
    for key in ('click', 'door', 'door-push', 'drag', 'carry', 'stop', 'drop', 'timer', 'call', 'timer-arm'):
        entry(key, [key], 'world', .64)
    for key in ('chase', 'chase-end'):
        entry(key, [key], 'threat', .56)
    for key in ('ui-start', 'ui-warning', 'ui-battery', 'ui-battery-2', 'ui-revive', 'ui-down', 'ui-lift', 'ui-defeat', 'ui-grab', 'ui-ready'):
        entry(key, [key], 'ui', .64)
    for kind in ('archive', 'pump', 'relay'):
        entry(f'ambience-{kind}', [f'ambience-{kind}'], 'ambience', .24, True)
    write_json(audio_dir / 'manifest.json', {'version': 1, 'author': 'Iva Games original procedural synthesis',
               'source': 'games/knock-first/assets-src/generate_media.py', 'spatialPolicy': 'Mono dry source; path filtering, portal location and attenuation are applied by the authoritative-cue client mixer.',
               'listeningStatus': 'No physical-device listening is claimed by this generation manifest.', 'sounds': sounds, 'files': files})


def make_icons():
    paths = {
      'knock': '<path d="M8 22V13a2 2 0 0 1 4 0v5-8a2 2 0 0 1 4 0v8-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v9c0 4-3 7-7 7h-2c-3 0-5-2-7-5l-4-5a2 2 0 0 1 3-3l3 3"/><path d="M24 5l3-3m0 8h4M19 3V0"/>',
      'handle': '<path d="M5 13V7h22v6M7 13h18v14H7zM10 7V4h12v3M5 18h22"/>',
      'battery': '<path d="M7 8h18v21H7zM12 8V4h8v4M12 16h8m-4-4v8M10 25h12"/>',
      'help': '<path d="M11 4h10v7h7v10h-7v7H11v-7H4V11h7z"/>',
      'lift': '<path d="M4 5h24v24H4zM16 5v24M11 12l-3 4h6zm10 8 3-4h-6zM12 1h8"/>',
      'sound': '<path d="M4 13h5l6-6v20l-6-6H4zM20 11c4 3 4 9 0 12m4-16c7 6 7 16 0 22"/>',
      'timer': '<circle cx="16" cy="18" r="11"/><path d="M16 18V10m0 8 5 3M11 2h10m-5 0v5M25 8l3-3"/>',
      'danger': '<path d="M16 3L2 28h28zM16 11v8m0 4v1"/>',
      'echo': '<circle cx="7" cy="16" r="2"/><path d="M12 9a9 9 0 0 1 0 14M17 5a15 15 0 0 1 0 22M22 1a21 21 0 0 1 0 30"/>',
      'quiet': '<path d="M10 5l5 6-3 4 4 5-3 7M5 14l5 2m10-9 7 18M21 19l5-1"/>',
      'map': '<path d="M3 6l9-3 8 4 9-3v23l-9 3-8-4-9 3zM12 3v23m8-19v23"/>',
      'crew': '<circle cx="16" cy="9" r="5"/><path d="M6 29v-6c0-6 20-6 20 0v6M3 11a4 4 0 0 1 3-5m-4 17c0-4 2-5 4-6M29 11a4 4 0 0 0-3-5m4 17c0-4-2-5-4-6"/>',
    }
    for name, shape in paths.items():
        path = OUT / 'icons' / f'{name}.svg'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="#f1e8d7" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">{shape}</svg>\n', encoding='utf-8')


def get_fonts():
    from fontTools.ttLib import TTFont
    fonts = [
        ('ibmplexmono', 'IBMPlexMono-Regular.ttf', 'ibm-plex-mono-regular.woff2', 'IBM Plex Mono', '400'),
        ('ibmplexmono', 'IBMPlexMono-Medium.ttf', 'ibm-plex-mono-medium.woff2', 'IBM Plex Mono', '500'),
        ('ptsans', 'PT_Sans-Web-Regular.ttf', 'pt-sans-regular.woff2', 'PT Sans', '400'),
        ('ptsans', 'PT_Sans-Web-Bold.ttf', 'pt-sans-bold.woff2', 'PT Sans', '700'),
    ]
    dest = OUT / 'fonts'
    dest.mkdir(parents=True, exist_ok=True)
    source_dir = ROOT / 'assets-src' / 'fonts'
    source_dir.mkdir(parents=True, exist_ok=True)
    metadata = []
    for family, filename, output, css_name, weight in fonts:
        source = source_dir / filename
        url = f'https://raw.githubusercontent.com/google/fonts/main/ofl/{family}/{filename}'
        if not source.exists():
            source.write_bytes(urllib.request.urlopen(url, timeout=30).read())
        font = TTFont(source)
        required = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя№'
        cmap = font.getBestCmap()
        missing = [c for c in required if ord(c) not in cmap]
        if missing:
            raise ValueError(f'Missing required glyphs in {filename}: {missing}')
        version = font['name'].getDebugName(5)
        font.flavor = 'woff2'
        font.save(dest / output)
        license_file = dest / f'{family}-OFL.txt'
        if not license_file.exists():
            license_url = f'https://raw.githubusercontent.com/google/fonts/main/ofl/{family}/OFL.txt'
            license_file.write_bytes(urllib.request.urlopen(license_url, timeout=30).read())
        metadata.append({'file': output, 'sourceFile': 'assets-src/fonts/' + filename, 'sourceUrl': url, 'family': css_name,
                         'weight': weight, 'version': version, 'license': 'OFL-1.1', 'licenseFile': license_file.name,
                         'modification': 'Lossless WOFF2 container conversion. All glyphs retained. No outlines or names edited.',
                         'glyphCoverageChecked': required, 'sha256': hashlib.sha256((dest / output).read_bytes()).hexdigest()})
    css = '\n'.join(f"@font-face {{ font-family: '{m['family']}'; font-style: normal; font-weight: {m['weight']}; font-display: swap; src: url('./{m['file']}') format('woff2'); }}" for m in metadata)
    (dest / 'fonts.css').write_text(css + '\n', encoding='utf-8')
    write_json(dest / 'font-sources.json', metadata)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fonts', action='store_true')
    args = parser.parse_args()
    make_atlas()
    make_audio()
    make_icons()
    if args.fonts:
        get_fonts()
    print(json.dumps({'textures': len(list((OUT / 'textures').glob('*'))), 'wavFiles': len(list((OUT / 'audio').glob('*.wav'))), 'icons': len(list((OUT / 'icons').glob('*.svg'))), 'woff2': len(list((OUT / 'fonts').glob('*.woff2')))}, indent=2))

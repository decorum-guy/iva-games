#!/usr/bin/env python3
"""Render the original OVERDRIVE SFX bank; no recordings or third-party samples.

Requires Python 3, numpy and scipy. Deterministic PCM16 WAV at 32 kHz stereo.
The checked-in WAV files are runtime assets; this generator is not run in-game.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import wave

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/overdrive/audio"
SR = 32000
SEED = 20261125


def times(duration: float) -> np.ndarray:
    return np.arange(round(duration * SR), dtype=np.float64) / SR


def noise(t: np.ndarray, seed: int, low: float, high: float) -> np.ndarray:
    rng = np.random.default_rng(seed)
    raw = rng.standard_normal(len(t))
    sos = butter(3, [low, high], btype="bandpass", fs=SR, output="sos")
    result = sosfilt(sos, raw)
    return result / max(.00001, np.std(result))


def env(t: np.ndarray, attack=.002, decay=.12, power=1.0) -> np.ndarray:
    return (1 - np.exp(-t / attack)) * np.exp(-(t / decay) ** power)


def modal(t: np.ndarray, base: float, decay: float, strength=1.0, ceramic=False) -> np.ndarray:
    ratios = [1, 2.61, 4.23, 6.37] if ceramic else [1, 1.48, 2.12, 3.71, 5.18]
    amplitudes = [1, .49, .24, .12, .055]
    total = np.zeros_like(t)
    for index, ratio in enumerate(ratios):
        total += amplitudes[index] * np.sin(2 * math.pi * base * ratio * t + index * .37) * \
            env(t, .0007, decay / (1 + index * .7))
    return strength * total


def motor(t: np.ndarray, f0: float, f1: float, decay=.3) -> np.ndarray:
    # A geared motor: moving carrier, inharmonic sidebands and changing tooth rate.
    frequency = f0 + (f1 - f0) * np.minimum(1, t / max(.01, t[-1] * .72))
    phase = 2 * math.pi * np.cumsum(frequency) / SR
    mod = .55 * np.sin(phase * .187) + .18 * np.sin(phase * 2.31)
    wave_shape = np.sin(phase + mod) + .22 * np.sin(2 * phase + mod * .6)
    return wave_shape * env(t, .018, decay, 1.5)


def burst(t: np.ndarray, seed: int, low=400, high=10000, decay=.05, attack=.001) -> np.ndarray:
    return noise(t, seed, low, high) * env(t, attack, decay)


def at(buffer: np.ndarray, sound: np.ndarray, seconds: float, gain=1.0) -> np.ndarray:
    start = round(seconds * SR)
    length = min(len(sound), len(buffer) - start)
    if length > 0:
        buffer[start:start + length] += sound[:length] * gain
    return buffer


def impact(t: np.ndarray, seed: int, base=265, weight=.5) -> np.ndarray:
    return modal(t, base, .19, .56) + burst(t, seed, 110, 9000, .025) * .23 + \
        motor(t, 95, 43, .075) * weight


def make(name: str, duration: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    t = times(duration)
    y = np.zeros_like(t)
    pan = np.zeros_like(t)
    if name == 'ui':
        y = modal(t, 1280, .023, .5, True) + burst(t, seed, 1700, 11000, .007) * .2
    elif name == 'move':
        y = modal(t, 780, .07, .5, True) + burst(t, seed, 550, 6700, .032) * .18
        at(y, modal(times(.15), 1180, .042, .13, True), .014)
    elif name == 'capture':
        # Short dense ceramic clack with body in the phone speaker range.
        y = modal(t, 212, .066, .68) + modal(t, 506, .032, .32, True)
        y += burst(t, seed, 370, 3900, .014) * .17
        at(y, modal(times(.13), 145, .044, .26), .012)
    elif name == 'sweep':
        # Vacuum pull, rising scrape and a restrained ceramic catch.
        y = motor(t, 160, 390, .21) * .29 + noise(t, seed, 1100, 7800) * np.sin(np.minimum(t / .29, 1) * math.pi) ** 2 * .15
        at(y, modal(times(.2), 920, .065, .45, True), .265)
        pan = -.32 + .64 * np.minimum(t / .3, 1)
    elif name == 'raid':
        # Fast overflight with a Doppler bend and a second landing contact.
        y = motor(t, 750, 160, .28) * .31 + burst(t, seed, 800, 11000, .115, .018) * .23
        at(y, modal(times(.25), 460, .08, .4), .095)
        at(y, modal(times(.2), 940, .06, .32, True), .32)
        pan = .43 * np.sin(2 * math.pi * t / .7)
    elif name == 'battery':
        # Capacitor rise, an arc transient, then the aluminium receiver resonance.
        y = motor(t, 140, 1120, .24) * .18
        at(y, burst(times(.3), seed + 1, 1600, 13500, .035) * .38 + modal(times(.3), 530, .16, .45), .19)
        at(y, modal(times(.27), 1067, .09, .17, True), .225)
        pan = .26 * np.sin(t * 8)
    elif name == 'ram':
        # Low servo approach and a two-part piston impact with a casing rattle.
        y = motor(t, 90, 205, .18) * .2
        at(y, impact(times(.44), seed, 135, .75), .14)
        at(y, burst(times(.3), seed + 1, 300, 4200, .07) * .17, .205)
        at(y, modal(times(.3), 360, .1, .16), .225)
    elif name == 'rotation':
        # Two opposing sweeps and twin mechanical locks; not a capture sound.
        y = motor(t, 185, 540, .29) * .22
        at(y, motor(times(.43), 540, 185, .25) * .24, .09)
        at(y, modal(times(.28), 760, .09, .35, True), .28)
        at(y, modal(times(.23), 1120, .075, .28, True), .34)
        pan = .4 * np.sin(t * 12)
    elif name == 'cover':
        # Short interlocking shutters followed by a low shield resonance.
        y = modal(t, 410, .052, .48) + burst(t, seed, 800, 6100, .026) * .18
        at(y, modal(times(.3), 560, .072, .44), .055)
        at(y, modal(times(.33), 185, .16, .31), .1)
    elif name == 'energy':
        y = motor(t, 450, 760, .115) * .12 + burst(t, seed, 3200, 12500, .027) * .055
        at(y, modal(times(.16), 1540, .06, .25, True), .055)
    elif name == 'spend':
        y = motor(t, 820, 230, .045) * .2 + burst(t, seed, 1700, 11000, .02) * .1
        at(y, modal(times(.1), 1030, .03, .16, True), .028)
    elif name == 'cellfull':
        y = modal(t, 650, .09, .35, True)
        at(y, modal(times(.32), 975, .15, .42, True), .095)
        at(y, modal(times(.22), 1950, .075, .14, True), .14)
        y += burst(t, seed, 1900, 8500, .019) * .07
    elif name == 'activate':
        # Longer energy coupling: turbine spool, contactor latch and warm decay.
        y = motor(t, 66, 440, .47) * .35 + noise(t, seed, 200, 4700) * env(t, .06, .4, 2) * .12
        at(y, impact(times(.57), seed + 1, 220, .32), .33)
        at(y, modal(times(.55), 660, .22, .2), .37)
        pan = .16 * np.sin(t * 7)
    elif name == 'expire':
        y = motor(t, 330, 70, .19) * .29 + burst(t, seed, 900, 6200, .14, .01) * .12
        at(y, modal(times(.18), 520, .045, .19), .21)
    elif name == 'promotion':
        # A single struck dyad with a soft upper partial blooming out of it.
        y = modal(t, 587.33, .105, .55, True)
        y += np.sin(2*math.pi*880*t) * env(t, .023, .145) * .43
        y += np.sin(2*math.pi*1174.66*t) * env(t, .039, .135) * .21
    elif name == 'check':
        y = modal(t, 513, .061, .46, True)
        at(y, modal(times(.21), 648, .068, .39, True), .081)
    elif name == 'mate':
        # Rounded descending stopped tones. No percussive onset before the fall.
        for f, onset, amp in [(392, 0, .50), (293.66, .125, .61)]:
            tone = (np.sin(2*math.pi*f*t) + .23*np.sin(2*math.pi*f*2*t))
            at(y, tone*env(t, .018, .13)*amp, onset)
    elif name == 'board-contact':
        y = modal(t, 148, .069, .6) + modal(t, 315, .034, .26)
        y += burst(t, seed, 160, 2200, .029, .0018) * .16
    elif name == 'piece-contact':
        y = modal(t, 560, .033, .55, True) + modal(t, 274, .029, .24)
    elif name == 'finish':
        y = modal(t, 440, .18, .28, True)
        at(y, modal(times(.61), 660, .24, .3, True), .13)
        at(y, modal(times(.52), 330, .24, .26), .2)
    else:
        raise ValueError(name)
    return y, pan


CUES = {
    'ui': (.09, -9.5), 'move': (.22, -6.5), 'capture': (.29, -5.2),
    'sweep': (.52, -4.5), 'raid': (.56, -4.5), 'battery': (.66, -4.5),
    'ram': (.65, -3.5), 'rotation': (.65, -5.0), 'cover': (.5, -4.5),
    'energy': (.28, -10.0), 'spend': (.16, -9.0), 'cellfull': (.48, -7.5),
    'activate': (1.05, -4.0), 'expire': (.5, -8.0),
    'promotion': (.42, -6.0), 'check': (.31, -7.0), 'mate': (.57, -6.0), 'finish': (.8, -7.5),
    'board-contact': (.27, -9.0), 'piece-contact': (.15, -13.0),
}


def render() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'bank': 'overdrive-original-dsp-v2', 'generator': 'scripts/generate-overdrive-audio.py',
              'provenance': 'Original deterministic DSP composition; no third-party or Remorse samples.',
              'sampleRate': SR, 'channels': 2, 'encoding': 'PCM signed 16-bit little-endian', 'seed': SEED,
              'auditoryReview': 'Not performed; measurements are not a listening assessment.', 'cues': {}}
    for index, (name, (duration, peak_db)) in enumerate(CUES.items()):
        signal, pan = make(name, duration, SEED + index * 103)
        signal -= signal.mean()
        signal = np.tanh(signal * 1.25)
        # Raised-cosine edges prevent a PCM discontinuity; tails end at exact zero.
        fade_in = min(round(.0015 * SR), len(signal) // 2)
        fade_out = min(round(.045 * SR), len(signal) // 2)
        signal[:fade_in] *= np.sin(np.linspace(0, math.pi / 2, fade_in)) ** 2
        signal[-fade_out:] *= np.cos(np.linspace(0, math.pi / 2, fade_out)) ** 2
        stereo = np.stack((signal * np.cos((pan + 1) * math.pi / 4), signal * np.sin((pan + 1) * math.pi / 4)), axis=1)
        # Small, discrete enclosure reflections; not a long ambient reverb bed.
        for delay, gain in [(0.011, .075), (.021, -.045)]:
            shift = round(delay * SR)
            stereo[shift:, :] += stereo[:-shift, ::-1] * gain
        stereo[-fade_out:, :] *= np.cos(np.linspace(0, math.pi / 2, fade_out))[:, None] ** 2
        stereo *= 10 ** (peak_db / 20) / max(np.abs(stereo).max(), 1e-8)
        pcm = np.rint(stereo * 32767).astype('<i2')
        path = OUT / f'{name}.wav'
        with wave.open(str(path), 'wb') as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(SR)
            wav.writeframes(pcm.tobytes())
        decoded = pcm.astype(np.float64) / 32768
        peak = float(np.abs(decoded).max())
        rms = float(np.sqrt(np.mean(decoded ** 2)))
        report['cues'][name] = {'file': f'{name}.wav', 'durationSeconds': len(pcm) / SR,
                               'bytes': path.stat().st_size, 'peakDbFS': round(20 * math.log10(peak), 3),
                               'rmsDbFS': round(20 * math.log10(rms), 3),
                               'clippedSamples': int(np.count_nonzero(np.abs(pcm.astype(np.int32)) >= 32767)),
                               'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    report['totalBytes'] = sum(cue['bytes'] for cue in report['cues'].values())
    assert report['totalBytes'] < 2_000_000
    assert all(cue['clippedSamples'] == 0 for cue in report['cues'].values())
    (OUT / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'cues': len(CUES), 'totalBytes': report['totalBytes'], 'output': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    render()

#!/usr/bin/env python3
"""Rebuild District's small CC0 placeholder bank from its checked-in CC0 sources.

Requires Python 3 and ffmpeg. No network, random external inputs or chess assets.
Synthesised layers are original procedural compositions, not recordings of people.
"""
from __future__ import annotations

import array
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/portal/public/assets/district/audio"
SRC = OUT / "sources"
RATE = 22050
TAU = math.tau
LICENSE = "CC0-1.0"
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"

SOURCE_INFO = {
    "whisper.mp3": {
        "author": "LisadiKaprio", "title": "Short Whisper", "page": "https://freesound.org/people/LisadiKaprio/sounds/584650/",
        "download": "https://cdn.freesound.org/previews/584/584650_5571497-hq.mp3",
    },
    "cough.mp3": {
        "author": "OwlStorm / Ashe Kirk", "title": "Cough (2)", "page": "https://freesound.org/people/OwlStorm/sounds/151212/",
        "download": "https://cdn.freesound.org/previews/151/151212_140737-hq.mp3",
    },
    "cough-female.mp3": {
        "author": "OwlStorm / Ashe Kirk", "title": "Cough Female", "page": "https://freesound.org/people/OwlStorm/sounds/151213/",
        "download": "https://cdn.freesound.org/previews/151/151213_140737-hq.mp3",
    },
}
for filename in sorted(SRC.glob("*.ogg")):
    SOURCE_INFO[filename.name] = {
        "author": "Kenney", "title": "Impact Sounds 1.0 / " + filename.name,
        "page": "https://kenney.nl/assets/impact-sounds", "archivePath": "Audio/" + filename.name,
    }


def read_sample(name: str) -> list[float]:
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(SRC / name), "-ac", "1", "-ar", str(RATE),
        "-f", "s16le", "-",
    ])
    data = array.array("h", raw)
    if sys.byteorder != "little":
        data.byteswap()
    values = [n / 32768 for n in data]
    peak = max(map(abs, values), default=1)
    start = next((n for n, value in enumerate(values) if abs(value) > peak * .025), 0)
    end = next((n for n in range(len(values) - 1, -1, -1) if abs(values[n]) > peak * .01), len(values) - 1)
    values = values[max(0, start - 200):min(len(values), end + 400)]
    return [n / max(peak, .01) for n in values]


SAMPLES = {name: read_sample(name) for name in SOURCE_INFO}


class Clip:
    def __init__(self, seconds: float, seed: str):
        self.values = [0.0] * round(seconds * RATE)
        self.rng = random.Random(seed)
        self.sources: set[str] = set()
        self.procedural = False

    def mix(self, values: list[float], at=0.0, volume=1.0, speed=1.0):
        start = round(at * RATE)
        length = min(len(self.values) - start, math.ceil(len(values) / speed))
        for n in range(max(0, length)):
            index = n * speed
            lo = min(int(index), len(values) - 1)
            hi = min(lo + 1, len(values) - 1)
            value = values[lo] + (values[hi] - values[lo]) * (index - lo)
            self.values[start + n] += value * volume

    def sample(self, name: str, at=0.0, volume=.3, speed=1.0):
        self.sources.add(name)
        self.mix(SAMPLES[name], at, volume, speed)

    def noise(self, at: float, length: float, volume=.15, smooth=.7, flutter=0.0, rise=False):
        self.procedural = True
        prev = 0.0
        count = round(length * RATE)
        values = []
        for n in range(count):
            t = n / RATE
            noise = self.rng.uniform(-1, 1)
            prev = smooth * prev + (1 - smooth) * noise
            envelope = math.sin(math.pi * n / max(count, 1)) ** .8
            if rise:
                envelope *= (.15 + .85 * n / max(count, 1))
            envelope *= .7 + .3 * math.sin(TAU * flutter * t) if flutter else 1
            values.append(prev * envelope)
        self.mix(values, at, volume * 2)

    def ring(self, at: float, frequency: float, length=.3, volume=.15, end=None, metallic=False):
        self.procedural = True
        count = round(length * RATE)
        values = []
        for n in range(count):
            t = n / RATE
            phase = TAU * (frequency * t + ((end or frequency) - frequency) * t * t / (2 * length))
            body = math.sin(phase) + .25 * math.sin(phase * (2.73 if metallic else 2))
            attack = min(1, t / .008)
            values.append(body * attack * math.exp(-6 * t / length))
        self.mix(values, at, volume)

    def gravel(self, at: float, count=5, volume=.16, spacing=.035):
        for i in range(count):
            self.noise(at + spacing * i, .028 + self.rng.random() * .035, volume, .25)

    def finish(self, name: str, description: str, category: str):
        # Conservative peak ceiling and fades: short confirmations, no loud looping ambience.
        values = self.values
        peak = max(map(abs, values), default=0)
        scale = min(1, .52 / max(peak, .001))
        fade_in, fade_out = round(.008 * RATE), round(.045 * RATE)
        values = [x * scale * min(1, n / fade_in, (len(values) - 1 - n) / fade_out)
                  for n, x in enumerate(values)]
        pcm = array.array("h", [round(max(-1, min(1, value)) * 32767) for value in values])
        if sys.byteorder != "little":
            pcm.byteswap()
        path = OUT / (name + ".wav")
        with wave.open(str(path), "wb") as file:
            file.setparams((1, 2, RATE, len(values), "NONE", "not compressed"))
            file.writeframes(pcm.tobytes())
        return {
            "id": name, "path": name + ".wav", "category": category, "description": description,
            "seconds": round(len(values) / RATE, 4), "sampleRate": RATE, "channels": 1,
            "peak": round(max(map(abs, values), default=0), 5),
            "rms": round(math.sqrt(sum(x*x for x in values) / len(values)), 5),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sources": sorted(self.sources), "originalProceduralLayers": self.procedural, "license": LICENSE,
        }


WOOD = "impactWood_medium_000.ogg"
LIGHT = "impactWood_light_000.ogg"
PLANK = "impactPlank_medium_000.ogg"
STONE = "footstep_concrete_000.ogg"
MINING = "impactMining_000.ogg"
METAL = "impactMetal_light_000.ogg"
GLASS = "impactGlass_light_000.ogg"
BELL = "impactBell_heavy_000.ogg"
TIN = "impactTin_medium_000.ogg"
CLIPS = []


def action(name, seconds, description, arrange):
    clip = Clip(seconds, name)
    arrange(clip)
    CLIPS.append(clip.finish(name, description, "effects"))


action("house", .46, "Wooden house placed: rounded contact and a light roof tap.", lambda c: (
    c.sample(WOOD, volume=.44), c.sample(LIGHT, .11, .17, 1.3)))
action("road", .4, "Two stone-and-gravel taps lay a short road.", lambda c: (
    c.sample(STONE, volume=.4, speed=1.45), c.gravel(.04, 4, .08), c.sample(STONE, .15, .2, 1.65)))
action("upgrade", .66, "Three construction contacts rise into a small metal finish.", lambda c: (
    c.sample(PLANK, volume=.24, speed=1.2), c.sample(MINING, .15, .22, 1.2), c.sample(METAL, .32, .3, 1.45)))
action("roll", .68, "Five wooden dice contacts slow down into a settled pair.", lambda c: (
    [c.sample(LIGHT, at, gain, speed) for at, gain, speed in [(.01,.18,1.5),(.07,.15,1.7),(.16,.24,1.4),(.29,.2,1.6),(.46,.32,1.3)]],
    c.sample(WOOD, .48, .14, 1.9)))
action("production", .5, "Resources arrive as soft card rustles and two small glass contacts.", lambda c: (
    c.noise(0,.2,.08,.2,12), c.sample(GLASS,.12,.18,1.8), c.sample(GLASS,.24,.15,2.1)))
action("trade", .6, "An agreed exchange: two metal clicks and a wooden completion tap.", lambda c: (
    c.sample(METAL,0,.22,1.65), c.sample(METAL,.13,.22,1.9), c.sample(WOOD,.29,.25,1.55)))
action("card", .45, "A card slides onto the table and settles.", lambda c: (c.noise(0,.24,.14,.2,18),c.sample(LIGHT,.24,.22,1.8)))
action("blockade", .55, "A low gate-like metal contact marks the blockade move.", lambda c: (c.sample(TIN,0,.3,.8),c.sample(WOOD,.16,.22,.85)))
action("win", 1.15, "A brief three-note glass finish for the result.", lambda c: (
    [c.ring(at,f,.65,.12,metallic=True) for at,f in [(0,440),(.17,554.37),(.34,659.25)]], c.sample(GLASS,.34,.15,1.3)))
action("turn", .43, "Two quiet wooden notes announce a new own turn.", lambda c: (c.sample(LIGHT,0,.21,1.5),c.sample(LIGHT,.13,.26,1.9)))
action("offer", .47, "Paper rustle and a soft tap for a new incoming offer.", lambda c: (c.noise(0,.26,.12,.25,14),c.sample(LIGHT,.22,.16,1.6)))


FAMILIES = {
    "G01": ("Ore discovery", ["applied"], "Mining strike and small ore chinks."),
    "G02": ("Supply trucks", ["applied"], "Short truck rumble and crates set down."),
    "G03": ("Harvest", ["applied"], "Dry stalk rustle and seed grains."),
    "G04": ("Renovation", ["applied"], "Construction taps and the town stamp."),
    "G05": ("Port trade fair", ["applied"], "Water brush and trading bell."),
    "G06": ("Funded roads", ["applied"], "Three paving contacts and a stamp."),
    "G07": ("Building subsidy", ["applied"], "Paper approval and a metal contact."),
    "G08": ("University grant", ["applied"], "Page turn and two small bell notes."),
    "G09": ("Exchange fair", ["applied"], "Paired trading contacts, alternate rhythm."),
    "G10": ("Repair fund", ["applied"], "Gentle repair taps and a shared finish."),
    "B01": ("Street dogs", ["applied"], "Two stylised synthesised barks; not dog recordings."),
    "B02": ("Work crews sick", ["applied"], "A short recorded cough and an idle work-tool contact."),
    "B03": ("Granary pests", ["applied"], "Small scratches, skittering and dry grain rustle."),
    "B04": ("Port storm", ["applied"], "A compact gust and a low harbour bell."),
    "B05": ("Rain on building sites", ["applied"], "Rain drops over a soft wet splash."),
    "B06": ("Delayed roadworks", ["applied"], "An interrupted paving rhythm."),
    "B07": ("Cranes stopped by wind", ["applied"], "Wind against a metal cable."),
    "B08": ("Harbour fog", ["applied"], "A short low foghorn and water brush."),
    "H01": ("Wildfire", ["forecast","confirmed","applied","cancelled"], "Dry crackle: distant risk, approaching fire, brief burn, extinguishing."),
    "H02": ("River flood", ["forecast","confirmed","applied","cancelled"], "Water: ripple, rising current, broad splash, receding flow."),
    "H03": ("Tsunami", ["forecast","confirmed","applied","cancelled"], "Sea: low swell, approaching surge, compact wave impact, receding wave."),
    "H04": ("Meteor", ["forecast","confirmed","applied","cancelled"], "Recorded quiet nonverbal whisper, confirmed trajectory, short impact, pass-by."),
    "P01": ("Oil exploration", ["applied","success","cancelled"], "A mechanical drilling rhythm; discovery adds a fluid release, no find winds down."),
    "P02": ("City funding", ["applied","success","cancelled"], "Paper and stamp; approval adds a flourish, postponement folds the paper."),
    "E01": ("Fictional epidemic", ["applied","forecast","update","success","cancelled"], "Recorded cough collage; sparse risk, wider layered outbreak, short containment release."),
}


def arrange_news(c, family, stage):
    i = int(family[1:])
    if family.startswith("G"):
        if i == 1:
            c.sample(MINING,0,.34);c.sample(METAL,.18,.24,1.7);c.sample(GLASS,.32,.13,2)
        elif i == 2:
            c.ring(0,67,.75,.15,end=48);c.noise(0,.75,.12,.96,19);c.sample(PLANK,.47,.28)
        elif i == 3:
            c.noise(0,.62,.14,.45,11);c.gravel(.11,9,.08,.05);c.ring(.44,810,.25,.055,metallic=True)
        elif i == 4:
            c.sample(PLANK,0,.2,1.4);c.sample(MINING,.15,.2,1.2);c.sample(WOOD,.35,.3)
        elif i == 5:
            c.noise(0,.6,.12,.85,4);c.sample(BELL,.15,.18,1.6)
        elif i == 6:
            [c.sample(STONE,n*.12,.22,1.7-n*.1) for n in range(3)];c.sample(WOOD,.42,.25,1.5)
        elif i == 7:
            c.noise(0,.25,.12,.2,20);c.sample(WOOD,.27,.3,1.4);c.sample(METAL,.4,.12,2)
        elif i == 8:
            c.noise(0,.32,.09,.4);c.ring(.22,740,.4,.13,metallic=True);c.ring(.37,988,.35,.1,metallic=True)
        elif i == 9:
            c.sample(METAL,0,.2,1.6);c.sample(METAL,.13,.18,1.8);c.sample(GLASS,.34,.18,1.9)
        elif i == 10:
            c.sample(LIGHT,0,.26,1.1);c.sample(PLANK,.18,.22,1.2);c.ring(.39,330,.35,.1,metallic=True)
    elif family.startswith("B"):
        if i == 1:
            for at in [0,.3]:
                c.ring(at,265,.21,.2,end=120);c.noise(at,.17,.22,.85,45)
        elif i == 2:
            c.sample("cough.mp3",0,.25,1.1);c.sample(TIN,.7,.1,.85)
        elif i == 3:
            c.gravel(0,10,.11,.055);c.noise(.2,.42,.12,.3,24)
        elif i == 4:
            c.noise(0,.88,.28,.91,3,True);c.sample(BELL,.24,.18,.65)
        elif i == 5:
            c.noise(0,.86,.17,.55,7);c.gravel(.02,15,.11,.05)
        elif i == 6:
            c.sample(STONE,0,.27,1.1);c.sample(STONE,.17,.24,1);c.sample(TIN,.48,.19,.75)
        elif i == 7:
            c.noise(0,.88,.28,.93,2,True);c.ring(.18,210,.61,.12,end=160,metallic=True)
        elif i == 8:
            c.ring(0,146.83,.75,.2,end=135);c.ring(.08,220,.65,.08,end=202);c.noise(.2,.58,.1,.93)
    elif family.startswith("H"):
        risk = stage == "forecast"
        confirmed = stage == "confirmed"
        cancelled = stage == "cancelled"
        power = .38 if risk else .6 if confirmed else .25 if cancelled else .8
        if i == 1:
            c.gravel(0,5 if risk else 11,power*.22,.065)
            c.noise(.05,.9,power*.3,.71,13)
            if cancelled:c.noise(.1,.7,.18,.93)
            elif stage=="applied":c.sample(PLANK,.3,.26,.85)
        elif i == 2:
            c.noise(0,1.05,power*.4,.87,6,not cancelled)
            c.noise(.3,.7,power*.19,.38,8)
            if confirmed:c.ring(.06,230,.27,.1,end=265)
        elif i == 3:
            c.noise(0,1.15,power*.6,.95,2,not cancelled)
            c.ring(.15,73,1,.1 if cancelled else power*.16,end=48 if cancelled else 95)
            if stage=="applied":c.noise(.5,.42,.3,.42)
        elif i == 4:
            if risk or confirmed:
                c.sample("whisper.mp3",.04,.2 if risk else .25,.94 if risk else 1.05)
                c.ring(.12,96,.9,.06,end=125 if confirmed else 103)
                if confirmed:c.sample(TIN,.55,.18,.8)
            elif cancelled:
                c.noise(0,.95,.18,.93);c.ring(.02,180,.75,.09,end=520)
            else:
                c.noise(0,.26,.13,.65,0,True);c.sample(MINING,.22,.42,.65)
                c.ring(.24,82,.9,.2,end=38);c.noise(.25,.86,.28,.94)
        if confirmed:
            c.sample(LIGHT,.03,.12,1.7);c.sample(LIGHT,.18,.12,1.5)
        if cancelled:
            c.ring(.65,400,.32,.06,end=520,metallic=True)
    elif family == "P01":
        if stage == "applied":
            c.noise(0,.95,.15,.9,30);[c.sample(METAL,n*.14,.16,.85) for n in range(5)]
            c.ring(0,92,.9,.12,end=110)
        elif stage == "success":
            c.sample(MINING,0,.23,.95);c.noise(.1,.8,.16,.91,12);c.ring(.16,160,.8,.13,end=370)
            c.sample(GLASS,.55,.2,1.6)
        else:
            c.noise(0,.9,.13,.92,17);c.ring(0,120,.9,.15,end=39);c.sample(METAL,.65,.12,.7)
    elif family == "P02":
        c.noise(0,.36,.14,.28,14);c.sample(WOOD,.25,.3,1.1)
        if stage == "success":
            [c.ring(.36+n*.12,f,.42,.09,metallic=True) for n,f in enumerate([523.25,659.25,783.99])]
        elif stage == "cancelled":c.noise(.33,.4,.12,.3,12)
        else:c.sample(METAL,.4,.12,1.8)
    elif family == "E01":
        if stage == "applied":
            c.sample("cough.mp3",0,.25,.95);c.sample("cough-female.mp3",.48,.19,1.05)
        elif stage == "success":
            c.sample("cough-female.mp3",0,.22,.95);c.sample("cough.mp3",.38,.23,1.05)
            c.sample("cough-female.mp3",.85,.17,1.1)
        elif stage == "cancelled":
            c.sample("cough-female.mp3",0,.1,1.2);c.ring(.56,392,.5,.09,end=523,metallic=True)
        elif stage == "update":
            c.sample("cough.mp3",.04,.14,1.05);c.sample("cough-female.mp3",.65,.1,1.1)
            c.sample(LIGHT,1.08,.11,1.6)
        else:
            c.sample("cough-female.mp3",.06,.14,1.1);c.sample(LIGHT,.72,.1,1.8)


for family, (label, stages, description) in FAMILIES.items():
    for stage in stages:
        duration = 1.65 if family == "E01" else 1.25 if family.startswith("H") else 1.1 if family.startswith("P") or family == "B02" else .95
        clip = Clip(duration, family + ":" + stage)
        arrange_news(clip, family, stage)
        CLIPS.append(clip.finish(family + "-" + stage, label + ": " + stage + ". " + description, "news"))

manifest = {
    "bankVersion": "district-audio@1", "purpose": "Licensed placeholders pending human auditory acceptance",
    "license": LICENSE, "licenseUrl": LICENSE_URL, "verifiedOn": "2026-11-27",
    "generator": "scripts/build-district-audio.py", "runtimeFetchesExternalSources": False,
    "sources": {name: {**info, "license": LICENSE, "licenseUrl": LICENSE_URL,
                       "sha256": hashlib.sha256((SRC/name).read_bytes()).hexdigest()} for name,info in SOURCE_INFO.items()},
    "families": {family: {"label": label,"stages":{stage: family+"-"+stage for stage in stages}} for family,(label,stages,_) in FAMILIES.items()},
    "clips": CLIPS,
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"clips":len(CLIPS),"families":len(FAMILIES),"bytes":sum((OUT/(c['path'])).stat().st_size for c in CLIPS),
                  "maxPeak":max(c['peak'] for c in CLIPS),"longestSeconds":max(c['seconds'] for c in CLIPS)}))

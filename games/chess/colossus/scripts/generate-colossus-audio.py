"""Original deterministic COLOSSUS synthesis. No sampled recordings."""
from pathlib import Path
import math, wave, struct, random, hashlib, json
root=Path(__file__).resolve().parents[1]/'public/assets/colossus/audio'
root.mkdir(parents=True, exist_ok=True)
sr=24000
specs={'move':(.20,165),'stone':(.34,65),'armour':(.36,440),'wound':(.30,115),'shield':(.42,620),'card':(.48,330),'fire':(.65,92),'victory':(1.45,220),'defeat':(1.10,110)}
manifest={}
for name,(duration,hz) in specs.items():
 rng=random.Random(41+sum(map(ord,name)))
 out=[]
 for i in range(int(sr*duration)):
  t=i/sr; p=t/duration; env=min(1,t/.008)*math.exp(-p*(4 if name not in ('victory','defeat') else 2.3))*(1-p)
  freq=hz*(1-.28*p) if name in ('stone','wound','defeat') else hz
  tone=sum(math.sin(2*math.pi*freq*ratio*t)*weight for ratio,weight in [(1,.55),(1.51,.19),(2.01,.11)])
  noise=rng.uniform(-1,1)
  if name in ('stone','fire'): tone=tone*.40+noise*.38
  if name=='victory': tone=sum(math.sin(2*math.pi*hz*r*t)*.25 for r in [1,1.25,1.5,2])
  if name=='card': tone=tone*.55+noise*.16
  out.append(int(max(-1,min(1,tone*env*.32))*32767))
 path=root/(name+'.wav')
 with wave.open(str(path),'wb') as wav:
  wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(sr);wav.writeframes(struct.pack('<'+'h'*len(out),*out))
 b=path.read_bytes();manifest[name]={'file':path.name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'seconds':duration}
(root/'manifest.json').write_text(json.dumps({'source':'Original deterministic synthesis; no third-party recordings','generator':'scripts/generate-colossus-audio.py','sounds':manifest},indent=2)+'\n')
print(json.dumps({k:v['bytes'] for k,v in manifest.items()}))


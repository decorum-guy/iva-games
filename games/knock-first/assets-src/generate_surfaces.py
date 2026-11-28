#!/usr/bin/env python3
"""Original deterministic architectural PBR maps. No external source images."""
from pathlib import Path
import numpy as np
import math
from PIL import Image, ImageDraw, ImageFilter
ROOT=Path(__file__).resolve().parents[1]/'public/knock-first/textures'
rng=np.random.default_rng(301128)
N=512
y,x=np.mgrid[:N,:N]
def noise(scale):
 return np.asarray(Image.fromarray(rng.integers(0,255,(scale,scale),dtype=np.uint8)).resize((N,N),Image.Resampling.BICUBIC),dtype=float)/255-.5
for kind,color,rough in [('concrete',(91,112,113),.9),('metal',(64,88,91),.58),('archive',(104,117,108),.91),('floor',(75,91,94),.77)]:
 large=noise(8); medium=noise(48); grain=noise(256)
 height=.5+large*.18+medium*.10+grain*.04
 stain=np.maximum(0,large+.05)
 rgb=np.zeros((N,N,3))+color
 rgb+=large[:,:,None]*28+medium[:,:,None]*12+grain[:,:,None]*10
 if kind in ('archive','concrete'):
  water=(np.clip((y-N*.62)/N*.8,0,1)*(1+large))
  rgb-=water[:,:,None]*np.array([35,29,20])
  pores=rng.random((N,N))<.012;rgb[pores]*=.55;height[pores]-=.15
  form=(y%128<2);rgb[form]*=.68;height[form]-=.08
 if kind=='metal':
  chips=(medium+large*.4)>.26
  rgb[chips]=np.array([112,77,48])+grain[chips,None]*24
  height[chips]-=.06
  lines=(x%128<3);rgb[lines]*=.35;height[lines]-=.14
 if kind=='floor':
  lines=(x<4)|(y<4);rgb[lines]*=.35;height[lines]-=.2
  wet=(large>.11);rgb[wet]*=.94
 # original hand-drawn hairline fractures / machining scratches
 scratch=Image.new('L',(N,N));d=ImageDraw.Draw(scratch)
 for i in range(12 if kind=='metal' else 4):
  px=int(rng.integers(12,N-12));py=int(rng.integers(0,N-60))
  d.line([(px,py),(px+int(rng.integers(-7,7)),py+22),(px+int(rng.integers(-9,9)),py+55)],fill=70,width=1)
 mask=np.array(scratch)/255;rgb-=mask[:,:,None]*48;height-=mask*.1
 dx=np.roll(height,-1,1)-np.roll(height,1,1);dy=np.roll(height,-1,0)-np.roll(height,1,0)
 normals=np.stack([-dx*3,-dy*3,np.ones_like(dx)],axis=-1);normals/=np.linalg.norm(normals,axis=-1)[:,:,None]
 Image.fromarray(np.uint8(np.clip(rgb,0,255))).save(ROOT/f'{kind}-color.jpg',quality=92)
 Image.fromarray(np.uint8((normals*.5+.5)*255)).save(ROOT/f'{kind}-normal.png',optimize=True)
 r=np.clip(rough+medium*.1-(large>.11)*(.08 if kind=='floor' else 0),.25,1)
 Image.fromarray(np.uint8(r*255)).save(ROOT/f'{kind}-roughness.png',optimize=True)
print('Generated four original 512px PBR surfaces')
# Viewmodel leather and woven canvas use their own true-scale UV maps.
for kind,color in [('glove-leather',(83,73,61)),('glove-fabric',(72,79,78))]:
 fine=noise(256);cloud=noise(24)
 if kind.endswith('fabric'):
  weave=((x%4<2).astype(float)+(y%4<2).astype(float)-1)*.04
  height=.5+fine*.12+weave
 else:
  height=.5+fine*.18+cloud*.04
 rgb=np.array(color)[None,None,:]+fine[:,:,None]*18+cloud[:,:,None]*35
 dx=np.roll(height,-1,1)-np.roll(height,1,1);dy=np.roll(height,-1,0)-np.roll(height,1,0)
 normal=np.stack([-dx*1.5,-dy*1.5,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1)[:,:,None]
 Image.fromarray(np.uint8(np.clip(rgb,0,255))).save(ROOT/f'{kind}-color.jpg',quality=92)
 Image.fromarray(np.uint8((normal*.5+.5)*255)).save(ROOT/f'{kind}-normal.png',optimize=True)
 orm=np.zeros((N,N,3),dtype=np.uint8);orm[:,:,0]=255;orm[:,:,1]=np.uint8(np.clip(.79+fine*.15,0,1)*255)
 Image.fromarray(orm).save(ROOT/f'{kind}-orm.png',optimize=True)

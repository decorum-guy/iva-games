#!/usr/bin/env python3
"""Structural checks of the shipped files, independent of their Blender source.

This is asset validation, not a claim of browser or physical-device acceptance.
"""
from __future__ import annotations
import hashlib
import copy
import json
import math
from pathlib import Path
import struct
import sys
import wave

import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'public'/'knock-first'
QA=ROOT.parent.parent/'.qa'/'knock-first'/'assets'
sys.path.insert(0,str(ROOT.parent.parent/'.qa'/'knock-first'/'font-tools'))
from fontTools.ttLib import TTFont

REQUIRED_MODELS={'battery','socket','resonator','striker','timer','beacon','cabinet','lift','operative','arms','listener','shelf','pump','pipe','valve','pallet','vent','cable','lamp','archive-box','fan','ladder','sign','control-panel','extinguisher','door-frame','door','wall-archive','wall-pump','wall-relay','floor','ceiling','corner','ramp','railing'}
EXPECTED_CLIPS={
    'listener':{'idle','walk','run','listen','turn','lunge','push'},
    'operative':{'idle','walk','run','crouch','carry','revive','down','support'},
    'arms':{'idle','walk','run','crouch','carry','knock','revive','down'},
}
DTYPES={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
COMPONENTS={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT2':4,'MAT3':9,'MAT4':16}


def glb(path):
    raw=path.read_bytes()
    magic,version,length=struct.unpack_from('<III',raw)
    assert magic==0x46546C67 and version==2 and length==len(raw), f'Invalid GLB header: {path}'
    length,kind=struct.unpack_from('<II',raw,12)
    assert kind==0x4E4F534A
    data=json.loads(raw[20:20+length])
    pos=20+length
    bin_length,bin_kind=struct.unpack_from('<II',raw,pos)
    assert bin_kind==0x004E4942 and pos+8+bin_length==len(raw)
    return data,raw[pos+8:pos+8+bin_length]


def accessor(data,binary,index):
    a=data['accessors'][index];view=data['bufferViews'][a['bufferView']]
    dtype=np.dtype(DTYPES[a['componentType']]);width=COMPONENTS[a['type']]
    start=view.get('byteOffset',0)+a.get('byteOffset',0)
    stride=view.get('byteStride',width*dtype.itemsize)
    assert start+(a['count']-1)*stride+width*dtype.itemsize<=len(binary)
    result=np.ndarray((a['count'],width),dtype,buffer=binary,offset=start,strides=(stride,dtype.itemsize))
    assert np.isfinite(result).all()
    return result


def node_matrix(node):
    if 'matrix' in node:return np.array(node['matrix']).reshape((4,4),order='F')
    x,y,z,w=node.get('rotation',[0,0,0,1])
    m=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),0],
                [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),0],
                [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),0],[0,0,0,1]],dtype=float)
    m[:3,:3]=m[:3,:3]@np.diag(node.get('scale',[1,1,1]))
    m[:3,3]=node.get('translation',[0,0,0])
    return m


def nodes_world(data):
    out={}
    def visit(i,parent):
        matrix=parent@node_matrix(data['nodes'][i]);out[i]=matrix
        for child in data['nodes'][i].get('children',[]):visit(child,matrix)
    for i in data['scenes'][data.get('scene',0)]['nodes']:visit(i,np.eye(4))
    return out


def animated_worlds(data,binary,clip,time):
    posed=copy.deepcopy(data)
    animation=next(a for a in data['animations']if a['name']==clip)
    for channel in animation['channels']:
        sampler=animation['samplers'][channel['sampler']]
        assert sampler.get('interpolation','LINEAR')in ('LINEAR','STEP')
        times=accessor(data,binary,sampler['input']).reshape(-1)
        values=accessor(data,binary,sampler['output']).astype(float)
        before=max(0,min(len(times)-1,int(np.searchsorted(times,time,side='right'))-1))
        after=min(before+1,len(times)-1)
        fraction=0 if after==before else float(np.clip((time-times[before])/(times[after]-times[before]),0,1))
        first,last=values[before],values[after]
        target=channel['target'];path=target['path']
        if path=='rotation':
            first=first/np.linalg.norm(first);last=last/np.linalg.norm(last)
            dot=float(np.dot(first,last))
            if dot<0:last=-last;dot=-dot
            angle=math.acos(min(1,max(-1,dot)))
            if angle<1e-5:value=(1-fraction)*first+fraction*last
            else:value=(math.sin((1-fraction)*angle)*first+math.sin(fraction*angle)*last)/math.sin(angle)
            value=value/np.linalg.norm(value)
        else:value=(1-fraction)*first+fraction*last
        posed['nodes'][target['node']][path]=value.tolist()
    return nodes_world(posed)


def bone_position(data,worlds,name):
    return next(worlds[i][:3,3]for i,n in enumerate(data['nodes'])if n.get('name')==name)


def skinned_bounds(data,binary,worlds):
    skin=data['skins'][0]
    inverse_binds=accessor(data,binary,skin['inverseBindMatrices']).reshape((-1,4,4)).transpose((0,2,1))
    matrices=np.array([worlds[joint]@inverse_binds[i]for i,joint in enumerate(skin['joints'])])
    points=[]
    for mesh in data['meshes']:
        for primitive in mesh['primitives']:
            attributes=primitive['attributes']
            positions=accessor(data,binary,attributes['POSITION'])
            joints=accessor(data,binary,attributes['JOINTS_0'])
            weights=accessor(data,binary,attributes['WEIGHTS_0'])
            if data['accessors'][attributes['WEIGHTS_0']]['componentType']!=5126:
                weights=weights.astype(float)/np.iinfo(weights.dtype).max
            homogeneous=np.column_stack([positions,np.ones(len(positions))])
            transformed=np.zeros_like(homogeneous)
            for column in range(4):
                transformed+=np.einsum('nij,nj->ni',matrices[joints[:,column]],homogeneous)*weights[:,column:column+1]
            points.append(transformed[:,:3])
    points=np.vstack(points)
    return points.min(axis=0),points.max(axis=0)


def validate():
    summary={'models':[],'audio':[],'fonts':[],'textures':[],'rigMotion':{}}
    model_files={p.stem:p for p in (OUT/'models').glob('*.glb')}
    assert REQUIRED_MODELS<=set(model_files),REQUIRED_MODELS-set(model_files)
    for name,path in sorted(model_files.items()):
        data,binary=glb(path)
        for i,a in enumerate(data.get('accessors',[])):
            values=accessor(data,binary,i)
            if a['componentType']==5126:
                assert np.abs(values).max()<1e7,f'Exploded accessor in {name}/{i}'
        for view in data.get('bufferViews',[]):
            assert view.get('byteOffset',0)+view['byteLength']<=len(binary)
        for image in data.get('images',[]):
            assert 'uri'in image and not image['uri'].startswith(('http','data:'))
            image_path=(path.parent/image['uri']).resolve()
            assert image_path.is_relative_to(OUT.resolve()) and image_path.is_file()
            Image.open(image_path).verify()
        triangles=0
        for mesh in data['meshes']:
            for primitive in mesh['primitives']:
                attrs=primitive['attributes'];positions=accessor(data,binary,attrs['POSITION'])
                assert 'NORMAL'in attrs and 'TEXCOORD_0'in attrs
                if 'indices'in primitive:
                    indices=accessor(data,binary,primitive['indices'])
                    assert indices.max()<len(positions)
                    triangles+=indices.size//3
                if 'WEIGHTS_0'in attrs:
                    weights=accessor(data,binary,attrs['WEIGHTS_0'])
                    if data['accessors'][attrs['WEIGHTS_0']]['componentType']!=5126:
                        weights=weights.astype(float)/np.iinfo(weights.dtype).max
                    assert np.max(np.abs(weights.sum(axis=1)-1))<.005,f'Unbound skin in {name}'
        clips={a['name']for a in data.get('animations',[])}
        if name in EXPECTED_CLIPS:
            assert EXPECTED_CLIPS[name]<=clips, (name,clips)
            assert len(data.get('skins',[]))==1
            bone_names={n.get('name')for n in data['nodes']}
            for side in ('left','right'):
                for joint in ('upper_arm','forearm','hand'):
                    assert side+'_'+joint in bone_names,(name,side,joint)
            for animation in data['animations']:
                duration=0
                for sampler in animation['samplers']:
                    times=accessor(data,binary,sampler['input']).reshape(-1)
                    assert (np.diff(times)>0).all() and times.min()>=0
                    duration=max(duration,float(times[-1]))
                assert duration>.3,(name,animation['name'],duration)
        if name=='battery':
            worlds=nodes_world(data)
            for key,expected in [('Handle_L',[-.62,.32,0]),('Handle_R',[.62,.32,0])]:
                matches=[worlds[i][:3,3]for i,n in enumerate(data['nodes'])if n.get('name')==key]
                assert len(matches)==1 and np.allclose(matches[0],expected,atol=1e-5),(key,matches)
        if name in ('arms','operative'):
            worlds=nodes_world(data)
            for key,bone in [('Hand_L','left_hand'),('Hand_R','right_hand')]:
                anchor_position=next(worlds[i][:3,3]for i,n in enumerate(data['nodes'])if n.get('name')==key)
                wrist_position=next(worlds[i][:3,3]for i,n in enumerate(data['nodes'])if n.get('name')==bone)
                assert np.allclose(anchor_position,wrist_position,atol=1e-5),(name,key,anchor_position,wrist_position)
        if name=='operative':
            max_wrist_error=0;max_ankle_error=0
            for time in np.linspace(0,1.4,43):
                posed=animated_worlds(data,binary,'carry',time)
                for side,pre in [(-1,'left'),(1,'right')]:
                    wrist=bone_position(data,posed,pre+'_hand')
                    ankle=bone_position(data,posed,pre+'_foot')
                    max_wrist_error=max(max_wrist_error,float(np.linalg.norm(wrist-[side*.11,.65,-.31])))
                    max_ankle_error=max(max_ankle_error,float(np.linalg.norm(ankle-[side*.12,.105,.008])))
            assert max_wrist_error<.005,('operative carry wrist target drift',max_wrist_error)
            assert max_ankle_error<.005,('operative carry ankle floor drift',max_ankle_error)
            revive=animated_worlds(data,binary,'revive',1.0)
            for pre in ('left','right'):
                wrist=bone_position(data,revive,pre+'_hand')
                assert wrist[2]<-.36 and .48<wrist[1]<.54,('operative revive hands',wrist)
            summary['rigMotion']['operative']={'carrySamples':43,'maximumWristErrorMetres':max_wrist_error,
                                              'maximumAnkleErrorMetres':max_ankle_error,'targetWristY':.65,'targetWristZ':-.31}
            down_min_y=1e3;down_max_y=-1e3
            for time in np.linspace(0,2.1,10):
                low,high=skinned_bounds(data,binary,animated_worlds(data,binary,'down',time))
                down_min_y=min(down_min_y,float(low[1]));down_max_y=max(down_max_y,float(high[1]))
            assert -.015<down_min_y<.10 and down_max_y<.60,('down skin floor bounds',down_min_y,down_max_y)
            summary['rigMotion']['operative']['downSkinMinY']=down_min_y
            summary['rigMotion']['operative']['downSkinMaxY']=down_max_y
        if name=='arms':
            rest=nodes_world(data)
            side_metrics=[]
            for side,pre in [(-1,'left'),(1,'right')]:
                shoulder=bone_position(data,rest,pre+'_upper_arm')
                elbow=bone_position(data,rest,pre+'_forearm')
                wrist=bone_position(data,rest,pre+'_hand')
                reach=float(np.linalg.norm(elbow-shoulder)+np.linalg.norm(wrist-elbow))
                translated_shoulder=shoulder+[0,1.48,-.03]
                distance=float(np.linalg.norm(translated_shoulder-[side*.11,.65,-.31]))
                assert distance<reach-.01,('first-person carry reach',pre,distance,reach)
                side_metrics.append({'side':pre,'boneReachMetres':reach,'targetDistanceMetres':distance,'bendReserveMetres':reach-distance})
            summary['rigMotion']['arms']={'rootXYZ':[0,1.48,-.03],'carryReach':side_metrics}
        if name=='listener':
            posed=animated_worlds(data,binary,'lunge',.70)
            hand_positions={pre:bone_position(data,posed,pre+'_hand').tolist()for pre in ('left','right')}
            assert all(p[2]<-.70 for p in hand_positions.values()),('listener strike must reach forward -Z',hand_positions)
            summary['rigMotion']['listener']={'lungeTimeSeconds':.70,'handPositionsXYZ':hand_positions}
        materials=data.get('materials',[])
        atlas=next(m for m in materials if m.get('name')=='Archive_Atlas')
        assert 'baseColorTexture'in atlas['pbrMetallicRoughness'] and 'metallicRoughnessTexture'in atlas['pbrMetallicRoughness'],f'Missing PBR atlas: {name}'
        assert 'normalTexture'in atlas, f'Missing normal map: {name}'
        summary['models'].append({'id':name,'bytes':path.stat().st_size,'triangles':triangles,'animations':sorted(clips),'skins':len(data.get('skins',[]))})
    manifest=json.loads((OUT/'audio'/'manifest.json').read_text())
    for entry in manifest['files']:
        path=OUT/'audio'/entry['file']
        assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256']
        with wave.open(str(path),'rb')as wav:
            assert wav.getsampwidth()==2
            samples=np.frombuffer(wav.readframes(wav.getnframes()),dtype='<i2').astype(float)/32768
            assert samples.size>100 and np.isfinite(samples).all() and np.abs(samples).max()<.40
            assert abs(samples.mean())<.001
            if entry['file'].startswith('ambience-'):
                channels=samples.reshape(-1,wav.getnchannels())
                assert np.max(np.abs(channels[0]-channels[-1]))<.015
            else:
                assert abs(samples[0])<.001 and abs(samples[-1])<.001
            summary['audio'].append({'id':entry['file'],'bytes':path.stat().st_size,'seconds':round(wav.getnframes()/wav.getframerate(),3)})
    for key,value in manifest['sounds'].items():
        assert value['bus']in ('ambience','world','threat','ui','music') and 0<=value['gain']<=1
        for filename in value['files']:assert (OUT/'audio'/filename).is_file(),(key,filename)
    required='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя№'
    for entry in json.loads((OUT/'fonts'/'font-sources.json').read_text()):
        path=OUT/'fonts'/entry['file']
        font=TTFont(path)
        cmap=font.getBestCmap()
        assert all(ord(c)in cmap for c in required)
        assert (OUT/'fonts'/entry['licenseFile']).is_file()
        source=TTFont(ROOT/entry['sourceFile'])
        assert font.getBestCmap()==source.getBestCmap(),'WOFF2 glyph mapping changed'
        assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256']
        summary['fonts'].append({'id':entry['file'],'bytes':path.stat().st_size,'glyphs':len(cmap),'version':entry['version']})
    for path in (OUT/'textures').glob('*'):
        if path.suffix not in ('.png','.jpg'):continue
        image=Image.open(path);size=image.size;image.verify()
        summary['textures'].append({'id':path.name,'bytes':path.stat().st_size,'dimensions':size})
    summary['totalPublicBytes']=sum(p.stat().st_size for p in OUT.rglob('*')if p.is_file())
    summary['status']='PASS'
    summary['limits']='Structural local-file validation. Browser appearance, live mixer, listening, target-device performance and gameplay acceptance are separate.'
    QA.mkdir(parents=True,exist_ok=True)
    (QA/'asset-validation.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({'status':summary['status'],'models':len(summary['models']),'clips':sum(len(x['animations'])for x in summary['models']),
                      'wav':len(summary['audio']),'fonts':len(summary['fonts']),'textures':len(summary['textures']),
                      'totalPublicBytes':summary['totalPublicBytes']},indent=2))


if __name__=='__main__':validate()

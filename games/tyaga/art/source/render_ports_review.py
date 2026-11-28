"""Private Blender review of mechanism ports; never gameplay acceptance.

blender -b -t 2 --python games/tyaga/art/source/render_ports_review.py -- private-dir
The directory must contain models/manifest.json and the four proposed GLBs.
Production model files are read only (the drive shown at its canonical mount).
"""
from pathlib import Path
import json
import sys
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUTPUT=Path(sys.argv[sys.argv.index('--')+1])
MODELS=OUTPUT/'models'
PRODUCTION=ROOT/'public/assets/tyaga/models'
OUTPUT.mkdir(parents=True,exist_ok=True)


def p(v):return Vector((v[0],-v[2],v[1]))

def material(name,color,metal=0,rough=.7):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    b=m.node_tree.nodes['Principled BSDF'];b.inputs['Base Color'].default_value=(*color,1)
    b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=rough
    return m


def load(name,at=(0,0,0),production=False):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str((PRODUCTION if production else MODELS)/(name+'.glb')))
    objects=set(bpy.data.objects)-before
    root=bpy.data.objects.new('review-'+name,None);bpy.context.collection.objects.link(root)
    for obj in objects:
        if obj.parent not in objects:obj.parent=root
    root.location=p(at)
    return root


def box(at,size,color):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p(at));o=bpy.context.object
    o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material('review-support',color,0,.9));return o


def marker(at,radius=.018):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=radius,location=p(at))
    obj=bpy.context.object;obj.name='canonical-port-marker'
    obj.data.materials.append(material('review-port',(.025,.65,.73),.1,.3))
    return obj


def setup(target,camera_position,scale):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=False
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.62,.74,.76,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
    target=p(target)
    for offset,power,size in [((-.7,2.8,1.8),650,3.0),((2.1,1.5,-1.3),400,2.4)]:
        light=bpy.data.lights.new('review-softbox','AREA');light.energy=power;light.shape='DISK';light.size=size
        obj=bpy.data.objects.new('review-softbox',light);bpy.context.collection.objects.link(obj)
        obj.location=target+p(offset);obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('review-camera');data.type='ORTHO';data.ortho_scale=scale
    camera=bpy.data.objects.new('review-camera',data);bpy.context.collection.objects.link(camera)
    camera.location=p(camera_position);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=camera;scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.render.image_settings.file_format='PNG'
    return scene


def render(filename,target,camera,scale,kind):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    if kind=='winch':
        load('winch');box((0,-.325,0),(3,.1,3),(.30,.36,.33))
        markers=[marker((.35,.1,0)),marker((0,.3,0)),marker((0,-.155,0))]
        if filename.endswith('clean.png'):
            for obj in markers:obj.hide_render=True
    elif kind=='lift':
        load('lift');box((0,-.36,0),(11,.15,7),(.30,.36,.33))
        for at in [(-3.5,.8,1.6),(-3.8,.15,0),(3.8,.15,0)]:marker(at,.012 if filename.startswith('04-') else .04)
    elif kind=='lower':
        load('lift-control');box((0,-1.3,-2),(3,1,4),(.28,.34,.36));marker((0,0,0),.012)
    else:
        load('lift-transmission');load('drive',(-.55,-.55,0),True)
        box((0,-1.425,-1.15),(1.2,.35,2.36),(.28,.34,.36))
        marker((0,0,0),.012);marker((0,-.4,0),.012)
    scene=setup(target,camera,scale);scene.render.filepath=str(OUTPUT/filename)
    bpy.ops.render.render(write_still=True)
    print('ART_REVIEW_ONLY '+str(OUTPUT/filename),flush=True)


views=[
 ('01-winch-clean.png',(.02,.02,0),(1.6,1.15,1.5),1.36,'winch'),
 ('02-winch-canonical-ports.png',(.02,.02,0),(1.6,1.15,1.5),1.36,'winch'),
 ('03-lift-platform.png',(0,.2,0),(9,8,10),10.5,'lift'),
 ('04-lift-console.png',(-3.5,.67,1.5),(-1.4,2.3,3.5),1.95,'lift'),
 ('05-lower-control-road.png',(0,-.30,-.08),(1.4,.9,-2.4),1.70,'lower'),
 ('06-transmission-installed-drive.png',(-.28,-.55,-.03),(1.65,1.0,-2.5),2.70,'upper'),
 ('07-transmission-mount-close.png',(0,-.06,0),(-.8,.4,-.9),.80,'upper'),
]
selected=set(sys.argv[sys.argv.index('--')+2:])
for args in views:
    if not selected or args[0] in selected:render(*args)
(OUTPUT/'views.json').write_text(json.dumps({'scope':'Blender-only asset/geometry inspection; no browser acceptance','views':[{'file':v[0],'target':v[1],'camera':v[2],'orthoScale':v[3]} for v in views]},indent=2)+'\n')

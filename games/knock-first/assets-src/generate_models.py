#!/usr/bin/env python3
"""Original metric Blender asset production for Knock First.

blender --background --python games/knock-first/assets-src/generate_models.py
Arguments after --: --only battery,listener or --cover or --render-review.
All authored coordinates are Y-up, facing -Z. Blender conversion is explicit.
Meshes are finished with bevels, UV atlas islands, weighted normals and named
anchors. Characters have real skin/armature bindings and exported animations.
"""
from __future__ import annotations
import argparse
import json
import math
import random
import shutil
import struct
import sys
from pathlib import Path

import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from anatomical_glove import make_glove
from mathutils import Vector, Quaternion, Matrix

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'knock-first'
QA = ROOT.parent.parent / '.qa' / 'knock-first' / 'assets'
MODELS = OUT / 'models'
TEX = OUT / 'textures'
MODELS.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)
random.seed(58263)
TILES = {'concrete': 0, 'paint': 1, 'rust': 2, 'paper': 3, 'oilskin': 4, 'rubber': 5,
         'brass': 6, 'steel': 7, 'leather': 8, 'blue': 9, 'insulation': 10, 'ivory': 11,
         'amber': 12, 'dark': 13, 'cyan': 14, 'skin': 15}
MATS = {}
PARTS = []
ANCHORS = []
RECORDS = {}


def V(p):
    return Vector((p[0], -p[2], p[1]))


def tup(v):
    return [round(v.x, 6), round(v.z, 6), round(-v.y, 6)]


def clear():
    global PARTS, ANCHORS
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    PARTS = []
    ANCHORS = []


def materials():
    material = bpy.data.materials.new('Archive_Atlas')
    material.use_nodes = True
    tree = material.node_tree
    bsdf = tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = .8
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(TEX / 'archive-atlas-basecolor.jpg'), check_existing=True)
    texture.image.name = 'archive-atlas-basecolor'
    tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
    orm = tree.nodes.new('ShaderNodeTexImage')
    orm.image = bpy.data.images.load(str(TEX / 'archive-atlas-orm.png'), check_existing=True)
    orm.image.name = 'archive-atlas-orm'
    orm.image.colorspace_settings.name = 'Non-Color'
    separate = tree.nodes.new('ShaderNodeSeparateColor')
    tree.links.new(orm.outputs['Color'], separate.inputs['Color'])
    tree.links.new(separate.outputs['Green'], bsdf.inputs['Roughness'])
    tree.links.new(separate.outputs['Blue'], bsdf.inputs['Metallic'])
    normal = tree.nodes.new('ShaderNodeTexImage')
    normal.image = bpy.data.images.load(str(TEX / 'archive-atlas-normal.png'), check_existing=True)
    normal.image.name = 'archive-atlas-normal'
    normal.image.colorspace_settings.name = 'Non-Color'
    normal_map = tree.nodes.new('ShaderNodeNormalMap')
    normal_map.inputs['Strength'].default_value = .28
    tree.links.new(normal.outputs['Color'], normal_map.inputs['Color'])
    tree.links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
    MATS['atlas'] = material
    for name, color, power in [('warm', (1, .57, .24, 1), 1.8), ('cold', (.48, .82, .92, 1), 1.6), ('milk', (.89, .94, .88, 1), 1.8)]:
        mat = bpy.data.materials.new('Lamp_' + name)
        mat.diffuse_color = color
        mat.use_nodes = True
        p = mat.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value = color
        p.inputs['Roughness'].default_value = .55
        p.inputs['Emission Color'].default_value = color
        p.inputs['Emission Strength'].default_value = power
        MATS[name] = mat


def atlas_uv(obj, tile):
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='UVMap')
        # Planar fallback for custom meshes; explicit authored islands otherwise.
        for polygon in obj.data.polygons:
            for li in polygon.loop_indices:
                p = obj.data.vertices[obj.data.loops[li].vertex_index].co
                obj.data.uv_layers.active.data[li].uv = ((p.x * .17) % 1, (p.z * .17) % 1)
    index = TILES[tile]
    col, row = index % 4, index // 4
    for uv in obj.data.uv_layers.active.data:
        u, v = uv.uv
        uv.uv = ((col + .03125 + (u % 1 if u < 0 or u > 1 else u) * .9375) / 4,
                 1 - (row + .03125 + (v % 1 if v < 0 or v > 1 else v) * .9375) / 4)


def finish(obj, tile='paint', bone=None, bevel=0, smooth=False, material=None):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Machined_edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.affect = 'EDGES'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if material:
        obj.data.materials.append(MATS[material])
    else:
        obj.data.materials.append(MATS['atlas'])
        atlas_uv(obj, tile)
    if bone:
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    PARTS.append(obj)
    obj.select_set(False)
    return obj


def box(name, p, dims, tile='paint', bevel=.012, bone=None, material=None, yaw=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=V(p))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (dims[0], dims[2], dims[1])
    obj.rotation_euler.z = yaw
    return finish(obj, tile, bone, bevel, False, material)


def ellipsoid(name, p, dims, tile='paint', bone=None, seg=16, rings=8, material=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=V(p))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (dims[0] / 2, dims[2] / 2, dims[1] / 2)
    return finish(obj, tile, bone, 0, True, material)


def cylinder(name, a, b, r=.05, tile='paint', bone=None, vertices=12, r2=None, material=None):
    a, b = V(a), V(b)
    mid = (a + b) / 2
    length = (b - a).length
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=length, location=mid)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r, radius2=r2, depth=length, location=mid)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (b - a).to_track_quat('Z', 'Y')
    return finish(obj, tile, bone, min(.006, r / 10), True, material)


def tube(name, points, radius=.025, tile='paint', bone=None, closed=False, material=None):
    # Direct polygon tube; deterministic and immediately exportable.
    pts = [V(p) for p in points]
    n = len(pts)
    verts, faces = [], []
    sides = 8
    for i, point in enumerate(pts):
        before = pts[(i - 1) % n] if closed or i > 0 else pts[0]
        after = pts[(i + 1) % n] if closed or i < n - 1 else pts[-1]
        tangent = (after - before).normalized()
        normal = tangent.cross(Vector((0, 0, 1)))
        if normal.length < .01:
            normal = tangent.cross(Vector((1, 0, 0)))
        normal.normalize()
        binormal = tangent.cross(normal).normalized()
        for j in range(sides):
            angle = math.tau * j / sides
            verts.append(point + radius * (math.cos(angle) * normal + math.sin(angle) * binormal))
    for i in range(n if closed else n - 1):
        for j in range(sides):
            k = ((i + 1) % n) * sides
            faces.append((i * sides + j, i * sides + (j + 1) % sides, k + (j + 1) % sides, k + j))
    if not closed:
        faces.extend([tuple(reversed(range(sides))), tuple(range((n - 1) * sides, n * sides))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, tile, bone, 0, True, material)


def ring(name, p, radius=.15, thickness=.02, plane='XZ', tile='paint', bone=None, material=None):
    points = []
    for i in range(24):
        a = math.tau * i / 24
        offset = [0, 0, 0]
        axes = {'XY': (0, 1), 'XZ': (0, 2), 'YZ': (1, 2)}[plane]
        offset[axes[0]], offset[axes[1]] = math.cos(a) * radius, math.sin(a) * radius
        points.append(tuple(p[j] + offset[j] for j in range(3)))
    return tube(name, points, thickness, tile, bone, True, material)


def loft(name, rings, tile='oilskin', bone=None, sides=16, pleats=0):
    # Each ring is (x,y,z,halfWidth,halfDepth), all in metric Y-up.
    verts, faces = [], []
    for k, (x, y, z, rx, rz) in enumerate(rings):
        for i in range(sides):
            angle = math.tau * i / sides
            ripple = (1 + pleats * (1 if i % 2 else -1))
            verts.append(V((x + math.cos(angle) * rx * ripple, y, z + math.sin(angle) * rz * ripple)))
    for k in range(len(rings) - 1):
        for i in range(sides):
            faces.append((k * sides + i, k * sides + (i + 1) % sides, (k + 1) * sides + (i + 1) % sides, (k + 1) * sides + i))
    faces.extend([tuple(reversed(range(sides))), tuple(range((len(rings) - 1) * sides, len(rings) * sides))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    uv = mesh.uv_layers.new(name='UVMap')
    for polygon in mesh.polygons:
        for li in polygon.loop_indices:
            vi = mesh.loops[li].vertex_index
            uv.data[li].uv = ((vi % sides) / sides, (vi // sides) / max(1, len(rings) - 1))
    return finish(obj, tile, bone, 0, True)


def anchor(name, p, bone=None, rig=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = .08
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = Matrix.Translation(V(p))
    if bone and rig:
        obj.parent = rig
        obj.parent_type = 'BONE'
        obj.parent_bone = bone
        bpy.context.view_layer.update()
        # The depsgraph has not necessarily evaluated a freshly assigned location;
        # author the intended matrix explicitly instead of reading a stale identity.
        obj.matrix_world = Matrix.Translation(V(p))
        bpy.context.view_layer.update()
    ANCHORS.append(obj)
    return obj


def bolt(p, axis='Z', radius=.018, tile='steel'):
    delta = {'X': (.01, 0, 0), 'Y': (0, .01, 0), 'Z': (0, 0, .01)}[axis]
    return cylinder('Rivet', tuple(p[i] - delta[i] for i in range(3)), tuple(p[i] + delta[i] for i in range(3)), radius, tile, vertices=8)


def join_meshes(name, rig=None):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    # A single mesh with a single non-emissive atlas material (plus local lamps).
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if rig:
        obj.parent = rig
        mod = obj.modifiers.new('Bound_skin', 'ARMATURE')
        mod.object = rig
        mod.use_vertex_groups = True
    return obj


def export(name, dimensions=None, collider=None, rig=None, notes=None):
    mesh = join_meshes(name + '_Mesh', rig)
    bpy.context.scene.frame_set(1)
    if rig:
        rig.animation_data.action = None
        for pb in rig.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
    temp = QA / ('export-' + name)
    temp.mkdir(exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    for obj in ANCHORS:
        obj.select_set(True)
    if rig:
        rig.select_set(True)
    bpy.context.view_layer.objects.active = rig or mesh
    bpy.context.scene.render.fps = 30
    bpy.ops.export_scene.gltf(filepath=str(temp / (name + '.gltf')), export_format='GLTF_SEPARATE',
        use_selection=True, export_yup=True, export_animations=bool(rig), export_animation_mode='NLA_TRACKS',
        export_nla_strips=True, export_force_sampling=True, export_frame_step=2,
        export_skins=True, export_all_influences=False, export_morph=False,
        export_lights=False, export_cameras=False, export_extras=True,
        export_materials='EXPORT', export_image_format='AUTO')
    data = json.loads((temp / (name + '.gltf')).read_text())
    binary = (temp / data['buffers'][0]['uri']).read_bytes()
    data['buffers'][0].pop('uri')
    for image in data.get('images', []):
        uri = image.get('uri')
        if uri:
            src = temp / uri
            filename = Path(uri).name
            destination = TEX / filename
            if src.exists() and (not destination.exists() or src.read_bytes() != destination.read_bytes()):
                shutil.copyfile(src, destination)
            image['uri'] = '../textures/' + filename
    # A GLB can reference shared external images; every model shares the same atlas.
    # Avoid embedding the 1K atlas anew in each of thirty small props.
    encoded = json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    binary += b'\0' * ((-len(binary)) % 4)
    length = 12 + 8 + len(encoded) + 8 + len(binary)
    result = struct.pack('<III', 0x46546C67, 2, length) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + struct.pack('<II', len(binary), 0x004E4942) + binary
    (MODELS / (name + '.glb')).write_bytes(result)
    counts = sum(len(poly.vertices) - 2 for poly in mesh.data.polygons)
    clips = [a['name'] for a in data.get('animations', [])]
    world_vertices = [mesh.matrix_world @ vertex.co for vertex in mesh.data.vertices]
    bounds_min = Vector(tuple(min(v[i] for v in world_vertices) for i in range(3)))
    bounds_max = Vector(tuple(max(v[i] for v in world_vertices) for i in range(3)))
    dimensions_measured = [round(bounds_max.x-bounds_min.x, 5), round(bounds_max.z-bounds_min.z, 5), round(bounds_max.y-bounds_min.y, 5)]
    RECORDS[name] = {'file': 'models/' + name + '.glb', 'units': 'metres', 'up': '+Y', 'forward': '-Z',
                     'triangles': counts, 'bytes': len(result), 'meshPrimitives': sum(len(m['primitives']) for m in data.get('meshes', [])),
                     'dimensionsXYZ': dimensions_measured, 'bodyDimensionsXYZ': dimensions, 'collision': collider,
                     'animations': clips, 'skinCount': len(data.get('skins', [])), 'anchors': [a.name for a in ANCHORS], 'notes': notes or ''}
    bpy.ops.wm.save_as_mainfile(filepath=str(QA / (name + '-editable.blend')))
    print('EXPORTED', name, json.dumps(RECORDS[name]))
    return mesh


def battery():
    clear()
    box('Battery_chassis', (0, .215, 0), (.95, .43, .55), 'paint', .032)
    box('Sealed_lid', (0, .401, 0), (.85, .045, .50), 'dark', .012)
    for x in (-.36, .36):
        box('Rubber_bumper', (x, .21, 0), (.045, .425, .556), 'rubber', .009)
    for x in (-.475, .475):
        box('Terminal_endplate', (x, .22, 0), (.018, .30, .425), 'steel', .012)
    for s, suffix in [(-1, 'L'), (1, 'R')]:
        tube('Handle_' + suffix + '_steel', [(s*.45,.27,-.15),(s*.59,.29,-.15),(s*.62,.32,-.11),(s*.62,.32,.11),(s*.59,.29,.15),(s*.45,.27,.15)], .024, 'steel')
        cylinder('Handle_' + suffix + '_grip', (s*.62,.32,-.105), (s*.62,.32,.105), .034, 'rubber', vertices=14)
        anchor('Handle_' + suffix, (s*.62,.32,0))
    for x in [-.29,-.20,-.11,-.02,.07,.16,.25]:
        box('Cooling_rib', (x,.215,.278), (.026,.20,.012), 'dark', .003)
    box('Enamel_identity_plate', (-.02,.26,-.281), (.39,.11,.008), 'ivory', .003)
    for x,w in [(-.16,.022),(-.10,.014),(-.052,.008),(-.028,.014),(.018,.022),(.065,.01),(.095,.014),(.13,.018)]:
        box('Inventory_code', (x,.265,-.288), (w,.065,.002), 'dark', 0)
    box('Indicator_recess', (.30,.28,-.278), (.09,.13,.014), 'rubber', .01)
    box('Indicator', (.30,.30,-.289), (.026,.061,.006), material='milk', bevel=.004)
    for x in (-.42,.42):
        for z in (-.21,.21):
            bolt((x,.426,z), 'Y', .013)
    anchor('BodyCenter', (0,.215,0))
    anchor('InstallPoint', (0,0,0))
    return export('battery', [.95,.43,.55], {'type':'box','size':[.95,.43,.55],'center':[0,.215,0]}, notes='Body exact size excludes two real end handles. Handle anchors ±0.62m; grip crossbar local Z.')


def socket():
    clear()
    box('Socket_plinth', (0,.07,0), (1.42,.14,.9), 'dark', .025)
    for x in (-.62,.62):
        box('Guide_rail',(x,.15,0),(.1,.20,.78),'steel',.012)
        box('Inset_amber_line',(x,.256,0),(.035,.008,.69),'amber',.001)
    box('Stop_block',(0,.24,.38),(1.12,.34,.11),'paint',.022)
    for x in (-.20,.20):
        cylinder('Contact',(x,.25,.30),(x,.25,.23),.065,'brass')
    box('Power_light',(0,.43,.39),(.12,.022,.034),material='milk',bevel=.004)
    anchor('BatterySeat',(0,.14,0))
    anchor('Interaction',(0,.45,-.55))
    return export('socket', collider={'type':'box','size':[1.42,.14,.9],'center':[0,.07,0]})


def resonator():
    clear()
    cylinder('Pipe',(0,0,0),(0,2.65,0),.105,'paint',vertices=32)
    for y in (.58,.65,.72,1.75,1.82,1.89):
        cylinder('Hazard_wrap',(0,y-.024,0),(0,y+.024,0),.107,'amber' if int(y*100)%2 else 'dark',vertices=32)
    for y in (.35,1.95):
        box('Mount_backplate',(0,y,.31),(.33,.24,.025),'paint',.012)
        for x in (-.12,.12):
            for offset in (-.075,.075): bolt((x,y+offset,.29),'Z',.013)
    tube('Pressure_capillary',[(.13,.2,.08),(.19,.3,.08),(.19,2.2,.08),(.11,2.3,.08)],.012,'brass')
    cylinder('Pressure_gauge_neck',(.13,1.6,0),(.24,1.6,0),.022,'steel',vertices=16)
    cylinder('Pressure_gauge_case',(.23,1.6,.02),(.23,1.6,-.06),.083,'dark',vertices=24)
    cylinder('Pressure_gauge_face',(.23,1.6,-.061),(.23,1.6,-.066),.069,'ivory',vertices=24)
    for i in range(9):
        a=math.pi*(.15+i*.09)
        box('Gauge_tick',(.23+math.cos(a)*.05,1.6+math.sin(a)*.05,-.069),(.004,.011,.003),'dark',0)
    tube('Gauge_needle',[(.23,1.6,-.072),(.20,1.635,-.072)],.002,'dark')
    for y in (.15,.88,2.15,2.50):
        cylinder('Flange',(0,y-.025,0),(0,y+.025,0),.16,'paint',vertices=16)
        for a in range(6):
            angle=math.tau*a/6
            bolt((math.cos(angle)*.13,y+.03,math.sin(angle)*.13),'Y',.014)
    box('Strike_plate',(0,1.30,-.116),(.31,.27,.04),'brass',.02)
    ring('Strike_groove',(0,1.30,-.141),.075,.006,'XY','dark')
    cylinder('Hot_indicator',(-.12,1.56,-.1),(.12,1.56,-.1),.012,material='warm')
    for y in (.35,1.95):
        box('Wall_standoff',(0,y,.19),(.30,.07,.4),'dark',.008)
    anchor('KnockPoint',(0,1.30,-.145))
    return export('resonator', collider={'type':'capsule','radius':.16,'height':2.65})


def striker():
    clear()
    tailored_segment('Striker_grip',(0,0,0),(0,.18,0),[.020,.024,.023,.021,.023,.024,.020],'rubber',None)
    cylinder('Striker_neck',(0,.15,0),(0,.26,0),.017,'brass')
    cylinder('Striker_head',(-.055,.275,0),(.055,.275,0),.032,'steel',vertices=24)
    cylinder('Replaceable_strike_face',(-.062,.275,0),(-.052,.275,0),.034,'dark',vertices=24)
    cylinder('Head_lock',(.055,.275,0),(.060,.275,0),.024,'brass',vertices=24)
    for y in (.02,.05,.08,.11,.14):
        ring('Grip_band',(0,y,0),.025,.003,'XZ','rubber')
    anchor('Grip',(0,.08,0)); anchor('StrikeTip',(0,.31,0))
    return export('striker', collider=None)


def timer():
    clear()
    cylinder('Timer_case',(0,.035,0),(0,.20,0),.11,'paint',vertices=24)
    cylinder('Dial_rim',(0,.20,0),(0,.22,0),.10,'brass',vertices=24)
    cylinder('Dial_face',(0,.221,0),(0,.224,0),.087,'ivory',vertices=24)
    for i in range(12):
        a=math.tau*i/12
        p=(math.sin(a)*.07,.229,math.cos(a)*.07)
        box('Dial_tick',p,(.006,.004,.015),'dark',0,yaw=a)
    box('Clock_hand',(0,.233,-.028),(.009,.006,.065),'dark',.001)
    cylinder('Arm_switch',(.105,.12,0),(.145,.12,0),.02,'amber')
    tube('Timer_hook',[(-.07,.10,.075),(-.085,.27,.075),(.085,.27,.075),(.07,.10,.075)],.01,'steel')
    anchor('Floor',(0,0,0)); anchor('SoundSource',(0,.13,0))
    return export('timer', collider={'type':'sphere','radius':.13,'center':[0,.13,0]})


def beacon():
    clear()
    box('Beacon_case',(0,.04,0),(.24,.08,.17),'ivory',.025)
    box('Beacon_band',(0,.082,0),(.07,.012,.15),'amber',.004)
    box('Medical_cross_vertical',(0,.09,0),(.027,.006,.095),'dark',.001)
    box('Medical_cross_horizontal',(0,.091,0),(.095,.006,.027),'dark',.001)
    cylinder('Beacon_mast',(.09,.05,.055),(.09,.29,.055),.006,'steel')
    ellipsoid('Beacon_lamp',(.09,.30,.055),(.025,.025,.025),material='warm')
    anchor('RescuePoint',(0,.1,0))
    return export('beacon', collider=None)


def cabinet():
    clear()
    box('Cabinet',(0,.65,0),(.78,1.3,.37),'paint',.025)
    box('Inset',(0,.75,-.19),(.63,.89,.012),'dark',.01)
    for y in (.38,.72,1.05):
        box('Shelf',(0,y,-.04),(.65,.027,.27),'steel',.006)
    for x in (-.20,.20):
        box('Timer_cradle',(x,.765,-.14),(.16,.07,.10),'brass',.008)
    box('Instruction_plate',(0,1.18,-.193),(.42,.11,.01),'ivory',.002)
    cylinder('Status_lamp',(-.3,1.18,-.20),(-.3,1.18,-.22),.022,material='warm')
    anchor('Timer_1',(-.20,.77,-.08)); anchor('Timer_2',(.20,.77,-.08))
    return export('cabinet', collider={'type':'box','size':[.78,1.3,.37],'center':[0,.65,0]})


def lift():
    clear()
    # Safe lift is a 10m room in all routes; side pathways remain completely clear.
    box('Lift_base',(0,-.085,0),(9.92,.12,9.92),'dark',.018)
    for x in (-4.82,4.82):
        for z in (-4.82,4.82):
            box('Column',(x,1.65,z),(.26,3.3,.26),'paint',.025)
            for y in (.25,2.8):
                box('Column_band',(x,y,z),(.30,.11,.30),'steel',.006)
    for z in (-4.80,4.80):
        box('Overhead_crossbeam',(0,3.20,z),(9.8,.2,.26),'paint',.025)
    for x in (-4.80,4.80):
        box('Overhead_sidebeam',(x,3.20,0),(.26,.2,9.8),'paint',.025)
    box('Rear_panel',(0,1.30,4.93),(9.6,2.6,.11),'paint',.018)
    for x in range(-4,5):
        box('Rear_reinforcing_seam',(x,1.30,4.86),(.038,2.42,.025),'dark',.005)
    for x in (-3.6,3.6):
        tube('Safety_handrail',[(x-.7,.85,4.60),(x-.7,1.0,4.6),(x+.7,1.0,4.6),(x+.7,.85,4.6)],.028,'steel')
    box('Instrument_panel',(0,2.08,4.79),(2.15,.66,.16),'dark',.025)
    box('Objective_screen',(0,2.1,4.69),(1.40,.40,.016),'rubber',.01)
    for x in (-.90,.90):
        cylinder('Gauge_ring',(x,2.13,4.68),(x,2.13,4.65),.12,'brass',vertices=24)
        cylinder('Gauge_face',(x,2.13,4.645),(x,2.13,4.64),.10,'ivory',vertices=24)
        box('Gauge_needle',(x,2.15,4.63),(.009,.1,.006),'dark',0,yaw=.2)
    for x in (-3.0,3.0):
        box('Ceiling_lamp_frame',(x,3.03,1.0),(1.55,.16,.28),'dark',.025)
        box('Ceiling_lamp',(x,2.94,1.0),(1.36,.035,.19),material='warm',bevel=.009)
    for x in [-4,-3,-2,-1,0,1,2,3,4]:
        box('Floor_grid_long',(x,.006,0),(.018,.012,9.5),'steel',0)
    for z in [-4,-3,-2,-1,0,1,2,3,4]:
        box('Floor_grid_cross',(0,.006,z),(9.5,.012,.018),'steel',0)
    box('Safe_boundary',(0,.02,-4.65),(3,.016,.12),'amber',.002)
    for x in (-1.28,-.96,-.64,-.32,0,.32,.64,.96,1.28):
        box('Boundary_hash',(x,.03,-4.65),(.10,.008,.13),'dark',0,yaw=.28)
    anchor('Socket_L',(-2.1,.05,3.3)); anchor('Socket_R',(2.1,.05,3.3))
    anchor('Cabinet',(-4.1,0,1.5)); anchor('Display',(0,2.1,4.62)); anchor('SafeThreshold',(0,0,-4.65))
    return export('lift', [10,3.3,10], None, notes='Detail shell only; no additional collision. Side access is open for the Pump route. Sockets/cabinet are separate models.')


def skeleton(name, bones):
    data = bpy.data.armatures.new(name + '_Rig')
    rig = bpy.data.objects.new(name + '_Rig', data)
    bpy.context.collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for key, (head, tail, parent) in bones.items():
        bone = data.edit_bones.new(key)
        bone.head = V(head)
        bone.tail = V(tail)
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.show_in_front = True
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return rig


def aim_bone(rig, name, target):
    """Aim an existing pose bone in armature space without changing its length."""
    pb = rig.pose.bones[name]
    head = pb.head.copy()
    current = pb.tail - head
    wanted = Vector(target) - head
    rotation = current.rotation_difference(wanted) @ pb.matrix.to_quaternion()
    pb.matrix = Matrix.LocRotScale(head, rotation, Vector((1, 1, 1)))
    bpy.context.view_layer.update()


def solve_limb(rig, upper, lower, target, pole, terminal=None):
    """Bake two rigid bone lengths to a metric target; no runtime IK dependency."""
    bpy.context.view_layer.update()
    first, second = rig.pose.bones[upper], rig.pose.bones[lower]
    start = first.head.copy()
    finish = V(target)
    length1, length2 = first.bone.length, second.bone.length
    direction = finish - start
    distance = direction.length
    if distance >= length1 + length2 - .00001:
        raise ValueError(f'Unreachable baked target {upper}: {distance:.6f} > {length1+length2:.6f}, start={tup(start)}, target={target}')
    direction.normalize()
    toward_pole = V(pole) - start
    bend = toward_pole - direction * toward_pole.dot(direction)
    bend.normalize()
    along = (length1 * length1 - length2 * length2 + distance * distance) / (2 * distance)
    height = math.sqrt(max(0, length1 * length1 - along * along))
    elbow = start + direction * along + bend * height
    aim_bone(rig, upper, elbow)
    aim_bone(rig, lower, finish)
    if terminal:
        pb = rig.pose.bones[terminal]
        pb.matrix = Matrix.LocRotScale(pb.head.copy(), pb.bone.matrix_local.to_quaternion(), Vector((1, 1, 1)))
        bpy.context.view_layer.update()
    if (rig.pose.bones[lower].tail - finish).length > .00002:
        raise AssertionError(f'Baked limb missed target: {upper}')


def animate(rig, name, seconds, poses, loop=True, post_pose=None):
    """poses(normalized_time) -> bone: {'rotation':[x,y,z], 'location':[x,y,z]}.

    Rotation is authored in each bone's local frame, in degrees. Export real NLA
    tracks named for the gameplay state, using a 30fps sample time base.
    """
    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    end = round(seconds * 30) + 1
    for u in [0, .125, .25, .375, .5, .625, .75, .875, 1]:
        frame = round(1 + (end - 1) * u)
        pose = poses(u)
        for key, pb in rig.pose.bones.items():
            values = pose.get(key, {})
            rotation = values.get('rotation', (0, 0, 0))
            # Local X bends limbs, local Y twists, local Z swings sideways.
            qx = Quaternion((1,0,0), math.radians(rotation[0]))
            qy = Quaternion((0,1,0), math.radians(rotation[1]))
            qz = Quaternion((0,0,1), math.radians(rotation[2]))
            pb.rotation_quaternion = qx @ qy @ qz
            pb.location = values.get('location', (0,0,0))
        bpy.context.view_layer.update()
        if post_pose:
            post_pose(u)
        for key, pb in rig.pose.bones.items():
            pb.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=key)
            pb.keyframe_insert(data_path='location', frame=frame, group=key)
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = 'BEZIER'
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.name = name
    strip.extrapolation = 'NOTHING'
    strip.blend_type = 'REPLACE'
    track.mute = True
    action['loop'] = loop
    rig['animation_' + name + '_loop'] = loop


def tailored_segment(name, a, b, radii, tile, bone, flatten=1):
    """Continuous tapered cloth/leather surface with modeled compression folds."""
    a,b=V(a),V(b); axis=(b-a).normalized()
    tangent=axis.cross(Vector((0,0,1)))
    if tangent.length<.01: tangent=axis.cross(Vector((1,0,0)))
    tangent.normalize(); other=axis.cross(tangent).normalized()
    verts=[]; faces=[]; sides=20
    for j,r in enumerate(radii):
        center=a.lerp(b,j/(len(radii)-1))
        for k in range(sides):
            theta=math.tau*k/sides
            verts.append(center+tangent*(math.cos(theta)*r)+other*(math.sin(theta)*r*flatten))
    for j in range(len(radii)-1):
        for k in range(sides):
            q=j*sides+k;n=j*sides+(k+1)%sides
            faces.append((q,n,n+sides,q+sides))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple((len(radii)-1)*sides+k for k in range(sides)))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    return finish(obj,tile,bone,0,True)


def hand_geometry(wrist, side, prefix, bones, first_person=False, tile='leather'):
    """Two phalanges per finger, padded knuckles and separate cuff geometry."""
    x,y,z = wrist
    palm = (x,y-.045,z) if not first_person else (x,y,z-.045)
    dims = (.105,.115,.052) if not first_person else (.105,.052,.115)
    ellipsoid(prefix+'_palm',palm,dims,tile,prefix+'_hand',seg=16,rings=8)
    ellipsoid(prefix+'_palm_patch', (x,y-.035,z-.026) if not first_person else (x,y+.026,z-.035),
              (.082,.075,.013) if not first_person else (.082,.013,.075), 'rubber', prefix+'_hand',seg=12,rings=6)
    names=['index','middle','ring','pinky']
    for i,offset in enumerate([-.039,-.013,.013,.038]):
        # Relative x keeps real left/right hand identity for the thumb.
        px = x + offset
        length = [.077,.088,.081,.066][i]
        if first_person:
            a=(px,y,z-.084); b=(px,y-.008,z-.084-length*.56); c=(px,y-.015,z-.084-length)
        else:
            a=(px,y-.084,z); b=(px,y-.084-length*.56,z-.008); c=(px,y-.084-length,z-.015)
        first=prefix+'_'+names[i]; second=first+'_tip'
        bones[first]=(a,b,prefix+'_hand'); bones[second]=(b,c,first)
        cylinder(first+'_glove',a,b,.015,tile,first,vertices=10,r2=.014)
        cylinder(second+'_glove',b,c,.014,tile,second,vertices=10,r2=.011)
        ellipsoid(first+'_knuckle',a,(.032,.033,.032),'rubber',first,seg=10,rings=6)
        ellipsoid(second+'_tip',c,(.023,.025,.023),tile,second,seg=10,rings=6)
    if first_person:
        a=(x-side*.047,y-.006,z-.018); b=(x-side*.070,y-.013,z-.058); c=(x-side*.075,y-.026,z-.084)
    else:
        a=(x-side*.047,y-.018,z-.006); b=(x-side*.070,y-.058,z-.013); c=(x-side*.075,y-.084,z-.026)
    bones[prefix+'_thumb']=(a,b,prefix+'_hand'); bones[prefix+'_thumb_tip']=(b,c,prefix+'_thumb')
    cylinder(prefix+'_thumb_glove',a,b,.019,tile,prefix+'_thumb',vertices=12,r2=.016)
    cylinder(prefix+'_thumb_end',b,c,.016,tile,prefix+'_thumb_tip',vertices=12,r2=.013)
    ellipsoid(prefix+'_thumb_tip_mesh',c,(.028,.029,.028),tile,prefix+'_thumb_tip',seg=10,rings=6)


def operative():
    clear()
    bones = {
        'root':((0,0,0),(0,.15,0),None),
        'pelvis':((0,.85,0),(0,1.00,0),'root'),
        'spine':((0,1.00,0),(0,1.25,0),'pelvis'),
        'chest':((0,1.25,0),(0,1.43,0),'spine'),
        'neck':((0,1.43,0),(0,1.53,0),'chest'),
        'head':((0,1.53,0),(0,1.69,0),'neck'),
    }
    loft('Oilskin_jacket',[(0,.88,0,.18,.125),(0,.99,0,.195,.13),(0,1.23,0,.225,.13),(0,1.38,0,.225,.12),(0,1.45,0,.14,.10)],'oilskin','chest',sides=20)
    loft('Jacket_lower',[(0,.76,0,.21,.145),(0,.89,0,.19,.135),(0,1.01,0,.195,.13)],'oilskin','pelvis',sides=20)
    cylinder('Collar',(0,1.42,0),(0,1.49,0),.116,'rubber','neck',vertices=20)
    ellipsoid('Hood',(0,1.568,.01),(.28,.29,.25),'oilskin','head',seg=20,rings=12)
    ellipsoid('Face_mask',(0,1.562,-.107),(.218,.205,.065),'rubber','head',seg=20,rings=10)
    box('Visor',(0,1.60,-.143),(.186,.060,.028),'dark',.018,'head')
    box('Goggle_metal_bridge',(0,1.60,-.16),(.015,.045,.006),'steel',.002,'head')
    for x in (-.047,.047):
        box('Visor_glass',(x,1.60,-.161),(.070,.036,.004),'blue',.009,'head')
    cylinder('Mask_filter',(0,1.525,-.138),(0,1.525,-.178),.04,'steel','head',vertices=16)
    for i in range(-2,3):
        box('Respirator_louvres',(i*.011,1.525,-.183),(.004,.042,.005),'dark',.001,'head')
    box('Head_lamp_mount',(0,1.684,-.056),(.082,.041,.07),'dark',.008,'head')
    box('Head_lamp',(0,1.684,-.094),(.052,.024,.007),bone='head',material='milk',bevel=.006)
    # Panel seams, functional harness, nameplate and service pouch.
    box('Jacket_zip',(0,1.17,-.135),(.018,.41,.014),'dark',.004,'chest')
    for x in (-.12,.12):
        box('Harness',(x,1.23,-.139),(.037,.37,.017),'leather',.004,'chest')
        box('Harness_buckle',(x,1.20,-.154),(.047,.045,.011),'brass',.003,'chest')
    box('Crew_color_patch',(-.135,1.36,-.145),(.085,.055,.015),'cyan',.006,'chest')
    box('Service_number',(.124,1.36,-.146),(.087,.048,.013),'ivory',.004,'chest')
    box('Belt',(0,.94,0),(.41,.063,.30),'leather',.01,'pelvis')
    box('Belt_buckle',(0,.94,-.16),(.075,.055,.016),'brass',.005,'pelvis')
    box('Medical_pouch',(.23,.88,.015),(.115,.17,.14),'ivory',.018,'pelvis')
    box('Pack',(0,1.20,.15),(.31,.34,.16),'blue',.04,'chest')
    for side, prefix in [(-1,'left'),(1,'right')]:
        shoulder=(side*.22,1.38,0)
        elbow=(side*.30,1.075,-.015)
        wrist=(side*.285,.79,-.053)
        bones[prefix+'_upper_arm']=(shoulder,elbow,'chest')
        bones[prefix+'_forearm']=(elbow,wrist,prefix+'_upper_arm')
        bones[prefix+'_hand']=(wrist,(side*.285,.665,-.06),prefix+'_forearm')
        cylinder(prefix+'_sleeve_upper',shoulder,elbow,.092,'oilskin',prefix+'_upper_arm',vertices=16,r2=.075)
        ellipsoid(prefix+'_shoulder',shoulder,(.192,.20,.18),'oilskin',prefix+'_upper_arm')
        cylinder(prefix+'_sleeve_forearm',elbow,wrist,.075,'oilskin',prefix+'_forearm',vertices=16,r2=.059)
        ellipsoid(prefix+'_elbow_patch',elbow,(.15,.14,.13),'leather',prefix+'_forearm')
        cylinder(prefix+'_cuff',(side*.285,.814,-.048),wrist,.066,'rubber',prefix+'_forearm',vertices=16)
        hand_geometry(wrist,side,prefix,bones)
        hip=(side*.12,.86,0); knee=(side*.12,.49,-.015); ankle=(side*.12,.105,.008)
        bones[prefix+'_thigh']=(hip,knee,'pelvis'); bones[prefix+'_shin']=(knee,ankle,prefix+'_thigh')
        bones[prefix+'_foot']=(ankle,(side*.12,.075,-.17),prefix+'_shin')
        cylinder(prefix+'_trouser_thigh',hip,knee,.105,'blue',prefix+'_thigh',vertices=16,r2=.087)
        cylinder(prefix+'_trouser_shin',knee,ankle,.087,'blue',prefix+'_shin',vertices=16,r2=.065)
        box(prefix+'_kneepad',(side*.12,.49,-.088),(.14,.16,.045),'rubber',.022,prefix+'_shin')
        ellipsoid(prefix+'_boot',(side*.12,.075,-.052),(.175,.15,.31),'rubber',prefix+'_foot',seg=16,rings=8)
        box(prefix+'_boot_sole',(side*.12,.025,-.057),(.178,.042,.31),'dark',.018,prefix+'_foot')
    rig = skeleton('Operative',bones)
    anchor('Hand_L',bones['left_hand'][0],'left_hand',rig); anchor('Hand_R',bones['right_hand'][0],'right_hand',rig)
    anchor('HeadLamp',(0,1.684,-.10),'head',rig)
    def pose(u, mode='idle'):
        s=math.sin(u*math.tau); c=math.cos(u*math.tau)
        p={'spine':{'rotation':[1.5*s,0,0]},'head':{'rotation':[.6*s,0,0]}}
        if mode in ('walk','run','crouch'):
            amp={'walk':21,'run':36,'crouch':12}[mode]
            for side,prefix in [(-1,'left'),(1,'right')]:
                stride=s*side
                p[prefix+'_thigh']={'rotation':[amp*stride,0,0]}
                p[prefix+'_shin']={'rotation':[-max(0,-stride)*amp*1.2,0,0]}
                p[prefix+'_upper_arm']={'rotation':[-amp*stride*.7,0,side*2]}
                p[prefix+'_forearm']={'rotation':[12 if mode=='run' else 5,0,0]}
            p['root']={'location':[0,.018*abs(c),0]}
            if mode=='crouch':
                p['pelvis']={'location':[0,-.25,0]}
                p['spine']={'rotation':[-10,0,0]}
        if mode=='carry':
            p.update({'pelvis':{'location':[0,-.25,0]},'spine':{'rotation':[-7+s*.5,0,0]}})
            for pre in ('left','right'):
                for finger in ('index','middle','ring','pinky','thumb'):
                    p[pre+'_'+finger]={'rotation':[38,0,0]};p[pre+'_'+finger+'_tip']={'rotation':[43,0,0]}
        if mode=='revive':
            p.update({'pelvis':{'location':[0,-.40,0]},'spine':{'rotation':[-15,0,0]},'head':{'rotation':[-20,0,0]}})
        if mode=='down':
            p.update({'root':{'rotation':[-88,0,0],'location':[0,.22,0]},'spine':{'rotation':[4+s*.5,0,0]},
                      'head':{'rotation':[12,0,0]}})
        if mode=='support':
            p.update({'spine':{'rotation':[-9,0,0]},'left_upper_arm':{'rotation':[70,0,-10]},'left_forearm':{'rotation':[20,0,0]},'right_upper_arm':{'rotation':[30,0,10]}})
        return p
    def constrain(u, mode):
        if mode in ('carry','revive','crouch'):
            for side, pre in [(-1,'left'),(1,'right')]:
                solve_limb(rig,pre+'_thigh',pre+'_shin',(side*.12,.105,.008),
                           (side*.13,.45,-.6),pre+'_foot')
                if mode=='carry':
                    solve_limb(rig,pre+'_upper_arm',pre+'_forearm',(side*.11,.65,-.31),
                               (side*.48,.90,-.02),pre+'_hand')
                if mode=='revive':
                    solve_limb(rig,pre+'_upper_arm',pre+'_forearm',(side*.16,.51+.02*math.sin(u*math.tau),-.42),
                               (side*.48,.70,-.08),pre+'_hand')
        if mode=='down':
            for side, pre in [(-1,'left'),(1,'right')]:
                solve_limb(rig,pre+'_upper_arm',pre+'_forearm',(side*.31,.10,-1.25),
                           (side*.58,.24,-.92),pre+'_hand')
                hand=rig.pose.bones[pre+'_hand']
                aim_bone(rig,pre+'_hand',hand.head+V((0,0,-.125)))
    for name,seconds in [('idle',2.4),('walk',1.05),('run',.7),('crouch',1.5),('carry',1.4),('revive',2.0),('down',2.1),('support',1.3)]:
        animate(rig,name,seconds,lambda u,n=name:pose(u,n),True,lambda u,n=name:constrain(u,n))
    rig['carryWristTargetsXYZ']=[-.11,.65,-.31,.11,.65,-.31]
    return export('operative',[.56,1.72,.42],{'type':'capsule','radius':.28,'height':1.72},rig,
                  notes='Oilskin archive crew with glove fingers, goggles, lamp, harness, knee pads and medical pouch. Color patch uses atlas cyan.')


def arms():
    clear()
    bones={'root':((0,-.50,.10),(0,-.30,.10),None)}
    for side,prefix in [(-1,'left'),(1,'right')]:
        shoulder=(side*.34,-.38,.14); elbow=(side*.38,-.43,-.14); wrist=(side*.24,-.30,-.48)
        bones[prefix+'_upper_arm']=(shoulder,elbow,'root')
        bones[prefix+'_forearm']=(elbow,wrist,prefix+'_upper_arm')
        bones[prefix+'_hand']=(wrist,(side*.24,-.30,-.63),prefix+'_forearm')
        tailored_segment(prefix+'_upper_sleeve',shoulder,elbow,[.065,.068,.063,.065,.059,.061,.055],'blue',prefix+'_upper_arm',.94)
        tailored_segment(prefix+'_forearm_sleeve',elbow,wrist,[.055,.060,.051,.055,.049,.051,.043,.040],'blue',prefix+'_forearm',.94)
        ellipsoid(prefix+'_elbow_seam',elbow,(.115,.10,.105),'blue',prefix+'_forearm')
        cylinder(prefix+'_glove_cuff',(side*.255,-.312,-.443),wrist,.043,'rubber',prefix+'_forearm',vertices=16)
        make_glove(sys.modules[__name__],wrist,side,prefix,bones)
        box(prefix+'_wrist_band',(side*.263,-.273,-.432),(.061,.008,.040),'dark',.006,prefix+'_forearm')
        if side < 0:
            box('Analog_wrist_meter',(side*.263,-.264,-.432),(.044,.010,.029),'ivory',.005,prefix+'_forearm')
            box('Meter_needle',(side*.263,-.257,-.432),(.004,.003,.023),'dark',0,prefix+'_forearm')
    rig=skeleton('FirstPerson',bones)
    anchor('Hand_L',bones['left_hand'][0],'left_hand',rig);anchor('Hand_R',bones['right_hand'][0],'right_hand',rig)
    anchor('ToolGrip_R',(.24,-.335,-.555),'right_hand',rig)
    anchor('PalmGrip_L',(-.24,-.335,-.555),'left_hand',rig)
    anchor('PalmGrip_R',(.24,-.335,-.555),'right_hand',rig)
    def pose(u,mode):
        wave=math.sin(math.tau*u);pulse=math.sin(math.pi*u)**2
        p={'left_upper_arm':{'rotation':[1,0,4]},'left_forearm':{'rotation':[5,0,0]},'left_hand':{'rotation':[0,-18,0]},
           'right_upper_arm':{'rotation':[4,0,-3]},'right_forearm':{'rotation':[12,0,0]},'right_hand':{'rotation':[25,80,0]}}
        for finger in ('index','middle','ring','pinky'):
            for suffix,angle in [('',-60),('_tip',-65),('_distal',-40)]:p['right_'+finger+suffix]={'rotation':[angle,0,0]}
            for suffix,angle in [('',-12),('_tip',-16),('_distal',-8)]:p['left_'+finger+suffix]={'rotation':[angle,0,0]}
        for prefix in ('left','right'):
            p[prefix+'_thumb']={'rotation':[-12,-28 if prefix=='right' else 8,-32 if prefix=='right' else 0]}
            p[prefix+'_thumb_tip']={'rotation':[-20,0,0]};p[prefix+'_thumb_distal']={'rotation':[-20,0,0]}
        if mode=='idle':
            p['right_upper_arm']['rotation'][0]+=.5*wave;p['left_upper_arm']['rotation'][0]-=.4*wave
        if mode in ('walk','run','crouch'):
            amp={'walk':1.0,'run':1.65,'crouch':.35}[mode]
            # Counter-rotation at elbow and delayed wrist response describe a
            # restrained weighted tool, rather than lifting both arms as a slab.
            p['left_upper_arm']['rotation']=[1+1.8*amp*wave,.7*amp*math.cos(math.tau*u),4+.9*amp*wave]
            p['left_forearm']['rotation'][0]+=-1.2*amp*wave+.5*amp*math.sin(math.tau*u-.45)
            p['left_hand']['rotation'][2]+=.7*amp*math.sin(math.tau*u-.6)
            p['right_upper_arm']['rotation'][0]-=.8*amp*wave
            p['right_upper_arm']['rotation'][1]+=.4*amp*math.cos(math.tau*u)
            p['right_forearm']['rotation'][0]+=.6*amp*wave
            p['right_hand']['rotation'][0]+=.45*amp*math.sin(math.tau*u-.6)
            p['right_hand']['rotation'][2]+=.4*amp*math.cos(math.tau*u-.6)
        if mode=='knock':
            # Starts and ends in the equipped idle pose. The old clip reset the
            # wrist twist and opened the grip at time zero, producing a snap.
            windup=math.sin(math.pi*min(u/.42,1)) if u<.42 else 0
            strike=math.sin(math.pi*min(max((u-.42)/.58,0),1))
            p['right_upper_arm']['rotation'][0]+=9*windup-7*strike
            p['right_forearm']['rotation'][0]+=-8*windup+15*strike
            p['right_hand']['rotation'][0]+=-5*strike
        if mode=='carry':
            for prefix in ('left','right'):
                p[prefix+'_hand']={'rotation':[0,0,0]}
                for finger in ('index','middle','ring','pinky'):
                    for suffix,angle in [('',-60),('_tip',-65),('_distal',-40)]:p[prefix+'_'+finger+suffix]={'rotation':[angle,0,0]}
                p[prefix+'_thumb']={'rotation':[-12,-28 if prefix=='right' else 28,-32 if prefix=='right' else 32]}
        if mode=='revive':
            p['left_upper_arm']={'rotation':[12+wave,0,-8]};p['right_upper_arm']={'rotation':[12-wave,0,8]}
            p['left_hand']={'rotation':[12,0,0]};p['right_hand']={'rotation':[12,0,0]}
        if mode=='down':
            p['left_upper_arm']={'rotation':[15,0,-14]};p['right_upper_arm']={'rotation':[15,0,14]}
        return p
    for name,seconds,loop in [('idle',2.4,True),('walk',1.05,True),('run',.7,True),('crouch',1.5,True),('carry',1.4,True),('knock',.5,False),('revive',2.0,True),('down',2.1,True)]:
        animate(rig,name,seconds,lambda u,n=name:pose(u,n),loop)
    return export('arms',collider=None,rig=rig,notes='Camera-local origin, forward -Z. Rig shoulder/elbow/wrist chains support per-frame IK to the server-defined handle anchor; use idle/carry animation for fingers and override arm chain only.')


def listener():
    clear()
    bones={
        'root':((0,0,0),(0,.20,0),None),
        'pelvis':((0,1.04,.08),(0,1.22,.06),'root'),
        'spine':((0,1.22,.06),(-.04,1.62,-.03),'pelvis'),
        'chest':((-.04,1.62,-.03),(-.10,1.91,-.16),'spine'),
        'neck':((-.10,1.91,-.16),(-.17,2.09,-.25),'chest'),
        'head':((-.17,2.09,-.25),(-.20,2.31,-.29),'neck'),
    }
    # Torso is a wrapped, folded archive mantle, not a generic humanoid mask.
    loft('Wrapped_body',[(0,.94,.08,.17,.12),(0,1.18,.06,.19,.14),(-.04,1.58,-.02,.22,.16),(-.10,1.86,-.13,.27,.19),(-.11,1.97,-.16,.15,.12)],'insulation','spine',sides=20,pleats=.12)
    loft('Pleated_mantle',[(.015,.67,.08,.27,.19),(0,.98,.08,.24,.19),(-.03,1.25,.06,.22,.17),(-.09,1.75,-.10,.32,.23),(-.11,1.96,-.15,.20,.17)],'paper','chest',sides=24,pleats=.13)
    # Overlapping vertical sheets produce the asymmetrical paper-shell silhouette.
    for i in range(9):
        theta=math.tau*i/9
        x=-.08+math.cos(theta)*.25; z=-.02+math.sin(theta)*.18
        top=1.83+(i%3)*.055; bottom=.78+(i%4)*.065
        sheet=box('Folio_strip_%02d'%i,(x,(top+bottom)/2,z),(.065,top-bottom,.022),'paper',.004,'chest',yaw=-theta+.4)
        sheet.rotation_euler.y = math.radians((i%3-1)*6)
    for y in (1.12,1.56,1.85):
        ring('Binding_cord',(-.06,y,-.035),.23,.014,'XZ','leather','chest')
    for y in (1.18,1.59):
        box('Archive_clasp',(-.14,y,-.245),(.13,.07,.036),'brass',.008,'chest')
    # Featureless hood split by an offset auditory bell. No luminous eyes.
    loft('Folded_cowl',[(-.15,1.99,-.23,.13,.105),(-.19,2.19,-.28,.18,.14),(-.20,2.34,-.29,.12,.10),(-.19,2.38,-.26,.025,.028)],'paper','head',sides=18,pleats=.13)
    ellipsoid('Black_face_recess',(-.18,2.18,-.407),(.235,.25,.037),'dark','head',seg=18,rings=10)
    for i in range(6):
        x=-.29+i*.043
        box('Face_lamella',(x,2.18,-.432),(.012,.18+(i%2)*.035,.028),'rust',.005,'head')
    # Left-side trumpet-like listening cavity is the creature's defining contour.
    cylinder('Ear_bell_neck',(-.31,2.19,-.28),(-.44,2.23,-.28),.075,'dark','head',vertices=16,r2=.12)
    cylinder('Ear_bell_shell',(-.44,2.23,-.28),(-.53,2.27,-.28),.12,'paper','head',vertices=18,r2=.19)
    cylinder('Ear_bell_cavity',(-.534,2.272,-.28),(-.542,2.275,-.28),.155,'dark','head',vertices=18)
    ring('Ear_bell_rim',(-.546,2.277,-.28),.177,.015,'YZ','brass','head')
    for side,prefix in [(-1,'left'),(1,'right')]:
        # Long hanging left arm; higher tense right arm.
        shoulder=(side*.27-.09,1.90+(side<0)*.09,-.10)
        elbow=(side*.40-.09,1.39+(side>0)*.08,-.11)
        wrist=(side*.43-.09,.83+(side>0)*.18,-.17)
        bones[prefix+'_upper_arm']=(shoulder,elbow,'chest');bones[prefix+'_forearm']=(elbow,wrist,prefix+'_upper_arm')
        bones[prefix+'_hand']=(wrist,(wrist[0],wrist[1]-.17,wrist[2]-.03),prefix+'_forearm')
        cylinder(prefix+'_bound_upper',shoulder,elbow,.079,'insulation',prefix+'_upper_arm',vertices=14,r2=.051)
        cylinder(prefix+'_long_forearm',elbow,wrist,.056,'paper',prefix+'_forearm',vertices=14,r2=.034)
        ellipsoid(prefix+'_elbow_joint',elbow,(.13,.14,.13),'dark',prefix+'_forearm')
        for t in (.2,.45,.72):
            p=tuple(elbow[j]+(wrist[j]-elbow[j])*t for j in range(3))
            # Small brass cuffs are actual geometry, not an exposed skeleton.
            ellipsoid(prefix+'_binding',p,(.114,.035,.10),'leather',prefix+'_forearm')
        ellipsoid(prefix+'_hand_shell',(wrist[0],wrist[1]-.055,wrist[2]),(.10,.16,.064),'rust',prefix+'_hand')
        for i in range(4):
            px=wrist[0]+(i-1.5)*.025
            a=(px,wrist[1]-.11,wrist[2]);b=(px,wrist[1]-.21,wrist[2]-.018);c=(px,wrist[1]-.27,wrist[2]-.057)
            finger=prefix+'_finger_'+str(i)
            bones[finger]=(a,c,prefix+'_hand')
            tube(finger+'_wrap',[a,b,c],.012,'paper',finger)
        hip=(side*.12,1.06,.08);knee=(side*.15,.59,.11);ankle=(side*.17,.10,-.015)
        bones[prefix+'_thigh']=(hip,knee,'pelvis');bones[prefix+'_shin']=(knee,ankle,prefix+'_thigh');bones[prefix+'_foot']=(ankle,(side*.17,.07,-.22),prefix+'_shin')
        cylinder(prefix+'_leg_upper',hip,knee,.084,'insulation',prefix+'_thigh',vertices=14,r2=.062)
        cylinder(prefix+'_leg_lower',knee,ankle,.065,'paper',prefix+'_shin',vertices=14,r2=.039)
        box(prefix+'_shin_brace',(side*.17,.34,.005),(.085,.37,.055),'rust',.012,prefix+'_shin')
        ellipsoid(prefix+'_bound_foot',(side*.17,.075,-.09),(.175,.15,.37),'leather',prefix+'_foot',seg=16,rings=8)
    rig=skeleton('Listener',bones)
    anchor('HearingOrigin',(-.54,2.27,-.28),'head',rig);anchor('ContactOrigin',(-.06,1.23,-.16),'spine',rig)
    def pose(u,mode):
        s=math.sin(math.tau*u);c=math.cos(math.tau*u);pulse=math.sin(math.pi*u)**2
        p={'spine':{'rotation':[-3+s*1.2,0,-2]},'neck':{'rotation':[0,s*1.5,-4]},'head':{'rotation':[s,0,5]}}
        if mode in ('walk','run'):
            amp=18 if mode=='walk' else 34
            for side,prefix in [(-1,'left'),(1,'right')]:
                st=s*side
                p[prefix+'_thigh']={'rotation':[amp*st,0,side*3]}
                p[prefix+'_shin']={'rotation':[-max(0,-st)*amp*1.15,0,0]}
                p[prefix+'_upper_arm']={'rotation':[-amp*st*.5,0,side*3]}
                p[prefix+'_forearm']={'rotation':[4+3*c,0,0]}
            p['root']={'location':[0,.018*abs(c),0]}
            if mode=='run':p['spine']={'rotation':[-12+s*2,0,-2]}
        if mode=='listen':
            p['head']={'rotation':[5,18*pulse,-22*pulse]};p['chest']={'rotation':[0,-12*pulse,-3]}
            p['right_upper_arm']={'rotation':[-11*pulse,0,5]}
        if mode=='turn':
            p['chest']={'rotation':[0,25*math.sin(math.pi*u),0]};p['head']={'rotation':[0,22*math.sin(math.pi*u),-6]}
        if mode=='lunge':
            # 0-.4 sec telegraph in the1s authored clip, then forward reach.
            charge=math.sin(math.pi*min(u/.4,1))*.45 if u<.4 else 0
            strike=math.sin(math.pi*min(max((u-.4)/.6,0),1))
            p['spine']={'rotation':[8*charge-24*strike,0,0]}
            p['left_upper_arm']={'rotation':[80*strike-15*charge,0,-10*strike]}
            p['right_upper_arm']={'rotation':[72*strike-12*charge,0,12*strike]}
            p['left_forearm']={'rotation':[25*strike,0,0]};p['right_forearm']={'rotation':[20*strike,0,0]}
            p['head']={'rotation':[-10*strike,0,-10]}
        if mode=='push':
            p['spine']={'rotation':[-15*pulse,0,0]};p['left_upper_arm']={'rotation':[78*pulse,0,-6]};p['right_upper_arm']={'rotation':[65*pulse,0,9]}
        return p
    for name,secs,loop in [('idle',3.0,True),('walk',1.5,True),('run',.83,True),('listen',1.5,False),('turn',1.0,False),('lunge',1.0,False),('push',.8,False)]:
        animate(rig,name,secs,lambda u,n=name:pose(u,n),loop)
    return export('listener',[1.12,2.40,.68],{'type':'capsule','radius':.35,'height':2.38},rig,
                  notes='Original asymmetric folio mantle, offset hearing bell, barred face cavity, long bound arms. No third-party mesh, animation or character reference is included.')


def shelf():
    clear()
    for x in (-.96,.96):
        for z in (-.28,.28):
            box('Shelf_post',(x,1.175,z),(.055,2.35,.055),'paint',.008)
    for y in (.08,.60,1.12,1.64,2.18):
        box('Archive_shelf',(0,y,0),(2,.045,.65),'paint',.009)
        box('Shelf_label_strip',(0,y+.007,-.328),(1.93,.055,.012),'ivory',.002)
    # Box dimensions alternate without filler geometry in the clear central aisle.
    for row,y in enumerate((.28,.80,1.32,1.84)):
        for col,x in enumerate((-.72,-.24,.25,.72)):
            height=.31+(col%2)*.05
            box('Folio_box',(x,y,0),(.42,height,.47),'paper',.013)
            box('Box_lid',(x,y+height/2-.018,0),(.435,.035,.485),'oilskin',.006)
            box('Box_label',(x,y-.005,-.242),(.20,.09,.007),'ivory',.002)
            box('Box_label_line',(x,y-.006,-.247),(.14,.013,.003),'dark',0)
            box('Finger_slot',(x,y-.065,-.243),(.085,.016,.008),'dark',.005)
    cylinder('Diagonal_brace',(-.95,.15,.294),(.95,2.15,.294),.013,'dark')
    return export('shelf',[2,2.35,.65],{'type':'box','size':[2,2.35,.65],'center':[0,1.175,0]})


def pump():
    clear()
    box('Pump_plinth',(0,.10,0),(1.85,.20,.62),'dark',.025)
    for x in (-.6,.6):
        box('Pump_mount',(x,.25,0),(.25,.3,.48),'paint',.025)
    cylinder('Motor',(-.75,.73,0),(.0,.73,0),.27,'paint',vertices=20)
    for x in (-.69,-.56,-.43,-.30,-.17):
        cylinder('Cooling_fin',(x-.015,.73,0),(x+.015,.73,0),.295,'dark',vertices=20)
    cylinder('Motor_cap',(-.79,.73,0),(-.74,.73,0),.28,'steel',vertices=20)
    ellipsoid('Pump_housing',(.37,.69,0),(.67,.71,.56),'rust',seg=20,rings=12)
    cylinder('Pressure_riser',(.39,.86,0),(.39,1.40,0),.105,'paint',vertices=16)
    tube('Pressure_outlet',[(.39,1.36,0),(.39,1.53,0),(.62,1.62,0),(.89,1.62,0)],.105,'paint')
    cylinder('Outlet_flange',(.82,1.62,0),(.90,1.62,0),.15,'steel',vertices=16)
    cylinder('Gauge_mount',(.08,1.08,-.04),(.08,1.20,-.12),.025,'brass')
    cylinder('Gauge_ring',(.08,1.25,-.12),(.08,1.25,-.17),.10,'brass',vertices=20)
    cylinder('Gauge_face',(.08,1.25,-.175),(.08,1.25,-.18),.085,'ivory',vertices=20)
    box('Gauge_needle',(.06,1.27,-.185),(.008,.09,.004),'dark',0)
    ring('Pump_valve',(.59,1.13,-.20),.105,.015,'XY','amber')
    cylinder('Valve_bar',(.485,1.13,-.20),(.695,1.13,-.20),.01,'steel')
    box('Motor_plate',(-.38,.76,-.28),(.25,.12,.011),'ivory',.003)
    return export('pump',[1.85,1.78,.62],{'type':'box','size':[1.85,1.78,.62],'center':[0,.89,0]})


def pipe():
    clear()
    cylinder('Pipe_main',(0,0,0),(0,2.8,0),.09,'rust',vertices=16)
    for y in (.3,1.4,2.5):
        cylinder('Pipe_flange',(0,y-.025,0),(0,y+.025,0),.14,'paint',vertices=16)
        box('Pipe_clamp',(0,y,.14),(.30,.075,.30),'dark',.007)
    tube('Auxiliary_pipe',[(.27,0,0),(.27,1.10,0),(.38,1.24,0),(.38,2.8,0)],.035,'steel')
    return export('pipe',collider=None)


def valve():
    clear()
    cylinder('Valve_body',(-.3,.40,0),(.3,.40,0),.09,'rust',vertices=16)
    for x in (-.28,.28):
        cylinder('Valve_flange',(x-.02,.40,0),(x+.02,.40,0),.13,'paint',vertices=16)
    cylinder('Valve_stem',(0,.40,0),(0,.68,0),.035,'brass')
    ring('Valve_wheel',(0,.70,0),.19,.022,'XZ','amber')
    for a in range(4):
        angle=math.tau*a/4
        cylinder('Valve_spoke',(0,.70,0),(math.cos(angle)*.18,.70,math.sin(angle)*.18),.013,'steel')
    return export('valve',collider=None)


def pallet():
    clear()
    for x in (-.55,0,.55):
        box('Pallet_block',(x,.075,0),(.17,.15,.82),'oilskin',.012)
    for z in (-.32,-.16,0,.16,.32):
        box('Top_plank',(0,.175,z),(1.38,.055,.14),'leather',.006)
    for z in (-.32,.32):
        box('Bottom_plank',(0,.025,z),(1.38,.05,.14),'leather',.006)
    return export('pallet',collider={'type':'box','size':[1.38,.202,.82],'center':[0,.101,0]})


def vent():
    clear()
    box('Vent_frame',(0,.6,0),(1.15,1.2,.15),'paint',.018)
    box('Black_airway',(0,.6,-.08),(.99,1.03,.015),'dark',.003)
    for y in [.16,.29,.42,.55,.68,.81,.94,1.07]:
        b=box('Vent_louvre',(0,y,-.10),(.97,.085,.055),'steel',.006)
        b.rotation_euler.x=math.radians(-18)
    for x in (-.51,.51):
        for y in (.08,1.12):bolt((x,y,-.09),'Z',.015)
    return export('vent',collider=None)


def cable():
    clear()
    for n in range(3):
        pts=[]
        for i in range(13):
            x=-1.3+i*2.6/12
            pts.append((x,.35-.20*math.sin(math.pi*i/12)+n*.035,.04*n))
        tube('Cable_%d'%n,pts,.014,'rubber')
    for x in (-1.29,1.29):
        box('Cable_bracket',(x,.34,.04),(.07,.15,.17),'steel',.006)
    return export('cable',collider=None)


def lamp():
    clear()
    box('Lamp_backplate',(0,.25,0),(.20,.5,.10),'paint',.018)
    cylinder('Lamp_stem',(0,.40,-.03),(0,.40,-.19),.028,'brass')
    ellipsoid('Lamp_lens',(0,.25,-.20),(.16,.24,.16),material='warm',seg=16,rings=10)
    for x in (-.09,.09):
        tube('Lamp_guard',[(x,.38,-.13),(x,.35,-.30),(x,.14,-.30),(x,.12,-.13)],.009,'dark')
    for y in (.16,.25,.34):
        ring('Lamp_guard_ring',(0,y,-.20),.10,.008,'XZ','dark')
    anchor('LightOrigin',(0,.25,-.22))
    return export('lamp',collider=None)


def archive_box():
    clear()
    box('Archive_box',(0,.22,0),(.65,.44,.48),'paper',.015)
    box('Box_lid',(0,.435,0),(.67,.055,.5),'oilskin',.009)
    box('Enamel_label',(0,.24,-.246),(.30,.13,.01),'ivory',.003)
    for x in [-.10,-.05,0,.04,.08]:
        box('Label_index',(x,.25,-.254),(.014,.06,.003),'dark',0)
    box('Box_handle',(0,.12,-.247),(.14,.028,.012),'dark',.008)
    return export('archive-box',collider={'type':'box','size':[.67,.463,.5],'center':[0,.2315,0]})


def fan():
    clear()
    box('Fan_case',(0,.70,0),(1.25,1.4,.40),'paint',.022)
    cylinder('Fan_recess',(0,.74,-.21),(0,.74,-.22),.51,'dark',vertices=32)
    cylinder('Fan_hub',(0,.74,-.22),(0,.74,-.30),.13,'brass',vertices=16)
    for i in range(5):
        angle=math.tau*i/5
        x=math.sin(angle)*.27;y=.74+math.cos(angle)*.27
        b=box('Fan_blade',(x,y,-.25),(.19,.40,.03),'steel',.02)
        b.rotation_euler.y=-angle
    for r in (.25,.39,.53):ring('Fan_grille',(0,.74,-.33),r,.008,'XY','dark')
    for a in range(8):
        angle=math.tau*a/8
        cylinder('Grille_spoke',(0,.74,-.33),(math.sin(angle)*.53,.74+math.cos(angle)*.53,-.33),.006,'dark')
    return export('fan',collider=None)


def ladder():
    clear()
    for x in (-.32,.32):
        cylinder('Ladder_rail',(x,0,0),(x,2.8,0),.035,'rust')
    for i in range(9):
        cylinder('Ladder_rung',(-.32,.17+i*.30,0),(.32,.17+i*.30,0),.025,'steel')
    for x in (-.32,.32):
        for y in (.30,2.5):cylinder('Wall_anchor',(x,y,0),(x,y,.20),.02,'dark')
    return export('ladder',collider=None,notes='Non-traversable set dressing; gameplay height changes use the permitted ramps.')


def sign():
    clear()
    box('Enamel_sign',(0,.16,0),(.78,.32,.035),'ivory',.017)
    box('Sign_border_top',(0,.301,-.022),(.73,.015,.008),'dark',.002)
    box('Sign_border_bottom',(0,.02,-.022),(.73,.015,.008),'dark',.002)
    for x in (-.35,.35):bolt((x,.16,-.026),'Z',.014)
    anchor('LocalizedLabel',(0,.16,-.027))
    return export('sign',collider=None,notes='Blank sign panel. Runtime labels are RU/EN canvas textures, never baked untranslated text.')


def control_panel():
    clear()
    box('Panel_case',(0,.60,0),(.85,1.2,.24),'paint',.023)
    box('Panel_face',(0,.62,-.13),(.76,1.04,.025),'dark',.011)
    for x in (-.21,.21):
        cylinder('Dial_ring',(x,.88,-.15),(x,.88,-.17),.12,'brass',vertices=20)
        cylinder('Dial_face',(x,.88,-.174),(x,.88,-.18),.10,'ivory',vertices=20)
        box('Dial_pointer',(x,.90,-.185),(.008,.085,.004),'dark',0)
    for y in (.34,.49):
        for x in (-.25,0,.25):
            cylinder('Switch_base',(x,y,-.16),(x,y,-.18),.036,'steel')
            cylinder('Switch_lever',(x,y,-.18),(x,y+.035,-.22),.012,'rubber')
    return export('control-panel',collider=None)


def extinguisher():
    clear()
    cylinder('Service_canister',(0,.08,0),(0,.63,0),.12,'rust',vertices=20)
    ellipsoid('Canister_dome',(0,.64,0),(.24,.17,.24),'rust')
    cylinder('Valve_neck',(0,.67,0),(0,.76,0),.034,'brass')
    box('Squeeze_handle',(0,.78,0),(.16,.035,.05),'dark',.006)
    tube('Hose',[(.05,.73,0),(.18,.70,0),(.19,.40,-.05),(.16,.24,-.08)],.017,'rubber')
    box('Canister_label',(0,.39,-.121),(.15,.21,.012),'ivory',.005)
    return export('extinguisher',collider=None)


def doorway():
    clear()
    # Standard active opening is 3m; author has a 1.9m minimum in the brief.
    for x in (-1.62,1.62):
        box('Door_jamb',(x,1.65,0),(.24,3.3,.35),'paint',.015)
        box('Door_jamb_strip',(x,1.55,-.19),(.045,2.7,.025),'amber',.004)
    box('Door_lintel',(0,3.15,0),(3.48,.30,.35),'paint',.018)
    box('Door_threshold',(0,.04,0),(3,.08,.4),'steel',.012)
    anchor('Opening',(0,0,0));anchor('DoorHinge',(-1.50,0,0))
    return export('door-frame',[3.48,3.3,.4],None)


def door():
    clear()
    box('Steel_door',(0,1.45,0),(3,2.9,.10),'paint',.025)
    for x in (-1.36,0,1.36):
        box('Reinforcement',(x,1.45,-.075),(.08,2.74,.05),'dark',.007)
    for y in (.16,1.45,2.74):
        box('Reinforcement',(0,y,-.073),(2.78,.065,.045),'dark',.006)
    box('Inspection_grille',(0,2.05,-.064),(.62,.43,.03),'dark',.005)
    for x in [-.24,-.12,0,.12,.24]:
        cylinder('Grille_bar',(x,1.86,-.09),(x,2.24,-.09),.014,'steel')
    tube('Door_handle',[(1.17,1.10,-.05),(1.17,1.10,-.15),(1.17,1.40,-.15),(1.17,1.40,-.05)],.021,'brass')
    anchor('Handle',(1.17,1.25,-.15))
    return export('door',[3,2.9,.1],{'type':'box','size':[3,2.9,.1],'center':[0,1.45,0]})


def wall_family(name,tile):
    clear()
    box('Wall',(0,1.65,0),(3,3.3,.22),tile,.008)
    box('Lower_plinth',(0,.12,-.13),(3,.24,.065),'dark',.007)
    box('Crown',(0,3.12,-.13),(3,.15,.055),'dark',.005)
    if name=='wall-archive':
        for x in (-1.40,0,1.40):box('Panel_seam',(x,1.63,-.118),(.027,2.82,.018),'oilskin',.003)
        box('Record_rail',(0,1.30,-.13),(2.8,.08,.035),'brass',.005)
    elif name=='wall-pump':
        for y in (.55,1.65,2.75):
            box('Expansion_joint',(0,y,-.115),(3,.021,.012),'dark',.002)
        for x in (-1.12,1.12):
            for y in (.45,2.8):bolt((x,y,-.13),'Z',.02)
    else:
        for x in [-1.3,-.65,0,.65,1.3]:box('Relay_fin',(x,1.6,-.16),(.055,2.70,.075),'steel',.008)
    return export(name,[3,3.3,.22],{'type':'box','size':[3,3.3,.22],'center':[0,1.65,0]})


def floor():
    clear()
    box('Concrete_slab',(0,-.06,0),(3,.12,3),'concrete',.005)
    for x in (-1.45,1.45):box('Drain_border',(x,.005,0),(.07,.012,2.9),'dark',0)
    for z in [-1.3+i*.2 for i in range(14)]:
        for x in (-1.45,1.45):box('Drain_slit',(x,.014,z),(.045,.007,.05),'rubber',0)
    return export('floor',[3,.12,3],{'type':'box','size':[3,.12,3],'center':[0,-.06,0]})


def ceiling():
    clear()
    box('Ceiling_slab',(0,0,0),(3,.12,3),'concrete',.005)
    for x in (-1.45,0,1.45):box('Beam',(x,-.13,0),(.10,.15,3),'dark',.008)
    return export('ceiling',[3,.28,3],None)


def corner():
    clear()
    box('Corner_pier',(0,1.65,0),(.45,3.3,.45),'concrete',.025)
    box('Corner_armor',(0,.56,-.24),(.50,1.12,.05),'paint',.011)
    box('Corner_cap',(0,3.22,0),(.52,.16,.52),'dark',.018)
    return export('corner',[.52,3.3,.52],None)


def ramp():
    clear()
    length,height,width=8.5,2.6,3
    verts=[V((x,y,z)) for x,y,z in [(-width/2,0,0),(width/2,0,0),(-width/2,height,-length),(width/2,height,-length),
                                  (-width/2,-.12,0),(width/2,-.12,0),(-width/2,height-.12,-length),(width/2,height-.12,-length)]]
    faces=[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
    mesh=bpy.data.meshes.new('Ramp_slab');mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new('Ramp_slab',mesh);bpy.context.collection.objects.link(obj);finish(obj,'concrete')
    for i in range(18):
        z=-length*i/17;y=height*i/17
        box('Traction_rib',(0,y+.008,z),(2.72,.016,.045),'dark',.002)
    for side in (-1,1):
        for i in range(5):
            z=-length*i/4;y=height*i/4
            cylinder('Rail_post',(side*1.42,y,z),(side*1.42,y+1.0,z),.027,'paint')
        cylinder('Handrail',(side*1.42,1.0,0),(side*1.42,3.6,-length),.033,'steel')
        cylinder('Midrail',(side*1.42,.55,0),(side*1.42,3.15,-length),.02,'dark')
    anchor('Lower',(0,0,0));anchor('Upper',(0,height,-length))
    return export('ramp',[3,3.63,8.5],{'type':'ramp','length':8.5,'rise':2.6,'width':3},notes='17.0 degree slope, no step >0.24m; scalable only through authoritative ramp transforms.')


def railing():
    clear()
    for x in (-1.5,0,1.5):cylinder('Rail_post',(x,0,0),(x,1.0,0),.027,'paint')
    for y,r in [(1.0,.033),(.55,.023)]:cylinder('Rail',(-1.5,y,0),(1.5,y,0),r,'steel')
    return export('railing',[3.07,1.033,.066],None)


def imported(name,p=(0,0,0),yaw=0,scale=1):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(MODELS/(name+'.glb')))
    new=set(bpy.data.objects)-before
    parent=bpy.data.objects.new('Display_'+name,None)
    bpy.context.collection.objects.link(parent)
    for obj in new:
        if obj.parent not in new:
            obj.parent=parent
    parent.location=V(p)
    parent.rotation_euler.z=yaw
    parent.scale=(scale,scale,scale)
    return parent


def area_light(name,p,target,color,power,size):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=power;data.color=color;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    obj.location=V(p)
    obj.rotation_euler=(V(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj


def point_light(name,p,color,power,radius=.2):
    data=bpy.data.lights.new(name,'POINT');data.energy=power;data.color=color;data.shadow_soft_size=radius
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=V(p)
    return obj


def camera(p,target,focal=35):
    data=bpy.data.cameras.new('Camera');obj=bpy.data.objects.new('Camera',data);bpy.context.collection.objects.link(obj)
    obj.location=V(p);obj.rotation_euler=(V(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    data.lens=focal;data.clip_start=.05;data.clip_end=100
    bpy.context.scene.camera=obj
    return obj


def render_settings(width,height,path,samples=32):
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=samples
    # The headless build may not include OpenImageDenoise. Use native sampling.
    scene.cycles.use_denoising=False
    scene.cycles.max_bounces=6
    scene.cycles.diffuse_bounces=3
    scene.cycles.glossy_bounces=3
    scene.cycles.use_adaptive_sampling=True
    scene.cycles.adaptive_threshold=.06
    scene.cycles.adaptive_min_samples=12
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
    scene.render.filepath=str(path)
    scene.view_settings.view_transform='AgX'
    scene.world.use_nodes=True
    background=scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value=(.012,.018,.022,1)
    background.inputs['Strength'].default_value=.35
    scene.render.film_transparent=False


def render_review():
    clear()
    imported('listener',(-1.6,0,0),yaw=.25)
    imported('operative',(.1,0,.1),yaw=-.15)
    imported('battery',(1.55,.4,.25),yaw=-.35)
    imported('socket',(1.55,.25,.25),yaw=-.35)
    imported('resonator',(-3.1,0,.5),yaw=.35)
    imported('shelf',(2.85,0,1.5),yaw=-.5)
    imported('timer',(1.0,.72,-.55),scale=1.6)
    imported('beacon',(1.65,.72,-.60),scale=1.6)
    box('Display_plinth',(1.4,.34,-.55),(1.20,.68,.7),'dark',.025)
    box('Studio_floor',(0,-.08,0),(200,.1,200),'concrete',0)
    camera((-5.1,3.0,-7.7),(-.10,1.15,.1),44)
    area_light('Soft_key',(-3,5,-4),(0,1,0),(1,.80,.61),1300,5)
    area_light('Blue_edge',(4,4,2),(0,1,0),(.35,.70,1),1000,4)
    area_light('Front_fill',(2,2,-5),(0,1.2,0),(.68,.81,1),450,3)
    render_settings(1440,1000,QA/'model-review.png',64)
    bpy.ops.render.render(write_still=True)


def render_motion():
    clear()
    def posed(name,p,clip,yaw=0):
        parent=imported(name,p,yaw)
        for child in parent.children_recursive:
            if child.type=='ARMATURE' and child.animation_data:
                child.animation_data.action=None
                for track in child.animation_data.nla_tracks:
                    track.mute=track.name!=clip
        return parent
    posed('listener',(-1.8,0,0),'lunge',-.35)
    posed('operative',(0,0,0),'carry',-.20)
    posed('operative',(1.7,0,0),'revive',-.35)
    imported('battery',(math.sin(.20)*.93,.33,-math.cos(.20)*.93),yaw=math.pi/2-.20)
    posed('operative',(2.5,0,-1.15),'down',math.pi/2)
    bpy.context.scene.frame_set(17)
    box('Studio_floor',(0,-.09,0),(200,.1,200),'concrete',0)
    camera((-5.8,2.5,-7.5),(-.1,1.05,0),45)
    area_light('Key',(-3,5,-4),(0,1,0),(1,.80,.61),1200,5)
    area_light('Rim',(4,4,2),(0,1,0),(.35,.70,1),900,4)
    area_light('Fill',(2,2,-5),(0,1.2,0),(.68,.81,1),450,3)
    render_settings(1200,800,QA/'motion-review.png',24)
    bpy.ops.render.render(write_still=True)


def render_cover(preview=False):
    clear()
    # The cover is rendered from original game geometry, without embedded title.
    box('Floor',(0,-.08,-5),(6,.14,25),'concrete',.01)
    box('Ceiling',(0,3.32,-5),(6,.18,25),'concrete',.01)
    for x in (-2.5,2.5):
        for z in (2,-1,-4,-7,-10,-13):
            imported('wall-archive' if z>-6 else 'wall-pump',(x,0,z),yaw=math.pi/2 if x>0 else -math.pi/2)
    # Structural ribs create a physically receding corridor silhouette.
    for z in (1,-3,-7,-11):
        for x in (-2.35,2.35):box('Rib_column',(x,1.60,z),(.18,3.2,.22),'dark',.016)
        box('Rib_crossbeam',(0,3.12,z),(4.8,.18,.22),'dark',.016)
    imported('shelf',(-2.0,0,-3),yaw=math.pi/2)
    imported('shelf',(-2.0,0,-8),yaw=math.pi/2)
    imported('pump',(1.9,0,-8),yaw=-math.pi/2)
    imported('battery',(-.64,0,-9),yaw=-.16)
    imported('door-frame',(0,0,-13))
    imported('listener',(1.05,0,-12.3),yaw=math.pi-.3)
    box('Far_dark_wall',(0,1.65,-16),(6,3.3,.20),'dark',.01)
    for z in (2,-5,-12):
        imported('lamp',(-2.27,1.70,z),yaw=-math.pi/2)
        point_light('Wall_practical',(-2.03,2.04,z),(1,.52,.22),65 if z==2 else 23,.14)
    # Foreground resonator and the same oilskin/glove anatomy used in play.
    imported('resonator',(.85,0,1.75),yaw=-.12)
    cylinder('Foreground_sleeve',(1.95,.45,3.20),(1.05,1.18,2.08),.13,'oilskin',vertices=20,r2=.082)
    cylinder('Foreground_cuff',(1.08,1.14,2.13),(1.02,1.22,2.04),.086,'rubber',vertices=20)
    ellipsoid('Foreground_gloved_hand',(.98,1.31,1.99),(.18,.21,.13),'leather',seg=20,rings=12)
    for i in range(4):
        x=.92+(i-1.5)*.035
        ellipsoid('Foreground_knuckle',(x,1.39,1.936),(.043,.080,.054),'rubber',seg=12,rings=8)
        cylinder('Foreground_folded_finger',(x,1.38,1.94),(x,1.31,1.92),.020,'leather',vertices=12,r2=.018)
    ellipsoid('Foreground_thumb',(1.05,1.29,1.93),(.052,.105,.06),'leather',seg=12,rings=8)
    # Echo illustrates real door edges and floor planes, no fake dynamic entity.
    for z in (-3.2,-3.28):
        tube('Echo_door_outline',[(-2.21,.02,z),(-2.21,2.97,z),(2.21,2.97,z),(2.21,.02,z)],.009,material='cold')
    for x in (-2.20,2.20):cylinder('Echo_floor_edge',(x,.035,-3.2),(x,.035,-7.5),.008,material='cold')
    for z in (-3.4,-3.65,-3.95):
        tube('Echo_floor_front',[(-2.12,.025,z),(-1,.026,z-.08),(0,.026,z-.13),(1,.026,z-.08),(2.12,.025,z)],.008,material='cold')
    area_light('Echo_bounce',(0,2.55,-3.0),(0,1,-4),(.28,.66,.82),55,3.0)
    # Thin, dark wet sheen catches lamps. Normal texture is original and seamless.
    water=bpy.data.materials.new('Still_water');water.use_nodes=True
    bsdf=water.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.022,.043,.049,1)
    bsdf.inputs['Roughness'].default_value=.18;bsdf.inputs['Metallic'].default_value=.32
    tex=water.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(TEX/'water-normal.png'),check_existing=True);tex.image.colorspace_settings.name='Non-Color'
    nm=water.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.20
    water.node_tree.links.new(tex.outputs['Color'],nm.inputs['Color']);water.node_tree.links.new(nm.outputs['Normal'],bsdf.inputs['Normal'])
    bpy.ops.mesh.primitive_plane_add(size=1,location=V((0,.012,-7)))
    w=bpy.context.object;w.name='Wet_reflection';w.scale=(2.95,16,1);w.data.materials.append(water)
    camera((-.28,1.59,4.05),(-.19,1.48,-6.4),25)
    area_light('Hand_key',(.35,2.6,3.5),(.98,1.3,1.99),(1,.64,.34),90,1.0)
    area_light('Hand_fill',(0,1.8,3.8),(.98,1.3,1.99),(.25,.58,.72),32,1.3)
    render_settings(1600,900,QA/('cover-preview.png' if preview else 'cover-source.png'),16 if preview else 64)
    if preview:
        bpy.context.scene.render.resolution_percentage=50
    bpy.ops.render.render(write_still=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--only',default='')
    parser.add_argument('--cover',action='store_true')
    parser.add_argument('--render-review',action='store_true')
    parser.add_argument('--render-motion',action='store_true')
    parser.add_argument('--preview',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    materials()
    if args.cover:
        render_cover(args.preview);return
    if args.render_review:
        render_review();return
    if args.render_motion:
        render_motion();return
    functions={
        'battery':battery,'socket':socket,'resonator':resonator,'striker':striker,'timer':timer,'beacon':beacon,
        'cabinet':cabinet,'lift':lift,'operative':operative,'arms':arms,'listener':listener,
        'shelf':shelf,'pump':pump,'pipe':pipe,'valve':valve,'pallet':pallet,'vent':vent,'cable':cable,
        'lamp':lamp,'archive-box':archive_box,'fan':fan,'ladder':ladder,'sign':sign,'control-panel':control_panel,
        'extinguisher':extinguisher,'door-frame':doorway,'door':door,
        'wall-archive':lambda:wall_family('wall-archive','paint'),
        'wall-pump':lambda:wall_family('wall-pump','concrete'),
        'wall-relay':lambda:wall_family('wall-relay','blue'),
        'floor':floor,'ceiling':ceiling,'corner':corner,'ramp':ramp,'railing':railing,
    }
    wanted=args.only.split(',') if args.only else list(functions)
    for name in wanted:
        functions[name]()
    manifest_path=MODELS/'model-contract.json'
    previous=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    previous.update(RECORDS)
    manifest_path.write_text(json.dumps(previous,ensure_ascii=False,indent=2)+'\n')
    print('Finished',len(wanted),'models')


if __name__=='__main__':
    main()

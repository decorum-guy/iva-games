"""Glove derivative of MakeHuman hm08 CC0 anatomy, with retained skin weights.
Source pin and license are in vendor/makehuman. No MakeHuman application code.
"""
import json,math
from pathlib import Path
import bpy
from mathutils import Vector

def make_glove(api,wrist,side,prefix,bones):
    src=Path(__file__).parent/'vendor/makehuman'
    vertices=[];faces=[];groups={};group=''
    for line in (src/'base.obj').read_text().splitlines():
        fields=line.split()
        if not fields:continue
        if fields[0]=='v':vertices.append(Vector(tuple(map(float,fields[1:4]))))
        elif fields[0]=='g':group=fields[1];groups[group]=set()
        elif fields[0]=='f':
            ids=[int(v.split('/')[0])-1 for v in fields[1:]]
            groups[group].update(ids)
            if group=='body':faces.append(ids)
    def joint(name):
        ids=groups['joint-l-'+name]
        return sum((vertices[i] for i in ids),Vector())/len(ids)
    origin=joint('hand'); forward=(joint('finger-3-1')-origin).normalized()
    across=joint('finger-5-1')-joint('finger-2-1');across=(across-forward*across.dot(forward)).normalized()
    dorsal=forward.cross(across).normalized()
    scale=.115
    def target(p):
        q=(p-origin)*scale
        return Vector((wrist[0]+side*q.dot(across),wrist[1]+q.dot(dorsal),wrist[2]-q.dot(forward)))
    # The continuous wrist is cut inside the independently tailored cuff.
    selected=[f for f in faces if all(vertices[i].x>3 and (vertices[i]-origin).dot(forward)*scale>-.028 for i in f)]
    ids=sorted({i for f in selected for i in f});lookup={i:n for n,i in enumerate(ids)}
    positions=[api.V(target(vertices[i])) for i in ids]
    polys=[[lookup[i] for i in f] for f in selected]
    if side>0:polys=[list(reversed(f)) for f in polys]
    mesh=bpy.data.meshes.new(prefix+'_continuous_glove');mesh.from_pydata(positions,[],polys);mesh.update()
    obj=bpy.data.objects.new(prefix+'_continuous_glove',mesh);bpy.context.collection.objects.link(obj)
    # Original anatomical MCP/PIP/DIP topology and skin weights, remapped to
    # named game joints. Metacarpals remain with the palm; no disconnected beads.
    names={1:'thumb',2:'index',3:'middle',4:'ring',5:'pinky'}
    mapping={}
    for finger,name in names.items():
        parent=prefix+'_hand'
        for phalanx,suffix in [(1,''),(2,'_tip'),(3,'_distal')]:
            key=prefix+'_'+name+suffix
            a=target(joint(f'finger-{finger}-{phalanx}'));b=target(joint(f'finger-{finger}-{phalanx+1}'))
            bones[key]=(tuple(a),tuple(b),parent);parent=key
            mapping[f'finger{finger}-{phalanx}.L']=key
    weights=json.loads((src/'default_weights.mhw').read_text())['weights']
    collected={i:{} for i in ids}
    for name,entries in weights.items():
        if not name.endswith('.L'):continue
        target_name=mapping.get(name,prefix+'_hand')
        for index,weight in entries:
            if index in lookup:
                row=collected[index];row[target_name]=row.get(target_name,0)+weight
    for old,row in collected.items():
        depth=(vertices[old]-origin).dot(forward)*scale
        blend=max(0,min(1,(.018-depth)/.046))
        if blend>0:
            row={key:value*(1-blend) for key,value in row.items()}
            row[prefix+'_forearm']=blend
        total=sum(row.values())
        if not total:row={prefix+'_hand':1};total=1
        for name,weight in row.items():
            vg=obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
            vg.add([lookup[old]],weight/total,'REPLACE')
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    # Subdivision preserves the continuous anatomical webs and thumb mound.
    smooth=obj.modifiers.new('Glove_over_nail_detail','SMOOTH');smooth.factor=.35;smooth.iterations=3
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    sub=obj.modifiers.new('Tailored_glove_surface','SUBSURF');sub.levels=1
    bpy.ops.object.modifier_apply(modifier=sub.name)
    # The glove is a thin garment over anatomy, not uncovered skin or nail caps.
    normals=[v.normal.copy() for v in obj.data.vertices]
    for v,n in zip(obj.data.vertices,normals):v.co+=n*.0012
    # A hand spans the UV tile. The old world-unit atlas fallback mapped the
    # entire hand to only a few texels and made it look like brown plastic.
    uv=obj.data.uv_layers.new(name='UVMap')
    for poly in obj.data.polygons:
        for li in poly.loop_indices:
            co=obj.data.vertices[obj.data.loops[li].vertex_index].co
            gx,gy,gz=api.tup(co)
            uv.data[li].uv=((gx-wrist[0])/.16+.5,(gz-wrist[2])/.25+1)
    for kind in ('glove-leather','glove-fabric'):
        if kind not in api.MATS:
            mat=bpy.data.materials.new(kind);mat.use_nodes=True
            tree=mat.node_tree;bsdf=tree.nodes.get('Principled BSDF')
            bsdf.inputs['Roughness'].default_value=.8
            for suffix,input_name in [('color.jpg','Base Color'),('normal.png','Normal'),('orm.png','Roughness')]:
                node=tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(api.TEX/(kind+'-'+suffix)),check_existing=True)
                if suffix!='color.jpg':node.image.colorspace_settings.name='Non-Color'
                if suffix=='normal.png':
                    normal=tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.35;tree.links.new(node.outputs['Color'],normal.inputs['Color']);tree.links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])
                elif suffix=='orm.png':
                    sep=tree.nodes.new('ShaderNodeSeparateColor');tree.links.new(node.outputs['Color'],sep.inputs['Color']);tree.links.new(sep.outputs['Green'],bsdf.inputs['Roughness'])
                else:tree.links.new(node.outputs['Color'],bsdf.inputs[input_name])
            api.MATS[kind]=mat
    api.finish(obj,material='glove-leather',smooth=True)
    bpy.context.view_layer.update()
    def on_back(dx,dz,lift=.0012):
        origin=api.V((wrist[0]+side*dx,wrist[1]+.20,wrist[2]+dz))
        hit,point,normal,_=obj.ray_cast(origin,Vector((0,0,-1)))
        if not hit:return None
        point+=normal*lift
        return api.tup(point)
    # Sewn oval canvas panel: its actual surface conforms to the anatomy.
    center_z=-.046;radx=.030;radz=.035
    center=on_back(0,center_z,.0015)
    points=[api.V(center)];polygons=[];steps=48;rings=5
    for ring in range(1,rings+1):
        radius=ring/rings
        for k in range(steps):
            angle=math.tau*k/steps
            point=on_back(radx*radius*math.cos(angle),center_z+radz*radius*math.sin(angle),.0015)
            points.append(api.V(point or center))
    for k in range(steps):polygons.append((0,1+k,1+(k+1)%steps))
    for ring in range(1,rings):
        start=1+(ring-1)*steps
        for k in range(steps):polygons.append((start+k,start+(k+1)%steps,start+steps+(k+1)%steps,start+steps+k))
    if side>0:polygons=[tuple(reversed(f)) for f in polygons]
    data=bpy.data.meshes.new(prefix+'_sewn_canvas_panel');data.from_pydata(points,[],polygons);data.update()
    panel=bpy.data.objects.new(prefix+'_sewn_canvas_panel',data);bpy.context.collection.objects.link(panel)
    uv=data.uv_layers.new(name='UVMap')
    for poly in data.polygons:
        for li in poly.loop_indices:
            gx,gy,gz=api.tup(data.vertices[data.loops[li].vertex_index].co)
            uv.data[li].uv=((gx-wrist[0])/.08+.5,(gz-wrist[2])/.10+1)
    api.finish(panel,bone=prefix+'_hand',material='glove-fabric',smooth=True)
    edge=[]
    for k in range(65):
        angle=math.tau*k/64;p=on_back(radx*math.cos(angle),center_z+radz*math.sin(angle),.002)
        if p:edge.append(p)
    api.tube(prefix+'_panel_piping',edge,.0007,'leather',prefix+'_hand')
    for k in range(40):
        angle=math.tau*k/40
        aa=on_back((radx-.0015)*math.cos(angle),center_z+(radz-.0015)*math.sin(angle),.002)
        bb=on_back((radx-.0015)*math.cos(angle+.045),center_z+(radz-.0015)*math.sin(angle+.045),.002)
        if aa and bb:api.tube(prefix+'_saddle_stitch',[aa,bb],.00025,'paper',prefix+'_hand')
    return obj

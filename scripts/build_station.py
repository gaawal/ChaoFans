"""Reference-based layout prototype. Not a Hyper3D-generated asset.
Blender 3.4+: --background --python scripts/build_station.py
Optional: -- --hyper3d /absolute/path/model.glb imports a generated decorative asset.
"""
import bpy, math, random, os, sys, json
from mathutils import Vector
random.seed(42)
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

def mat(name, color, metallic=0, rough=.45, emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'); bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metallic; bs.inputs['Roughness'].default_value=rough
    if emission: bs.inputs['Emission'].default_value=(*color,1); bs.inputs['Emission Strength'].default_value=emission
    return m
steel=mat('Brushed stainless steel',(.39,.48,.53),.78,.28)
edge=mat('Polished rolled edges',(.68,.73,.72),.8,.2)
dark=mat('Cast iron',(.028,.032,.04),.55,.32)
blue=mat('Cobalt blue enamel',(.012,.11,.58),.52,.25)
red=mat('Vermilion signage',(.65,.055,.024),.2)
wood=mat('Warm wood handles',(.38,.16,.045))
cream=mat('Warm lamp',(.99,.72,.3),0,.4,2)
black=mat('Rubber',(.025,.032,.045))
white=mat('Rice',(.94,.86,.62))

def finish(o,name,ma):
    o.name=name; o.data.materials.append(ma)
    return o

def cube(name,loc,scale,ma,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Soft fabricated edges','BEVEL'); mod.width=bevel; mod.segments=2
        o.data.use_auto_smooth=True; o.modifiers.new('Weighted corners','WEIGHTED_NORMAL')
    return finish(o,name,ma)

def cyl(name,loc,r,depth,ma,rot=(0,0,0),verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=loc,rotation=rot)
    o=finish(bpy.context.object,name,ma)
    for f in o.data.polygons: f.use_smooth=True
    return o

def sphere(name,loc,scale,ma):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=1,location=loc);o=bpy.context.object;o.scale=scale
    return finish(o,name,ma)

def torus(name,loc,major,minor,ma,rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=8,location=loc,major_radius=major,minor_radius=minor,rotation=rot)
    return finish(bpy.context.object,name,ma)

def tray(name,x,y,w=.36,h=.32):
    z=1.025
    cube(name+' bottom',(x,y,z),(w,h,.055),steel)
    for dx in [-1,1]:cube(name+' side',(x+dx*w/2,y,z+.058),(.022,h,.14),edge,.007)
    for dy in [-1,1]:cube(name+' rim',(x,y+dy*h/2,z+.058),(w+.022,.022,.14),edge,.007)

# Coordinates use Blender Z up; glTF exporter converts to Y up.
cube('Worktop',(0,0,.97),(3.6,1.6,.095),edge)
cube('Cabinet',(0,.1,.49),(3.28,1.25,.86),steel)
for x in [-.82,.82]:
    cube('Sliding door',(x,-.536,.5),(1.61,.035,.75),steel)
    cube('Door handle',(x+.48,-.58,.52),(.034,.035,.19),black)
for x in [-1.48,1.48]:
    for y in [-.49,.62]:
        cyl('Caster',(x,y,.09),.085,.06,black,(math.pi/2,0,0))
        cube('Canopy post',(x,y,1.73),(.043,.043,1.48),edge)
cube('Canopy roof',(0,.06,2.5),(3.5,1.56,.065),steel)
cube('Red sign band',(0,.82,2.34),(3.45,.075,.3),red)
cube('Inner warm sign',(0,.772,2.34),(3.26,.025,.21),cream)
for x in [-1.3,1.3]:
    cube('Work light',(x,.45,2.2),(.28,.14,.055),cream)
cube('Splash guard',(0,.7,1.18),(3.4,.035,.38),steel)
cube('Condiment shelf',(-.4,.64,1.29),(1.8,.27,.035),edge)
# Center wok and fixed burner; interactive wok is separately named.
cyl('Stove',(0,-.18,1.055),.46,.09,dark)
torus('Burner ring',(0,-.18,1.13),.32,.025,dark)
for a in range(6):
    t=a*math.pi/3; o=cube('Stove support',(.34*math.cos(t),-.18+.34*math.sin(t),1.12),(.14,.06,.08),dark);o.rotation_euler.z=t
# Open bowl mesh, smooth continuous profile.
verts=[]; faces=[]; steps=40; rings=12
for j in range(rings):
    r=.025+.49*j/(rings-1);z=1.155+.235*(r/.515)**2
    for i in range(steps):
        a=i*2*math.pi/steps;verts.append((r*math.cos(a),-.18+r*math.sin(a),z))
for j in range(rings-1):
    for i in range(steps):
        a=j*steps+i;b=j*steps+(i+1)%steps;faces.append((a,b,b+steps,a+steps))
mesh=bpy.data.meshes.new('Wok bowl mesh');mesh.from_pydata(verts,[],faces);mesh.update()
wok=bpy.data.objects.new('Wok',mesh);bpy.context.collection.objects.link(wok);wok.data.materials.append(dark)
for p in mesh.polygons:p.use_smooth=True
mod=wok.modifiers.new('Forged thickness','SOLIDIFY');mod.thickness=.012
# Local pivot at center of pan.
bpy.context.scene.cursor.location=(0,-.18,1.16);bpy.context.view_layer.objects.active=wok;wok.select_set(True)
bpy.ops.object.origin_set(type='ORIGIN_CURSOR');wok.select_set(False)
handle=cyl('WokHandle',(-.40,-.70,1.34),.045,.63,wood,(math.pi/2,0,-.48))
# Rice storage left, preparation right: 3 x 3 trays.
tray('Rice bin',-1.09,-.32,.72,.74)
for i in range(90):sphere('Rice in bin',(-1.4+random.random()*.6,-.64+random.random()*.62,1.105+random.random()*.022),(.035,.021,.014),white)
colors=[(.55,.16,.065),(.82,.35,.23),(.71,.43,.30),(.27,.58,.10),(.92,.51,.055),(.52,.68,.22),(.07,.34,.075),(.8,.09,.025),(.87,.75,.35)]
for row in range(3):
    for col in range(3):
        x=.77+col*.37;y=-.5+row*.38;tray('Ingredient tray %s'% (row*3+col),x,y,.33,.32)
        ma=mat('Ingredient %s'%(row*3+col),colors[row*3+col])
        for i in range(18):cube('Food dice',(x+(random.random()-.5)*.27,y+(random.random()-.5)*.25,1.105+random.random()*.03),(.042,.025,.027),ma,.008)
for i,color in enumerate([(.93,.62,.065),(.17,.065,.015),(.68,.12,.022)]):
    ma=mat('Sauce %s'%i,color)
    cyl('Sauce bottle',(-1.06+i*.19,.60,1.48),.065,.34,ma)
    cyl('Bottle cap',(-1.06+i*.19,.60,1.67),.04,.065,white)
    cyl('Nozzle',(-1.06+i*.19,.60,1.73),.012,.085,white)
for x in [-.41,-.25]:cyl('Seasoning tin',(x,.60,1.43),.059,.23,steel)
for i in range(7):cyl('Paper bowl stack',(.24,.60,1.345+i*.022),.15,.035,white)
cube('Serving extension',(2.06,.08,.96),(.54,1.12,.055),edge)
cyl('Gas tank',(1.94,.54,.41),.20,.67,red)
torus('Tank guard',(1.94,.54,.81),.12,.018,red)
# Blue tricycle cabin on the left.
cube('Blue chassis',(-2.32,.0,.5),(1.0,1.35,.22),blue)
cube('Cabin nose',(-2.62,.5,1.0),(.55,.42,.96),blue)
cube('Blue cabin pillar',(-2.76,.52,1.75),(.055,.055,1.0),blue)
cube('Cabin roof',(-2.3,.0,2.21),(1.0,1.4,.09),blue)
cube('Driver seat',(-2.17,-.1,.86),(.55,.55,.12),black)
cube('Seat back',(-1.89,-.1,1.12),(.10,.55,.62),black)
for y in [-.45,.5]:
    cyl('Trike wheel',(-2.45,y,.27),.28,.16,black,(math.pi/2,0,0))
    cyl('Wheel hub',(-2.45,y-.09,.27),.135,.025,steel,(math.pi/2,0,0))
# Optional generated decorative model. Keep interactive objects independent.
source='blender-reference-prototype'
if '--hyper3d' in sys.argv:
    p=sys.argv[sys.argv.index('--hyper3d')+1]
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(p)); imported=list(bpy.context.selected_objects)
    root=bpy.data.objects.new('Hyper3D_generated_decoration',None);bpy.context.collection.objects.link(root)
    for o in imported:
        if o.parent is None:o.parent=root
    root.location=(0,3,0);source='blender-layout-with-hyper3d-decoration'
# Keep material bevels, export geometry, save editable native file.
bpy.context.scene.world.color=(.06,.06,.06)
os.makedirs(os.path.join(ROOT,'assets/source'),exist_ok=True)
os.makedirs(os.path.join(ROOT,'public/models'),exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets/source/street-station.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public/models/street-station.glb'),export_format='GLB',export_apply=True)
with open(os.path.join(ROOT,'public/models/manifest.json'),'w') as f:
    json.dump({'source':source,'layoutReference':['炒饭地摊三轮车.png','炒饭工作台.png'],'interactiveNodes':['Wok','WokHandle'],'hyper3dGenerated':source!='blender-reference-prototype'},f,ensure_ascii=False,indent=2)
print('STATION_EXPORT_OK')

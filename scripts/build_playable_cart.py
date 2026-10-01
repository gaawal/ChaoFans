"""Build the playable cart in Blender, retaining the actual Hyper3D vehicle.

Run with /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build_playable_cart.py
Authored dimensions are metres, and all public anchors use glTF / Three Y-up coordinates.
The imported worktop is surgically removed; its replacement is part of this same cart.
"""
import bpy, bmesh, math, os, json, random
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
random.seed(1027)

def V(p): return Vector((p[0], -p[2], p[1]))
def G(p): return [round(p.x, 5), round(p.z, 5), round(-p.y, 5)]

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, 'assets/source/hyper3d-cart-finished.blend'))
for obj in list(bpy.data.objects):
    if obj.type != 'MESH': bpy.data.objects.remove(obj, do_unlink=True)
shell = next(obj for obj in bpy.data.objects if obj.type == 'MESH')
shell.name = 'Hyper3D_vehicle_retained'
bm = bmesh.new(); bm.from_mesh(shell.data)
removed = [v for v in bm.verts if .947 < v.co.z < 1.938 and -.735 < v.co.y < 1.81]
bmesh.ops.delete(bm, geom=removed, context='VERTS')
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00006)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(shell.data); bm.free()
for vertex in shell.data.vertices:
    x,y,z = vertex.co
    vertex.co = (y-.50, -x+.30, z)
# The generated GLB has custom split normals. They must be rebuilt after the
# coordinate rotation, otherwise specular triangles point in the old direction.
bpy.ops.object.select_all(action='DESELECT');shell.select_set(True);bpy.context.view_layer.objects.active=shell
if shell.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
for polygon in shell.data.polygons:polygon.use_smooth=True
for edge in shell.data.edges:edge.use_edge_sharp=False
shell.data.use_auto_smooth=True;shell.data.auto_smooth_angle=math.radians(56)
normal=shell.modifiers.new('Area weighted vehicle surface normals','WEIGHTED_NORMAL');normal.keep_sharp=True;normal.weight=30
for material in shell.data.materials:
    if material and material.use_nodes:
        p = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if p:
            p.inputs['Roughness'].default_value = .51
            p.inputs['Metallic'].default_value = .28
            p.inputs['Specular'].default_value = .25

def parent(obj, root):
    # Newly assigned location / scale is not reflected in matrix_world until the
    # dependency graph has evaluated. Reading that stale matrix inflated the
    # UV spheres to metres and also moved parented parts to the wrong location.
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy(); obj.parent = root
    obj.matrix_parent_inverse = root.matrix_world.inverted()
    obj.matrix_world = world
    bpy.context.view_layer.update()
    return obj

def group(name, loc=(0,0,0), root=None):
    o = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(o); o.location = V(loc)
    bpy.context.view_layer.update()
    if root: parent(o, root)
    return o

cart = group('CartShell'); parent(shell, cart)

def material(name, color, metal=0, rough=.45, alpha=1, transmission=0):
    m = bpy.data.materials.new(name); m.diffuse_color=(*color,alpha); m.use_nodes=True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value=(*color,alpha)
    p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    p.inputs['Alpha'].default_value=alpha; p.inputs['Transmission'].default_value=transmission
    p.inputs['IOR'].default_value=1.46
    if alpha < 1: m.blend_method='BLEND'; m.use_screen_refraction=True; m.show_transparent_back=False
    return m

steel=material('Brushed 304 stainless / neutral',(.38,.43,.46),.88,.29)
polish=material('Rolled stainless edges',(.57,.62,.64),.93,.19)
darksteel=material('Burner iron',(.045,.052,.056),.72,.52)
wokmat=material('Seasoned forged carbon steel',(.028,.025,.022),.76,.34)
patina=material('Wok rim heat patina',(.068,.044,.025),.7,.32)
wood=material('Oiled walnut handle',(.20,.082,.026),.04,.37)
rubber=material('Black rubber grips',(.024,.023,.021),0,.65)
rice=material('Individual steamed rice / ivory',(.89,.864,.748),0,.36)
carrotmat=material('Fresh carrot julienne',(.94,.245,.029),0,.38)
onion=material('White translucent onion flesh',(.82,.855,.712),0,.3)
onionskin=material('Red onion fine purple edge',(.37,.06,.21),0,.43)
lean=material('Cured pork ruby lean',(.25,.038,.019),0,.36)
fat=material('Cured pork ivory fat',(.73,.57,.37),0,.33)
rind=material('Cured pork caramel rind',(.30,.091,.025),0,.31)
scallion=material('Scallion deep green',(.075,.27,.026),0,.39)
scallionlight=material('Scallion light green cut',(.41,.61,.14),0,.39)
eggmat=material('Beaten egg golden yolk',(.97,.53,.033),0,.23)
eggshell=material('Eggshell warm white',(.79,.67,.47),0,.65)
cornmat=material('Sweet corn kernel gold',(.95,.68,.055),0,.33)
peasmat=material('Green pea jade',(.145,.44,.075),0,.35)
hammat=material('Ham dice rosy cure',(.60,.145,.125),0,.37)
hamfat=material('Ham dice fat marbling',(.85,.60,.50),0,.34)
cream=material('Porcelain off white',(.84,.81,.72),0,.22)
oil=material('Golden oil inside transparent bottle',(.78,.40,.019),0,.18,1,0)
soy=material('Dark amber soy inside transparent bottle',(.044,.015,.004),0,.21,1,0)
plastic=material('Thin translucent squeeze bottle wall',(.84,.86,.80),0,.21,.20,.72)
cap=material('Natural plastic bottle nozzle',(.89,.83,.63),0,.31)
skin=material('Warm natural skin',(.53,.303,.191),0,.54)
next(n for n in skin.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Subsurface'].default_value=.085
next(n for n in skin.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Subsurface Color'].default_value=(.66,.27,.15,1)
nailmat=material('Natural fingernails',(.64,.43,.32),0,.35)
crease=material('Subtle knuckle crease',(.37,.195,.12),0,.58)

def micro_surface(mat, scale, strength, distance):
    n=mat.node_tree.nodes; links=mat.node_tree.links
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=scale;noise.inputs['Detail'].default_value=2.4
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=strength;bump.inputs['Distance'].default_value=distance
    links.new(noise.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],next(q for q in n if q.type == 'BSDF_PRINCIPLED').inputs['Normal'])
micro_surface(wokmat,145,.23,.0015);micro_surface(wood,52,.18,.0013);micro_surface(skin,260,.13,.00065)

# Exportable small PBR roughness texture: steel is brushed, never white plastic.
size=256; image=bpy.data.images.new('Steel fine brushed roughness',width=size,height=size)
pixels=[]
for y in range(size):
    band=random.uniform(-.045,.045)
    for x in range(size):
        v=.34+band+random.uniform(-.025,.025);pixels.extend((v,v,v,1))
image.pixels=pixels;image.pack()
tex=steel.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.image.colorspace_settings.name='Non-Color'
steel.node_tree.links.new(tex.outputs['Color'],next(n for n in steel.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Roughness'])

def finish(o,name,mat=None,root=cart):
    o.name=name
    if mat:o.data.materials.append(mat)
    if o.type=='MESH':
        for face in o.data.polygons:face.use_smooth=True
    if root:parent(o,root)
    return o

def cube(name,p,size,mat,bevel=.009,root=cart):
    bpy.ops.mesh.primitive_cube_add(size=1,location=V(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Machined soft edges','BEVEL');mod.width=bevel;mod.segments=3
        mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');mod.keep_sharp=True
        o.data.use_auto_smooth=True
    return finish(o,name,mat,root)

def cylinder(name,p,radius,depth,mat,root=cart,vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=V(p))
    o=bpy.context.object;mod=o.modifiers.new('Turned edge bevel','BEVEL');mod.width=min(.003,radius*.12);mod.segments=2
    o.data.use_auto_smooth=True;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return finish(o,name,mat,root)

def sphere(name,p,size,mat,root=cart,seg=24,rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,radius=1,location=V(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);return finish(o,name,mat,root)

def mesh(name,verts,faces,mat=None,root=cart):
    data=bpy.data.meshes.new(name+' geometry');data.from_pydata([V(v) for v in verts],[],faces);data.update()
    uv=data.uv_layers.new(name='Surface UV')
    for f in data.polygons:
        for li in f.loop_indices:
            q=data.vertices[data.loops[li].vertex_index].co;uv.data[li].uv=(q.x*.8,q.y*.8)
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);return finish(o,name,mat,root)

def tube(name,points,radius,mat,root=cart,resolution=4):
    curve=bpy.data.curves.new(name+' path','CURVE');curve.dimensions='3D';curve.resolution_u=8
    curve.bevel_depth=radius;curve.bevel_resolution=resolution
    curve.use_fill_caps=True
    sp=curve.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
    for bp,p in zip(sp.bezier_points,points):bp.co=V(p);bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
    obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj);finish(obj,name,mat,root)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.convert(target='MESH');obj.select_set(False)
    return obj

def torus(name,p,major,minor,mat,root=cart):
    bpy.ops.mesh.primitive_torus_add(major_segments=80,minor_segments=10,location=V(p),major_radius=major,minor_radius=minor)
    return finish(bpy.context.object,name,mat,root)

def join_objects(items,name,root=cart):
    bpy.ops.object.select_all(action='DESELECT')
    for o in items:o.select_set(True)
    bpy.context.view_layer.objects.active=items[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    if root:parent(o,root)
    o.select_set(False);return o

def rounded_rect(w,d,r,steps=8):
    out=[]
    for cx,cz,a in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for j in range(steps):
            t=math.radians(a+90*j/steps);out.append((cx+r*math.cos(t),cz+r*math.sin(t)))
    # The order above would trace crossing arcs: explicitly trace clockwise corners.
    out=[]
    for cx,cz,a in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for j in range(steps):
            t=math.radians(a+90*j/steps);out.append((cx+r*math.cos(t),cz+r*math.sin(t)))
    return out

# Connected worktop, welded folded edges, backsplash and canopy supports.
cube('Continuous stainless worktop',(0,.972,-.19),(2.39,.045,1.36),steel,.022)
cube('Front rolled counter lip',(0,.957,.485),(2.39,.058,.026),polish,.012)
cube('Low rear splashback',(0,1.10,-.855),(2.36,.22,.024),steel,.012)
cube('Condiment shelf',(-.14,1.13,-.687),(1.96,.029,.31),steel,.009)
for x in (-1.16,1.15):
    for z in (-.825,.405):
        cylinder('Canopy stainless upright',(x,1.48,z),.016,1.02,polish,vertices=24)
        cube('Bolted post flange',(x,.998,z),(.069,.011,.065),polish,.005)
        for dx in [-.024,.024]:cylinder('Flange screw',(x+dx,1.005,z),.006,.004,darksteel,vertices=8)
    tube('Rear upright brace',[(x,.976,-.825),(x,1.08,-.82),(x,1.29,-.59)],.008,polish)
# A continuous replacement splashguard masks the cut mesh behind the cooking line.
cube('Back panel',(0,1.02,-.91),(2.38,.15,.04),steel,.008)

# Folded thermal partition between the driver's cabin and the actual kitchen.
cube('Cabin-side stainless heat shield',(-1.205,1.267,-.19),(.021,.535,1.32),steel,.012)
tube('Heat shield rolled top',[(-1.205,1.536,.46),(-1.205,1.536,-.19),(-1.205,1.536,-.84)],.010,polish)

# Recessed stove ring, gas jets and cast iron prongs.
burner=group('Burner',(0,1.006,0),cart)
cylinder('Burner recessed bowl',(0,1.005,0),.294,.035,darksteel,burner)
torus('Outer gas ring',(0,1.041,0),.218,.019,darksteel,burner)
torus('Inner gas ring',(0,1.044,0),.153,.011,polish,burner)
for i in range(48):
    a=i*math.tau/48
    cylinder('Burner port',(math.cos(a)*.220,1.062,math.sin(a)*.220),.0045,.003,rubber,burner,vertices=8)
# The trivet top is derived from the wok bowl itself. A fixed-height prong pokes
# through the pan floor; hugging the real profile keeps the ring under the pan.
WOK_HOME_Y=1.1;WOK_RADIUS=.28;WOK_RISE=.122;WOK_WALL=.004;PRONG_RADIUS=.013;PRONG_GAP=.004
def wok_underside(r):return 1.103+WOK_RISE*(min(r,WOK_RADIUS)/WOK_RADIUS)**1.75-WOK_WALL
def prong_seat(r):
    # The prong has to clear the bowl at right angles to its own wall. Dropping
    # the path straight down leaves the tube poking through wherever the bowl
    # steepens, which is exactly where a measured triangle overlap showed up.
    s=WOK_RISE*1.75*(min(r,WOK_RADIUS)/WOK_RADIUS)**.75/WOK_RADIUS
    n=math.hypot(s,1.0);drop=PRONG_RADIUS+PRONG_GAP
    return (r+s/n*drop,wok_underside(r)-drop/n)
TRIVET_PROFILE=[(.297,1.037),(.291,1.140),(.288,1.194)]+[prong_seat(r) for r in (.278,.271,.262,.252,.240,.228,.214,.198)]+[(.190,1.107),(.116,1.037)]
for i in range(8):
    a=i*math.tau/8
    pts=[(r*math.cos(a),y,r*math.sin(a)) for r,y in TRIVET_PROFILE]
    tube('Cast iron pan support',pts,PRONG_RADIUS,darksteel,burner,2)
# Keep the valve on the visible worktop edge, clear of the wok handle and
# rice tray. Its broad indicator can be read from the cook's camera.
knobroot=group('GasKnob',(-.76,1.038,.43),cart)
cylinder('Gas knob base',(-.76,1.014,.43),.071,.020,darksteel,knobroot)
cylinder('Gas knob cap',(-.76,1.038,.43),.061,.030,rubber,knobroot)
cylinder('Gas knob hub',(-.76,1.057,.43),.012,.008,polish,knobroot)
cube('Gas knob indicator',(-.713,1.052,.43),(.055,.008,.013),polish,.002,knobroot)
for i in range(11):
    a=math.radians(-135+27*i)
    cylinder('Gas knob tick',(-.76+math.cos(a)*.081,1.016,.43+math.sin(a)*.081),.0032,.005,polish,knobroot,vertices=8)

wok=group('Wok',(0,1.1,0))
verts=[];faces=[];segments=112;rings=19
for j in range(rings):
    r=.006+.274*j/(rings-1);y=1.103+.122*(r/.28)**1.75
    for i in range(segments):
        a=i*math.tau/segments;verts.append((r*math.cos(a),y,r*math.sin(a)))
for j in range(rings-1):
    for i in range(segments):
        a=j*segments+i;b=j*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
faces.append(tuple(reversed(range(segments))))
pan=mesh('Wok / continuous concave carbon steel',verts,faces,wokmat,wok)
solid=pan.modifiers.new('Forged steel wall thickness','SOLIDIFY');solid.thickness=.004
torus('Wok rolled lip',(0,1.225,0),.280,.004,patina,wok)
# Side handle directed towards the left hand, rivets and a curved hanging ring.
tube('Wok steel handle shank',[(-.195,1.18,.196),(-.27,1.206,.277),(-.339,1.237,.344)],.017,polish,wok)
tube('Wok turned walnut grip',[(-.322,1.233,.328),(-.43,1.278,.439),(-.535,1.306,.55)],.031,wood,wok,6)
for dx in (-.016,.016):sphere('Handle rivet',(-.202+dx,1.189,.209-dx),(.006,.004,.006),polish,wok)
tube('Small helper handle',[(.20,1.19,-.20),(.269,1.25,-.286),(.33,1.25,-.25),(.263,1.19,-.174)],.010,darksteel,wok)

# Rounded, pressed stainless GN pans: their wall is a continuous folded mesh.
tray_roots={};food_roots={};anchors={}
def tray(kind,x,z,w,d,y=1.006):
    root=group('Tray_'+kind,(x,y,z),cart);tray_roots[kind]=root;anchors[kind]=[x,y+.07,z]
    verts=[];faces=[];n=48
    loops=[(w-.028,d-.028,.026,y-.012),(w-.008,d-.008,.035,y+.062),(w+.01,d+.01,.041,y+.065),(w+.012,d+.012,.042,y+.057),(w-.002,d-.002,.035,y+.049),(w-.036,d-.036,.023,y-.005)]
    for W,D,R,Y in loops:
        for cx,cz,a in [(W/2-R,D/2-R,0),(-W/2+R,D/2-R,90),(-W/2+R,-D/2+R,180),(W/2-R,-D/2+R,270)]:
            for j in range(12):
                t=math.radians(a+j*90/12);verts.append((x+cx+R*math.cos(t),Y,z+cz+R*math.sin(t)))
    for k in range(len(loops)-1):
        for i in range(n):faces.append((k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i))
    faces.append(tuple(range(n-1,-1,-1)));faces.append(tuple((len(loops)-1)*n+i for i in range(n)))
    mesh('Pressed pan '+kind,verts,faces,steel,root)
    food_roots[kind]=group('FoodPile_'+kind,(x,y+.028,z),root)
    return root

# Nine smaller pressed pans in a stepped 2x4 bank: more ingredients on the
# same counter, each tray shallow enough to see its contents over the one
# in front. Steps rise towards the back so nothing hides behind anything.
tray('rice',-.735,.07,.40,.48)
tray('carrot',.585,.315,.24,.205)
tray('onion',.925,.315,.24,.205)
tray('corn',.585,.06,.24,.205,1.030)
tray('peas',.925,.06,.24,.205,1.030)
tray('bacon',.585,-.19,.24,.205,1.054)
tray('ham',.925,-.19,.24,.205,1.054)
tray('egg',.585,-.44,.24,.205,1.078)
tray('scallion',.925,-.44,.24,.205,1.078)

# Food specimen meshes. The same prototypes are used for the tray pile and live particles.
proto_group=group('FoodPrototypes',(0,0,0));proto_group['prototypes']=True
protos={}
def prototype(kind,obj):
    obj.name='FoodPrototype_'+kind;parent(obj,proto_group)
    obj['foodPrototype']=kind;obj['hiddenPrototype']=True;protos[kind]=obj
    return obj

def strip(name,kind,length=.067,width=.003,thickness=.002,curve=.008):
    verts=[];faces=[];N=12
    for i in range(N):
        t=i/(N-1);x=(t-.5)*length;z=math.sin(t*math.pi)*curve
        for dy,dz in [(-thickness/2,-width/2),(thickness/2,-width/2),(thickness/2,width/2),(-thickness/2,width/2)]:
            verts.append((x,dy+.002*math.sin(t*math.tau),z+dz))
    for i in range(N-1):
        for k in range(4):faces.append((i*4+k,i*4+(k+1)%4,(i+1)*4+(k+1)%4,(i+1)*4+k))
    faces.extend([(3,2,1,0),tuple((N-1)*4+k for k in range(4))])
    return mesh(name,verts,faces,kind,None)

prototype('carrot',strip('carrot julienne',carrotmat,.075,.0031,.0023,.012))
# Onion is a thin C-shaped petal with white layers and a fine red outer skin.
verts=[];faces=[];N=20
for i in range(N):
    a=(-1.07+i/(N-1)*2.55)
    for r,y in [(.034,-.0012),(.034,.0012),(.029,.0012),(.029,-.0012)]:verts.append((math.cos(a)*r-.019,y,math.sin(a)*r))
for i in range(N-1):
    for k in range(4):faces.append((i*4+k,i*4+(k+1)%4,(i+1)*4+(k+1)%4,(i+1)*4+k))
faces.extend([(3,2,1,0),tuple((N-1)*4+k for k in range(4))])
o=mesh('Onion petal',verts,faces,onion,None);o.data.materials.append(onionskin)
for p in o.data.polygons:
    if p.index % 4 == 0:p.material_index=1
prototype('onion',o)
# Pork belly: one thin irregular slice, five contiguous bands of fat and ruby meat.
verts=[];faces=[];mids=[];bands=[(0,.009,lean),(.009,.013,fat),(.013,.022,lean),(.022,.025,fat),(.025,.027,rind)]
for bi,(za,zb,ma) in enumerate(bands):
    start=len(verts);xs=[-.023,-.011,.001,.012,.026]
    for y in [-.0022,.0022]:
        for z in [za-.0135,zb-.0135]:
            for x in xs:verts.append((x,y+.0006*math.sin(x*110),z+.0017*math.sin(x*91)))
    for row in range(4):
        for i in range(4):
            if row==0:f=(start+i,start+i+1,start+6+i,start+5+i)
            elif row==1:f=(start+10+i,start+15+i,start+16+i,start+11+i)
            elif row==2:f=(start+i,start+10+i,start+11+i,start+i+1)
            else:f=(start+5+i,start+6+i,start+16+i,start+15+i)
            faces.append(f);mids.append([lean,fat,rind].index(ma))
    faces.extend([(start,start+5,start+15,start+10),(start+4,start+14,start+19,start+9)]);mids.extend([[lean,fat,rind].index(ma)]*2)
o=mesh('Pork belly bands',verts,faces,None,None)
for ma in [lean,fat,rind]:o.data.materials.append(ma)
for p,i in zip(o.data.polygons,mids):p.material_index=i
prototype('bacon',o)
o=sphere('Long individual rice grain',(0,0,0),(.0065,.0021,.00245),rice,None,8,5)
bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.select_set(False);prototype('rice',o)
# Scallion slices are genuine hollow short tubes, with pale exposed cut faces.
verts=[];faces=[];N=10
for r,y in [(.0034,-.0026),(.0034,.0026),(.0024,.0026),(.0024,-.0026)]:
    for i in range(N):
        a=i*math.tau/N;verts.append((math.cos(a)*r,y,math.sin(a)*r))
for row in range(4):
    for i in range(N):faces.append((row*N+i,row*N+(i+1)%N,((row+1)%4)*N+(i+1)%N,((row+1)%4)*N+i))
o=mesh('Scallion hollow cut',verts,faces,scallion,None);o.data.materials.append(scallionlight)
for p in o.data.polygons:
    if N<=p.index<2*N or p.index>=3*N:p.material_index=1
prototype('scallion',o)
o=sphere('Egg curd',(0,0,0),(.013,.006,.009),eggmat,None,12,8)
for v in o.data.vertices:v.co*=random.uniform(.79,1.16)
bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.select_set(False);prototype('egg',o)
# Sweet corn: a plump rounded kernel, slightly squared, glossy gold.
corn_kernel=sphere('Corn kernel',(0,0,0),(.0048,.0032,.0058),cornmat,None,12,8)
bpy.context.view_layer.objects.active=corn_kernel;corn_kernel.select_set(True)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);corn_kernel.select_set(False)
prototype('corn',corn_kernel)
# Green peas: near-perfect small spheres with a faint dent.
pea=sphere('Green pea',(0,0,0),(.0041,.0041,.0041),peasmat,None,12,8)
bpy.context.view_layer.objects.active=pea;pea.select_set(True)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);pea.select_set(False)
prototype('peas',pea)
# Ham dice: a small beveled cube, rosy cure with one pale fat face.
hamdice=cube('Ham dice',(0,0,0),(.017,.015,.017),hammat,.004,None)
hamdice.data.materials.append(hamfat)
for p in hamdice.data.polygons:
    if p.index % 6 == 4:p.material_index=1
prototype('ham',hamdice)

def pile(kind,count,w,d,depth=.023):
    center=food_roots[kind].matrix_world.translation;proto=protos[kind];verts=[];faces=[];ids=[]
    source=proto.data
    for i in range(count):
        x=random.uniform(-w*.43,w*.43);z=random.uniform(-d*.41,d*.41)
        mound=(1-(x/(w*.6))**2)*(1-(z/(d*.6))**2)
        y=.014+depth*mound+random.uniform(-depth*.45,depth*.45)
        loc=center+V((x,y,z))
        angle=random.uniform(0,math.tau)
        rot=Matrix.Rotation(angle,4,'Z') @ Matrix.Rotation(random.uniform(-.22,.22),4,'X') @ Matrix.Rotation(random.uniform(-.22,.22),4,'Y')
        scale=random.uniform(.78,1.19);offset=len(verts)
        for v in source.vertices:
            p=loc+(rot @ v.co)*scale;verts.append(G(p))
        for f in source.polygons:faces.append(tuple(offset+k for k in f.vertices));ids.append(f.material_index)
    result=mesh('Food '+kind+' / distinguishable pieces',verts,faces,None,food_roots[kind])
    for ma in source.materials:result.data.materials.append(ma)
    for f,mi in zip(result.data.polygons,ids):f.material_index=mi
    return result

# A continuous bed of cooked rice supports the visible individual grains.
# It is mostly below the grain surface and prevents the bin looking half empty.
vs=[];fs=[];NX=20;NZ=24
for j in range(NZ):
    zz=(j/(NZ-1)-.5)*.418
    for i in range(NX):
        xx=(i/(NX-1)-.5)*.348
        mound=max(0,(1-(xx/.21)**2)*(1-(zz/.25)**2))
        yy=1.045+.031*mound+random.uniform(-.004,.004)
        vs.append((-.735+xx,yy,.07+zz))
for j in range(NZ-1):
    for i in range(NX-1):a=j*NX+i;fs.append((a,a+NX,a+NX+1,a+1))
mesh('Steamed rice filled mound',vs,fs,rice,food_roots['rice'])
pile('rice',1250,.36,.42,.040)
pile('carrot',175,.215,.175,.021)
pile('onion',100,.205,.170,.026)
pile('bacon',60,.195,.170,.018)
pile('scallion',340,.20,.170,.020)
pile('corn',260,.20,.170,.013)
pile('peas',260,.20,.170,.012)
pile('ham',80,.195,.170,.015)
# Glossy beaten egg is a visible liquid surface, with a few larger whole eggs
# parked between the rice bin and the stove where the old garnish tray used to be.
eggvs=[];eggfs=[]
for cx,cz,a in [(.105,.085,0),(-.105,.085,90),(-.105,-.085,180),(.105,-.085,270)]:
    for j in range(12):
        t=math.radians(a+j*90/12);eggvs.append((.585+cx+.019*math.cos(t),1.130,-.44+cz+.019*math.sin(t)))
eggfs.append(tuple(reversed(range(48))))
mesh('Golden beaten egg liquid surface',eggvs,eggfs,eggmat,food_roots['egg'])
for i,ex,ez in [(0,-.44,.33),(1,-.52,.375),(2,-.45,.415)]:
    sphere('Unbroken egg',(ex,1.047,ez),(.035,.044,.035),eggshell,cart,32,18)
for i in range(10):
    x=random.uniform(.505,.665);z=random.uniform(-.498,-.382)
    torus('Egg surface bubble',(x,1.1307,z),random.uniform(.0017,.0035),.0006,cream,food_roots['egg'])

# The rice tray stays open. A hinged lid used to stand here, 47 cm of sheet
# steel between the cook and the condiment shelf: it hid the lower half of the
# oil bottle and almost all of the red-capped oyster bottle from the play
# camera, and the pan could be dragged straight through it. The bin reads
# better, and collides honestly with nothing, as an open pressed-steel tray.

def lathe(name,profile,mat,root=None,loc=(0,0,0),segments=64):
    vs=[];fs=[]
    for y,r in profile:
        for i in range(segments):
            a=i*math.tau/segments;vs.append((loc[0]+r*math.cos(a),loc[1]+y,loc[2]+r*math.sin(a)))
    for j in range(len(profile)-1):
        for i in range(segments):
            a=j*segments+i;b=j*segments+(i+1)%segments;fs.append((a,b,b+segments,a+segments))
    return mesh(name,vs,fs,mat,root)

def bottle(kind,x,z,liquid):
    y=1.147;root=group('Bottle_'+kind,(x,y,z));root['pivot']='bottom center; local +Y up'
    profile=[(0,.037),(.007,.045),(.035,.046),(.192,.046),(.217,.035),(.226,.025),(.231,.025)]
    lathe(kind+' translucent squeeze bottle',profile,plastic,root,(x,y,z))
    lathe(kind+' liquid fill',[(.009,.001),(.009,.043),(.173,.043),(.174,.001)],liquid,root,(x,y,z))
    cylinder(kind+' threaded screw cap',(x,y+.23,z),.028,.024,cap,root)
    lathe(kind+' tapered nozzle',[(.24,.018),(.269,.010),(.295,.005),(.303,.004)],cap,root,(x,y,z),40)
    torus(kind+' fill meniscus',(x,y+.174,z),.041,.0015,liquid,root)
    for i in range(12):
        a=i*math.tau/12;tube(kind+' cap fluting',[(x+math.cos(a)*.028,y+.222,z+math.sin(a)*.028),(x+math.cos(a)*.028,y+.238,z+math.sin(a)*.028)],.0011,cap,root,1)
    return root

bottle('oil',-.91,-.68,oil);bottle('soy',-.71,-.68,soy)
# A separate squat oyster-sauce bottle, recognizable by its dark viscous fill and red cap.
oyster_mat=material('Thick glossy oyster sauce',(.057,.024,.011),0,.20)
oyster_cap=material('Oyster bottle red screw cap',(.36,.027,.017),0,.34)
oyster_label=material('Oyster sauce parchment label',(.61,.44,.23),0,.67)
x,y,z=-.50,1.147,-.68
oyster_root=group('Bottle_oyster',(x,y,z));oyster_root['pivot']='bottom center; local +Y up'
lathe('Oyster glass bottle',[(0,.043),(.007,.052),(.153,.052),(.181,.037),(.191,.026),(.208,.026)],plastic,oyster_root,(x,y,z))
lathe('Oyster sauce thick fill',[(.008,.001),(.008,.049),(.160,.049),(.169,.033),(.171,.001)],oyster_mat,oyster_root,(x,y,z))
lathe('Oyster sauce wrapped label',[(.045,.0525),(.126,.0525)],oyster_label,oyster_root,(x,y,z))
cylinder('Oyster red cap',(x,y+.210,z),.030,.031,oyster_cap,oyster_root)
lathe('Oyster pour spout',[(.225,.015),(.260,.007),(.275,.005)],oyster_cap,oyster_root,(x,y,z),32)
for i in range(16):
 a=i*math.tau/16;tube('Oyster cap ridges',[(x+math.cos(a)*.030,y+.197,z+math.sin(a)*.030),(x+math.cos(a)*.030,y+.224,z+math.sin(a)*.030)],.001, oyster_cap,oyster_root,1)
for x in [-.33,-.18]:
    cylinder('Perforated seasoning tin',(x,1.228,-.682),.045,.17,steel)
    cylinder('Seasoning shaker lid',(x,1.317,-.682),.047,.013,polish)
    for a in range(8):cylinder('Shaker opening',(x+.025*math.cos(a*math.tau/8),1.325,-.682+.025*math.sin(a*math.tau/8)),.0025,.001,rubber,vertices=8)
cylinder('Utensil holder',(-.065,1.25,-.694),.064,.22,steel)
for i in range(12):
    x=-.065+random.uniform(-.043,.043);z=-.694+random.uniform(-.043,.043)
    tube('Bamboo chopstick',[(x,1.25,z),(x+random.uniform(-.02,.02),1.58+random.uniform(-.03,.02),z)],.003,wood,resolution=2)
# Stacked bowls, rolled stainless shelf details and folded washcloth.
for i in range(6):
    lathe('Serving bowl stack '+str(i),[(0,.065),(.015,.085),(.058,.11),(.061,.113),(.064,.11)],cream,cart,(.25,1.15+i*.016,-.69))
clothmat=material('Slate blue cotton cloth',(.065,.105,.12),0,.96)
cube('Folded cook cloth',(-.83,1.021,.414),(.20,.027,.10),clothmat,.019)
cube('Rear serving foldout',(1.46,.969,-.06),(.53,.032,.87),steel,.017)
lathe('Serving plate',[(0,.06),(.002,.15),(.013,.177),(.02,.181),(.023,.177)],cream,cart,(1.45,.991,-.04))
for x in [1.21,1.59]:tube('Foldout support',[(x,.95,.29),(1.17,.78,.29)],.010,polish)

ladle=group('Ladle',(.30,1.28,.38));ladle['pivot']='grip end; bowl towards local -Z'
# All vertices are defined relative to the end of the wooden grip.
lp=(.30,1.28,.38)
def L(p):return tuple(lp[i]+p[i] for i in range(3))
tube('Ladle wooden grip',[L((0,0,.028)),L((0,0,-.068)),L((0,-.006,-.143))],.015,wood,ladle,5)
tube('Ladle stainless shaft',[L((0,-.006,-.136)),L((0,-.035,-.265)),L((0,-.045,-.366))],.007,polish,ladle,4)
vs=[];fs=[];N=64;R=12
for j in range(R):
    r=.002+.052*j/(R-1)
    for i in range(N):
        a=i*math.tau/N;vs.append(L((math.cos(a)*r,-.062+.029*(r/.054)**1.7,-.404+math.sin(a)*r)))
for j in range(R-1):
    for i in range(N):a=j*N+i;b=j*N+(i+1)%N;fs.append((a,b,b+N,a+N))
head=mesh('Ladle deep steel bowl',vs,fs,polish,ladle);solid=head.modifiers.new('Ladle steel thickness','SOLIDIFY');solid.thickness=.002

# Anatomical sculpted hands: continuous skin, with three deforming joints per finger.
# The wrist origin is local [0,0,0], fingertips point -Z and the back faces +Y.
hand_rests={'left':[-.39,1.10,.66],'right':[.39,1.10,.66]}
def build_hand(side):
    mirror=-1 if side=='left' else 1;at=hand_rests[side];root=group('Hand_'+side,at)
    root['pivot']='wrist; fingertips -Z, hand back +Y';root['handSide']=side;root['handRig']='anatomical-16-joints';parts=[]
    def H(p):return (at[0]+p[0]*mirror,at[1]+p[1],at[2]+p[2])
    # Ellipsoid palm naturally tapers into a narrower wrist; forearm broadens toward viewer.
    parts.append(sphere('Palm '+side,H((0,0,-.070)),(.045,.022,.063),skin,root,40,24))
    parts.append(sphere('Thenar '+side,H((-.028,-.007,-.066)),(.025,.025,.043),skin,root,32,20))
    vs=[];fs=[];N=32
    for z,rx,ry,cy in [(-.04,.032,.020,0),(.00,.027,.020,0),(.042,.032,.024,-.004),(.11,.040,.030,-.008),(.22,.048,.036,-.019),(.33,.050,.040,-.03)]:
        for i in range(N):
            a=i*math.tau/N;vs.append(H((math.cos(a)*rx,math.sin(a)*ry+cy,z)))
    for j in range(5):
        for i in range(N):a=j*N+i;b=j*N+(i+1)%N;fs.append((a,b,b+N,a+N))
    fs.append(tuple(range(N-1,-1,-1)));fs.append(tuple(5*N+i for i in range(N)))
    parts.append(mesh('Forearm '+side,vs,fs,skin,root))
    # Model a slightly relaxed open hand. A pre-curled mesh cannot be opened
    # convincingly by rotating the wrist, so every phalanx has a real bone.
    fingertips=[];finger_paths={}
    for j,(name,x,length,width) in enumerate([('index',-.032,.087,.0114),('middle',-.010,.097,.0122),('ring',.013,.089,.0113),('little',.033,.070,.0098)]):
        start=-.104+(abs(x)*.28)
        path=[(x,.004,start),(x,.002,start-length*.42),(x,-.003,start-length*.75),(x,-.010,start-length)]
        finger_paths[name]=path
        vs=[];fs=[];N=16
        for k,p in enumerate(path):
            r=width*[1,.96,.84,.57][k]
            tangent=Vector(path[min(k+1,3)])-Vector(path[max(k-1,0)])
            tangent.normalize();axis=Vector((1,0,0));axis2=tangent.cross(axis).normalized()
            for i in range(N):
                a=i*math.tau/N;q=Vector(p)+axis*math.cos(a)*r+axis2*math.sin(a)*r*.91;vs.append(H(q))
        for k in range(3):
            for i in range(N):a=k*N+i;b=k*N+(i+1)%N;fs.append((a,b,b+N,a+N))
        fs.extend([tuple(range(N-1,-1,-1)),tuple(3*N+i for i in range(N))])
        parts.append(mesh('Finger '+str(j)+' '+side,vs,fs,skin,root))
        fingertips.append((name,x,-.007,start-length*.91,width))
        parts.append(sphere('Knuckle '+str(j)+' '+side,H((x,.010,start-.009)),(width*.98,.012,.014),skin,root,20,12))
    finger_paths['thumb']=[(-.028,-.006,-.047),(-.054,-.009,-.073),(-.070,-.014,-.099),(-.074,-.023,-.123)]
    thumbpath=[H(p) for p in finger_paths['thumb']]
    parts.append(tube('Thumb '+side,thumbpath,.015,skin,root,5))
    joined=join_objects(parts,'Sculpted anatomical hand '+side,root)
    bpy.context.view_layer.objects.active=joined
    bpy.ops.object.select_all(action='DESELECT');joined.select_set(True)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    rem=joined.modifiers.new('Continuous skin union','REMESH');rem.mode='VOXEL';rem.voxel_size=.0027;rem.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=rem.name)
    smooth=joined.modifiers.new('Sculpt smoothing','SMOOTH');smooth.factor=.52;smooth.iterations=5;bpy.ops.object.modifier_apply(modifier=smooth.name)
    dec=joined.modifiers.new('Game sculpt optimisation','DECIMATE');dec.ratio=.44;bpy.ops.object.modifier_apply(modifier=dec.name)
    nails=[]
    fingertips.append(('thumb',-.073,-.019,-.116,.014))
    for name,x,y,z,w in fingertips:
        n=sphere('Natural fingernail '+name+' '+side,H((x,y+.007,z)),(w*.65,.0018,.0075),nailmat,root,20,12)
        n.rotation_euler.x=math.radians(14)
        nails.append((n,name))
    # Fine wrist crease and a tendon indicate actual hand anatomy at close range.
    tube('Wrist flexion crease '+side,[H((-.020,-.017,.006)),H((0,-.020,.007)),H((.020,-.017,.006))],.00055,crease,root,2)

    rig_data=bpy.data.armatures.new('Anatomical hand skeleton '+side)
    rig=bpy.data.objects.new('HandRig_'+side,rig_data);bpy.context.collection.objects.link(rig)
    rig.location=V(at);parent(rig,root);rig.show_in_front=True
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    wrist=rig_data.edit_bones.new('hand_'+side+'_wrist');wrist.head=V((0,0,0));wrist.tail=V((0,0,-.080));wrist.align_roll(V((0,1,0)))
    for name,path in finger_paths.items():
        previous=wrist
        for k in range(3):
            bone=rig_data.edit_bones.new('hand_'+side+'_'+name+'_'+str(k+1))
            bone.head=V((path[k][0]*mirror,path[k][1],path[k][2]))
            bone.tail=V((path[k+1][0]*mirror,path[k+1][1],path[k+1][2]))
            bone.align_roll(V((0,1,0)));bone.parent=previous;bone.use_connect=k>0;previous=bone
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone in rig.pose.bones:bone.rotation_mode='XYZ'

    def add_skin(obj, rigid_bone=None):
        groups={b.name:obj.vertex_groups.new(name=b.name) for b in rig_data.bones}
        if rigid_bone:
            groups[rigid_bone].add(list(range(len(obj.data.vertices))),1,'REPLACE')
        else:
            # Nearest finger centreline selects a finger, then smooth joint bands
            # blend consecutive phalanges. Palm/forearm stay on the wrist bone.
            bpy.context.view_layer.update()
            for vertex in obj.data.vertices:
                world=obj.matrix_world@vertex.co;local=world-V(at)
                q=Vector((local.x*mirror,local.z,-local.y))
                candidates=[]
                for name,path in finger_paths.items():
                    path=[Vector(p) for p in path];distances=[];lengths=[0]
                    for a,b in zip(path,path[1:]):lengths.append(lengths[-1]+(b-a).length)
                    for k,(a,b) in enumerate(zip(path,path[1:])):
                        d=b-a;t=max(0,min(1,(q-a).dot(d)/d.length_squared));near=a+d*t
                        distances.append(((q-near).length,k,lengths[k]+t*d.length))
                    distance,segment,along=min(distances)
                    direction=(path[1]-path[0]).normalized()
                    proximal=(q-path[0]).dot(direction)
                    influence=max(0,min(1,(proximal+.016)/.029))
                    if name=='thumb':influence*=max(0,min(1,(-q.x-.026)/.021))
                    candidates.append((distance,name,along,lengths,influence))
                distance,name,along,lengths,influence=min(candidates,key=lambda item:item[0])
                # Outside the finger tube only the palm/wrist may influence skin.
                influence*=max(0,min(1,(.026-distance)/.012))
                weights=[1.,0.,0.]
                for k in (1,2):
                    half=.009 if name!='thumb' else .008
                    t=max(0,min(1,(along-lengths[k]+half)/(2*half)));t=t*t*(3-2*t)
                    weights[k-1]*=1-t;weights[k]=t
                if influence<1:groups[wrist.name].add([vertex.index],1-influence,'REPLACE')
                for k,w in enumerate(weights):
                    if w*influence>.00001:groups['hand_'+side+'_'+name+'_'+str(k+1)].add([vertex.index],w*influence,'REPLACE')
        mod=obj.modifiers.new('Live finger skin deformation','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=True
        parent(obj,rig)
    # The edit-bone handle is invalid after edit mode; use the stable name.
    wrist_name='hand_'+side+'_wrist'
    wrist=rig_data.bones[wrist_name]
    add_skin(joined)
    for obj,name in nails:add_skin(obj,'hand_'+side+'_'+name+'_3')
    return root

build_hand('left');build_hand('right')

# Hide prototypes underground; renderer extracts them and sets visible=false as well.
for i,obj in enumerate(protos.values()):obj.location=V((0,-3-i*.1,0))

layout={
    'version':2,'coordinateSystem':'glTF Y-up; metres; customer street behind cart (-Z), cook +Z, cabin -X',
    'model':'/models/playable-cart.glb','source':'Hyper3D shell + Blender worktop/food/utensils/anatomical hands',
    'cameraMenu':[-3.55,2.46,4.15],'lookMenu':[-.55,1.13,-.20],
    'cameraPlay':[0,1.81,1.24],'lookPlay':[0,1.12,-.12], 'cameraFov':64,
    'worktopBounds':{'min':[-1.195,.95,-.87],'max':[1.195,1.003,.49]},
    'wokCenter':[0,1.1,0], 'wokRimHeight':1.225,'wokRadius':.28,'foodSurface':[0,1.13,0],
    'wokHandle':[-.43,1.28,.44], 'burnerCenter':[0,1.055,0],
    'trays':anchors,
    'bottles':{'oil':[-.91,1.147,-.68],'soy':[-.71,1.147,-.68],'oyster':[-.50,1.147,-.68]},
    'tools':{'ladle':[.30,1.28,.38],'ladleGrip':[.30,1.28,.38],'ladleBowl':[.30,1.218,-.024],'serve':[1.45,1.014,-.04],'burner':[0,1.055,0],'knob':[-.76,1.038,.43]},
    'handRest':hand_rests,'handGripOffset':[0,-.025,-.105],
    'prototypes':{k:'FoodPrototype_'+k for k in protos},
    'nodes':{'static':'CartShell','wok':'Wok','ladle':'Ladle','oil':'Bottle_oil','soy':'Bottle_soy','oyster':'Bottle_oyster','leftHand':'Hand_left','rightHand':'Hand_right'},
}
os.makedirs(os.path.join(ROOT,'public/models'),exist_ok=True)
with open(os.path.join(ROOT,'public/models/playable-cart-layout.json'),'w') as f:json.dump(layout,f,indent=2,ensure_ascii=False)

# Export actual Blender meshes as GLB. Cameras, QA lights and ground are excluded.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    if o.type in ['MESH','EMPTY','ARMATURE']:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public/models/playable-cart.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True)

scene=bpy.context.scene;scene.world.use_nodes=True
next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND').inputs[0].default_value=(.075,.092,.12,1)
next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND').inputs[1].default_value=.5
groundmat=material('QA charcoal ground',(.055,.061,.068),0,.84)
ground=cube('QA ground',(0,-.034,0),(200,.03,200),groundmat,0,root=None)
for p,power,size,color in [((1,4,2),650,4,(1,.86,.71)),((-4,3,-2),900,4,(.63,.78,1)),((3,4,-3),700,3,(1,.95,.88)),((0,2.0,.20),60,1.8,(1,.72,.43))]:
    bpy.ops.object.light_add(type='AREA',location=V(p));o=bpy.context.object;o.name='QA studio light';o.data.energy=power;o.data.size=size;o.data.color=color;o.rotation_euler=(V((-.2,1,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=V(layout['cameraMenu']));camera=bpy.context.object;camera.name='QA camera';camera.rotation_euler=(V(layout['lookMenu'])-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=43;scene.camera=camera
scene.render.engine='BLENDER_EEVEE';scene.eevee.use_gtao=True;scene.eevee.gtao_distance=.2;scene.eevee.gtao_factor=1.18;scene.eevee.use_ssr=True;scene.eevee.use_ssr_refraction=True;scene.eevee.taa_render_samples=96
scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Filmic';scene.view_settings.look='Medium High Contrast';scene.view_settings.exposure=0;scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets/source/playable-cart.blend'))
for name in ['Hand_left','Hand_right']:
    for child in bpy.data.objects[name].children_recursive:child.hide_render=True
scene.render.filepath=os.path.join(ROOT,'assets/source/playable-cart-full-qa.png');bpy.ops.render.render(write_still=True)
# Kitchen close-up is an inspection viewpoint rather than a replacement game scene.
camera.location=V((.02,1.92,1.50));camera.rotation_euler=(V((0,1.11,-.15))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=35
scene.render.filepath=os.path.join(ROOT,'assets/source/playable-cart-worktop-qa.png');bpy.ops.render.render(write_still=True)
for name in ['Hand_left','Hand_right']:
    for child in bpy.data.objects[name].children_recursive:child.hide_render=False
camera.location=V((0,1.55,1.35));camera.rotation_euler=(V((0,1.1,.41))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=39
scene.render.filepath=os.path.join(ROOT,'assets/source/playable-cart-hands-qa.png');bpy.ops.render.render(write_still=True)
mesh_objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('QA')]
triangles=0
for o in mesh_objects:o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
print('PLAYABLE_CART_DONE',json.dumps({'meshes':len(mesh_objects),'triangles':triangles,'oldVerticesRemoved':len(removed),'model':layout['model'],'anchors':layout},ensure_ascii=False))

"""Import the actual generated GLB, normalize, clean, save .blend, export game GLB and render QA."""
import bpy,os,math,json
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets/source/hyper3d-cart-v2.glb'))
objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
points=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box]
lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)]);dim=hi-lo
print('IMPORTED_DIMENSIONS',list(dim))
# Normalize longest horizontal axis to 4.2m and place wheels on the floor.
scale=4.2/max(dim.x,dim.y);center=(lo+hi)*.5
for o in objects:
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for v in o.data.vertices:
        world=o.matrix_world@v.co;world.x-=center.x;world.y-=center.y;world.z-=lo.z
        v.co=world*scale
    o.matrix_world.identity();o.name='Hyper3D_Cart_PBR'
    for p in o.data.polygons:p.use_smooth=True
    # Input is already target remeshed; preserve silhouettes and UVs.
    for m in o.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type=='TEX_IMAGE' and n.image:
                    if max(n.image.size)>2048:n.image.scale(2048,2048)
    o.select_set(False)
# Put editable generated model in its own clearly named collection.
collection=bpy.data.collections.new('Hyper3D generated cart');bpy.context.scene.collection.children.link(collection)
for o in objects:
    for c in list(o.users_collection):c.objects.unlink(o)
    collection.objects.link(o)
scene=bpy.context.scene
scene.world.use_nodes=True;next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND').inputs[0].default_value=(.19,.23,.29,1)
# Render without including QA lights/camera in export.
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public/models/hyper3d-cart.glb'),export_format='GLB',use_selection=True,export_apply=True)
for loc,power,size in [((2,-4,6),1100,5),((-4,-1,4),800,4),((1,5,5),1300,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.size=size;light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(5,-6,4));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=6.1;scene.camera=camera
scene.render.engine='BLENDER_EEVEE';scene.eevee.use_gtao=True;scene.eevee.gtao_distance=3;scene.eevee.gtao_factor=1.3
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast';scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets/source/hyper3d-cart-finished.blend'))
scene.render.filepath=os.path.join(ROOT,'assets/source/hyper3d-cart-qa.png');bpy.ops.render.render(write_still=True)
triangles=sum(len(o.data.loop_triangles) for o in objects)
for o in objects:o.data.calc_loop_triangles()
triangles=sum(len(o.data.loop_triangles) for o in objects)
report={'source':'Hyper3D MCP → Blender 3.4.1 → GLB','meshes':len(objects),'triangles':triangles,'widthMeters':4.2,'textureMaxSize':2048,'file':'/models/hyper3d-cart.glb'}
open(os.path.join(ROOT,'assets/source/hyper3d-qa.json'),'w').write(json.dumps(report,indent=2))
print('HYPER3D_BLENDER_EXPORT_OK',json.dumps(report))

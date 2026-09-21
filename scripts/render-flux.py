"""Offline product photography for the same blade assembly used in Three.js."""
import bpy
import math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/flux'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
try:
    p=bpy.context.preferences.addons['cycles'].preferences;p.compute_device_type='OPTIX';p.get_devices()
    for d in p.devices:d.use=d.type=='OPTIX'
    scene.cycles.device='GPU'
except Exception:pass
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.7,.73,.7,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
mat=bpy.data.materials.new('Polished alloy');mat.use_nodes=True
shader=mat.node_tree.nodes.get('Principled BSDF');shader.inputs['Metallic'].default_value=1;shader.inputs['Roughness'].default_value=.20
for i in range(80):
    a=i/80*math.tau
    bpy.ops.mesh.primitive_cube_add(size=1,location=(math.cos(a)*1.33,math.sin(a*2)*.23,math.sin(a)*1.33+2.05))
    o=bpy.context.object;o.scale=(.105,.53,.80);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.rotation_euler=(.16,-a,a*.5+.35);o.data.materials.append(mat)
    mod=o.modifiers.new('Precision edge','BEVEL');mod.width=.035;mod.segments=3
    mod=o.modifiers.new('Weighted highlights','WEIGHTED_NORMAL')
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,0));floor=bpy.context.object
fm=bpy.data.materials.new('Gallery');fm.diffuse_color=(.68,.70,.66,1);floor.data.materials.append(fm)
def light(pos,power,size,target=(0,0,2)):
    d=bpy.data.lights.new('Softbox','AREA');d.energy=power;d.shape='RECTANGLE';d.size=size;d.size_y=size*2
    o=bpy.data.objects.new('Softbox',d);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
light((-3,-4,6),900,2);light((3,1,4),1400,2);light((0,2,6),1000,3)
d=bpy.data.cameras.new('Product camera');cam=bpy.data.objects.new('Product camera',d);bpy.context.collection.objects.link(cam);scene.camera=cam
cam.location=(3,-7,4.1);cam.rotation_euler=(Vector((0,0,2))-cam.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=5.6
scene.render.resolution_x=1000;scene.render.resolution_y=1250;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
for name,color in [('silver',(.60,.65,.63,1)),('carbon',(.035,.05,.04,1)),('ion',(.02,.09,.75,1))]:
    shader.inputs['Base Color'].default_value=color;scene.render.filepath=str(OUT/f'{name}.png');bpy.ops.render.render(write_still=True)
print('FLUX renders complete',flush=True)

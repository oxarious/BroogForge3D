"""Export a UV-ready OBJ copy for the standalone texture editor."""
import bpy
import os
import sys
from math import radians

source, destination = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if not meshes:
    raise RuntimeError('Asset contains no meshes')
for obj in meshes:
    if obj.data.uv_layers:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=0.025)
    bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.ops.wm.obj_export(filepath=os.path.join(destination, 'mesh-uv.obj'), export_selected_objects=True, export_materials=False, export_uv=True)
print('UV-ready OBJ exported; source GLB unchanged.')

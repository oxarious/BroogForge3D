"""Render actual mesh depth for the local ControlNet smoke test."""
import bpy
import sys
from mathutils import Vector

source, destination = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
center = (low + high) / 2
extent = high - low
distance = max(extent) * 3
bpy.ops.object.camera_add(location=center + Vector((0, -distance, 0)))
camera = bpy.context.object
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = max(extent.x, extent.z) * 1.14
bpy.context.scene.camera = camera
material = bpy.data.materials.new('Linear mesh depth')
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
camera_data = nodes.new('ShaderNodeCameraData')
mapping = nodes.new('ShaderNodeMapRange')
mapping.inputs['From Min'].default_value = distance - extent.y / 2
mapping.inputs['From Max'].default_value = distance + extent.y / 2
mapping.inputs['To Min'].default_value = 1
mapping.inputs['To Max'].default_value = 0.1
emission = nodes.new('ShaderNodeEmission')
output = nodes.new('ShaderNodeOutputMaterial')
links = material.node_tree.links
links.new(camera_data.outputs['View Z Depth'], mapping.inputs['Value'])
links.new(mapping.outputs['Result'], emission.inputs['Color'])
links.new(emission.outputs[0], output.inputs['Surface'])
for obj in meshes:
    obj.data.materials.clear()
    obj.data.materials.append(material)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = destination
bpy.ops.render.render(write_still=True)

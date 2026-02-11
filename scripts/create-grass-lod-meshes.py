"""
Create grass blade LOD meshes for instanced rendering.

Generates two LOD levels:
- Near LOD (0-15m): Detailed grass blades with 4-6 cards, gentle curve
- Mid LOD (15-50m): Simple grass clumps with 2 cards

Export as GLB for use in Three.js/R3F
"""

import bpy
import math

# ===== CONFIGURATION =====
CONFIG = {
    'output_dir': 'C:/Users/Rick/Desktop/proj-medevil-village/code/public/models/',
    'grass_height': 0.3,      # 30cm tall grass (Z-axis in Blender, stays Z in Three.js)
    'grass_width': 0.05,      # 5cm wide blade
}


def clear_scene():
    """Remove all objects from scene"""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def create_grass_blade_card(height=0.3, width=0.05, segments=3, curve_amount=0.08):
    """
    Create a single grass blade card with curvature
    Returns the mesh object
    """
    verts = []
    faces = []
    
    # Create vertices with curve
    for i in range(segments + 1):
        t = i / segments  # 0 to 1
        
        # Quadratic curve (bends at top)
        curve_offset = curve_amount * (t ** 2)
        
        y = height * t
        x_offset = curve_offset
        
        # Left vertex
        verts.append((-width/2 + x_offset, 0, y))
        # Right vertex
        verts.append((width/2 + x_offset, 0, y))
    
    # Create faces
    for i in range(segments):
        base = i * 2
        # Two triangles per segment
        faces.append((base, base + 2, base + 3, base + 1))
    
    # Create mesh
    mesh = bpy.data.meshes.new("GrassBlade")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    
    return mesh


def create_near_lod_grass():
    """
    Create detailed grass for 0-15m range
    4 blade cards in X pattern with slight rotation variation
    """
    clear_scene()
    
    height = CONFIG['grass_height']
    width = CONFIG['grass_width']
    
    # Create 4 blades in cross pattern
    angles = [0, 45, 90, 135]
    
    all_verts = []
    all_faces = []
    vert_offset = 0
    
    for angle in angles:
        # Create blade mesh
        blade_mesh = create_grass_blade_card(height, width, segments=4, curve_amount=0.08)
        
        # Rotate blade
        rot_matrix = bpy.data.objects.new("temp", blade_mesh).matrix_world
        bpy.data.objects.remove(bpy.data.objects["temp"])
        
        for vert in blade_mesh.vertices:
            # Rotate around Z axis
            rad = math.radians(angle)
            x = vert.co.x * math.cos(rad) - vert.co.y * math.sin(rad)
            y = vert.co.x * math.sin(rad) + vert.co.y * math.cos(rad)
            z = vert.co.z
            
            all_verts.append((x, y, z))
        
        # Update face indices
        for face in blade_mesh.polygons:
            new_face = tuple(v + vert_offset for v in face.vertices)
            all_faces.append(new_face)
        
        vert_offset += len(blade_mesh.vertices)
        bpy.data.meshes.remove(blade_mesh)
    
    # Create final mesh
    grass_mesh = bpy.data.meshes.new("GrassNearLOD")
    grass_mesh.from_pydata(all_verts, [], all_faces)
    grass_mesh.update()
    
    # Create UV map (simple vertical unwrap)
    grass_mesh.uv_layers.new(name="UVMap")
    for i, loop in enumerate(grass_mesh.loops):
        vert = grass_mesh.vertices[loop.vertex_index]
        # Simple UV: X maps to U, Z (height) maps to V
        u = (vert.co.x / width) * 0.5 + 0.5
        v = vert.co.z / height
        grass_mesh.uv_layers["UVMap"].data[i].uv = (u, v)
    
    # Create object
    grass_obj = bpy.data.objects.new("GrassNearLOD", grass_mesh)
    bpy.context.collection.objects.link(grass_obj)
    
    # Create material
    mat = bpy.data.materials.new(name="GrassMaterial")
    mat.use_nodes = True
    grass_obj.data.materials.append(mat)
    
    # Set origin to base
    bpy.context.view_layer.objects.active = grass_obj
    grass_obj.select_set(True)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    
    print(f"Created Near LOD grass: {len(all_verts)} verts, {len(all_faces)} faces")
    
    return grass_obj


def create_mid_lod_grass():
    """
    Create simplified grass clump for 15-50m range
    2 blade cards in X pattern, no curve
    """
    clear_scene()
    
    height = CONFIG['grass_height']
    width = CONFIG['grass_width'] * 1.5  # Slightly wider
    
    # Create 2 simple cards
    angles = [0, 90]
    
    all_verts = []
    all_faces = []
    vert_offset = 0
    
    for angle in angles:
        # Create simple blade (no curve, fewer segments)
        blade_mesh = create_grass_blade_card(height, width, segments=2, curve_amount=0.03)
        
        for vert in blade_mesh.vertices:
            # Rotate around Z axis
            rad = math.radians(angle)
            x = vert.co.x * math.cos(rad) - vert.co.y * math.sin(rad)
            y = vert.co.x * math.sin(rad) + vert.co.y * math.cos(rad)
            z = vert.co.z
            
            all_verts.append((x, y, z))
        
        # Update face indices
        for face in blade_mesh.polygons:
            new_face = tuple(v + vert_offset for v in face.vertices)
            all_faces.append(new_face)
        
        vert_offset += len(blade_mesh.vertices)
        bpy.data.meshes.remove(blade_mesh)
    
    # Create final mesh
    grass_mesh = bpy.data.meshes.new("GrassMidLOD")
    grass_mesh.from_pydata(all_verts, [], all_faces)
    grass_mesh.update()
    
    # Create UV map
    grass_mesh.uv_layers.new(name="UVMap")
    for i, loop in enumerate(grass_mesh.loops):
        vert = grass_mesh.vertices[loop.vertex_index]
        u = (vert.co.x / width) * 0.5 + 0.5
        v = vert.co.z / height
        grass_mesh.uv_layers["UVMap"].data[i].uv = (u, v)
    
    # Create object
    grass_obj = bpy.data.objects.new("GrassMidLOD", grass_mesh)
    bpy.context.collection.objects.link(grass_obj)
    
    # Create material
    mat = bpy.data.materials.new(name="GrassMaterial")
    mat.use_nodes = True
    grass_obj.data.materials.append(mat)
    
    # Set origin to base
    bpy.context.view_layer.objects.active = grass_obj
    grass_obj.select_set(True)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    
    print(f"Created Mid LOD grass: {len(all_verts)} verts, {len(all_faces)} faces")
    
    return grass_obj


def export_glb(obj, filename):
    """Export object as GLB"""
    import os
    
    filepath = os.path.join(CONFIG['output_dir'], filename)
    
    # Ensure directory exists
    os.makedirs(CONFIG['output_dir'], exist_ok=True)
    
    # Select only this object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    
    # Export as GLB
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=True,
        export_format='GLB',
        export_materials='EXPORT',
        export_normals=True,
        export_tangents=False,
        export_yup=False  # Keep Z-up for Three.js (grass grows along +Z)
    )
    
    print(f"Exported: {filepath}")


def main():
    """Generate and export both LOD levels"""
    
    print(f"\n{'='*60}")
    print(f"GRASS LOD MESH GENERATOR")
    print(f"{'='*60}\n")
    
    # Create Near LOD
    print("Creating Near LOD (0-15m)...")
    near_obj = create_near_lod_grass()
    export_glb(near_obj, "grass-near.glb")
    
    # Create Mid LOD
    print("\nCreating Mid LOD (15-50m)...")
    mid_obj = create_mid_lod_grass()
    export_glb(mid_obj, "grass-mid.glb")
    
    print(f"\n{'='*60}")
    print(f"EXPORT COMPLETE!")
    print(f"{'='*60}")
    print(f"Files exported to: {CONFIG['output_dir']}")
    print(f"  - grass-near.glb (4 blades, curved)")
    print(f"  - grass-mid.glb (2 blades, simple)")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()

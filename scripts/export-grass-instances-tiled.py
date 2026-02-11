"""
Blender script to export grass instances in a tiled format for LOD streaming.

Usage:
1. Open your Blender scene with grass distribution (particle system or mesh vertices)
2. Select the object containing grass instances
3. Run this script in Blender's scripting workspace
4. Configure settings below before running

Output:
- Creates a manifest.json with tile information
- Exports individual tile files (grass_tile_X_Z.bin) for streaming
"""

import bpy
import struct
import json
import os
from pathlib import Path

# ===== CONFIGURATION =====
CONFIG = {
    'object_name': 'GrassScatterPlane',  # Name of object with grass distribution
    'tile_size': 50.0,                    # Size of each tile in meters (50x50m)
    'output_dir': 'C:/Users/Rick/Desktop/proj-medevil-village/code/public/grass-tiles/',
    'source_type': 'pointcloud',          # 'pointcloud', 'particles', or 'vertices'
    'particle_system_index': 0,           # Which particle system to use (if multiple)
    'min_instances_per_tile': 10,         # Skip tiles with fewer instances than this
}

def get_instances_from_pointcloud(obj):
    """Extract instance data from point cloud (including geometry nodes output)"""
    
    # Get evaluated/computed geometry (handles geometry nodes)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    obj_eval = obj.evaluated_get(depsgraph)
    
    # Check if evaluated object has point cloud data
    if hasattr(obj_eval.data, 'points'):
        # Native point cloud
        pointcloud = obj_eval.data
        num_points = len(pointcloud.points)
        
        print(f"Extracting {num_points} points from point cloud '{obj.name}'...")
        
        instances = []
        
        for i in range(num_points):
            point = pointcloud.points[i]
            
            # Get world position
            local_pos = point.co
            world_pos = obj_eval.matrix_world @ local_pos
            
            # Transform from Blender coords (Y-up, Z-forward) to Three.js coords (Y-up, Z-forward)
            # Apply the same -90° X rotation that's in Scene.tsx
            # x' = x, y' = z, z' = -y
            x = world_pos.x
            y = world_pos.z  # Blender Z becomes Three.js Y (after group rotation)
            z = -world_pos.y  # Blender Y becomes Three.js -Z (after group rotation)
            
            # Generate deterministic seed from position
            seed = hash((round(x, 3), round(y, 3), round(z, 3))) & 0xFFFF
            
            instances.append({
                'x': x,
                'y': y,
                'z': z,
                'seed': seed,
                'scale': 0.8 + (seed % 100) / 250.0,  # 0.8-1.2 variation
                'rotation': (seed % 360) * 0.017453,  # Random Y rotation in radians
            })
            
            if i % 10000 == 0 and i > 0:
                print(f"  Processed {i} points...")
        
        return instances
    
    # Try to access as mesh with vertices (fallback for geometry nodes that output mesh)
    elif hasattr(obj_eval.data, 'vertices'):
        print(f"Object '{obj.name}' detected as MESH with geometry nodes")
        print(f"Note: If this should be a point cloud, ensure geometry nodes output is set to 'Points'")
        
        mesh = obj_eval.data
        num_verts = len(mesh.vertices)
        
        print(f"Extracting {num_verts} vertices as point instances from '{obj.name}'...")
        
        instances = []
        
        for i, vert in enumerate(mesh.vertices):
            # Get world position
            world_pos = obj_eval.matrix_world @ vert.co
            
            # Transform coords to match Three.js with -90° X rotation
            x = world_pos.x
            y = world_pos.z
            z = -world_pos.y
            
            # Generate deterministic seed from position
            seed = hash((round(x, 3), round(y, 3), round(z, 3))) & 0xFFFF
            
            instances.append({
                'x': x,
                'y': y,
                'z': z,
                'seed': seed,
                'scale': 0.8 + (seed % 100) / 250.0,
                'rotation': (seed % 360) * 0.017453,
            })
            
            if i % 10000 == 0 and i > 0:
                print(f"  Processed {i} vertices...")
        
        return instances
    
    else:
        raise ValueError(f"Cannot extract points from object '{obj.name}' (type: {obj.type})")


def get_instances_from_particles(obj, psys_index=0):
    """Extract instance data from particle system"""
    if not obj.particle_systems:
        raise ValueError(f"Object '{obj.name}' has no particle systems")
    
    psys = obj.particle_systems[psys_index]
    instances = []
    
    print(f"Extracting {len(psys.particles)} particles from '{obj.name}'...")
    
    for i, particle in enumerate(psys.particles):
        # Get world position
        pos = obj.matrix_world @ particle.location
        
        # Generate deterministic seed from position
        seed = hash((round(pos.x, 3), round(pos.y, 3), round(pos.z, 3))) & 0xFFFF
        
        instances.append({
            'x': pos.x,
            'y': pos.y,
            'z': pos.z,
            'seed': seed,
            'scale': 0.8 + (seed % 100) / 250.0,  # 0.8-1.2 variation
            'rotation': (seed % 360) * 0.017453,  # Random Y rotation in radians
        })
        
        if i % 10000 == 0 and i > 0:
            print(f"  Processed {i} particles...")
    
    return instances


def get_instances_from_vertices(obj):
    """Extract instance data from mesh vertices"""
    if obj.type != 'MESH':
        raise ValueError(f"Object '{obj.name}' is not a mesh")
    
    mesh = obj.data
    instances = []
    
    print(f"Extracting {len(mesh.vertices)} vertices from '{obj.name}'...")
    
    for i, vert in enumerate(mesh.vertices):
        # Get world position
        pos = obj.matrix_world @ vert.co
        
        # Generate deterministic seed from position
        seed = hash((round(pos.x, 3), round(pos.y, 3), round(pos.z, 3))) & 0xFFFF
        
        instances.append({
            'x': pos.x,
            'y': pos.y,
            'z': pos.z,
            'seed': seed,
            'scale': 0.8 + (seed % 100) / 250.0,
            'rotation': (seed % 360) * 0.017453,
        })
        
        if i % 10000 == 0 and i > 0:
            print(f"  Processed {i} vertices...")
    
    return instances


def group_instances_by_tiles(instances, tile_size):
    """Organize instances into spatial tiles"""
    tiles = {}
    
    for inst in instances:
        tx = int(inst['x'] // tile_size)
        tz = int(inst['z'] // tile_size)
        key = (tx, tz)
        
        if key not in tiles:
            tiles[key] = []
        tiles[key].append(inst)
    
    return tiles


def write_tile_binary(filepath, instances):
    """
    Write tile binary format:
    Header: count(u32), bmin(f32*3), bmax(f32*3)
    Per instance: x,y,z(f32*3), seed(u16), scale(f32), rotation(f32)
    """
    # Calculate bounding box
    if not instances:
        return
    
    xs = [i['x'] for i in instances]
    ys = [i['y'] for i in instances]
    zs = [i['z'] for i in instances]
    
    bmin = (min(xs), min(ys), min(zs))
    bmax = (max(xs), max(ys), max(zs))
    
    with open(filepath, 'wb') as f:
        # Header
        f.write(struct.pack('I', len(instances)))  # count (uint32)
        f.write(struct.pack('fff', *bmin))         # bounding box min
        f.write(struct.pack('fff', *bmax))         # bounding box max
        
        # Instance data (22 bytes per instance)
        for inst in instances:
            f.write(struct.pack('fff', inst['x'], inst['y'], inst['z']))  # 12 bytes
            f.write(struct.pack('H', inst['seed']))                       # 2 bytes
            f.write(struct.pack('ff', inst['scale'], inst['rotation']))   # 8 bytes


def export_grass_tiles():
    """Main export function"""
    
    # Get the object
    obj = bpy.data.objects.get(CONFIG['object_name'])
    if not obj:
        print(f"ERROR: Object '{CONFIG['object_name']}' not found!")
        print(f"Available objects: {[o.name for o in bpy.data.objects]}")
        return
    
    print(f"\n{'='*60}")
    print(f"GRASS INSTANCE TILE EXPORT")
    print(f"{'='*60}")
    print(f"Object: {CONFIG['object_name']} (Type: {obj.type})")
    print(f"Source: {CONFIG['source_type']}")
    print(f"Tile size: {CONFIG['tile_size']}m")
    print(f"Output: {CONFIG['output_dir']}")
    print(f"{'='*60}\n")
    
    # Extract instances based on source type
    if CONFIG['source_type'] == 'pointcloud':
        instances = get_instances_from_pointcloud(obj)
    elif CONFIG['source_type'] == 'particles':
        instances = get_instances_from_particles(obj, CONFIG['particle_system_index'])
    elif CONFIG['source_type'] == 'vertices':
        instances = get_instances_from_vertices(obj)
    else:
        print(f"ERROR: Unknown source_type '{CONFIG['source_type']}'")
        print(f"Valid options: 'pointcloud', 'particles', 'vertices'")
        return
    
    if not instances:
        print("ERROR: No instances found!")
        return
    
    print(f"\nTotal instances: {len(instances)}")
    
    # Group into tiles
    print(f"\nGrouping into {CONFIG['tile_size']}m tiles...")
    tiles = group_instances_by_tiles(instances, CONFIG['tile_size'])
    
    print(f"Created {len(tiles)} tiles")
    
    # Filter tiles by minimum instance count
    filtered_tiles = {k: v for k, v in tiles.items() 
                     if len(v) >= CONFIG['min_instances_per_tile']}
    
    if len(filtered_tiles) < len(tiles):
        print(f"Filtered out {len(tiles) - len(filtered_tiles)} tiles with < {CONFIG['min_instances_per_tile']} instances")
    
    # Create output directory
    output_path = Path(CONFIG['output_dir'])
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Export tiles
    print(f"\nExporting tiles...")
    tile_manifest = {
        'tile_size': CONFIG['tile_size'],
        'total_instances': len(instances),
        'tile_count': len(filtered_tiles),
        'tiles': []
    }
    
    for i, ((tx, tz), tile_instances) in enumerate(filtered_tiles.items()):
        filename = f"grass_tile_{tx}_{tz}.bin"
        filepath = output_path / filename
        
        write_tile_binary(str(filepath), tile_instances)
        
        # Calculate tile bounds
        xs = [inst['x'] for inst in tile_instances]
        ys = [inst['y'] for inst in tile_instances]
        zs = [inst['z'] for inst in tile_instances]
        
        tile_manifest['tiles'].append({
            'filename': filename,
            'tile_x': tx,
            'tile_z': tz,
            'instance_count': len(tile_instances),
            'bounds': {
                'min': [min(xs), min(ys), min(zs)],
                'max': [max(xs), max(ys), max(zs)]
            }
        })
        
        if (i + 1) % 10 == 0:
            print(f"  Exported {i + 1}/{len(filtered_tiles)} tiles...")
    
    # Write manifest
    manifest_path = output_path / 'manifest.json'
    with open(str(manifest_path), 'w') as f:
        json.dump(tile_manifest, f, indent=2)
    
    # Summary
    print(f"\n{'='*60}")
    print(f"EXPORT COMPLETE!")
    print(f"{'='*60}")
    print(f"Total instances: {len(instances)}")
    print(f"Tiles exported: {len(filtered_tiles)}")
    print(f"Output directory: {output_path}")
    print(f"Manifest: {manifest_path}")
    print(f"\nInstance count by tile:")
    
    counts = [len(v) for v in filtered_tiles.values()]
    if counts:
        print(f"  Min: {min(counts)}")
        print(f"  Max: {max(counts)}")
        print(f"  Avg: {sum(counts) / len(counts):.1f}")
    
    print(f"{'='*60}\n")


# ===== RUN EXPORT =====
if __name__ == "__main__":
    export_grass_tiles()

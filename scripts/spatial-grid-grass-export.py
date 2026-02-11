"""
Spatial Grid Grass Exporter - exports grass positions organized in a spatial grid.

Pre-builds the spatial grid structure for AAA-style LOD culling.
Avoids runtime grid construction and enables fast queries.

Usage:
1. Open your Blender scene with grass point cloud
2. Run this script in Blender's scripting workspace

Output: grass-grid.bin with spatial grid structure
"""

import bpy
import struct
import os
from collections import defaultdict

# ===== CONFIGURATION =====
CONFIG = {
    'object_name': 'Grass land',
    'output_file': 'C:/Users/Rick/Desktop/proj-medevil-village/code/public/grass-grid.bin',
    'cell_size': 50.0,  # 50m cells (good for 100m-300m LOD ranges)
    'decimation_factor': 20,  # Keep 1 in every N positions (20 = 5% density = ~2M positions)
}

def export_grass_positions():
    """Export grass positions organized in spatial grid"""
    
    obj = bpy.data.objects.get(CONFIG['object_name'])
    if not obj:
        print(f"ERROR: Object '{CONFIG['object_name']}' not found!")
        print(f"Available objects: {[o.name for o in bpy.data.objects]}")
        return
    
    print(f"\n{'='*60}")
    print(f"SPATIAL GRID GRASS EXPORT")
    print(f"{'='*60}")
    print(f"Object: {CONFIG['object_name']} (Type: {obj.type})")
    print(f"Cell size: {CONFIG['cell_size']}m")
    print(f"Output: {CONFIG['output_file']}")
    print(f"{'='*60}\n")
    
    # Get evaluated object (handles geometry nodes)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    obj_eval = obj.evaluated_get(depsgraph)
    
    print(f"Evaluated object data type: {type(obj_eval.data)}")
    
    positions = []
    
    # Extract positions from point cloud
    if hasattr(obj_eval.data, 'points'):
        pointcloud = obj_eval.data
        num_points = len(pointcloud.points)
        print(f"Extracting {num_points} points from point cloud...")
        
        for i, point in enumerate(pointcloud.points):
            local_pos = point.co
            world_pos = obj_eval.matrix_world @ local_pos
            
            # Transform from Blender coords to Three.js coords
            x = world_pos.x
            y = world_pos.z   # Blender Z -> Three.js Y
            z = -world_pos.y  # Blender Y -> Three.js -Z
            
            positions.append((x, y, z))
            
            if (i + 1) % 100000 == 0:
                print(f"  Processed {i + 1} points...")
    
    # Fallback: mesh vertices
    elif hasattr(obj_eval.data, 'vertices'):
        mesh = obj_eval.data
        num_verts = len(mesh.vertices)
        print(f"Extracting {num_verts} vertices...")
        
        for i, vert in enumerate(mesh.vertices):
            world_pos = obj_eval.matrix_world @ vert.co
            
            x = world_pos.x
            y = world_pos.z
            z = -world_pos.y
            
            positions.append((x, y, z))
            
            if (i + 1) % 100000 == 0:
                print(f"  Processed {i + 1} vertices...")
    
    else:
        print(f"ERROR: Cannot extract positions from '{obj.name}'")
        return
    
    if not positions:
        print("ERROR: No positions found!")
        return
    
    print(f"\nTotal positions: {len(positions)}")
    
    # Decimate positions (keep every Nth position)
    if CONFIG['decimation_factor'] > 1:
        original_count = len(positions)
        positions = positions[::CONFIG['decimation_factor']]
        print(f"Decimated: {original_count} -> {len(positions)} positions (factor: {CONFIG['decimation_factor']})")
    
    # Build spatial grid
    print(f"\nBuilding spatial grid (cell size: {CONFIG['cell_size']}m)...")
    
    grid = defaultdict(list)
    min_x = min_z = float('inf')
    max_x = max_z = float('-inf')
    
    for i, (x, y, z) in enumerate(positions):
        # Track bounds
        min_x = min(min_x, x)
        max_x = max(max_x, x)
        min_z = min(min_z, z)
        max_z = max(max_z, z)
        
        # Assign to grid cell
        cell_x = int(x // CONFIG['cell_size'])
        cell_z = int(z // CONFIG['cell_size'])
        grid[(cell_x, cell_z)].append((x, y, z))
        
        if (i + 1) % 100000 == 0:
            print(f"  Assigned {i + 1} positions to grid...")
    
    num_cells = len(grid)
    print(f"\nGrid built: {num_cells} cells")
    print(f"Bounds: X[{min_x:.1f}, {max_x:.1f}], Z[{min_z:.1f}, {max_z:.1f}]")
    
    # Calculate statistics
    cell_counts = [len(positions) for positions in grid.values()]
    avg_per_cell = sum(cell_counts) / len(cell_counts)
    max_per_cell = max(cell_counts)
    min_per_cell = min(cell_counts)
    
    print(f"Positions per cell: avg={avg_per_cell:.0f}, min={min_per_cell}, max={max_per_cell}")
    
    # Write binary file
    print(f"\nWriting binary file...")
    
    """
    Binary format:
    - Header:
      - cell_size: float32
      - min_x, max_x, min_z, max_z: float32 x 4
      - num_cells: uint32
    
    - For each cell:
      - cell_x, cell_z: int32 x 2
      - num_positions: uint32
      - positions: float32 x 3 x num_positions
    """
    
    with open(CONFIG['output_file'], 'wb') as f:
        # Write header
        f.write(struct.pack('<f', CONFIG['cell_size']))
        f.write(struct.pack('<ffff', min_x, max_x, min_z, max_z))
        f.write(struct.pack('<I', num_cells))
        
        # Write cells
        for (cell_x, cell_z), cell_positions in sorted(grid.items()):
            f.write(struct.pack('<ii', cell_x, cell_z))
            f.write(struct.pack('<I', len(cell_positions)))
            
            for x, y, z in cell_positions:
                f.write(struct.pack('<fff', x, y, z))
    
    file_size = os.path.getsize(CONFIG['output_file'])
    print(f"\n{'='*60}")
    print(f"EXPORT COMPLETE!")
    print(f"{'='*60}")
    print(f"Total positions: {len(positions)}")
    print(f"Grid cells: {num_cells}")
    print(f"Cell size: {CONFIG['cell_size']}m")
    print(f"File size: {file_size / (1024*1024):.2f} MB")
    print(f"Output: {CONFIG['output_file']}")
    print(f"{'='*60}\n")



# ===== RUN EXPORT =====
if __name__ == "__main__":
    export_grass_positions()

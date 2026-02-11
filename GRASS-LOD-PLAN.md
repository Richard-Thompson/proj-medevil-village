# Grass LOD 60fps Plan

## Assumptions
- 1 unit = 1m
- Target: stable 60fps on desktop (adjustable)

## Plan
1. **Lock constraints**
   1. Decide target device class, typical camera height, and max grass draw distance.
   2. Set budget targets: max visible clumps, total instance count, and max GPU time for grass (e.g. 3–5ms).

2. **Define LOD bands**
   1. Near: `0–15m` = real blades/clumps (dense).
   2. Mid: `15–45m` = clumps only (lighter mesh, cheaper shader).
   3. Far: `45m+` = no geometry, terrain shader only.
   4. Keep cutoffs data-driven (config).

3. **Clump assets + instance data**
   1. Build 2–3 clump meshes (dense + light).
   2. Pack per‑instance attributes: random height/lean/width, tint, wind phase, seed.
   3. Export clump instance data by tile (positions + attributes).

4. **Near + mid rendering**
   1. Use GPU instancing only.
   2. Alpha‑clip, no blending.
   3. Wind in vertex shader (phase per instance).
   4. Spec/roughness breakup for “alive” shimmer.

5. **Far rendering (terrain shader)**
   1. Add grass coverage signal (noise or baked mask).
   2. Add “fur normal”/anisotropic normal blend.
   3. Add horizon sparkle (view‑dependent spec term).
   4. Animate coverage/normal with wind advection.

6. **Transition system**
   1. Dithered cross‑fade at band boundaries (no alpha blending).
   2. Far shader increases “grassness” as mid fades out.

7. **Streaming & culling**
   1. Tile‑based ring buffer around camera.
   2. Frustum + distance culling per tile.
   3. Optional: density falloff by distance.

8. **Performance instrumentation**
   1. GPU timing for grass pass(es).
   2. Track instance counts per band.
   3. Verify draw calls and memory use.

9. **Tuning pass**
   1. Adjust band cutoffs and density until 60fps target.
   2. Validate look (silhouette, shimmer, wind coherence).

## Deliverables
- Configurable LOD band distances + budgets.
- Instanced clump renderer (near/mid).
- Terrain shader “far grassness”.
- Dithered transition system.
- Performance dashboard (counts + GPU time).
---

## Implementation Plan

### Phase 1: Blender Export Script

**Export Script (`export-grass-instances-blender.py`)**

```python
# Goal: Export grass instance positions from particle system or vertex group
# Output format: Binary file with instance data

import bpy
import struct
import numpy as np

def export_grass_instances(obj_name, output_path):
    """
    Extract grass positions from Blender object (particle system or vertices)
    """
    obj = bpy.data.objects[obj_name]
    
    # Option A: From particle system (if using particles for distribution)
    if obj.particle_systems:
        psys = obj.particle_systems[0]
        instances = []
        
        for particle in psys.particles:
            pos = particle.location
            # Generate deterministic random seed from position
            seed = hash((round(pos.x, 3), round(pos.y, 3), round(pos.z, 3))) & 0xFFFF
            
            instances.append({
                'x': pos.x,
                'y': pos.y,
                'z': pos.z,
                'seed': seed,  # For deterministic culling
                'scale': 0.8 + (seed % 100) / 250.0,  # 0.8-1.2 variation
                'rotation': (seed % 360) * 0.017453  # Random Y rotation in radians
            })
    
    # Option B: From vertices (if using mesh vertices for distribution)
    else:
        mesh = obj.data
        instances = []
        
        for vert in mesh.vertices:
            pos = obj.matrix_world @ vert.co
            seed = hash((round(pos.x, 3), round(pos.y, 3), round(pos.z, 3))) & 0xFFFF
            
            instances.append({
                'x': pos.x,
                'y': pos.y,
                'z': pos.z,
                'seed': seed,
                'scale': 0.8 + (seed % 100) / 250.0,
                'rotation': (seed % 360) * 0.017453
            })
    
    # Write binary format
    # Header: count(u32), bmin(f32*3), bmax(f32*3)
    # Per instance: x,y,z(f32*3), seed(u16), scale(f32), rotation(f32)
    
    positions = np.array([[i['x'], i['y'], i['z']] for i in instances], dtype=np.float32)
    bmin = positions.min(axis=0)
    bmax = positions.max(axis=0)
    
    with open(output_path, 'wb') as f:
        # Header
        f.write(struct.pack('I', len(instances)))  # count
        f.write(struct.pack('fff', *bmin))         # bounding box min
        f.write(struct.pack('fff', *bmax))         # bounding box max
        
        # Instance data
        for inst in instances:
            f.write(struct.pack('fff', inst['x'], inst['y'], inst['z']))
            f.write(struct.pack('H', inst['seed']))
            f.write(struct.pack('ff', inst['scale'], inst['rotation']))
    
    print(f"Exported {len(instances)} grass instances to {output_path}")
    return len(instances)

# Usage
export_grass_instances('GrassScatterPlane', '/tmp/grass-instances.bin')
```

**Tile-Based Export (for large worlds)**

```python
def export_grass_by_tiles(obj_name, tile_size=50, output_dir='/tmp/grass-tiles/'):
    """
    Split instances into spatial tiles for streaming
    """
    import os
    os.makedirs(output_dir, exist_ok=True)
    
    # Get all instances
    instances = get_all_instances(obj_name)  # same logic as above
    
    # Group by tile
    tiles = {}
    for inst in instances:
        tx = int(inst['x'] // tile_size)
        tz = int(inst['z'] // tile_size)
        key = (tx, tz)
        
        if key not in tiles:
            tiles[key] = []
        tiles[key].append(inst)
    
    # Write each tile
    for (tx, tz), tile_instances in tiles.items():
        filename = f"grass_tile_{tx}_{tz}.bin"
        write_tile(os.path.join(output_dir, filename), tile_instances)
    
    print(f"Exported {len(tiles)} tiles with {len(instances)} total instances")
```

---

### Phase 2: R3F Close/Mid Range Rendering

**Component Structure**

```typescript
// src/components/GrassLODSystem.tsx

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { useControls } from 'leva';

interface GrassInstance {
  x: number;
  y: number;
  z: number;
  seed: number;
  scale: number;
  rotation: number;
}

export function GrassLODSystem() {
  const nearMeshRef = useRef<InstancedMesh>(null);
  const midMeshRef = useRef<InstancedMesh>(null);
  
  // Leva controls for real-time tweaking
  const config = useControls('Grass LOD', {
    nearDistance: { value: 15, min: 5, max: 50, step: 1 },
    midDistance: { value: 45, min: 15, max: 150, step: 5 },
    nearDensity: { value: 1.0, min: 0.1, max: 1.0, step: 0.1 },
    midDensity: { value: 0.3, min: 0.05, max: 1.0, step: 0.05 },
    windSpeed: { value: 1.0, min: 0, max: 3, step: 0.1 },
    windStrength: { value: 0.5, min: 0, max: 2, step: 0.1 },
    debugShowBands: false,
  });
  
  // Load grass instance data
  const instances = useMemo(() => {
    // TODO: Fetch and parse grass-instances.bin
    // For now, return dummy data
    return [] as GrassInstance[];
  }, []);
  
  // Update instances per frame based on camera distance
  useFrame(({ camera }) => {
    const cameraPos = new Vector3();
    camera.getWorldPosition(cameraPos);
    
    const matrix = new Matrix4();
    const position = new Vector3();
    
    let nearCount = 0;
    let midCount = 0;
    
    instances.forEach((inst) => {
      position.set(inst.x, inst.y, inst.z);
      const distance = cameraPos.distanceTo(position);
      
      // Deterministic culling based on seed and density setting
      const shouldShowNear = (inst.seed % 100) < (config.nearDensity * 100);
      const shouldShowMid = (inst.seed % 100) < (config.midDensity * 100);
      
      // Near band (0-15m)
      if (distance < config.nearDistance && shouldShowNear) {
        matrix.makeRotationY(inst.rotation);
        matrix.setPosition(inst.x, inst.y, inst.z);
        matrix.scale(new Vector3(inst.scale, inst.scale, inst.scale));
        nearMeshRef.current?.setMatrixAt(nearCount++, matrix);
      }
      
      // Mid band (15-45m)
      else if (distance < config.midDistance && shouldShowMid) {
        matrix.makeRotationY(inst.rotation);
        matrix.setPosition(inst.x, inst.y, inst.z);
        matrix.scale(new Vector3(inst.scale, inst.scale, inst.scale));
        midMeshRef.current?.setMatrixAt(midCount++, matrix);
      }
    });
    
    if (nearMeshRef.current) {
      nearMeshRef.current.count = nearCount;
      nearMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    
    if (midMeshRef.current) {
      midMeshRef.current.count = midCount;
      midMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  });
  
  return (
    <>
      {/* Near LOD - Dense grass mesh */}
      <instancedMesh ref={nearMeshRef} args={[undefined, undefined, 10000]}>
        <planeGeometry args={[0.1, 0.3, 1, 3]} /> {/* TODO: Real grass mesh */}
        <meshStandardMaterial color="#4a7c3e" side={2} />
      </instancedMesh>
      
      {/* Mid LOD - Simplified grass mesh */}
      <instancedMesh ref={midMeshRef} args={[undefined, undefined, 10000]}>
        <planeGeometry args={[0.1, 0.3, 1, 1]} /> {/* Simpler geometry */}
        <meshBasicMaterial color="#5a8c4e" side={2} />
      </instancedMesh>
    </>
  );
}
```

**Binary Loader Utility**

```typescript
// src/utils/grassLoader.ts

export async function loadGrassInstances(url: string) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  
  let offset = 0;
  
  // Read header
  const count = view.getUint32(offset, true);
  offset += 4;
  
  const bmin = [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ];
  offset += 12;
  
  const bmax = [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ];
  offset += 12;
  
  // Read instances
  const instances = [];
  for (let i = 0; i < count; i++) {
    instances.push({
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
      seed: view.getUint16(offset + 12, true),
      scale: view.getFloat32(offset + 14, true),
      rotation: view.getFloat32(offset + 18, true),
    });
    offset += 22; // 3*4 + 2 + 2*4 bytes
  }
  
  return { instances, bmin, bmax, count };
}
```

---

### Next Steps

1. ✅ Install leva: `npm install leva`
2. ✅ Run Blender export script to generate grass-instances.bin
3. ✅ Create GrassLODSystem component
4. ✅ Integrate into Scene.tsx
5. ✅ Create proper grass clump meshes (2-3 blade cards)
6. ✅ Add wind animation shader
7. ✅ Optimize with frustum culling
"use client";

import { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { 
  InstancedMesh, 
  Matrix4, 
  Vector3,
  BoxGeometry,
  MeshBasicMaterial,
  Quaternion
} from 'three';
import { useControls } from 'leva';

// Pre-built spatial grid loaded from binary
interface SpatialGrid {
  cellSize: number;
  cells: Map<string, Float32Array>; // "x,z" -> positions (xyz floats)
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

async function loadSpatialGrid(url: string): Promise<SpatialGrid> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  
  console.log(`[SpatialGrid] File size: ${buffer.byteLength} bytes (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
  
  let offset = 0;
  
  // Read header
  const cellSize = view.getFloat32(offset, true); offset += 4;
  const minX = view.getFloat32(offset, true); offset += 4;
  const maxX = view.getFloat32(offset, true); offset += 4;
  const minZ = view.getFloat32(offset, true); offset += 4;
  const maxZ = view.getFloat32(offset, true); offset += 4;
  const numCells = view.getUint32(offset, true); offset += 4;
  
  console.log(`[SpatialGrid] Loading: ${numCells} cells, size ${cellSize}m`);
  console.log(`[SpatialGrid] Bounds: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}], Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
  console.log(`[SpatialGrid] Header size: 24 bytes, offset after header: ${offset}`);
  
  const cells = new Map<string, Float32Array>();
  let totalPositions = 0;
  
  // Read cells
  for (let i = 0; i < numCells; i++) {
    if (offset + 12 > buffer.byteLength) {
      console.error(`[SpatialGrid] ERROR: Cell ${i} header at offset ${offset} exceeds buffer size ${buffer.byteLength}`);
      break;
    }
    
    const cellX = view.getInt32(offset, true); offset += 4;
    const cellZ = view.getInt32(offset, true); offset += 4;
    const numPositions = view.getUint32(offset, true); offset += 4;
    
    const positionsBytes = numPositions * 3 * 4;
    if (offset + positionsBytes > buffer.byteLength) {
      console.error(`[SpatialGrid] ERROR: Cell ${i} (${cellX},${cellZ}) needs ${numPositions} positions (${positionsBytes} bytes) but only ${buffer.byteLength - offset} bytes remain`);
      break;
    }
    
    // Read positions for this cell
    const positions = new Float32Array(numPositions * 3);
    for (let j = 0; j < numPositions * 3; j++) {
      positions[j] = view.getFloat32(offset, true);
      offset += 4;
    }
    
    cells.set(`${cellX},${cellZ}`, positions);
    totalPositions += numPositions;
    
    if ((i + 1) % 100 === 0) {
      console.log(`  Loaded ${i + 1}/${numCells} cells... (offset: ${offset}/${buffer.byteLength})`);
    }
  }
  
  console.log(`[SpatialGrid] Loaded ${totalPositions} total positions in ${cells.size} cells`);
  console.log(`[SpatialGrid] Final offset: ${offset}, buffer size: ${buffer.byteLength}, ${buffer.byteLength - offset} bytes unused`);
  
  return { cellSize, cells, minX, maxX, minZ, maxZ };
}

function getCellsInRadius(grid: SpatialGrid, centerX: number, centerZ: number, radius: number): Float32Array[] {
  const cellArrays: Float32Array[] = [];
  const cellSize = grid.cellSize;
  
  const minCellX = Math.floor((centerX - radius) / cellSize);
  const maxCellX = Math.floor((centerX + radius) / cellSize);
  const minCellZ = Math.floor((centerZ - radius) / cellSize);
  const maxCellZ = Math.floor((centerZ + radius) / cellSize);
  
  for (let cx = minCellX; cx <= maxCellX; cx++) {
    for (let cz = minCellZ; cz <= maxCellZ; cz++) {
      const key = `${cx},${cz}`;
      const cellPositions = grid.cells.get(key);
      if (cellPositions) {
        cellArrays.push(cellPositions);
      }
    }
  }
  
  return cellArrays;
}

export function SimpleGrass() {
  const nearMeshRef = useRef<InstancedMesh>(null);
  const midMeshRef = useRef<InstancedMesh>(null);
  const [spatialGrid, setSpatialGrid] = useState<SpatialGrid | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const frameCount = useRef(0);

  const config = useControls('Simple Grass LOD', {
    enabled: true,
    yOffset: { value: 0, min: -50, max: 50, step: 0.5, label: 'Y Offset' },
    nearDistance: { value: 30, min: 10, max: 300, step: 5, label: 'Near Distance (m)' },
    midDistance: { value: 300, min: 50, max: 1000, step: 10, label: 'Mid Distance (m)' },
    nearDensity: { value: 6.0, min: 0.01, max: 6.0, step: 0.01, label: 'Near Density (high)' },
    midDensity: { value: 0.3, min: 0.01, max: 1.0, step: 0.01, label: 'Mid Density (low)' },
    nearSize: { value: 2.0, min: 0.1, max: 10, step: 0.1, label: 'Near Size' },
    midSize: { value: 3.0, min: 0.1, max: 10, step: 0.1, label: 'Mid Size' },    runtimeMultiplier: { value: 4, min: 1, max: 20, step: 1, label: 'Runtime Grass Multiplier' },
    spawnRadius: { value: 1.5, min: 0.1, max: 5, step: 0.1, label: 'Spawn Radius (m)' },  });

  // Create geometries and materials once
  const nearGeometry = useMemo(() => new BoxGeometry(0.5, 0.5, 0.5), []);
  const midGeometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  
  const nearMaterial = useMemo(() => new MeshBasicMaterial({ color: 'green' }), []);
  const midMaterial = useMemo(() => new MeshBasicMaterial({ color: 'yellow' }), []);

  // Load pre-built spatial grid (or fallback to old format)
  useEffect(() => {
    loadSpatialGrid('/grass-grid.bin')
      .then(grid => {
        setSpatialGrid(grid);
        
        // Count total positions
        let total = 0;
        for (const positions of grid.cells.values()) {
          total += positions.length / 3;
        }
        setTotalCount(total);
        
        console.log(`[SimpleGrass] Ready with ${total} positions in ${grid.cells.size} cells`);
      })
      .catch(err => {
        console.error('[SimpleGrass] Failed to load grid:', err);
        console.log('[SimpleGrass] The grass-grid.bin file is corrupted or in old format.');
        console.log('[SimpleGrass] Please run the updated spatial-grid-grass-export.py script in Blender.');
        console.log('[SimpleGrass] It will generate a new file with proper format and decimation (decimation_factor=20 for ~2M positions).');
      });
  }, []);

  // AAA LOD system: Static grass positions, dynamic LOD "mask" follows camera
  useFrame(({ camera }) => {
    if (!config.enabled || !spatialGrid || !nearMeshRef.current || !midMeshRef.current) return;

    frameCount.current++;
    
    // Update every 2 frames for performance (30 updates/sec)
    if (frameCount.current % 2 !== 0) return;

    const cameraPos = camera.position;
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    
    // Apply group rotation of -Math.PI/2 around X-axis
    quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    
    // LOD "mask" distances that follow camera
    const nearDistSq = config.nearDistance * config.nearDistance;
    const midDistSq = config.midDistance * config.midDistance;

    let nearCount = 0;
    let midCount = 0;

    const maxNearInstances = 150000;
    const maxMidInstances = 60000;

    // AAA APPROACH: Query cells, but use different sampling strategies
    // Near cells: check all positions (within near range)
    // Mid cells: sample sparsely (only check positions in mid range)
    const nearCells = getCellsInRadius(spatialGrid, cameraPos.x, cameraPos.z, config.nearDistance);
    const midCells = getCellsInRadius(spatialGrid, cameraPos.x, cameraPos.z, config.midDistance);

    let checkedCount = 0;

    // Check ALL positions in near cells (high density)
    for (const cellPositions of nearCells) {
      const numPositions = cellPositions.length / 3;
      
      for (let i = 0; i < numPositions; i++) {
        if (nearCount >= maxNearInstances) break;
        checkedCount++;
        
        const x = cellPositions[i * 3];
        const y = cellPositions[i * 3 + 1] + config.yOffset;
        const z = cellPositions[i * 3 + 2];

        const dx = x - cameraPos.x;
        const dz = z - cameraPos.z;
        const xzDistSq = dx * dx + dz * dz;
        
        if (xzDistSq > nearDistSq) continue;

        const dy = y - cameraPos.y;
        const distSq = xzDistSq + dy * dy;

        const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;

        if (distSq < nearDistSq && hash < config.nearDensity) {
          // Original position from bin file
          position.set(x, y, z);
          scale.set(config.nearSize, config.nearSize, config.nearSize);
          matrix.compose(position, quaternion, scale);
          nearMeshRef.current.setMatrixAt(nearCount++, matrix);
          
          // RUNTIME DENSITY BOOST: Spawn additional grass around each bin position
          for (let j = 1; j < config.runtimeMultiplier; j++) {
            if (nearCount >= maxNearInstances) break;
            
            // Deterministic random offset based on position + index
            const seed = x * 73856093 + z * 19349663 + j * 83492791;
            const rand1 = Math.abs(Math.sin(seed * 0.001) * 43758.5453) % 1;
            const rand2 = Math.abs(Math.sin(seed * 0.002) * 43758.5453) % 1;
            const rand3 = Math.abs(Math.sin(seed * 0.003) * 43758.5453) % 1;
            
            // Random offset within spawn radius
            const angle = rand1 * Math.PI * 2;
            const radius = rand2 * config.spawnRadius;
            const offsetX = Math.cos(angle) * radius;
            const offsetZ = Math.sin(angle) * radius;
            const offsetY = (rand3 - 0.5) * 0.5; // Small y variation
            
            position.set(x + offsetX, y + offsetY, z + offsetZ);
            scale.set(config.nearSize * (0.8 + rand3 * 0.4), config.nearSize * (0.8 + rand3 * 0.4), config.nearSize * (0.8 + rand3 * 0.4));
            matrix.compose(position, quaternion, scale);
            nearMeshRef.current.setMatrixAt(nearCount++, matrix);
          }
        }
      }
    }

    // Sample SPARSELY in mid cells (low density) - only check every 10th position
    const midStride = 10;
    for (const cellPositions of midCells) {
      const numPositions = cellPositions.length / 3;
      
      for (let i = 0; i < numPositions; i += midStride) {
        if (midCount >= maxMidInstances) break;
        checkedCount++;
        
        const x = cellPositions[i * 3];
        const y = cellPositions[i * 3 + 1] + config.yOffset;
        const z = cellPositions[i * 3 + 2];

        const dx = x - cameraPos.x;
        const dz = z - cameraPos.z;
        const xzDistSq = dx * dx + dz * dz;
        
        // Only mid range (exclude near range - already processed)
        if (xzDistSq <= nearDistSq || xzDistSq > midDistSq) continue;

        const dy = y - cameraPos.y;
        const distSq = xzDistSq + dy * dy;

        const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;

        if (hash < config.midDensity) {
          position.set(x, y, z);
          scale.set(config.midSize, config.midSize, config.midSize);
          matrix.compose(position, quaternion, scale);
          midMeshRef.current.setMatrixAt(midCount++, matrix);
        }
      }
    }

    // Update instance counts
    nearMeshRef.current.count = nearCount;
    nearMeshRef.current.instanceMatrix.needsUpdate = true;
    
    midMeshRef.current.count = midCount;
    midMeshRef.current.instanceMatrix.needsUpdate = true;

    // Debug log
    if (frameCount.current <= 6 || frameCount.current % 120 === 0) {
      const nearFilled = ((nearCount / maxNearInstances) * 100).toFixed(1);
      const midFilled = ((midCount / maxMidInstances) * 100).toFixed(1);
      console.log(
        `[SimpleGrass] Cam: (${cameraPos.x.toFixed(1)}, ${cameraPos.y.toFixed(1)}, ${cameraPos.z.toFixed(1)}) | ` +
        `Near: ${nearCount}/${maxNearInstances} (${nearFilled}%), Mid: ${midCount}/${maxMidInstances} (${midFilled}%) | ` +
        `Checked: ${checkedCount} positions | Near cells: ${nearCells.length}, Mid cells: ${midCells.length}`
      );
    }
  });

  if (!spatialGrid || totalCount === 0) {
    return null;
  }

  // AAA budgets: Near=150k, Mid=60k (Far is material-only, no geometry)
  const maxNearInstances = 150000;
  const maxMidInstances = 60000;

  return (
    <>
      {/* Near LOD (0-15m): THICK green cubes */}
      <instancedMesh 
        ref={nearMeshRef} 
        args={[nearGeometry, nearMaterial, maxNearInstances]} 
        frustumCulled={false}
      />
      
      {/* Mid LOD (15-40m): SPARSE yellow cubes */}
      <instancedMesh 
        ref={midMeshRef} 
        args={[midGeometry, midMaterial, maxMidInstances]} 
        frustumCulled={false}
      />
      
      {/* Far LOD (40m+): NO GEOMETRY - handled by terrain material shader with:
          - Coverage map (albedo tint, roughness variation)
          - Fur normal trick (anisotropic normal for vertical structure)
          - Horizon sparkle (view-dependent spec at grazing angles)
          - Wind animation (advecting normals/spec, no geometry)
      */}
    </>
  );
}

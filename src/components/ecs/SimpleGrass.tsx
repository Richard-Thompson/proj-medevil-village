"use client";

import { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { 
  InstancedMesh, 
  Matrix4, 
  Vector3,
  BoxGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  BufferGeometry,
  Texture
} from 'three';
import { useControls } from 'leva';
import { useGLTF } from '@react-three/drei';

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
  const lastCameraPos = useRef(new Vector3());
  const updateThreshold = 2.0; // Only update when camera moves 2m
  const lastConfig = useRef<typeof config | null>(null);

  // Load grass model (texture is embedded in GLB)
  const grassModel = useGLTF('/models/good-grass-1.1.glb');
  
  // Get grass geometry and material from model
  const { grassGeometry, grassMaterial } = useMemo(() => {
    if (grassModel && grassModel.scene) {
      const mesh = grassModel.scene.children[0] as any;
      if (mesh && mesh.geometry && mesh.material) {
        console.log('[SimpleGrass] Loaded grass model');
        
        // Clone material to avoid modifying original
        const mat = mesh.material.clone();
        mat.side = 2; // DoubleSide for instancing
        mat.alphaTest = 0.5; // Enable alpha clipping for transparency
        
        return { 
          grassGeometry: mesh.geometry,
          grassMaterial: mat
        };
      }
    }
    // Fallback
    console.warn('[SimpleGrass] Model not loaded, using fallback');
    return {
      grassGeometry: new BoxGeometry(0.5, 2, 0.1),
      grassMaterial: new MeshStandardMaterial({ color: 0x4a7c4a, side: 2 })
    };
  }, [grassModel]);

  const config = useControls('Simple Grass LOD', {
    enabled: true,
    nearDistance: { value: 243, min: 0, max: 300, step: 5, label: 'Near Distance (m)' },
    midDistance: { value: 50, min: 50, max: 1000, step: 10, label: 'Mid Distance (m)' },
    nearDensity: { value: 3.00, min: 0.01, max: 6.0, step: 0.01, label: 'Near Density (high)' },
    midDensity: { value: 10.0, min: 0.01, max: 10.0, step: 0.01, label: 'Mid Density (low)' },
    nearSize: { value: 1.79, min: 0.01, max: 10, step: 0.01, label: 'Near Size' },
    midSize: { value: 1.79, min: 0.01, max: 10, step: 0.01, label: 'Mid Size' },
    runtimeMultiplier: { value: 1, min: 1, max: 200, step: 1, label: 'Runtime Grass Multiplier' },
    spawnRadius: { value: 0.8, min: 0.1, max: 3, step: 0.1, label: 'Spawn Radius (m)' },
  });

  // Use original material from GLB for both LODs
  const nearMaterial = grassMaterial;
  const midMaterial = grassMaterial;

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
    
    // Check if any config values changed
    const configChanged = !lastConfig.current || 
      lastConfig.current.nearDistance !== config.nearDistance ||
      lastConfig.current.midDistance !== config.midDistance ||
      lastConfig.current.nearDensity !== config.nearDensity ||
      lastConfig.current.midDensity !== config.midDensity ||
      lastConfig.current.nearSize !== config.nearSize ||
      lastConfig.current.midSize !== config.midSize ||
      lastConfig.current.runtimeMultiplier !== config.runtimeMultiplier ||
      lastConfig.current.spawnRadius !== config.spawnRadius;
    
    // Early exit if camera hasn't moved much AND config unchanged (40fps boost)
    const cameraDist = cameraPos.distanceTo(lastCameraPos.current);
    if (!configChanged && cameraDist < updateThreshold && frameCount.current > 20) return;
    
    lastCameraPos.current.copy(cameraPos);
    lastConfig.current = { ...config };
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    
    // No rotation - keep grass upright as exported from Blender/GLB
    quaternion.set(0, 0, 0, 1);
    
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

    // Adaptive stride for near LOD - check fewer positions when at high capacity
    const nearCapacityRatio = nearCount / maxNearInstances;
    const nearStride = nearCapacityRatio > 0.8 ? 3 : (nearCapacityRatio > 0.5 ? 2 : 1);

    // Check positions in near cells
    for (const cellPositions of nearCells) {
      const numPositions = cellPositions.length / 3;
      
      for (let i = 0; i < numPositions; i += nearStride) {
        if (nearCount >= maxNearInstances) break;
        checkedCount++;
        
        const x = cellPositions[i * 3];
        const y = cellPositions[i * 3 + 1];
        const z = cellPositions[i * 3 + 2];

        const dx = x - cameraPos.x;
        const dz = z - cameraPos.z;
        const xzDistSq = dx * dx + dz * dz;
        
        if (xzDistSq > nearDistSq) continue;

        const dy = y - cameraPos.y;
        const distSq = xzDistSq + dy * dy;
        const dist = Math.sqrt(distSq);

        // Continuous gradient: thick close (max density) -> sparse far (min density)
        const maxDensity = Math.max(config.nearDensity, config.midDensity);
        const minDensity = Math.min(config.nearDensity, config.midDensity);
        
        const distRatio = Math.min(1.0, dist / config.midDistance);
        const smoothRatio = distRatio * distRatio * (3.0 - 2.0 * distRatio); // Smoothstep
        let densityTarget = maxDensity * (1.0 - smoothRatio) + minDensity * smoothRatio;
        
        // Fade to zero beyond midDistance
        if (dist > config.midDistance) {
          const fadeT = Math.min(1.0, (dist - config.midDistance) / 100.0);
          const smoothFade = fadeT * fadeT * (3.0 - 2.0 * fadeT);
          densityTarget = densityTarget * (1.0 - smoothFade);
        }
        
        // Runtime multiplier also falls off with distance - amplifies the density gradient
        const multiplierFactor = config.runtimeMultiplier * (1.0 - smoothRatio);
        const effectiveMultiplier = Math.max(1, multiplierFactor);
        
        const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        
        // AAA smooth fade: use hash margin to determine fade amount
        const fadeMargin = 0.1; // 10% margin for smooth fade
        const hashDiff = densityTarget - hash;
        
        if (hashDiff > 0) { // Blade is visible
          // Calculate fade factor: 0 at threshold, 1.0 when well within margin
          const fadeFactor = Math.min(1.0, hashDiff / fadeMargin);
          const smoothFade = fadeFactor * fadeFactor * (3.0 - 2.0 * fadeFactor); // Smoothstep
          
          if (distSq < nearDistSq && smoothFade > 0.01) { // Only render if visible enough
            // Original position from bin file
            position.set(x, y, z);
            // Apply smooth fade to scale for AAA-style appearance
            const fadeScale = config.nearSize * smoothFade;
            scale.set(fadeScale, fadeScale, fadeScale);
            matrix.compose(position, quaternion, scale);
            nearMeshRef.current.setMatrixAt(nearCount++, matrix);
            
            // RUNTIME DENSITY BOOST: Use pre-calculated multiplier
            // Limit spawns when near capacity
            const effectiveMultiplierInt = Math.floor(effectiveMultiplier);
            const remainingSlots = maxNearInstances - nearCount;
            const spawnCount = Math.min(effectiveMultiplierInt - 1, remainingSlots);
            
            for (let j = 1; j <= spawnCount; j++) {
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
              
              position.set(x + offsetX, y, z + offsetZ);
              scale.set(fadeScale, fadeScale, fadeScale);
              matrix.compose(position, quaternion, scale);
              nearMeshRef.current.setMatrixAt(nearCount++, matrix);
            }
          }
        }
      }
    }

    // Sample SPARSELY in mid cells (low density) - only check every 15th position
    const midStride = 15;
    for (const cellPositions of midCells) {
      const numPositions = cellPositions.length / 3;
      
      for (let i = 0; i < numPositions; i += midStride) {
        if (midCount >= maxMidInstances) break;
        checkedCount++;
        
        const x = cellPositions[i * 3];
        const y = cellPositions[i * 3 + 1];
        const z = cellPositions[i * 3 + 2];

        const dx = x - cameraPos.x;
        const dz = z - cameraPos.z;
        const xzDistSq = dx * dx + dz * dz;
        
        // Only mid range (exclude near range - already processed)
        if (xzDistSq <= nearDistSq || xzDistSq > midDistSq) continue;

        const dy = y - cameraPos.y;
        const distSq = xzDistSq + dy * dy;
        const dist = Math.sqrt(distSq);

        // Same continuous gradient: max density close, min density far
        const maxDensity = Math.max(config.nearDensity, config.midDensity);
        const minDensity = Math.min(config.nearDensity, config.midDensity);
        
        const distRatio = Math.min(1.0, dist / config.midDistance);
        const smoothRatio = distRatio * distRatio * (3.0 - 2.0 * distRatio);
        let densityTarget = maxDensity * (1.0 - smoothRatio) + minDensity * smoothRatio;
        
        if (dist > config.midDistance) {
          const fadeT = Math.min(1.0, (dist - config.midDistance) / 100.0);
          const smoothFade = fadeT * fadeT * (3.0 - 2.0 * fadeT);
          densityTarget = densityTarget * (1.0 - smoothFade);
        }
        
        // Runtime multiplier also falls off with distance in mid range
        const multiplierFactor = config.runtimeMultiplier * (1.0 - smoothRatio);
        const effectiveMultiplier = Math.max(1, multiplierFactor);
        
        const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;

        // AAA smooth fade
        const fadeMargin = 0.15; // Slightly larger margin for mid LOD
        const hashDiff = densityTarget - hash;
        
        if (hashDiff > 0) {
          const fadeFactor = Math.min(1.0, hashDiff / fadeMargin);
          const smoothFade = fadeFactor * fadeFactor * (3.0 - 2.0 * fadeFactor);
          
          if (smoothFade > 0.01) {
          position.set(x, y, z);
          const fadeScale = config.midSize * smoothFade;
          scale.set(fadeScale, fadeScale, fadeScale);
          matrix.compose(position, quaternion, scale);
          midMeshRef.current.setMatrixAt(midCount++, matrix);
          
          // Spawn additional grass with gradient multiplier (same as near LOD)
          const effectiveMultiplierInt = Math.floor(effectiveMultiplier);
          const remainingSlots = maxMidInstances - midCount;
          const spawnCount = Math.min(effectiveMultiplierInt - 1, remainingSlots);
          
          for (let j = 1; j <= spawnCount; j++) {
            if (midCount >= maxMidInstances) break;
            
            const seed = x * 73856093 + z * 19349663 + j * 83492791;
            const rand1 = Math.abs(Math.sin(seed * 0.001) * 43758.5453) % 1;
            const rand2 = Math.abs(Math.sin(seed * 0.002) * 43758.5453) % 1;
            
            const angle = rand1 * Math.PI * 2;
            const radius = rand2 * config.spawnRadius;
            const offsetX = Math.cos(angle) * radius;
            const offsetZ = Math.sin(angle) * radius;
            
            position.set(x + offsetX, y, z + offsetZ);
            scale.set(fadeScale, fadeScale, fadeScale);
            matrix.compose(position, quaternion, scale);
            midMeshRef.current.setMatrixAt(midCount++, matrix);
            }
          }
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
      {/* Near LOD: Dense grass blades */}
      <instancedMesh 
        ref={nearMeshRef} 
        args={[grassGeometry, nearMaterial, maxNearInstances]} 
        frustumCulled={false}
      />
      
      {/* Mid LOD: Sparse grass blades */}
      <instancedMesh 
        ref={midMeshRef} 
        args={[grassGeometry, midMaterial, maxMidInstances]} 
        frustumCulled={false}
      />
      
      {/* Far LOD (300m+): NO GEOMETRY - handled by terrain material shader with:
          - Coverage map (albedo tint, roughness variation)
          - Fur normal trick (anisotropic normal for vertical structure)
          - Horizon sparkle (view-dependent spec at grazing angles)
          - Wind animation (advecting normals/spec, no geometry)
      */}
    </>
  );
}

"use client";

import ECSLoop from "@/components/ecs/systems/ECSLoop";
import { InstancedTriangles } from "@/components/ecs/InstancedTriangles";
import { ECS } from "@react-ecs/core";
import { ContactShadows, Environment, PointerLockControls, Stats } from "@react-three/drei";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useEffect, useState, useRef } from "react";
import { Vector3 } from "three";

// Ray-triangle intersection
function rayTriangleIntersect(
  rayOrigin: Vector3,
  rayDir: Vector3,
  v0: Vector3,
  v1: Vector3,
  v2: Vector3
): number | null {
  const EPSILON = 0.0000001;
  const edge1 = new Vector3().subVectors(v1, v0);
  const edge2 = new Vector3().subVectors(v2, v0);
  const h = new Vector3().crossVectors(rayDir, edge2);
  const a = edge1.dot(h);

  if (a > -EPSILON && a < EPSILON) return null;

  const f = 1.0 / a;
  const s = new Vector3().subVectors(rayOrigin, v0);
  const u = f * s.dot(h);

  if (u < 0.0 || u > 1.0) return null;

  const q = new Vector3().crossVectors(s, edge1);
  const v = f * rayDir.dot(q);

  if (v < 0.0 || u + v > 1.0) return null;

  const t = f * edge2.dot(q);

  if (t > EPSILON) return t;
  return null;
}

// Decode triangle from ITRI format and apply group rotation
function decodeTriangle(
  idx: number,
  v0_u16: Uint16Array,
  x_i16: Int16Array,
  y_i16: Int16Array,
  bmin: Vector3,
  bmax: Vector3,
  vecRange: number
): [Vector3, Vector3, Vector3] {
  const i = idx * 3;
  
  // Decode v0 from uint16 [0, 65535] to [bmin, bmax]
  const v0 = new Vector3(
    bmin.x + (v0_u16[i + 0] / 65535) * (bmax.x - bmin.x),
    bmin.y + (v0_u16[i + 1] / 65535) * (bmax.y - bmin.y),
    bmin.z + (v0_u16[i + 2] / 65535) * (bmax.z - bmin.z)
  );

  // Decode x and y vectors from int16 [-32768, 32767] to world space
  const x = new Vector3(
    (x_i16[i + 0] / 32767) * vecRange,
    (x_i16[i + 1] / 32767) * vecRange,
    (x_i16[i + 2] / 32767) * vecRange
  );

  const y = new Vector3(
    (y_i16[i + 0] / 32767) * vecRange,
    (y_i16[i + 1] / 32767) * vecRange,
    (y_i16[i + 2] / 32767) * vecRange
  );

  // Triangle vertices: v0, v0+x, v0+y
  let vert0 = v0.clone();
  let vert1 = v0.clone().add(x);
  let vert2 = v0.clone().add(y);

  // Apply group rotation: [-Math.PI / 2, 0, 0]
  // This rotates -90° around X-axis: (x, y, z) -> (x, z, -y)
  const applyRotation = (v: Vector3) => new Vector3(v.x, v.z, -v.y);
  vert0 = applyRotation(vert0);
  vert1 = applyRotation(vert1);
  vert2 = applyRotation(vert2);

  return [vert0, vert1, vert2];
}

// Global storage for terrain data
let terrainData: {
  count: number;
  v0_u16: Uint16Array;
  x_i16: Int16Array;
  y_i16: Int16Array;
  bmin: Vector3;
  bmax: Vector3;
  vecRange: number;
} | null = null;

// Octree node for spatial acceleration
class OctreeNode {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  triangles: number[] = [];
  children: OctreeNode[] | null = null;

  constructor(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.bounds = bounds;
  }
}

let octree: OctreeNode | null = null;

function buildOctree() {
  if (!terrainData) return;

  const { count, v0_u16, x_i16, y_i16, bmin, bmax, vecRange } = terrainData;
  
  console.log('Building octree for spatial acceleration...');
  
  // Find bounds by sampling
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i += 100) {
    const [v0, v1, v2] = decodeTriangle(i, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
    minX = Math.min(minX, v0.x, v1.x, v2.x);
    maxX = Math.max(maxX, v0.x, v1.x, v2.x);
    minZ = Math.min(minZ, v0.z, v1.z, v2.z);
    maxZ = Math.max(maxZ, v0.z, v1.z, v2.z);
  }

  octree = new OctreeNode({ minX, maxX, minZ, maxZ });
  
  // Insert all triangles (just indices, not decoded geometry)
  for (let i = 0; i < count; i++) {
    octree.triangles.push(i);
  }
  
  // Subdivide recursively
  subdivideOctree(octree, 0, 6); // Max depth 6
  
  console.log('Octree built!');
}

function subdivideOctree(node: OctreeNode, depth: number, maxDepth: number) {
  if (depth >= maxDepth || node.triangles.length < 500) return;

  const { minX, maxX, minZ, maxZ } = node.bounds;
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;

  // Create 4 children (quadtree in XZ plane)
  node.children = [
    new OctreeNode({ minX, maxX: midX, minZ, maxZ: midZ }),
    new OctreeNode({ minX: midX, maxX, minZ, maxZ: midZ }),
    new OctreeNode({ minX, maxX: midX, minZ: midZ, maxZ }),
    new OctreeNode({ minX: midX, maxX, minZ: midZ, maxZ })
  ];

  if (!terrainData) return;
  const { v0_u16, x_i16, y_i16, bmin, bmax, vecRange } = terrainData;

  // Distribute triangles to children
  for (const triIdx of node.triangles) {
    const [v0, v1, v2] = decodeTriangle(triIdx, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
    
    const tMinX = Math.min(v0.x, v1.x, v2.x);
    const tMaxX = Math.max(v0.x, v1.x, v2.x);
    const tMinZ = Math.min(v0.z, v1.z, v2.z);
    const tMaxZ = Math.max(v0.z, v1.z, v2.z);

    for (const child of node.children) {
      // Check if triangle overlaps child bounds
      if (tMaxX >= child.bounds.minX && tMinX <= child.bounds.maxX &&
          tMaxZ >= child.bounds.minZ && tMinZ <= child.bounds.maxZ) {
        child.triangles.push(triIdx);
      }
    }
  }

  // Clear parent triangles and subdivide children
  node.triangles = [];
  for (const child of node.children) {
    subdivideOctree(child, depth + 1, maxDepth);
  }
}

function queryOctree(x: number, z: number): number[] {
  if (!octree) return [];

  const result: number[] = [];
  const stack: OctreeNode[] = [octree];

  while (stack.length > 0) {
    const node = stack.pop()!;

    // Check if point is in bounds
    if (x < node.bounds.minX || x > node.bounds.maxX ||
        z < node.bounds.minZ || z > node.bounds.maxZ) {
      continue;
    }

    if (node.children) {
      stack.push(...node.children);
    } else {
      result.push(...node.triangles);
    }
  }

  return result;
}

function getTerrainHeightFast(x: number, z: number): number {
  if (!terrainData || !octree) return 2;

  const { v0_u16, x_i16, y_i16, bmin, bmax, vecRange } = terrainData;
  
  // Query octree for nearby triangles
  const nearbyTriangles = queryOctree(x, z);
  
  const rayOrigin = new Vector3(x, 450, z);
  const rayDir = new Vector3(0, -1, 0);
  
  let closestY = 2;
  let closestDist = Infinity;

  // Only test triangles from octree query
  for (const triIdx of nearbyTriangles) {
    const [v0, v1, v2] = decodeTriangle(triIdx, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
    
    const t = rayTriangleIntersect(rayOrigin, rayDir, v0, v1, v2);
    if (t !== null && t < closestDist) {
      closestDist = t;
      closestY = rayOrigin.y - t;
    }
  }

  return closestY;
}

function findTerrainHeight(x: number, z: number, searchRadius: number = 50): number | null {
  if (!terrainData) return null;

  const { count, v0_u16, x_i16, y_i16, bmin, bmax, vecRange } = terrainData;
  
  const rayOrigin = new Vector3(x, 450, z);
  const rayDir = new Vector3(0, -1, 0);

  let closestDist = Infinity;
  let closestY: number | null = null;

  for (let i = 0; i < count; i++) {
    const [v0, v1, v2] = decodeTriangle(i, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
    
    // Quick reject: check if triangle is too far from ray in XZ plane
    const maxX = Math.max(v0.x, v1.x, v2.x);
    const minX = Math.min(v0.x, v1.x, v2.x);
    const maxZ = Math.max(v0.z, v1.z, v2.z);
    const minZ = Math.min(v0.z, v1.z, v2.z);
    
    if (maxX < x - searchRadius || minX > x + searchRadius || 
        maxZ < z - searchRadius || minZ > z + searchRadius) {
      continue;
    }
    
    const t = rayTriangleIntersect(rayOrigin, rayDir, v0, v1, v2);
    
    if (t !== null && t < closestDist) {
      closestDist = t;
      closestY = rayOrigin.y - t;
    }
  }

  return closestY;
}

function FirstPersonController() {
  const { camera } = useThree();
  const velocity = useRef(new Vector3());
  const direction = useRef(new Vector3());
  const keys = useRef({ forward: false, backward: false, left: false, right: false });
  const cachedTerrainY = useRef<number>(2);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keys.current.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keys.current.backward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keys.current.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keys.current.right = true;
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keys.current.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keys.current.backward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keys.current.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keys.current.right = false;
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    if (!terrainData) return;

    const speed = 5; // units per second
    
    direction.current.set(0, 0, 0);

    // Get camera's forward and right vectors
    const forward = new Vector3();
    const right = new Vector3();
    
    camera.getWorldDirection(forward);
    forward.y = 0; // Keep movement horizontal
    forward.normalize();
    
    right.crossVectors(new Vector3(0, 1, 0), forward).normalize();

    // Build movement direction from WASD
    if (keys.current.forward) direction.current.add(forward);
    if (keys.current.backward) direction.current.sub(forward);
    if (keys.current.right) direction.current.add(right);
    if (keys.current.left) direction.current.sub(right);

    if (direction.current.length() > 0) {
      direction.current.normalize();
      
      // Update position
      velocity.current.copy(direction.current).multiplyScalar(speed * delta);
      camera.position.x += velocity.current.x;
      camera.position.z += velocity.current.z;
    }

    // Use octree-accelerated raycast - only tests ~100-500 triangles instead of millions
    const terrainY = getTerrainHeightFast(camera.position.x, camera.position.z);
    camera.position.y = terrainY + 2;
  });

  return null;
}

function CameraPositioner() {
  const { camera } = useThree();
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // Fetch and parse the data
        const res = await fetch('/data.bin.br');
        const ab = await res.arrayBuffer();
        
        const dv = new DataView(ab);
        const count = dv.getUint32(8, true);
        const flags = dv.getUint32(12, true);
        
        const v0Off = dv.getUint32(20, true);
        const xOff = dv.getUint32(24, true);
        const yOff = dv.getUint32(28, true);
        
        const bmin = new Vector3(
          dv.getFloat32(44, true),
          dv.getFloat32(48, true),
          dv.getFloat32(52, true)
        );
        const bmax = new Vector3(
          dv.getFloat32(56, true),
          dv.getFloat32(60, true),
          dv.getFloat32(64, true)
        );
        const vecRange = dv.getFloat32(68, true);
        
        const v0_u16 = new Uint16Array(ab, v0Off, count * 3);
        const x_i16 = new Int16Array(ab, xOff, count * 3);
        const y_i16 = new Int16Array(ab, yOff, count * 3);

        // Store terrain data globally for continuous raycasting
        terrainData = { count, v0_u16, x_i16, y_i16, bmin, bmax, vecRange };

        if (!alive) return;

        console.log(`Loaded ${count} triangles, starting raycast from y=450`);

        // Initial camera position raycast
        const rayOrigin = new Vector3(0, 450, 0);
        const rayDir = new Vector3(0, -1, 0);

        let closestDist = Infinity;
        let closestPoint: Vector3 | null = null;
        let testedCount = 0;

        const searchRadius = 50;
        
        for (let i = 0; i < count; i++) {
          const [v0, v1, v2] = decodeTriangle(i, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
          
          const maxX = Math.max(v0.x, v1.x, v2.x);
          const minX = Math.min(v0.x, v1.x, v2.x);
          const maxZ = Math.max(v0.z, v1.z, v2.z);
          const minZ = Math.min(v0.z, v1.z, v2.z);
          
          if (maxX < -searchRadius || minX > searchRadius || 
              maxZ < -searchRadius || minZ > searchRadius) {
            continue;
          }
          
          testedCount++;
          const t = rayTriangleIntersect(rayOrigin, rayDir, v0, v1, v2);
          
          if (t !== null && t < closestDist) {
            closestDist = t;
            closestPoint = rayOrigin.clone().add(rayDir.clone().multiplyScalar(t));
          }
        }
        
        console.log(`Tested ${testedCount} / ${count} triangles for initial position`);

        if (!alive) return;

        if (closestPoint) {
          console.log('Found intersection at:', closestPoint);
          const newCameraY = closestPoint.y + 2;
          camera.position.set(closestPoint.x, newCameraY, closestPoint.z);
          console.log('Camera positioned at:', camera.position);
        } else {
          camera.position.set(0, 2, 0);
        }

        // Build octree for fast spatial queries
        buildOctree();

        setDataLoaded(true);
      } catch (error) {
        console.error('Error during raycasting:', error);
        camera.position.set(0, 2, 0);
      }
    })();

    return () => {
      alive = false;
    };
  }, [camera]);

  return null;
}

export default function Scene() {
  const ecs = useMemo(() => new ECS(), []);
  const cameraProps = useMemo(() => ({ position: [0, 2, 0] as [number, number, number], fov: 75, near: 0.1, far: 5000 }), []);
  const dprProps = useMemo(() => [1, 1.5] as [number, number], []);
  const bgColor = useMemo(() => ["#0b0d12"] as [string], []);
  const groupRotation = useMemo(() => [-Math.PI / 2, 0, 0] as [number, number, number], []);
  const shadowPosition = useMemo(() => [0, -1.2, 0] as [number, number, number], []);
  const lightPosition = useMemo(() => [300, 400, 200] as [number, number, number], []);

  return (
    <Canvas
      className="h-full w-full"
      camera={cameraProps}
      shadows
      dpr={dprProps}
    >
      <color attach="background" args={bgColor} />
      <ambientLight intensity={.5} />
      <directionalLight position={lightPosition} intensity={0.1} />
      <Stats />
      <CameraPositioner />
      <FirstPersonController />
      <PointerLockControls minPolarAngle={Math.PI / 2} maxPolarAngle={Math.PI / 2} />

      <group rotation={groupRotation}>
        <Suspense fallback={null}>
          <ECSLoop ecs={ecs} />
          <InstancedTriangles url="/data.bin.br" textureUrl="/baked-textures/diffuse.webp" />
        </Suspense>
      </group>

      <ContactShadows position={shadowPosition} opacity={0.45} blur={2.8} scale={12} />
      <Environment preset="sunset" />
    </Canvas>
  );
}

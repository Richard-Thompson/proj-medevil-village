import { Vector3 } from "three";

// Terrain data storage and octree
let terrainData: {
  count: number;
  v0_u16: Uint16Array;
  x_i16: Int16Array;
  y_i16: Int16Array;
  bmin: Vector3;
  bmax: Vector3;
  vecRange: number;
} | null = null;

class OctreeNode {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  triangles: number[] = [];
  children: OctreeNode[] | null = null;

  constructor(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.bounds = bounds;
  }
}

let octree: OctreeNode | null = null;
let octreeReady = false;

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
  
  const v0 = new Vector3(
    bmin.x + (v0_u16[i + 0] / 65535) * (bmax.x - bmin.x),
    bmin.y + (v0_u16[i + 1] / 65535) * (bmax.y - bmin.y),
    bmin.z + (v0_u16[i + 2] / 65535) * (bmax.z - bmin.z)
  );

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

function subdivideOctree(node: OctreeNode, depth: number, maxDepth: number) {
  if (depth >= maxDepth || node.triangles.length < 500) return;

  const { minX, maxX, minZ, maxZ } = node.bounds;
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;

  node.children = [
    new OctreeNode({ minX, maxX: midX, minZ, maxZ: midZ }),
    new OctreeNode({ minX: midX, maxX, minZ, maxZ: midZ }),
    new OctreeNode({ minX, maxX: midX, minZ: midZ, maxZ }),
    new OctreeNode({ minX: midX, maxX, minZ: midZ, maxZ })
  ];

  if (!terrainData) return;
  const { v0_u16, x_i16, y_i16, bmin, bmax, vecRange } = terrainData;

  for (const triIdx of node.triangles) {
    const [v0, v1, v2] = decodeTriangle(triIdx, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
    
    const tMinX = Math.min(v0.x, v1.x, v2.x);
    const tMaxX = Math.max(v0.x, v1.x, v2.x);
    const tMinZ = Math.min(v0.z, v1.z, v2.z);
    const tMaxZ = Math.max(v0.z, v1.z, v2.z);

    for (const child of node.children) {
      if (tMaxX >= child.bounds.minX && tMinX <= child.bounds.maxX &&
          tMaxZ >= child.bounds.minZ && tMinZ <= child.bounds.maxZ) {
        child.triangles.push(triIdx);
      }
    }
  }

  node.triangles = [];
  for (const child of node.children) {
    subdivideOctree(child, depth + 1, maxDepth);
  }
}

function queryOctree(x: number, z: number): number[] {
  if (!octree || !octreeReady) return [];

  const result: number[] = [];
  const stack: OctreeNode[] = [octree];

  while (stack.length > 0) {
    const node = stack.pop()!;

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

export function setTerrainData(data: {
  count: number;
  v0_u16: Uint16Array;
  x_i16: Int16Array;
  y_i16: Int16Array;
  bmin: Vector3;
  bmax: Vector3;
  vecRange: number;
}) {
  terrainData = data;
}

export function getTerrainData() {
  return terrainData;
}

export function buildTerrainOctree() {
  if (!terrainData) return;

  const { count, v0_u16, x_i16, y_i16, bmin, bmax, vecRange } = terrainData;
  
  console.log('Building octree for spatial acceleration...');
  
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i += 100) {
    const [v0, v1, v2] = decodeTriangle(i, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
    minX = Math.min(minX, v0.x, v1.x, v2.x);
    maxX = Math.max(maxX, v0.x, v1.x, v2.x);
    minZ = Math.min(minZ, v0.z, v1.z, v2.z);
    maxZ = Math.max(maxZ, v0.z, v1.z, v2.z);
  }

  octree = new OctreeNode({ minX, maxX, minZ, maxZ });
  
  for (let i = 0; i < count; i++) {
    octree.triangles.push(i);
  }
  
  subdivideOctree(octree, 0, 6);
  
  octreeReady = true;
  console.log('Octree built!');
}

export function isOctreeReady(): boolean {
  return octreeReady;
}

export function getTerrainHeightFromOctree(x: number, z: number, lastValidHeight: number = 2): number {
  if (!terrainData || !octree || !octreeReady) return lastValidHeight;

  const { v0_u16, x_i16, y_i16, bmin, bmax, vecRange } = terrainData;
  
  const nearbyTriangles = queryOctree(x, z);
  
  if (nearbyTriangles.length === 0) {
    return lastValidHeight;
  }
  
  const rayOrigin = new Vector3(x, 450, z);
  const rayDir = new Vector3(0, -1, 0);
  
  let closestY = null;
  let closestDist = Infinity;
  let minTriY = Infinity;
  let maxTriY = -Infinity;

  for (const triIdx of nearbyTriangles) {
    const [v0, v1, v2] = decodeTriangle(triIdx, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
    
    minTriY = Math.min(minTriY, v0.y, v1.y, v2.y);
    maxTriY = Math.max(maxTriY, v0.y, v1.y, v2.y);
    
    const t = rayTriangleIntersect(rayOrigin, rayDir, v0, v1, v2);
    if (t !== null && t < closestDist) {
      closestDist = t;
      closestY = rayOrigin.y - t;
    }
  }

  if (closestY === null) {
    if (nearbyTriangles.length > 0 && nearbyTriangles.length % 100 === 78) {
      console.warn(`Tested ${nearbyTriangles.length} triangles at (${x.toFixed(2)}, ${z.toFixed(2)}). Triangle Y range: [${minTriY.toFixed(2)}, ${maxTriY.toFixed(2)}]. Ray at Y=450`);
    }
    return lastValidHeight;
  }

  return closestY;
}

export function findTerrainHeight(x: number, z: number, searchRadius: number = 50): number | null {
  if (!terrainData) return null;

  const { count, v0_u16, x_i16, y_i16, bmin, bmax, vecRange } = terrainData;
  const rayOrigin = new Vector3(x, 450, z);
  const rayDir = new Vector3(0, -1, 0);

  let closestDist = Infinity;
  let closestY: number | null = null;

  for (let i = 0; i < count; i++) {
    const [v0, v1, v2] = decodeTriangle(i, v0_u16, x_i16, y_i16, bmin, bmax, vecRange);
    
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

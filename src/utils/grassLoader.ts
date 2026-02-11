/**
 * Grass instance loader utility
 * Loads binary grass tile data for LOD streaming
 */

export interface GrassInstance {
  x: number;
  y: number;
  z: number;
  seed: number;
  scale: number;
  rotation: number;
}

export interface GrassTileData {
  instances: GrassInstance[];
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  count: number;
}

export interface GrassManifest {
  tile_size: number;
  total_instances: number;
  tile_count: number;
  tiles: Array<{
    filename: string;
    tile_x: number;
    tile_z: number;
    instance_count: number;
    bounds: {
      min: number[];
      max: number[];
    };
  }>;
}

/**
 * Load grass tile binary data
 * Format: count(u32), bmin(f32*3), bmax(f32*3), instances[](xyz:f32*3, seed:u16, scale:f32, rotation:f32)
 */
export async function loadGrassTile(url: string): Promise<GrassTileData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load grass tile: ${url}`);
  }

  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);

  let offset = 0;

  // Read header
  const count = view.getUint32(offset, true);
  offset += 4;

  const bmin: [number, number, number] = [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ];
  offset += 12;

  const bmax: [number, number, number] = [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ];
  offset += 12;

  // Read instances (22 bytes each)
  const instances: GrassInstance[] = [];
  for (let i = 0; i < count; i++) {
    instances.push({
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
      seed: view.getUint16(offset + 12, true),
      scale: view.getFloat32(offset + 14, true),
      rotation: view.getFloat32(offset + 18, true),
    });
    offset += 22;
  }

  return {
    instances,
    bounds: { min: bmin, max: bmax },
    count,
  };
}

/**
 * Load grass manifest
 */
export async function loadGrassManifest(url: string = '/grass-tiles/manifest.json'): Promise<GrassManifest> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load grass manifest: ${url}`);
  }
  return response.json();
}

/**
 * Get visible tiles based on camera position and view distance
 */
export function getVisibleTiles(
  manifest: GrassManifest,
  cameraX: number,
  cameraZ: number,
  viewDistance: number
): Array<{ tile_x: number; tile_z: number; filename: string }> {
  const tileSize = manifest.tile_size;
  const cameraTileX = Math.floor(cameraX / tileSize);
  const cameraTileZ = Math.floor(cameraZ / tileSize);
  const tileRadius = Math.ceil(viewDistance / tileSize) + 1;

  const visible: Array<{ tile_x: number; tile_z: number; filename: string }> = [];

  for (const tile of manifest.tiles) {
    const dx = tile.tile_x - cameraTileX;
    const dz = tile.tile_z - cameraTileZ;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance <= tileRadius) {
      visible.push({
        tile_x: tile.tile_x,
        tile_z: tile.tile_z,
        filename: tile.filename,
      });
    }
  }

  return visible;
}

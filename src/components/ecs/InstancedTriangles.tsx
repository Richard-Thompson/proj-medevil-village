import * as THREE from "three";
import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

function makeUnitTriangleGeometry() {
  const g = new THREE.BufferGeometry();
  // unit tri: pos.x = w0, pos.y = w1, w2 = 1-w0-w1 (barycentric)
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
  );
  g.setIndex([0, 1, 2]);
  return g;
}

type ITRIData = {
  kind: "ITRI";
  count: number;
  flags: number;
  bmin: THREE.Vector3;
  bmax: THREE.Vector3;
  vecRange: number;
  v0_u16: Uint16Array; // count*3
  x_i16: Int16Array;   // count*3
  y_i16: Int16Array;   // count*3
  colors: Uint8Array | null; // count*4
  uvs: Float32Array | null;  // count*6 (uv0 uv1 uv2)
};

function readMagic(dv: DataView, o = 0) {
  return (
    String.fromCharCode(dv.getUint8(o + 0)) +
    String.fromCharCode(dv.getUint8(o + 1)) +
    String.fromCharCode(dv.getUint8(o + 2)) +
    String.fromCharCode(dv.getUint8(o + 3))
  );
}

function parseITRI(ab: ArrayBuffer): ITRIData {
  const dv = new DataView(ab);
  const magic = readMagic(dv, 0);
  if (magic !== "ITRI") throw new Error("Invalid ITRI magic");
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new Error(`Unsupported ITRI version ${version}`);

  const count = dv.getUint32(8, true);
  const flags = dv.getUint32(12, true);

  // const headerBytes = dv.getUint32(16, true);
  const v0Off = dv.getUint32(20, true);
  const xOff  = dv.getUint32(24, true);
  const yOff  = dv.getUint32(28, true);
  const cOff  = dv.getUint32(32, true);
  const uvOff = dv.getUint32(36, true);
  // reserved at 40

  const bmin = new THREE.Vector3(
    dv.getFloat32(44, true),
    dv.getFloat32(48, true),
    dv.getFloat32(52, true)
  );
  const bmax = new THREE.Vector3(
    dv.getFloat32(56, true),
    dv.getFloat32(60, true),
    dv.getFloat32(64, true)
  );
  const vecRange = dv.getFloat32(68, true);

  const v0_u16 = new Uint16Array(ab, v0Off, count * 3);
  const x_i16  = new Int16Array(ab, xOff, count * 3);
  const y_i16  = new Int16Array(ab, yOff, count * 3);

  const hasColor = (flags & 1) !== 0;
  const hasUvs = (flags & 2) !== 0;
  const colors = hasColor && cOff ? new Uint8Array(ab, cOff, count * 4) : null;
  
  // Float32Array requires 4-byte alignment, copy if needed
  let uvs: Float32Array | null = null;
  if (hasUvs && uvOff) {
    if (uvOff % 4 === 0) {
      uvs = new Float32Array(ab, uvOff, count * 6);
    } else {
      // Copy to aligned buffer
      const byteLength = count * 6 * 4;
      const tempBytes = new Uint8Array(ab, uvOff, byteLength);
      const alignedBuffer = new ArrayBuffer(byteLength);
      new Uint8Array(alignedBuffer).set(tempBytes);
      uvs = new Float32Array(alignedBuffer);
    }
  }

  return { kind: "ITRI", count, flags, bmin, bmax, vecRange, v0_u16, x_i16, y_i16, colors, uvs };
}

// Cache for fetched data - EXPORTED for shared usage
export const dataCache = new Map<string, Promise<ITRIData>>();

async function fetchArrayBufferMaybeBr(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.arrayBuffer();
}

// Export the fetch function for shared usage
export async function fetchAndParseITRI(url: string): Promise<ITRIData> {
  let p = dataCache.get(url);
  if (!p) {
    p = (async () => {
      const ab = await fetchArrayBufferMaybeBr(url);
      console.log("Loaded bytes:", ab.byteLength);
      const parsed = parseITRI(ab);
      console.log("Parsed ITRI:", parsed.count, "triangles, bmin:", parsed.bmin, "bmax:", parsed.bmax, "vecRange:", parsed.vecRange);
      return parsed;
    })();
    dataCache.set(url, p);
  }
  return await p;
}

type InstancedTrianglesProps = Omit<ThreeElements["mesh"], "args"> & {
  url: string;
  textureUrl?: string;
  parent?: THREE.Object3D | null;
  maxInstances?: number;
  grassGridUrl?: string; // Optional grass grid for accurate black gradient
};

export function InstancedTriangles({
  url,
  textureUrl = "/baked-textures/output.webp",
  parent = null,
  maxInstances = 0,
  grassGridUrl = "/grass-grid.bin",
  ...props
}: InstancedTrianglesProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => makeUnitTriangleGeometry(), []);
  const [data, setData] = useState<ITRIData | null>(null);
  const [albedoMap, setAlbedoMap] = useState<THREE.Texture | null>(null);
  const [grassTexture, setGrassTexture] = useState<THREE.DataTexture | null>(null);
  const [grassBounds, setGrassBounds] = useState<{ minX: number; maxX: number; minZ: number; maxZ: number } | null>(null);
  const [grassTexSize, setGrassTexSize] = useState<number>(8192);

  useEffect(() => {
    console.log("Loading texture:", textureUrl);
    const loader = new THREE.TextureLoader();
    loader.load(
      textureUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        console.log("Texture loaded successfully:", textureUrl);
        setAlbedoMap(tex);
      },
      undefined,
      (err) => console.error("Texture load failed:", err)
    );
  }, [textureUrl]);

  useEffect(() => {
    if (!parent) return;
    const m = ref.current;
    if (!m) return;
    parent.add(m);
    return () => {
      parent.remove(m);
    };
  }, [parent]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        console.log("Fetching ITRI from:", url);
        const parsed = await fetchAndParseITRI(url);
        if (!alive) return;
        console.log("Setting data with", parsed.count, "triangles");
        setData(parsed);
      } catch (e) {
        console.error("Failed to load ITRI:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [url]);

  // Load grass grid and create density texture
  useEffect(() => {
    if (!grassGridUrl) return;
    
    let alive = true;
    (async () => {
      try {
        const response = await fetch(grassGridUrl);
        const buffer = await response.arrayBuffer();
        const view = new DataView(buffer);
        
        let offset = 0;
        const cellSize = view.getFloat32(offset, true); offset += 4;
        const minX = view.getFloat32(offset, true); offset += 4;
        const maxX = view.getFloat32(offset, true); offset += 4;
        const minZ = view.getFloat32(offset, true); offset += 4;
        const maxZ = view.getFloat32(offset, true); offset += 4;
        const numCells = view.getUint32(offset, true); offset += 4;
        
        // Create texture: map world space to texture coordinates
        const worldWidth = maxX - minX;
        const worldDepth = maxZ - minZ;
        // Use fixed high resolution for accurate grass detection
        const texSize = 8192; // High resolution for accurate matching
        const textureData = new Uint8Array(texSize * texSize);
        
        console.log(`[InstancedTriangles] Texture resolution: ${texSize}x${texSize} for world ${worldWidth.toFixed(1)}x${worldDepth.toFixed(1)} (${(worldWidth/texSize).toFixed(4)} units per pixel)`);
        
        // Read cells and mark positions with grass
        for (let i = 0; i < numCells && offset < buffer.byteLength - 12; i++) {
          const cellX = view.getInt32(offset, true); offset += 4;
          const cellZ = view.getInt32(offset, true); offset += 4;
          const numPositions = view.getUint32(offset, true); offset += 4;
          
          for (let j = 0; j < numPositions && offset < buffer.byteLength - 12; j++) {
            const x = view.getFloat32(offset, true); offset += 4;
            const y = view.getFloat32(offset, true); offset += 4;
            const z = view.getFloat32(offset, true); offset += 4;
            
            // Map world position to texture coordinates
            const u = (x - minX) / worldWidth;
            const v = (z - minZ) / worldDepth;
            const px = Math.floor(u * texSize);
            const py = Math.floor(v * texSize);
            
            // Mark just the pixel itself (no radius expansion)
            if (px >= 0 && px < texSize && py >= 0 && py < texSize) {
              textureData[py * texSize + px] = 255; // Mark grass present
            }
          }
        }
        
        if (!alive) return;
        
        const texture = new THREE.DataTexture(textureData, texSize, texSize, THREE.RedFormat);
        texture.needsUpdate = true;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        
        console.log("[InstancedTriangles] Created grass density texture:", texSize, "x", texSize);
        console.log("[InstancedTriangles] Grass bounds:", { minX, maxX, minZ, maxZ });
        console.log("[InstancedTriangles] Sample texture values:", textureData.slice(0, 100));
        setGrassTexture(texture);
        setGrassBounds({ minX, maxX, minZ, maxZ });
        setGrassTexSize(texSize);
      } catch (e) {
        console.error("[InstancedTriangles] Failed to load grass grid:", e);
      }
    })();
    
    return () => {
      alive = false;
    };
  }, [grassGridUrl]);

  // Material with onBeforeCompile to inject custom instancing logic
  const material = useMemo(() => {
    if (!data) return null;
    if (!albedoMap) return null;
    if (!grassTexture) return null; // Wait for grass texture to be loaded

    const mat = new THREE.MeshStandardMaterial({
      map: albedoMap,
      side: THREE.DoubleSide,
      flatShading: false,
      roughness: 0.8,
      metalness: 0.0,
    });

    mat.onBeforeCompile = (shader) => {
      console.log("onBeforeCompile called, hasUvs:", !!data.uvs);
      
      // Add custom uniforms
      shader.uniforms.uBMin = { value: data.bmin.clone() };
      shader.uniforms.uBMax = { value: data.bmax.clone() };
      shader.uniforms.uVecRange = { value: data.vecRange };
      shader.uniforms.uCameraPosition = { value: new THREE.Vector3() };
      shader.uniforms.uGradientRadius = { value: 0.1 };
      shader.uniforms.uGrassTexture = { value: grassTexture };
      shader.uniforms.uGrassMin = { value: grassBounds ? new THREE.Vector2(grassBounds.minX, grassBounds.minZ) : new THREE.Vector2(-5000, -5000) };
      shader.uniforms.uGrassMax = { value: grassBounds ? new THREE.Vector2(grassBounds.maxX, grassBounds.maxZ) : new THREE.Vector2(5000, 5000) };
      shader.uniforms.uGrassTexSize = { value: grassTexSize };
      shader.uniforms.uDebugGrass = { value: 1.0 }; // 1.0 = show red debug, 0.0 = normal

      // Inject custom attributes at the top of vertex shader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBMin;
        uniform vec3 uBMax;
        uniform float uVecRange;
        uniform vec3 uCameraPosition;
        uniform float uGradientRadius;
        attribute vec3 iV0;
        attribute vec3 iX;
        attribute vec3 iY;
        varying vec3 vWorldPosition;
        ${data.uvs ? `
        attribute vec2 instanceUv0;
        attribute vec2 instanceUv1;
        attribute vec2 instanceUv2;
        ` : ''}`
      );

      // Replace position transformation
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `float w0 = position.x;
        float w1 = position.y;
        float w2 = 1.0 - w0 - w1;
        vec3 v0 = mix(uBMin, uBMax, iV0);
        vec3 x = iX * uVecRange;
        vec3 y = iY * uVecRange;
        vec3 transformed = v0 + x * w0 + y * w1;`
      );
      
      // Add world position calculation after worldpos
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

      // Replace normal calculation
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = normalize(cross(iX, iY));`
      );

      // Replace UV if we have custom UVs
      if (data.uvs) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <uv_vertex>',
          `#if defined( USE_MAP ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( USE_SPECULARMAP ) || defined( USE_ALPHAMAP ) || defined( USE_EMISSIVEMAP ) || defined( USE_ROUGHNESSMAP ) || defined( USE_METALNESSMAP )
          vMapUv = instanceUv0 * (1.0 - position.x - position.y) + instanceUv1 * position.x + instanceUv2 * position.y;
          #endif`
        );
      }

      // Modify fragment shader to add varying and uniforms at the top
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uCameraPosition;
        uniform float uGradientRadius;
        uniform sampler2D uGrassTexture;
        uniform vec2 uGrassMin;
        uniform vec2 uGrassMax;
        uniform float uDebugGrass;
        uniform float uGrassTexSize;
        varying vec3 vWorldPosition;`
      );
      
      // Apply black gradient ONLY where grass instances exist (from texture)
      // OR show red debug visualization
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Sample grass density texture with blur for smooth edges
        vec2 grassUV = (vWorldPosition.xz - uGrassMin) / (uGrassMax - uGrassMin);
        
        // Clamp UV to valid range and skip if outside bounds
        if (grassUV.x < 0.0 || grassUV.x > 1.0 || grassUV.y < 0.0 || grassUV.y > 1.0) {
          // Outside grass bounds, skip processing
        } else {
          // Sample with larger blur to expand red areas and create gradient
          float texelSize = 1.0 / uGrassTexSize * 1.1;
          float blurRadius = 3.0; // Larger radius for more expansion
          float totalDensity = 0.0;
          float totalWeight = 0.0;
          
          for (float y = -blurRadius; y <= blurRadius; y += 1.0) {
            for (float x = -blurRadius; x <= blurRadius; x += 1.0) {
              vec2 offset = vec2(x, y) * texelSize;
              float dist = length(vec2(x, y));
              if (dist <= blurRadius) {
                // Gaussian-like falloff
                float weight = exp(-dist * dist / (blurRadius * blurRadius * 0.5));
                float texSample = texture2D(uGrassTexture, grassUV + offset).r;
                totalDensity += texSample * weight;
                totalWeight += weight;
              }
            }
          }
          
          float grassDensity = totalWeight > 0.0 ? totalDensity / totalWeight : 0.0;
          
          // Debug mode: show black gradient with soft falloff
          if (uDebugGrass > 0.5) {
            // Boost density for more solid black while keeping soft gradient
            float boostedDensity = min(grassDensity * 100.8, 1.0);
            float intensity = pow(boostedDensity, 0.6); // Keep smooth gradient
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.01, 0.01, 0.01), smoothstep(0.0, 1.0, intensity));
          } else {
            // Soft black blob with very soft gradient at grass boundaries
            float distFromCamera = length(vWorldPosition - uCameraPosition);
            
            // Very soft radial gradient from camera
            float radialFade = pow(distFromCamera / uGradientRadius, 2.5);
            radialFade = clamp(radialFade, 0.0, 1.0);
            
            // Very soft grass boundary fade
            float grassFade = pow(grassDensity, 0.3);
            
            // Combine both fades for soft blob effect
            float darknessFactor = grassFade * (1.0 - radialFade);
            
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), darknessFactor);
          }
        }`
      );

      console.log("Modified vertex shader (first 500 chars):", shader.vertexShader.substring(0, 500));

      mat.userData.shader = shader;
    };

    mat.needsUpdate = true;
    return mat;
  }, [albedoMap, data, grassTexture, grassBounds, grassTexSize]);

  useEffect(() => {
    if (!material) return;
    
    // Update camera position uniform every frame
    const updateCameraPosition = (camera: THREE.Camera) => {
      const shader = material.userData.shader;
      if (shader && shader.uniforms.uCameraPosition) {
        shader.uniforms.uCameraPosition.value.copy(camera.position);
      }
    };
    
    // Store the update function for cleanup
    material.userData.updateCameraPosition = updateCameraPosition;
    
    return () => {
      material.dispose();
    };
  }, [material]);

  // Bind attributes (still no per-instance matrix loop)
  useEffect(() => {
    if (!data) return;

    const instanceCount =
      maxInstances > 0 ? Math.min(data.count, maxInstances) : data.count;

    // Core attributes: note normalized=true so shader receives 0..1 and -1..1 floats
    geom.setAttribute(
      "iV0",
      new THREE.InstancedBufferAttribute(
        data.v0_u16.subarray(0, instanceCount * 3),
        3,
        true // normalized
      )
    );
    geom.setAttribute(
      "iX",
      new THREE.InstancedBufferAttribute(
        data.x_i16.subarray(0, instanceCount * 3),
        3,
        true // normalized
      )
    );
    geom.setAttribute(
      "iY",
      new THREE.InstancedBufferAttribute(
        data.y_i16.subarray(0, instanceCount * 3),
        3,
        true // normalized
      )
    );

    if (data.colors) {
      // Optional: if you want to use it in shader, add attribute + varyings.
      geom.setAttribute(
        "instanceColor",
        new THREE.InstancedBufferAttribute(
          data.colors.subarray(0, instanceCount * 4),
          4,
          true
        )
      );
    } else if (geom.getAttribute("instanceColor")) {
      geom.deleteAttribute("instanceColor");
    }

    // UVs: still needs a loop if you keep the 3-attribute layout.
    // BUT we can avoid that too by using one attribute vec4 + vec2, or three vec2 from a single Float32Array with proper stride (not supported directly).
    // For now: keep simple. If you want zero loops here too, tell me and I'll repack exporter to write uv0/uv1/uv2 as separate arrays.
    if (data.uvs) {
      const count = instanceCount;
      const uv0Array = new Float32Array(count * 2);
      const uv1Array = new Float32Array(count * 2);
      const uv2Array = new Float32Array(count * 2);

      for (let i = 0; i < count; i++) {
        const base = i * 6;
        uv0Array[i * 2] = data.uvs[base];
        uv0Array[i * 2 + 1] = data.uvs[base + 1];
        uv1Array[i * 2] = data.uvs[base + 2];
        uv1Array[i * 2 + 1] = data.uvs[base + 3];
        uv2Array[i * 2] = data.uvs[base + 4];
        uv2Array[i * 2 + 1] = data.uvs[base + 5];
      }

      geom.setAttribute("instanceUv0", new THREE.InstancedBufferAttribute(uv0Array, 2));
      geom.setAttribute("instanceUv1", new THREE.InstancedBufferAttribute(uv1Array, 2));
      geom.setAttribute("instanceUv2", new THREE.InstancedBufferAttribute(uv2Array, 2));
    } else if (geom.getAttribute("instanceUv0")) {
      geom.deleteAttribute("instanceUv0");
      geom.deleteAttribute("instanceUv1");
      geom.deleteAttribute("instanceUv2");
    }

    console.log("Attributes set for", instanceCount, "instances");
  }, [data, geom, maxInstances]);

  // Update camera position uniform every frame
  useFrame(({ camera }) => {
    if (material && material.userData.shader) {
      const shader = material.userData.shader;
      if (shader.uniforms.uCameraPosition) {
        shader.uniforms.uCameraPosition.value.copy(camera.position);
      }
    }
  });

  console.log("InstancedTriangles render - data:", !!data, "material:", !!material);

  if (!material || !data) {
    return null;
  }

  console.log("Rendering with custom shader material, instanceCount:", data.count);

  const instanceCount = maxInstances > 0 ? Math.min(data.count, maxInstances) : data.count;

  return (
    <instancedMesh
      ref={(mesh) => {
        ref.current = mesh;
        if (mesh) {
          console.log("InstancedMesh mounted:", {
            visible: mesh.visible,
            count: mesh.count,
            geometry: mesh.geometry,
            material: mesh.material,
            position: mesh.position,
            attributes: Object.keys(mesh.geometry.attributes)
          });
        }
      }}
      args={[geom, material, instanceCount]}
      frustumCulled={false}
      renderOrder={999}
      {...props}
    />
  );
}

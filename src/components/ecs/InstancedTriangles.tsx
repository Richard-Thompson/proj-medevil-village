import * as THREE from "three";
import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";

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

// Cache for fetched data
const dataCache = new Map<string, Promise<ITRIData>>();

async function fetchArrayBufferMaybeBr(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.arrayBuffer();
}

type InstancedTrianglesProps = Omit<ThreeElements["mesh"], "args"> & {
  url: string;
  textureUrl?: string;
  parent?: THREE.Object3D | null;
  maxInstances?: number;
};

export function InstancedTriangles({
  url,
  textureUrl = "/baked-textures/output.webp",
  parent = null,
  maxInstances = 0,
  ...props
}: InstancedTrianglesProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => makeUnitTriangleGeometry(), []);
  const [data, setData] = useState<ITRIData | null>(null);
  const [albedoMap, setAlbedoMap] = useState<THREE.Texture | null>(null);

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
        const parsed = await p;
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

  // Material with onBeforeCompile to inject custom instancing logic
  const material = useMemo(() => {
    if (!data) return null;
    if (!albedoMap) return null;

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

      // Inject custom attributes at the top of vertex shader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBMin;
        uniform vec3 uBMax;
        uniform float uVecRange;
        attribute vec3 iV0;
        attribute vec3 iX;
        attribute vec3 iY;
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

      console.log("Modified vertex shader (first 500 chars):", shader.vertexShader.substring(0, 500));

      mat.userData.shader = shader;
    };

    mat.needsUpdate = true;
    return mat;
  }, [albedoMap, data]);

  useEffect(() => {
    if (!material) return;
    return () => material.dispose();
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

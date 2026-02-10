"use client";

import ECSLoop from "@/components/ecs/systems/ECSLoop";
import CameraControlSystem from "@/components/ecs/systems/CameraControlSystem";
import { InstancedTriangles } from "@/components/ecs/InstancedTriangles";
import { ECS } from "@react-ecs/core";
import { ContactShadows, Environment, PointerLockControls, Stats } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useEffect, useState } from "react";
import { setTerrainData, buildTerrainOctree, findTerrainHeight } from "./terrainUtils";

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
        
        // Store terrain data globally
        setTerrainData(ab);

        if (!alive) return;

        console.log('Starting initial raycast from y=450');

        // Initial camera position raycast
        const terrainY = findTerrainHeight(0, 0, 50);

        if (!alive) return;

        if (terrainY !== null) {
          console.log('Found intersection at Y:', terrainY);
          camera.position.set(0, terrainY + 2, 0);
          console.log('Camera positioned at:', camera.position);
        } else {
          camera.position.set(0, 2, 0);
        }

        // Build octree for fast spatial queries
        buildTerrainOctree();

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

interface SceneProps {
  onLoaded?: () => void;
}

export default function Scene({ onLoaded }: SceneProps = {}) {
  const ecs = useMemo(() => new ECS(), []);
  const cameraProps = useMemo(() => ({ position: [0, 2, 0] as [number, number, number], fov: 75, near: 0.1, far: 5000 }), []);
  const dprProps = useMemo(() => [1, 1.5] as [number, number], []);
  const bgColor = useMemo(() => ["#0b0d12"] as [string], []);
  const groupRotation = useMemo(() => [-Math.PI / 2, 0, 0] as [number, number, number], []);
  const shadowPosition = useMemo(() => [0, -1.2, 0] as [number, number, number], []);
  const lightPosition = useMemo(() => [300, 400, 200] as [number, number, number], []);

  useEffect(() => {
    // Notify parent when scene is mounted and ready
    const timer = setTimeout(() => {
      onLoaded?.();
    }, 1000); // Give it a second to fully initialize

    return () => clearTimeout(timer);
  }, [onLoaded]);

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
      <CameraControlSystem />
      <PointerLockControls />

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

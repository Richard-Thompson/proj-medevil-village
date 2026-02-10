"use client";

import { InstancedMesh } from "@/components/ecs/types";
import ECSLoop from "@/components/ecs/systems/ECSLoop";
import InstancedMeshSystem from "@/components/ecs/systems/ModelSystem";
import { InstancedTriangles } from "@/components/ecs/InstancedTriangles";
import { ECS, Entity } from "@react-ecs/core";
import { ThreeView } from "@react-ecs/three";
import { ContactShadows, Environment, OrbitControls, Stats } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";

export default function Scene() {
  const ecs = useMemo(() => new ECS(), []);
  const cameraProps = useMemo(() => ({ position: [300,300,300] as [number, number, number], fov: 50, near: 0.1, far: 5000 }), []);
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
      {/* <ambientLight intensity={.5} />
      <directionalLight position={lightPosition} intensity={0.1} /> */}
      <Stats />
      <OrbitControls enablePan={false} makeDefault target={[0, 0, 0]} />

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

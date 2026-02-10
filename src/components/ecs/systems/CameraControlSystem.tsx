"use client";

import { useFrame } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";

// Import terrain data from Scene.tsx
import { getTerrainHeightFromOctree, isOctreeReady } from "../terrainUtils";

export default function CameraControlSystem() {
  const { camera } = useThree();
  const velocity = useRef(new Vector3());
  const direction = useRef(new Vector3());
  const keys = useRef({ forward: false, backward: false, left: false, right: false });
  const currentTerrainY = useRef<number | null>(null);
  const targetTerrainY = useRef<number>(2);

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

    // Use octree-accelerated terrain following
    if (isOctreeReady()) {
      const lastValid = currentTerrainY.current !== null ? currentTerrainY.current : camera.position.y - 2;
      targetTerrainY.current = getTerrainHeightFromOctree(camera.position.x, camera.position.z, lastValid);
      
      // Initialize current height on first frame
      if (currentTerrainY.current === null) {
        currentTerrainY.current = targetTerrainY.current;
      }
      
      // Smooth interpolation to prevent glitches
      const lerpSpeed = 10;
      currentTerrainY.current += (targetTerrainY.current - currentTerrainY.current) * Math.min(1, delta * lerpSpeed);
      
      camera.position.y = currentTerrainY.current + 2;
    }
  });

  return null;
}

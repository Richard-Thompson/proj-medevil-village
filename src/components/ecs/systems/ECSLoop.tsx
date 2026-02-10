"use client";

import { useAnimationFrame, useECS } from "@react-ecs/core";

export default function ECSLoop() {
  const ecs = useECS();
  useAnimationFrame((dt) => ecs.update(dt));
  return null;
}

"use client";

import { InstancedMesh } from "@/components/ecs/types";
import { useQuery } from "@react-ecs/core";
import { ThreeView } from "@react-ecs/three";
import { InstancedTrianglesIMSH } from "../InstancedTrianglesIMSH";

export default function InstancedMeshSystem() {
  const query = useQuery((entity) => entity.hasAll(ThreeView, InstancedMesh));
  const components = [ThreeView, InstancedMesh] as const;

  console.log("InstancedMeshSystem render, query:", query);

  return (
    <>
      {query.loop(components, (entity, [view, mesh]) => {
        const binUrl = mesh.binUrl;
        const textureUrl = mesh.textureUrl;
        
        console.log("Rendering instance:", { entityId: entity.id, binUrl, textureUrl, hasParent: !!view.object3d });
        
        return (
          <InstancedTrianglesIMSH
            key={`${entity.id}-${binUrl}`}
            url={binUrl}
            textureUrl={textureUrl}
            parent={view.object3d}
          />
        );
      })}
    </>
  );
}

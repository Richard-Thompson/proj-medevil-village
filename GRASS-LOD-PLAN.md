# Grass LOD 60fps Plan

## Assumptions
- 1 unit = 1m
- Target: stable 60fps on desktop (adjustable)

## Plan
1. **Lock constraints**
   1. Decide target device class, typical camera height, and max grass draw distance.
   2. Set budget targets: max visible clumps, total instance count, and max GPU time for grass (e.g. 3–5ms).

2. **Define LOD bands**
   1. Near: `0–15m` = real blades/clumps (dense).
   2. Mid: `15–45m` = clumps only (lighter mesh, cheaper shader).
   3. Far: `45m+` = no geometry, terrain shader only.
   4. Keep cutoffs data-driven (config).

3. **Clump assets + instance data**
   1. Build 2–3 clump meshes (dense + light).
   2. Pack per‑instance attributes: random height/lean/width, tint, wind phase, seed.
   3. Export clump instance data by tile (positions + attributes).

4. **Near + mid rendering**
   1. Use GPU instancing only.
   2. Alpha‑clip, no blending.
   3. Wind in vertex shader (phase per instance).
   4. Spec/roughness breakup for “alive” shimmer.

5. **Far rendering (terrain shader)**
   1. Add grass coverage signal (noise or baked mask).
   2. Add “fur normal”/anisotropic normal blend.
   3. Add horizon sparkle (view‑dependent spec term).
   4. Animate coverage/normal with wind advection.

6. **Transition system**
   1. Dithered cross‑fade at band boundaries (no alpha blending).
   2. Far shader increases “grassness” as mid fades out.

7. **Streaming & culling**
   1. Tile‑based ring buffer around camera.
   2. Frustum + distance culling per tile.
   3. Optional: density falloff by distance.

8. **Performance instrumentation**
   1. GPU timing for grass pass(es).
   2. Track instance counts per band.
   3. Verify draw calls and memory use.

9. **Tuning pass**
   1. Adjust band cutoffs and density until 60fps target.
   2. Validate look (silhouette, shimmer, wind coherence).

## Deliverables
- Configurable LOD band distances + budgets.
- Instanced clump renderer (near/mid).
- Terrain shader “far grassness”.
- Dithered transition system.
- Performance dashboard (counts + GPU time).

"use client";

import Scene from "@/components/ecs/Scene";
import LockScreen from "@/components/LockScreen";
import LoadingScreen from "@/components/LoadingScreen";
import { useState } from "react";

export default function Home() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <>
      {!isUnlocked && <LockScreen onUnlock={() => setIsUnlocked(true)} />}
      {isUnlocked && !isLoaded && <LoadingScreen />}
      
      <main className="min-h-screen bg-[#0a0d12] text-zinc-100">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
          <header className="flex flex-col gap-4">
            <div className="text-xs uppercase tracking-[0.3em] text-zinc-400">
              React ECS + R3F
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Minimal ECS template with ThreeView + systems
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-zinc-300">
              Entities own data (facets), systems run every frame, and ThreeView
              binds a React mesh to ECS. The scene below wires those pieces
              together in a React-friendly way.
            </p>
            <div className="grid gap-2 text-sm text-zinc-300">
              <div>Facet components: `Spin`, `Bob`</div>
              <div>Systems: `SpinSystem`, `BobSystem`</div>
              <div>Loop: `useAnimationFrame` to `ecs.update`</div>
            </div>
          </header>

          <section className="h-[65vh] w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_60px_rgba(15,23,42,0.45)]">
            {isUnlocked && <Scene onLoaded={() => setIsLoaded(true)} />}
          </section>

          <footer className="text-xs text-zinc-400">
            Find the ECS patterns in `src/components/ecs/Scene.tsx`.
          </footer>
        </div>
      </main>
    </>
  );
}



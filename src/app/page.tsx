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

      <main className="h-screen w-screen overflow-hidden bg-[#0a0d12] text-zinc-100">
        <section className="h-full w-full">
          {isUnlocked && <Scene onLoaded={() => setIsLoaded(true)} />}
        </section>
      </main>
    </>
  );
}



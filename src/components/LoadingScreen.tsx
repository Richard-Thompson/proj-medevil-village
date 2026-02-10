"use client";

export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0a0d12]">
      <div className="flex flex-col items-center gap-6">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-zinc-800"></div>
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-zinc-400"></div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-xl font-semibold text-white">Loading Scene</h2>
          <p className="text-sm text-zinc-400">Please wait...</p>
        </div>
      </div>
    </div>
  );
}

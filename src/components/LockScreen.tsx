"use client";

import { useState } from "react";

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code === "1234") {
      onUnlock();
    } else {
      setError(true);
      setCode("");
      setTimeout(() => setError(false), 500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0d12]">
      <div className="flex flex-col items-center gap-8 px-6">
        <div className="flex flex-col items-center gap-4">
          <div className="h-20 w-20 rounded-full border-2 border-zinc-700 bg-zinc-900 flex items-center justify-center">
            <svg
              className="h-10 w-10 text-zinc-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white">Enter Access Code</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`w-48 rounded-lg border-2 bg-zinc-900 px-4 py-3 text-center text-2xl tracking-[0.5em] text-white transition-colors focus:outline-none ${
              error
                ? "border-red-500 animate-shake"
                : "border-zinc-700 focus:border-zinc-500"
            }`}
            placeholder="••••"
            autoFocus
          />
          {error && (
            <p className="text-sm text-red-400">Incorrect code. Try again.</p>
          )}
          <button
            type="submit"
            className="w-48 rounded-lg bg-zinc-800 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-600"
          >
            Unlock
          </button>
        </form>

        <p className="text-xs text-zinc-500">Hint: Try 1234</p>
      </div>

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-8px); }
          20%, 40%, 60%, 80% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.5s;
        }
      `}</style>
    </div>
  );
}

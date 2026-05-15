"use client"

import dynamic from "next/dynamic"

const PrototypePage = dynamic(
  () => import("@/components/prototype-page").then((module) => module.PrototypePage),
  {
    ssr: false,
    loading: () => (
      <main className="min-h-screen bg-[#090b0f] text-white">
        <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-5 text-white/55">
          Loading prototype...
        </div>
      </main>
    ),
  }
)

export function PrototypePageShell() {
  return <PrototypePage />
}

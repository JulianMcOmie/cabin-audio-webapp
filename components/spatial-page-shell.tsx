"use client"

import dynamic from "next/dynamic"

const SpatialPage = dynamic(
  () => import("@/components/spatial-page").then((module) => module.SpatialPage),
  {
    ssr: false,
    loading: () => (
      <main className="min-h-screen bg-[#090b0f] text-white">
        <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 text-white/55">
          Loading spatial editor...
        </div>
      </main>
    ),
  }
)

export function SpatialPageShell() {
  return <SpatialPage />
}

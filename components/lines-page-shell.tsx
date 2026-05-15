"use client"

import dynamic from "next/dynamic"

const LinesPage = dynamic(
  () => import("@/components/lines-page").then((module) => module.LinesPage),
  {
    ssr: false,
    loading: () => (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#0d3a6f_0%,rgba(13,58,111,0.15)_28%,transparent_48%),radial-gradient(circle_at_top_right,rgba(22,163,171,0.22),transparent_36%),linear-gradient(180deg,#0b0d12_0%,#10121a_52%,#090a0d_100%)] text-white">
        <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-8 text-white/60 sm:px-10 lg:px-12">
          Loading line sweep...
        </div>
      </main>
    ),
  }
)

export function LinesPageShell() {
  return <LinesPage />
}

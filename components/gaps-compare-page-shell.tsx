"use client"

import dynamic from "next/dynamic"

const GapsComparePage = dynamic(
  () => import("@/components/gaps-compare-page").then((module) => module.GapsComparePage),
  {
    ssr: false,
    loading: () => (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#6f2a0d_0%,rgba(111,42,13,0.15)_28%,transparent_48%),radial-gradient(circle_at_top_right,rgba(22,163,171,0.28),transparent_36%),linear-gradient(180deg,#120d0b_0%,#140f18_52%,#090a0d_100%)] text-white">
        <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-8 text-white/60 sm:px-10 lg:px-12">
          Loading EQ comparison...
        </div>
      </main>
    ),
  }
)

export function GapsComparePageShell() {
  return <GapsComparePage />
}

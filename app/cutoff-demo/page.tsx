import type { Metadata } from "next"
import { CutoffDemo } from "@/components/cutoff-demo"

export const metadata: Metadata = {
  title: "Lower Cutoff Demo",
  description: "Continuous noise with an oscillating lower cutoff.",
}

export default function Page() {
  return <CutoffDemo />
}

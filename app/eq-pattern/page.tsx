import type { Metadata } from "next"
import { EQPatternExperimentPage } from "@/components/eq-pattern-experiment-page"

export const metadata: Metadata = {
  title: "EQ Pattern Experiment",
  description: "Single-dot dry/EQ pattern playback experiment.",
}

export default function Page() {
  return <EQPatternExperimentPage />
}

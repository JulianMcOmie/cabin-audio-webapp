import type { Metadata } from "next"
import { HrtfPageShell } from "@/components/hrtf-page-shell"

export const metadata: Metadata = {
  title: "Cabin Audio Spatial Lab",
  description:
    "Multi-angle HRTF audition and virtual stereo speaker playback using public datasets, synthetic variants, and a dedicated Web Audio routing path.",
}

export default function Page() {
  return <HrtfPageShell />
}

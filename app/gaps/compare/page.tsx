import type { Metadata } from "next"
import { GapsComparePageShell } from "@/components/gaps-compare-page-shell"

export const metadata: Metadata = {
  title: "Cabin Audio – EQ Comparison",
  description:
    "Alternate short bursts of shaped noise between two adjustable bell-cut EQ settings for focused frequency comparison.",
}

export default function Page() {
  return <GapsComparePageShell />
}

import type { Metadata } from "next"
import { BandwidthColumnsPage } from "@/components/bandwidth-columns-page"

export const metadata: Metadata = {
  title: "Bandwidth Columns",
  description: "Column-based bandwidth control surface using the dot grid audio engine.",
}

export default function Page() {
  return <BandwidthColumnsPage />
}

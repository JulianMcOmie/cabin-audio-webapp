import type { Metadata } from "next"
import { SpatialPageShell } from "@/components/spatial-page-shell"

export const metadata: Metadata = {
  title: "Cabin Spatial Editor",
  description: "Experimental spatial EQ calibration editor.",
}

export default function Page() {
  return <SpatialPageShell />
}

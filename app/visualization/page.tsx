import type { Metadata } from "next"
import { VisualizationPage } from "@/components/visualization-page"

export const metadata: Metadata = {
  title: "Cabin Audio Visualization",
  description: "Single-dot left, center, right timing visualizations.",
}

export default function Page() {
  return <VisualizationPage />
}

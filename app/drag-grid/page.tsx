import type { Metadata } from "next"
import { DragGrid } from "@/components/drag-grid"

export const metadata: Metadata = {
  title: "Cube · Cabin Audio",
  description: "A draggable cube of continuous noise with speed and volume controls.",
}

export default function Page() {
  return <DragGrid />
}

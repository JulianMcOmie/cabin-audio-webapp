import type { Metadata } from "next"
import { GlyphGrid } from "@/components/glyph-grid"

export const metadata: Metadata = {
  title: "Glyph Canvas · Cabin Audio",
  description: "Trace glyphs as spatial noise at 200 positions per second.",
}

export default function Page() {
  return <GlyphGrid />
}

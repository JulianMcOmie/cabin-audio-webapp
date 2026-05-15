import type { Metadata } from "next"
import { LinesPageShell } from "@/components/lines-page-shell"

export const metadata: Metadata = {
  title: "Cabin Audio Line Sweep",
  description:
    "Draw a line across the soundstage and hear a noise dot sweep back and forth along it.",
}

export default function Page() {
  return <LinesPageShell />
}

import type { Metadata } from "next"
import { GapsPageShell } from "@/components/gaps-page-shell"

export const metadata: Metadata = {
  title: "Cabin Audio – Gap Editor",
  description:
    "Generate shaped noise with controllable frequency gaps for ear training and frequency analysis.",
}

export default function Page() {
  return <GapsPageShell />
}

import type { Metadata } from "next"
import { PrototypePageShell } from "@/components/prototype-page-shell"

export const metadata: Metadata = {
  title: "Cabin Audio Prototype",
  description: "Pairwise spatial calibration prototype.",
}

export default function Page() {
  return <PrototypePageShell />
}

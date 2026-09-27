import type { Metadata } from "next"
import { ScrambleDemo } from "@/components/scramble-demo"

export const metadata: Metadata = {
  title: "Unscramble · Cabin Audio",
  description: "Restore hidden 3D shapes one held dot at a time.",
}

export default function Page() {
  return <ScrambleDemo />
}

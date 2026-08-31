import type { Metadata } from "next"
import { RotatingDotsPage } from "@/components/rotating-dots-page"

export const metadata: Metadata = {
  title: "Rotating Dots",
  description:
    "Two dots orbiting the center firing staggered wide-bandpass noise hits; height shifts the band, distance sets volume.",
}

export default function Page() {
  return <RotatingDotsPage />
}

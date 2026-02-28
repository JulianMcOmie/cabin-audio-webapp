import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ToastProvider } from "@/components/common/ToastManager"
import { ThemeProvider } from "@/components/theme-provider"
import AudioProvider from "./providers/AudioProvider"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Cabin Audio",
  description: "A modern audio player with advanced EQ capabilities",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          <ToastProvider>
            <AudioProvider>{children}</AudioProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

"use client"

import { Apple } from "lucide-react"
import { Button } from "@/components/ui/button"

export function InstallView() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-12">Desktop App</h1>

      <div className="flex flex-col items-start gap-8">
        <div>
          <Button size="lg" className="px-12 py-6 text-lg">
            <Apple className="mr-2 h-5 w-5" />
            Download for macOS
          </Button>
          <p className="text-sm text-muted-foreground mt-3">Version 1.2.3 • macOS 11.0+ (Intel/Apple Silicon)</p>
        </div>

        <div>
          <Button size="lg" className="px-12 py-6 text-lg">
            <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M0 0h24v24H0V0z" fill="none" />
              <path d="M21.17 3.25Q21.5 3.25 21.76 3.5 22 3.74 22 4.08v15.84q0 .34-.24.58-.24.25-.59.25H2.83q-.34 0-.59-.25-.24-.24-.24-.58V4.08q0-.34.24-.58.25-.25.59-.25h18.34M5 15.17l3.17-1.85 3.17 1.85-.84-3.65 2.83-2.45-3.73-.32L8.17 5 6.74 8.75 3 9.07l2.83 2.45L5 15.17m7 0l3.17-1.85 3.17 1.85-.84-3.65 2.83-2.45-3.73-.32L15.17 5l-1.43 3.75-3.73.32 2.83 2.45-.84 3.65" />
            </svg>
            Download for Windows
          </Button>
          <p className="text-sm text-muted-foreground mt-3">Version 1.2.1 • Windows 10/11 (64-bit)</p>
        </div>
      </div>
    </div>
  )
}


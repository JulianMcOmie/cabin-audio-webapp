"use client"

import { Apple } from "lucide-react"
import { Button } from "@/components/ui/button"

export function MobileView() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-12">Mobile App</h1>

      <div className="flex flex-col items-start gap-8">
        <div>
          <Button size="lg" className="px-12 py-6 text-lg">
            <Apple className="mr-2 h-5 w-5" />
            Download on the App Store
          </Button>
          <p className="text-sm text-muted-foreground mt-3">Version 1.1.8 • iOS 14.0+</p>
        </div>

        <div>
          <Button size="lg" className="px-12 py-6 text-lg">
            <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M0 0h24v24H0z" fill="none" />
              <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-2.86-1.21-6.08-1.21-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48C3.3 11.25 1.28 14.44 1 18h22c-.28-3.56-2.3-6.75-5.4-8.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z" />
            </svg>
            Get it on Google Play
          </Button>
          <p className="text-sm text-muted-foreground mt-3">Version 1.1.5 • Android 8.0+</p>
        </div>
      </div>
    </div>
  )
}


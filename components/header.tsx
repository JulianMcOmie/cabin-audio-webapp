"use client"

import { Download, LogIn, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Header() {
  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center px-6">
        <div className="flex items-center gap-4 lg:gap-6">
          <div className="font-semibold text-lg">
            <span className="text-orange-500">Cabin</span> Audio
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Install App</span>
          </Button>
          <Button size="sm" className="gap-1 bg-primary hover:bg-primary/90 text-white">
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Sign up</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-1">
            <LogIn className="h-4 w-4" />
            <span className="hidden sm:inline">Log in</span>
          </Button>
        </div>
      </div>
    </header>
  )
}


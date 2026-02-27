"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"

interface TopBarProps {
  setActiveTab?: (tab: "eq" | "library") => void
  history?: Array<"eq" | "library">
  currentIndex?: number
  setCurrentIndex?: (index: number) => void
}

type TabHistory = Array<"eq" | "library">

export function TopBar({ setActiveTab, history, currentIndex, setCurrentIndex }: TopBarProps) {
  const { theme, setTheme } = useTheme()

  const [localHistory] = useState<TabHistory>(["eq"])
  const [localCurrentIndex, setLocalCurrentIndex] = useState(0)

  const activeHistory = history || localHistory
  const activeCurrentIndex = currentIndex !== undefined ? currentIndex : localCurrentIndex
  const setActiveCurrentIndex = setCurrentIndex || setLocalCurrentIndex

  const handleBack = () => {
    if (activeCurrentIndex > 0 && setActiveTab) {
      const newIndex = activeCurrentIndex - 1
      setActiveCurrentIndex(newIndex)
      setActiveTab(activeHistory[newIndex])
    }
  }

  const handleForward = () => {
    if (activeCurrentIndex < activeHistory.length - 1 && setActiveTab) {
      const newIndex = activeCurrentIndex + 1
      setActiveCurrentIndex(newIndex)
      setActiveTab(activeHistory[newIndex])
    }
  }

  return (
    <div className="h-16 flex items-center px-6 bg-background">
      <div className="hidden md:flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBack} disabled={activeCurrentIndex <= 0}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleForward} disabled={activeCurrentIndex >= activeHistory.length - 1}>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="ml-auto">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>
    </div>
  )
}

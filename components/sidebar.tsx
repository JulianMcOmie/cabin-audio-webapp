"use client"

import { useState } from "react"
import { Menu, Music, Sliders, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useMobile } from "@/lib/hooks/useMobile"

interface SidebarProps {
  activeTab: "eq" | "library"
  setActiveTab: (tab: "eq" | "library") => void
  pushToHistory?: (tab: "eq" | "library") => void
}

export function Sidebar({ activeTab, setActiveTab, pushToHistory }: SidebarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const isMobile = useMobile()

  const handleTabChange = (tab: "eq" | "library") => {
    if (pushToHistory) {
      pushToHistory(tab)
    } else {
      setActiveTab(tab)
    }

    if (isMobile) {
      setIsMobileMenuOpen(false)
    }
  }

  const MobileMenuButton = () => (
    <div className="md:hidden fixed top-4 left-4 z-50">
      <Button variant="outline" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="bg-background relative overflow-hidden">
        <div className={`absolute inset-0 flex items-center justify-center transition-transform duration-300 ${isMobileMenuOpen ? "rotate-0 scale-100" : "rotate-0 scale-0"}`}>
          <X className="h-5 w-5" />
        </div>
        <div className={`absolute inset-0 flex items-center justify-center transition-transform duration-300 ${isMobileMenuOpen ? "rotate-90 scale-0" : "rotate-0 scale-100"}`}>
          <Menu className="h-5 w-5" />
        </div>
      </Button>
    </div>
  )

  return (
    <>
      <MobileMenuButton />

      <div
        className={`
        w-64 bg-background flex flex-col border-r border-border h-full pb-16
        md:relative fixed inset-y-0 left-0 z-40
        transform ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        transition-transform duration-300 ease-in-out
      `}
      >
        <div className="md:p-6 p-6 pt-16 md:pt-6">
          <h1 className="font-semibold text-xl">Cabin Audio</h1>
        </div>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="p-4 pt-2">
            <div className="space-y-1">
              <Button
                variant="ghost"
                className={`w-full justify-start ${activeTab === "eq" ? "bg-electric-blue-light text-electric-blue hover:bg-electric-blue-light hover:text-electric-blue" : ""}`}
                onClick={() => handleTabChange("eq")}
              >
                <Sliders className={`mr-2 h-4 w-4 ${activeTab === "eq" ? "text-electric-blue" : ""}`} />
                Soundstage
              </Button>
              <Button
                variant="ghost"
                className={`w-full justify-start ${activeTab === "library" ? "bg-purple-light text-purple hover:bg-purple-light hover:text-purple" : ""}`}
                onClick={() => handleTabChange("library")}
              >
                <Music className={`mr-2 h-4 w-4 ${activeTab === "library" ? "text-purple" : ""}`} />
                Music Library
              </Button>
            </div>
          </div>
        </ScrollArea>
      </div>

      {isMobileMenuOpen && <div className="md:hidden fixed inset-0 bg-black/50 z-30 animate-in fade-in duration-200" onClick={() => setIsMobileMenuOpen(false)} />}
    </>
  )
}

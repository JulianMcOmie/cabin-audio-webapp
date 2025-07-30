"use client"

import { useState, useEffect } from "react"
import { ExternalLink, Menu, Monitor, Music, Sliders, Smartphone, Sparkles, X, FlaskConical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

interface SidebarProps {
  activeTab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile" | "experiments"
  setActiveTab: (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile" | "experiments") => void
  onUpgradeClick: () => void
  pushToHistory?: (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile" | "experiments") => void
}

export function Sidebar({ activeTab, setActiveTab, onUpgradeClick, pushToHistory }: SidebarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    // Function to check if viewport is mobile size
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    // Check on initial load
    checkMobile()
    
    // Set up event listener for window resize
    window.addEventListener('resize', checkMobile)
    
    // Cleanup event listener
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  // Helper function to handle tab changes
  const handleTabChange = (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile" | "experiments") => {
    if (pushToHistory) {
      // If pushToHistory is provided, use it to update history
      pushToHistory(tab);
    } else {
      // Otherwise, just set the active tab directly
      setActiveTab(tab);
    }
    
    // Close mobile menu after selection on mobile
    if (isMobile) {
      setIsMobileMenuOpen(false)
    }
  };

  // Mobile hamburger menu button
  const MobileMenuButton = () => (
    <div className="md:hidden fixed top-4 left-4 z-50">
      <Button 
        variant="outline" 
        size="icon" 
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="bg-background relative overflow-hidden"
      >
        <div className={`absolute inset-0 flex items-center justify-center transition-transform duration-300 ${isMobileMenuOpen ? 'rotate-0 scale-100' : 'rotate-0 scale-0'}`}>
          <X className="h-5 w-5" />
        </div>
        <div className={`absolute inset-0 flex items-center justify-center transition-transform duration-300 ${isMobileMenuOpen ? 'rotate-90 scale-0' : 'rotate-0 scale-100'}`}>
          <Menu className="h-5 w-5" />
        </div>
      </Button>
    </div>
  )

  return (
    <>
      <MobileMenuButton />
      
      <div className={`
        w-64 bg-background flex flex-col border-r border-border h-full pb-16
        md:relative fixed inset-y-0 left-0 z-40
        transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        transition-transform duration-300 ease-in-out
      `}>
        <div className="md:p-6 p-6 pt-16 md:pt-6">
          <h1 className="font-semibold text-xl">Cabin Audio</h1>
        </div>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="p-4 pt-2">
            <div className="space-y-1">
              <Button
                variant="ghost"
                className={`w-full justify-start ${activeTab === "library" ? "bg-purple-light text-purple hover:bg-purple-light hover:text-purple" : ""}`}
                onClick={() => handleTabChange("library")}
              >
                <Music className={`mr-2 h-4 w-4 ${activeTab === "library" ? "text-purple" : ""}`} />
                Music Library
              </Button>
              <Button
                variant="ghost"
                className={`w-full justify-start ${activeTab === "eq" ? "bg-electric-blue-light text-electric-blue hover:bg-electric-blue-light hover:text-electric-blue" : ""}`}
                onClick={() => handleTabChange("eq")}
              >
                <Sliders className={`mr-2 h-4 w-4 ${activeTab === "eq" ? "text-electric-blue" : ""}`} />
                EQ
              </Button>
              <Button
                variant="ghost"
                className={`w-full justify-start ${activeTab === "experiments" ? "bg-electric-blue-light text-electric-blue hover:bg-electric-blue-light hover:text-electric-blue" : ""}`}
                onClick={() => handleTabChange("experiments")}
              >
                <FlaskConical className={`mr-2 h-4 w-4 ${activeTab === "experiments" ? "text-electric-blue" : ""}`} />
                Experiments
              </Button>
            </div>

            <Separator className="my-4" />

            <div className="space-y-1">
              <Button
                variant="ghost"
                className={`w-full justify-start ${activeTab === "export" ? "bg-red-light text-red hover:bg-red-light hover:text-red" : ""}`}
                onClick={() => handleTabChange("export")}
              >
                <ExternalLink className={`mr-2 h-4 w-4 ${activeTab === "export" ? "text-red" : ""}`} />
                Export EQ Settings
              </Button>

              {false && <Button
                variant="ghost"
                className={`w-full justify-start ${activeTab === "desktop" ? "bg-red-light text-red hover:bg-red-light hover:text-red" : ""}`}
                onClick={() => handleTabChange("desktop")}
              >
                <Monitor className={`mr-2 h-4 w-4 ${activeTab === "desktop" ? "text-red" : ""}`} />
                Desktop App
              </Button>}

              {false && <Button
                variant="ghost"
                className={`w-full justify-start ${activeTab === "mobile" ? "bg-red-light text-red hover:bg-red-light hover:text-red" : ""}`}
                onClick={() => handleTabChange("mobile")}
              >
                <Smartphone className={`mr-2 h-4 w-4 ${activeTab === "mobile" ? "text-red" : ""}`} />
                Mobile App
              </Button>}

              {false && <div className="p-4 mt-4 mb-2 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-red" />
                  <h3 className="font-medium">Upgrade to Pro</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Get access to advanced EQ features, cloud storage, and more.
                </p>
                <Button size="sm" className="w-full bg-red hover:bg-red/90 text-white" onClick={onUpgradeClick}>
                  Upgrade Now
                </Button>
              </div>}
            </div>
          </div>
        </ScrollArea>
      </div>
      
      {/* Overlay for mobile menu */}
      {isMobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/50 z-30 
          animate-in fade-in duration-200"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  )
}


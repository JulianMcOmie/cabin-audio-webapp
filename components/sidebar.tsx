"use client"

import { ExternalLink, Monitor, Music, Sliders, Smartphone, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

interface SidebarProps {
  activeTab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile"
  setActiveTab: (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => void
  onUpgradeClick: () => void
  pushToHistory?: (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => void
}

export function Sidebar({ activeTab, setActiveTab, onUpgradeClick, pushToHistory }: SidebarProps) {
  // Helper function to handle tab changes
  const handleTabChange = (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => {
    if (pushToHistory) {
      // If pushToHistory is provided, use it to update history
      pushToHistory(tab);
    } else {
      // Otherwise, just set the active tab directly
      setActiveTab(tab);
    }
  };

  return (
    <div className="w-64 bg-background flex flex-col border-r border-border h-full pb-16">
      <div className="p-6">
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
  )
}


"use client"

import { useState } from "react"
import { TopBar } from "@/components/top-bar"
import { EQView } from "@/components/eq-view"
import { MusicLibrary } from "@/components/music-library/MusicLibrary"
import { PlayerBar } from "@/components/player-bar"
import { EQToolDock } from "@/components/eq-tool-dock"
import { Sidebar } from "@/components/sidebar"

type TabType = "eq" | "library"
type TabHistory = Array<TabType>

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("eq")
  const [eqEnabled, setEqEnabled] = useState(false)

  const [history, setHistory] = useState<TabHistory>(["eq"])
  const [currentIndex, setCurrentIndex] = useState(0)

  const pushToHistory = (tab: TabType) => {
    if (currentIndex < history.length - 1) {
      setHistory((prev) => prev.slice(0, currentIndex + 1))
    }

    if (history[currentIndex] !== tab) {
      setHistory((prev) => [...prev, tab])
      setCurrentIndex((prev) => prev + 1)
    }

    setActiveTab(tab)
  }

  const updateActiveTab = (tab: TabType) => {
    setActiveTab(tab)
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={updateActiveTab} pushToHistory={pushToHistory} />

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <TopBar setActiveTab={updateActiveTab} history={history} currentIndex={currentIndex} setCurrentIndex={setCurrentIndex} />

          {activeTab === "eq" ? (
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <EQView setEqEnabled={setEqEnabled} />
            </div>
          ) : (
            <div className="flex-1 pr-4 bg-main-section rounded-lg overflow-auto mb-2 pb-36">
              <main className="h-full p-6 pb-0 md:pt-6 pt-12">
                <MusicLibrary eqEnabled={eqEnabled} setActiveTab={pushToHistory} />
              </main>
            </div>
          )}
        </div>
      </div>

      {/* Global bottom bar — always visible, all tabs */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col">
        <EQToolDock />
        <PlayerBar />
      </div>
    </div>
  )
}

"use client"

import { useState } from "react"
import { TopBar } from "@/components/top-bar"
import { EQView } from "@/components/eq-view"
import { MusicLibrary } from "@/components/music-library"
import { PlayerBar } from "@/components/player-bar"
import { Sidebar } from "@/components/sidebar"
import { InstallView } from "@/components/install-view"
import ExportView from "@/components/export-view-component"
import { PricingModal } from "@/components/pricing-modal"
import { MobileView } from "@/components/mobile-view"

export default function Home() {
  const [activeTab, setActiveTab] = useState<"eq" | "library" | "export" | "desktop" | "mobile">("library")
  const [isPlaying, setIsPlaying] = useState(false)
  const [showPricingModal, setShowPricingModal] = useState(false)
  const [currentTrack, setCurrentTrack] = useState({
    title: "Ambient Forest",
    artist: "Nature Sounds",
    album: "Relaxation Series",
    duration: 240, // in seconds
    currentTime: 45, // in seconds
    coverUrl: "/placeholder.svg?height=60&width=60",
  })

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onUpgradeClick={() => setShowPricingModal(true)} />

        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar />

          <div className="flex-1 overflow-auto pr-4">
            <main className="h-full bg-main-section rounded-lg rounded-b-none p-6 pb-0">
              {activeTab === "eq" ? (
                <EQView isPlaying={isPlaying} setIsPlaying={setIsPlaying} />
              ) : activeTab === "library" ? (
                <MusicLibrary setCurrentTrack={setCurrentTrack} setIsPlaying={setIsPlaying} />
              ) : activeTab === "export" ? (
                <ExportView />
              ) : activeTab === "desktop" ? (
                <InstallView />
              ) : (
                <MobileView />
              )}
            </main>
          </div>
        </div>
      </div>

      <PlayerBar track={currentTrack} isPlaying={isPlaying} setIsPlaying={setIsPlaying} />

      <PricingModal open={showPricingModal} onClose={() => setShowPricingModal(false)} />
    </div>
  )
}


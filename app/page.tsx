"use client"

import { useState } from "react"
import { TopBar } from "@/components/top-bar"
import { EQView } from "@/components/eq-view"
import { MusicLibrary } from "@/components/music-library/MusicLibrary"
import { PlayerBar } from "@/components/player-bar"
import { Sidebar } from "@/components/sidebar"
import { InstallView } from "@/components/install-view"
import ExportView from "@/components/export-view-component"
import { PricingModal } from "@/components/pricing-modal"
import { MobileView } from "@/components/mobile-view"
import { ProfilePage } from "@/components/profile-page"

export default function Home() {
  const [activeTab, setActiveTab] = useState<"eq" | "library" | "export" | "desktop" | "mobile" | "profile">("library")
  const [isPlaying, setIsPlaying] = useState(false)
  const [showPricingModal, setShowPricingModal] = useState(false)
  const [eqEnabled, setEqEnabled] = useState(false) // Add this state
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
          <TopBar setActiveTab={setActiveTab} />

          <div className="flex-1 pr-4 bg-main-section rounded-lg overflow-auto mb-2">
            <main className="h-full p-6 pb-0">
              {activeTab === "eq" ? (
                <EQView
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  eqEnabled={eqEnabled}
                  setEqEnabled={setEqEnabled}
                />
              ) : activeTab === "library" ? (
                <MusicLibrary setCurrentTrack={setCurrentTrack} setIsPlaying={setIsPlaying} eqEnabled={eqEnabled} />
              ) : activeTab === "export" ? (
                <ExportView />
              ) : activeTab === "desktop" ? (
                <InstallView />
              ) : activeTab === "profile" ? (
                <ProfilePage />
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


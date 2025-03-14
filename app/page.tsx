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
import { SignupModal } from "@/components/signup-modal"
import { usePlayerStore } from "@/lib/stores"

export default function Home() {
  const [activeTab, setActiveTab] = useState<"eq" | "library" | "export" | "desktop" | "mobile" | "profile">("library")
  const [showPricingModal, setShowPricingModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  const [eqEnabled, setEqEnabled] = useState(false) // Add this state

  // Function to show the upgrade/pricing modal
  const handleShowUpgrade = () => {
    setShowPricingModal(true);
  }

  // Function to show the actual signup modal
  const handleShowSignup = () => {
    setShowSignupModal(true);
  }

  // Get isPlaying and setIsPlaying from playerStore for EQView
  const isPlaying = usePlayerStore(state => state.isPlaying);
  const setIsPlaying = usePlayerStore(state => state.setIsPlaying);

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar 
          activeTab={activeTab as any} // Use type assertion to fix the type issue
          setActiveTab={setActiveTab}
          onUpgradeClick={handleShowUpgrade} 
        />

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
                  onSignupClick={handleShowSignup}
                />
              ) : activeTab === "library" ? (
                <MusicLibrary 
                  eqEnabled={eqEnabled}
                  setActiveTab={setActiveTab}
                  onSignupClick={handleShowSignup}
                />
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

      <PlayerBar />

      <PricingModal open={showPricingModal} onClose={() => setShowPricingModal(false)} />
      <SignupModal open={showSignupModal} onClose={() => setShowSignupModal(false)} />
    </div>
  )
}


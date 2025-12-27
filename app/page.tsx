"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
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
// import { usePlayerStore } from "@/lib/stores"

// Dynamic import for client-only component (uses Web Audio API)
const RotatingDotGrid = dynamic(
  () => import("@/components/rotating-dot-grid").then(mod => ({ default: mod.RotatingDotGrid })),
  { ssr: false }
)

type TabType = "eq" | "library" | "export" | "desktop" | "mobile" | "profile" | "rotation";
type TabHistory = Array<TabType>;

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("library")
  const [showPricingModal, setShowPricingModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  const [eqEnabled, setEqEnabled] = useState(false)
  
  // Navigation history tracking
  const [history, setHistory] = useState<TabHistory>(['library'])
  const [currentIndex, setCurrentIndex] = useState(0)
  
  // Function to push to history and update active tab
  const pushToHistory = (tab: TabType) => {
    // If we're not at the end of history, truncate history
    if (currentIndex < history.length - 1) {
      setHistory(prev => prev.slice(0, currentIndex + 1))
    }
    
    // Don't add duplicate consecutive entries
    if (history[currentIndex] !== tab) {
      setHistory(prev => [...prev, tab])
      setCurrentIndex(prev => prev + 1)
    }
    
    // Set the active tab
    setActiveTab(tab)
  }
  
  // Standalone function to set active tab without pushing to history
  // This is used by the back/forward buttons
  const updateActiveTab = (tab: TabType) => {
    setActiveTab(tab)
  }

  // Function to show the upgrade/pricing modal
  const handleShowUpgrade = () => {
    setShowPricingModal(true);
  }

  // Function to show the actual signup modal
  const handleShowSignup = () => {
    setShowSignupModal(true);
  }

  // Get isPlaying and setIsPlaying from playerStore for EQView
//   const isPlaying = usePlayerStore(state => state.isPlaying);
//   const setIsPlaying = usePlayerStore(state => state.setIsPlaying);

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar 
          activeTab={activeTab}
          setActiveTab={updateActiveTab}
          onUpgradeClick={handleShowUpgrade}
          pushToHistory={pushToHistory}
        />

        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar 
            setActiveTab={updateActiveTab}
            history={history}
            currentIndex={currentIndex}
            setCurrentIndex={setCurrentIndex}
          />

          <div className="flex-1 pr-4 bg-main-section rounded-lg overflow-auto mb-2">
            <main className="h-full p-6 pb-0 md:pt-6 pt-12">
              {activeTab === "eq" ? (
                <EQView
                //   isPlaying={isPlaying}
                //   setIsPlaying={setIsPlaying}
                //   eqEnabled={eqEnabled}
                  setEqEnabled={setEqEnabled}
                //   onSignupClick={handleShowSignup}
                />
              ) : activeTab === "library" ? (
                <MusicLibrary
                  eqEnabled={eqEnabled}
                  setActiveTab={pushToHistory}
                  onSignupClick={handleShowSignup}
                />
              ) : activeTab === "rotation" ? (
                <div className="h-full flex flex-col">
                  <h2 className="text-2xl font-bold mb-4">Rotating Dot Grid</h2>
                  <div className="flex-1">
                    <RotatingDotGrid />
                  </div>
                </div>
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


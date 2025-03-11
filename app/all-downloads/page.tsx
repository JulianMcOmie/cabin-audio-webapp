"use client"

import { Apple, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TopBar } from "@/components/top-bar"
import { Sidebar } from "@/components/sidebar"
import { PlayerBar } from "@/components/player-bar"
import { useState } from "react"

export default function AllDownloadsPage() {
  const [activeTab, setActiveTab] = useState<"eq" | "library" | "install" | "export">("install")
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

          <main className="flex-1 overflow-auto p-6">
            <div className="container max-w-4xl py-8">
              <h1 className="text-3xl font-bold mb-8">Downloads</h1>

              <div className="grid gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Apple className="mr-2 h-5 w-5" />
                      macOS
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                      <div>
                        <p className="text-muted-foreground mb-2">Version 1.2.3 • macOS 11.0+ (Intel/Apple Silicon)</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          System-wide EQ and music library integration
                        </p>
                      </div>
                      <Button>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M0 0h24v24H0V0z" fill="none" />
                        <path d="M21.17 3.25Q21.5 3.25 21.76 3.5 22 3.74 22 4.08v15.84q0 .34-.24.58-.24.25-.59.25H2.83q-.34 0-.59-.25-.24-.24-.24-.58V4.08q0-.34.24-.58.25-.25.59-.25h18.34M5 15.17l3.17-1.85 3.17 1.85-.84-3.65 2.83-2.45-3.73-.32L8.17 5 6.74 8.75 3 9.07l2.83 2.45L5 15.17m7 0l3.17-1.85 3.17 1.85-.84-3.65 2.83-2.45-3.73-.32L15.17 5l-1.43 3.75-3.73.32 2.83 2.45-.84 3.65" />
                      </svg>
                      Windows
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                      <div>
                        <p className="text-muted-foreground mb-2">Version 1.2.1 • Windows 10/11 (64-bit)</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          System-wide audio processing for all applications
                        </p>
                      </div>
                      <Button>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Apple className="mr-2 h-5 w-5" />
                      iOS
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                      <div>
                        <p className="text-muted-foreground mb-2">Version 1.1.8 • iOS 14.0+</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          Works with your favorite music apps and AirPlay
                        </p>
                      </div>
                      <Button>
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                        </svg>
                        App Store
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M0 0h24v24H0z" fill="none" />
                        <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-2.86-1.21-6.08-1.21-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48C3.3 11.25 1.28 14.44 1 18h22c-.28-3.56-2.3-6.75-5.4-8.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z" />
                      </svg>
                      Android
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                      <div>
                        <p className="text-muted-foreground mb-2">Version 1.1.5 • Android 8.0+</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          System-wide audio processing and music player
                        </p>
                      </div>
                      <Button>
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3.609 1.814L13.792 12 3.609 22.186a.996.996 0 0 1-.609-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.535-3.535l-1.326-1.326 9.292 5.395-9.292 5.395 1.326-1.326 2.27-2.27a1 1 0 0 0 0-1.414l-2.27-2.27 5.657-5.657-5.657 3.473zm-2.209-2.209L5.188 13.6 15.825 6.963l-.707-.707-5.657-5.657 6.364 6.364z" />
                        </svg>
                        Google Play
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </main>
        </div>
      </div>

      <PlayerBar track={currentTrack} isPlaying={isPlaying} setIsPlaying={setIsPlaying} />
    </div>
  )
}


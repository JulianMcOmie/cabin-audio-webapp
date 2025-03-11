"use client"

import Link from "next/link"
import { ArrowLeft, Apple, Download, Laptop, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function InstallPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-16 border-b flex items-center px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Cabin Audio</span>
        </Link>
      </header>

      <main className="flex-1 container max-w-4xl py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Download Cabin Audio</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Get the Cabin Audio app on your favorite devices and enjoy your personalized EQ everywhere.
          </p>
        </div>

        <Tabs defaultValue="desktop" className="w-full">
          <TabsList className="grid grid-cols-2 w-full max-w-md mx-auto mb-8">
            <TabsTrigger value="desktop">
              <Laptop className="mr-2 h-4 w-4" />
              Desktop
            </TabsTrigger>
            <TabsTrigger value="mobile">
              <Smartphone className="mr-2 h-4 w-4" />
              Mobile
            </TabsTrigger>
          </TabsList>

          <TabsContent value="desktop" className="space-y-8">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Apple className="mr-2 h-5 w-5" />
                    macOS
                  </CardTitle>
                  <CardDescription>For macOS 11.0 or later</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p>
                      Our native macOS app provides system-wide EQ and seamless integration with your music library.
                    </p>
                    <Button className="w-full">
                      <Download className="mr-2 h-4 w-4" />
                      Download for macOS (Intel/Apple Silicon)
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
                  <CardDescription>For Windows 10 or later</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p>
                      Our Windows app integrates with your system audio for a seamless EQ experience across all
                      applications.
                    </p>
                    <Button className="w-full">
                      <Download className="mr-2 h-4 w-4" />
                      Download for Windows (64-bit)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Installation Instructions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-2">macOS</h3>
                    <ol className="list-decimal pl-5 space-y-2">
                      <li>Download the .dmg file</li>
                      <li>Open the .dmg file</li>
                      <li>Drag Cabin Audio to your Applications folder</li>
                      <li>Open Cabin Audio from your Applications folder</li>
                      <li>Follow the setup wizard to configure system audio permissions</li>
                    </ol>
                  </div>

                  <div>
                    <h3 className="font-medium mb-2">Windows</h3>
                    <ol className="list-decimal pl-5 space-y-2">
                      <li>Download the .exe installer</li>
                      <li>Run the installer</li>
                      <li>Follow the installation wizard</li>
                      <li>Launch Cabin Audio from the Start menu</li>
                      <li>Follow the setup wizard to configure system audio</li>
                    </ol>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mobile" className="space-y-8">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Apple className="mr-2 h-5 w-5" />
                    iOS
                  </CardTitle>
                  <CardDescription>For iOS 14.0 or later</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p>Our iOS app works with your favorite music apps and supports AirPlay for wireless audio.</p>
                    <Button className="w-full">
                      <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                      </svg>
                      Download on the App Store
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
                  <CardDescription>For Android 8.0 or later</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p>Our Android app works with popular music services and supports system-wide audio processing.</p>
                    <Button className="w-full">
                      <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3.609 1.814L13.792 12 3.609 22.186a.996.996 0 0 1-.609-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.535-3.535l-1.326-1.326 9.292 5.395-9.292 5.395 1.326-1.326 2.27-2.27a1 1 0 0 0 0-1.414l-2.27-2.27 5.657-5.657-5.657 3.473zm-2.209-2.209L5.188 13.6 15.825 6.963l-.707-.707-5.657-5.657 6.364 6.364z" />
                      </svg>
                      Get it on Google Play
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Mobile Features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p>Our mobile apps include all the features you love from the desktop version:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>Real-time EQ adjustments</li>
                    <li>Sync your EQ profiles across all your devices</li>
                    <li>Offline playback of your music library</li>
                    <li>Background audio processing</li>
                    <li>Integration with popular music streaming services</li>
                    <li>Customizable interface</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}


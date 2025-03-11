"use client"

import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

interface PricingModalProps {
  open: boolean
  onClose: () => void
}

export function PricingModal({ open, onClose }: PricingModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px]">
        <div className="py-4">
          <h2 className="text-2xl font-bold text-center mb-6">Upgrade to Pro</h2>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Basic</CardTitle>
                <div className="mt-2 flex items-baseline text-3xl font-bold">Free</div>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>Basic EQ functionality</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>1 EQ profile</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>Local file playback</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>100MB storage</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Button variant="outline" className="w-full" disabled>
                  Current Plan
                </Button>
              </CardFooter>
            </Card>

            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Pro</CardTitle>
                <div className="mt-2 flex items-baseline text-3xl font-bold">
                  $3<span className="ml-1 text-xl font-medium text-muted-foreground">/month</span>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>Everything in Basic</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>Left/right channel adjustments</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>Unlimited EQ profiles</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>Cloud sync across devices</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>10GB storage</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-teal-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>Playlist creation</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Button className="w-full">Upgrade Now</Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


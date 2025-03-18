"use client"

import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

export function PricingView() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-4">Choose Your Plan</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Upgrade to Pro for advanced features and unlimited EQ profiles.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Basic</CardTitle>
            <div className="mt-4 flex items-baseline text-5xl font-extrabold">Free</div>
            <CardDescription className="mt-4">For casual listeners</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-3">
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>Basic EQ functionality</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>1 EQ profile</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>Local file playback</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
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
            <div className="mt-4 flex items-baseline text-5xl font-extrabold">
              $3<span className="ml-1 text-2xl font-medium text-muted-foreground">/month</span>
            </div>
            <CardDescription className="mt-4">For audio enthusiasts</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-3">
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>Everything in Basic</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>Left/right channel adjustments</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>Unlimited EQ profiles</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>Cloud sync across devices</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>10GB storage</span>
              </li>
              <li className="flex items-start">
                <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                <span>Playlist creation</span>
              </li>
            </ul>
          </CardContent>
          <CardFooter>
            <Button className="w-full">Upgrade Now</Button>
          </CardFooter>
        </Card>
      </div>

      <div className="mt-12 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4 text-center">Frequently Asked Questions</h2>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium">Can I cancel my subscription anytime?</h3>
            <p className="text-muted-foreground mt-1">
              Yes, you can cancel your subscription at any time. Your benefits will continue until the end of your
              billing period.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Is there a free trial?</h3>
            <p className="text-muted-foreground mt-1">
              Yes, we offer a 14-day free trial for the Pro plan. No credit card required.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Will I lose my data if I downgrade?</h3>
            <p className="text-muted-foreground mt-1">
              If you downgrade to the Basic plan, you&apos;ll keep your primary EQ profile, but additional profiles will be
              archived until you upgrade again.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}


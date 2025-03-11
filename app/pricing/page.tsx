"use client"

import Link from "next/link"
import { ArrowLeft, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

export default function PricingPage() {
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

      <main className="flex-1 container max-w-6xl py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Pricing Plans</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Choose the perfect plan for your audio needs. All plans include our core EQ technology.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Free</CardTitle>
              <div className="mt-4 flex items-baseline text-5xl font-extrabold">
                $0<span className="ml-1 text-2xl font-medium text-muted-foreground">/month</span>
              </div>
              <CardDescription className="mt-4">Perfect for casual listeners</CardDescription>
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
              <Button variant="outline" className="w-full">
                Current Plan
              </Button>
            </CardFooter>
          </Card>

          <Card className="flex flex-col border-teal-500 shadow-md relative">
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-teal-500 text-white px-4 py-1 rounded-full text-sm font-medium">
              Most Popular
            </div>
            <CardHeader>
              <CardTitle>Pro</CardTitle>
              <div className="mt-4 flex items-baseline text-5xl font-extrabold">
                $9.99<span className="ml-1 text-2xl font-medium text-muted-foreground">/month</span>
              </div>
              <CardDescription className="mt-4">For audio enthusiasts</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-3">
                <li className="flex items-start">
                  <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                  <span>Advanced EQ functionality</span>
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
                <li className="flex items-start">
                  <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                  <span>No ads</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button className="w-full">Subscribe Now</Button>
            </CardFooter>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Studio</CardTitle>
              <div className="mt-4 flex items-baseline text-5xl font-extrabold">
                $19.99<span className="ml-1 text-2xl font-medium text-muted-foreground">/month</span>
              </div>
              <CardDescription className="mt-4">For professionals</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-3">
                <li className="flex items-start">
                  <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                  <span>Professional EQ tools</span>
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
                  <span>100GB storage</span>
                </li>
                <li className="flex items-start">
                  <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                  <span>Advanced audio analysis</span>
                </li>
                <li className="flex items-start">
                  <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                  <span>Priority support</span>
                </li>
                <li className="flex items-start">
                  <Check className="h-5 w-5 text-teal-500 mr-2 flex-shrink-0" />
                  <span>API access</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full">
                Subscribe Now
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="mt-16 text-center">
          <h2 className="text-2xl font-bold mb-4">Frequently Asked Questions</h2>
          <div className="max-w-3xl mx-auto grid gap-6 mt-8">
            <div className="text-left">
              <h3 className="font-medium text-lg">Can I cancel my subscription anytime?</h3>
              <p className="text-muted-foreground mt-1">
                Yes, you can cancel your subscription at any time. Your benefits will continue until the end of your
                billing period.
              </p>
            </div>
            <div className="text-left">
              <h3 className="font-medium text-lg">Is there a free trial?</h3>
              <p className="text-muted-foreground mt-1">
                Yes, we offer a 14-day free trial for both Pro and Studio plans. No credit card required.
              </p>
            </div>
            <div className="text-left">
              <h3 className="font-medium text-lg">What payment methods do you accept?</h3>
              <p className="text-muted-foreground mt-1">We accept all major credit cards, PayPal, and Apple Pay.</p>
            </div>
            <div className="text-left">
              <h3 className="font-medium text-lg">Can I switch between plans?</h3>
              <p className="text-muted-foreground mt-1">
                Yes, you can upgrade or downgrade your plan at any time. Changes will take effect on your next billing
                cycle.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}


"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/auth-context"
import { Eye, EyeOff, Save } from "lucide-react"
import { Progress } from "@/components/ui/progress"

export function ProfilePage() {
  const { user } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Please log in to view your profile.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-8 pb-24">
      {" "}
      {/* Added pb-24 for bottom padding */}
      <h1 className="text-3xl font-bold mb-2">Your Account</h1>
      <p className="text-muted-foreground mb-8">Manage your profile and subscription.</p>
      <div className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" defaultValue={user.email} disabled />
                <p className="text-xs text-muted-foreground mt-1">To change your email, please contact support.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subscription Plan */}
        <Card>
          <CardHeader>
            <CardTitle>Subscription Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium">Current Plan: Free</h3>
                <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full dark:bg-green-900/40 dark:text-green-300">
                  Active
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Basic EQ functionality, 1 EQ profile, and 100MB storage.
              </p>
              <Button className="bg-electric-blue hover:bg-electric-blue/90 text-white">Upgrade to Pro</Button>
            </div>
          </CardContent>
        </Card>

        {/* Storage Usage */}
        <Card>
          <CardHeader>
            <CardTitle>Storage Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">23.5 MB used of 100 MB</span>
                <span className="text-xs text-muted-foreground">23.5%</span>
              </div>
              <Progress value={23.5} className="h-2" />
            </div>

            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full bg-electric-blue mr-2"></div>
                    <span className="text-sm">Music Files</span>
                  </div>
                  <span className="text-sm">18.2 MB</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full bg-purple mr-2"></div>
                    <span className="text-sm">EQ Profiles</span>
                  </div>
                  <span className="text-sm">5.3 MB</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Password Reset */}
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <div className="relative">
                <Input id="current-password" type={showCurrentPassword ? "text" : "password"} placeholder="••••••••" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                >
                  {showCurrentPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="sr-only">{showCurrentPassword ? "Hide password" : "Show password"}</span>
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input id="new-password" type={showPassword ? "text" : "password"} placeholder="••••••••" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="sr-only">{showPassword ? "Hide password" : "Show password"}</span>
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input id="confirm-password" type="password" placeholder="••••••••" />
            </div>
            <Button>
              <Save className="h-4 w-4 mr-2" />
              Update Password
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


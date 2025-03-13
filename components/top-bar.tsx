"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowLeft, ArrowRight, LogIn, Search, Settings, User, UserPlus, X, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoginModal } from "@/components/login-modal"
import { SignupModal } from "@/components/signup-modal"
import { SearchResults } from "@/components/search-results"
import { useTheme } from "@/components/theme-provider"

interface TopBarProps {
  setActiveTab?: (tab: "eq" | "library" | "export" | "desktop" | "mobile" | "profile") => void
}

export function TopBar({ setActiveTab }: TopBarProps) {
  const { user, signOut } = useAuth()
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const searchRef = useRef<HTMLDivElement>(null)
  const { theme, setTheme } = useTheme()

  // Close search results when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchFocused(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  // For debugging - log the user state
  useEffect(() => {
    console.log("Current user state:", user)
  }, [user])

  return (
    <>
      <div className="h-16 flex items-center px-6 bg-background">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span className="sr-only">Toggle theme</span>
          </Button>
          <div className="relative w-64" ref={searchRef}>
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7 rounded-full"
                onClick={() => {
                  setSearchQuery("")
                  setSearchFocused(false)
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
            <Input
              type="search"
              placeholder="Search..."
              className="w-full pl-9 h-9"
              onFocus={() => setSearchFocused(true)}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchFocused && <SearchResults query={searchQuery} />}
          </div>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full bg-gradient-to-br from-electric-blue/20 to-purple/20 border border-electric-blue/30 dark:from-electric-blue/30 dark:to-purple/30"
                >
                  <span className="font-medium text-sm text-electric-blue dark:text-electric-blue">
                    {user.email.substring(0, 1).toUpperCase()}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">My Account</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    if (setActiveTab) setActiveTab("profile")
                  }}
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (setActiveTab) setActiveTab("eq")
                  }}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  <span>EQ Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogIn className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 hover:bg-secondary"
                onClick={() => setShowSignupModal(true)}
              >
                <UserPlus className="h-4 w-4" />
                <span>Sign up</span>
              </Button>

              <Button size="sm" className="gap-1 ml-1" onClick={() => setShowLoginModal(true)}>
                <LogIn className="h-4 w-4" />
                <span>Log in</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <SignupModal open={showSignupModal} onClose={() => setShowSignupModal(false)} />
    </>
  )
}


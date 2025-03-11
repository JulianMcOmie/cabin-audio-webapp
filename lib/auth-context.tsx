"use client"

import type React from "react"

import { createContext, useContext, useState, useEffect } from "react"

type User = {
  email: string
  isSignedIn: boolean
}

type AuthContextType = {
  user: User | null
  signIn: (email: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  signIn: () => {},
  signOut: () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  // Check for saved user on mount
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem("cabin-audio-user")
      if (savedUser) {
        setUser(JSON.parse(savedUser))
      }
    } catch (error) {
      console.error("Error loading user from localStorage:", error)
    }
  }, [])

  const signIn = (email: string) => {
    try {
      const newUser = { email, isSignedIn: true }
      setUser(newUser)
      localStorage.setItem("cabin-audio-user", JSON.stringify(newUser))
    } catch (error) {
      console.error("Error saving user to localStorage:", error)
    }
  }

  const signOut = () => {
    setUser(null)
    try {
      localStorage.removeItem("cabin-audio-user")
    } catch (error) {
      console.error("Error removing user from localStorage:", error)
    }
  }

  return <AuthContext.Provider value={{ user, signIn, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}


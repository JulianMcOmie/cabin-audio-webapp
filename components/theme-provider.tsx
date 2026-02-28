"use client"

import type * as React from "react"
import { createContext, useContext, useEffect } from "react"

type ThemeProviderProps = {
  children: React.ReactNode
  attribute?: string
  defaultTheme?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: string
  setTheme: (theme: string) => void
}

const ThemeProviderContext = createContext<ThemeProviderState>({
  theme: "dark",
  setTheme: () => null,
})

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light")
    root.classList.add("dark")
  }, [])

  return (
    <ThemeProviderContext.Provider {...props} value={{ theme: "dark", setTheme: () => null }}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider")
  return context
}

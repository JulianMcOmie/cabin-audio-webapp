"use client"

import type React from "react"

import { createContext, useCallback, useContext, useState } from "react"
import dynamic from "next/dynamic"
import { Toast, type ToastProps } from "./Toast"

type ToastOptions = Omit<ToastProps, "id" | "onDismiss">

interface ToastContextType {
  showToast: (options: ToastOptions) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

// Dynamic import of ToastContainer to avoid hydration errors
const ToastContainer = dynamic(() => Promise.resolve(({ toasts, dismissToast }: { toasts: ToastProps[], dismissToast: (id: string) => void }) => (
  <div className="fixed top-0 z-[100] flex flex-col items-end gap-2 px-4 py-6 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col-reverse sm:items-end sm:justify-start">
    {toasts.map((toast) => (
      <Toast key={toast.id} {...toast} onDismiss={() => dismissToast(toast.id)} />
    ))}
  </div>
)), { ssr: false })

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastProps[]>([])

  const showToast = useCallback((options: ToastOptions) => {
    const id = Math.random().toString(36).substring(2, 9)
    const toast = { ...options, id }

    setToasts((prev) => [...prev, toast])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} dismissToast={dismissToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider")
  }

  return context
}

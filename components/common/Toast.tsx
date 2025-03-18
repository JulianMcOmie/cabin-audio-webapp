"use client"

import { useEffect } from "react"
import { X } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all",
  {
    variants: {
      variant: {
        success:
          "bg-green-50 text-green-900 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800",
        error: "bg-red-50 text-red-900 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800",
        info: "bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
)

export interface ToastProps extends VariantProps<typeof toastVariants> {
  id: string
  message: string
  duration?: number
  onDismiss?: () => void
}

export function Toast({ message, variant, duration = 1000, onDismiss }: ToastProps) {
  useEffect(() => {
    if (duration === Number.POSITIVE_INFINITY) return

    const timer = setTimeout(() => {
      onDismiss?.()
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onDismiss])

  return (
    <div className={cn(toastVariants({ variant }), "animate-in slide-in-from-right")}>
      <div className="flex-1">
        <p className="text-sm font-medium">{message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </button>
    </div>
  )
}


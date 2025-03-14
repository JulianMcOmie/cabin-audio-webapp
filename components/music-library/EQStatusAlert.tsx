"use client"

import { Button } from "@/components/ui/button"

interface EQStatusAlertProps {
  isEnabled: boolean
  onSettingsClick: () => void
}

export function EQStatusAlert({ isEnabled, onSettingsClick }: EQStatusAlertProps) {
  return (
    <div
      className={`rounded-lg p-4 mb-4 flex items-center justify-between ${
        isEnabled
          ? "bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800"
          : "bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
      }`}
    >
      <div className="flex items-center">
        {isEnabled ? (
          <>
            <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-800 flex items-center justify-center mr-3">
              <svg
                className="h-4 w-4 text-green-600 dark:text-green-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">EQ is enabled</p>
              <p className="text-xs text-muted-foreground">
                Your music is being enhanced with your custom EQ settings
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center mr-3">
              <svg
                className="h-4 w-4 text-blue-600 dark:text-blue-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                Enhance your listening experience
              </p>
              <p className="text-xs text-muted-foreground">
                Personalized EQ can dramatically improve sound quality and spatial separation
              </p>
            </div>
          </>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className={
          isEnabled
            ? "text-green-600 hover:text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30"
            : "text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30"
        }
        onClick={onSettingsClick}
      >
        {isEnabled ? "Adjust EQ" : "Try EQ"}
      </Button>
    </div>
  )
} 
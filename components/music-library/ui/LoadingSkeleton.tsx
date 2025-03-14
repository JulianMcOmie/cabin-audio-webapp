"use client"

import { Separator } from "@/components/ui/separator"

interface LoadingSkeletonProps {
  itemCount?: number
  className?: string
}

export function LoadingSkeleton({ itemCount = 5, className = "" }: LoadingSkeletonProps) {
  return (
    <div className={`mx-auto space-y-8 ${className}`}>
      {/* EQ Status Alert - Skeleton */}
      <div className="rounded-lg p-4 mb-4 animate-pulse bg-muted">
        <div className="flex items-center">
          <div className="h-8 w-8 rounded-full bg-muted-foreground/20 mr-3"></div>
          <div className="space-y-2">
            <div className="h-4 w-40 bg-muted-foreground/20 rounded"></div>
            <div className="h-3 w-64 bg-muted-foreground/20 rounded"></div>
          </div>
        </div>
      </div>

      {/* Header - Skeleton */}
      <div className="flex justify-between items-center mb-2">
        <div className="space-y-2">
          <div className="h-6 w-40 bg-muted-foreground/20 rounded"></div>
          <div className="h-4 w-56 bg-muted-foreground/20 rounded"></div>
        </div>
      </div>

      {/* Track List - Skeleton */}
      <div className="rounded-md border p-4">
        {Array(itemCount)
          .fill(0)
          .map((_, index) => (
            <div key={index}>
              <div className="flex items-center py-3 px-2 animate-pulse">
                <div className="h-12 w-12 bg-muted-foreground/20 rounded-md mr-4"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted-foreground/20 rounded w-3/4"></div>
                  <div className="h-3 bg-muted-foreground/20 rounded w-1/2"></div>
                </div>
                <div className="h-4 w-10 bg-muted-foreground/20 rounded"></div>
              </div>
              {index < itemCount - 1 && <Separator />}
            </div>
          ))}
      </div>

      {/* Import Area - Skeleton */}
      <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center animate-pulse">
        <div className="flex flex-col items-center justify-center">
          <div className="h-20 w-20 rounded-full bg-muted-foreground/20"></div>
          <div className="h-6 w-56 bg-muted-foreground/20 rounded mt-4"></div>
          <div className="h-4 w-72 bg-muted-foreground/20 rounded mt-2"></div>
          <div className="h-10 w-32 bg-muted-foreground/20 rounded mt-4"></div>
        </div>
      </div>
    </div>
  )
} 
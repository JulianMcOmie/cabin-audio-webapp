"use client"

import { Separator } from "@/components/ui/separator"

interface LoadingSkeletonProps {
  itemCount?: number
  className?: string
}

export function LoadingSkeleton({ itemCount = 5, className = "" }: LoadingSkeletonProps) {
  return (
    <div className={`mx-auto ${className}`}>
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
    </div>
  )
} 
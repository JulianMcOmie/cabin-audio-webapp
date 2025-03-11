import type React from "react"
import { InfoIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface InfoCircleProps {
  children: React.ReactNode
  className?: string
  size?: "sm" | "md" | "lg"
}

export function InfoCircle({ children, className, size = "md" }: InfoCircleProps) {
  const sizeClasses = {
    sm: "text-xs p-2",
    md: "text-sm p-3",
    lg: "text-base p-4",
  }

  return (
    <div className={cn("flex items-center gap-2 bg-muted/50 rounded-md", sizeClasses[size], className)}>
      <InfoIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <span className="text-muted-foreground">{children}</span>
    </div>
  )
}


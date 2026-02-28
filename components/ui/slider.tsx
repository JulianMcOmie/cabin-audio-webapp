"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    rangeClassName?: string
    thumbClassName?: string
  }
>(({ className, orientation = "horizontal", rangeClassName, thumbClassName, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    orientation={orientation}
    className={cn(
      "relative flex touch-none select-none",
      orientation === "vertical" ? "h-full flex-col items-center" : "w-full items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track
      className={cn(
        "relative grow overflow-hidden rounded-full bg-secondary",
        orientation === "vertical" ? "h-full w-1.5" : "h-1.5 w-full"
      )}
    >
      <SliderPrimitive.Range className={cn(
        "absolute bg-primary",
        orientation === "vertical" ? "w-full" : "h-full",
        rangeClassName
      )} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className={cn(
      "block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      thumbClassName
    )} />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }

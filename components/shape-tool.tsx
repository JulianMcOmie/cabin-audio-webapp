"use client"

import { useRef, useEffect, useState } from "react"
import { Slider } from "@/components/ui/slider"
import * as shapeToolAudio from '@/lib/audio/shapeToolAudio'

// Define Diamond Parameters Type (matching audio player)
interface DiamondParams {
  center: { x: number, y: number }; // Normalized (-1 to 1)
  size: { width: number, height: number }; // Normalized (total width/height, max 2)
  pointCount: number;
}

// Define interaction target types
type DragTarget = 'none' | 'center' | 'top' | 'bottom' | 'left' | 'right';

interface ShapeToolProps {
  isPlaying: boolean;
  disabled?: boolean;
}

export function ShapeTool({ isPlaying, disabled = false }: ShapeToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false) // Keep for distinguishing drag types
  const [dragTarget, setDragTarget] = useState<DragTarget>('none')
  const [shapeParams, setShapeParams] = useState<DiamondParams>({
    center: { x: 0, y: 0 }, // Center of the canvas
    size: { width: 1, height: 1 }, // Half width/height initially
    pointCount: 12, // Default number of points
  })
  
  const [lastMousePos, setLastMousePos] = useState<{ x: number, y: number } | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [hoverState, setHoverState] = useState<DragTarget>('none') // Reuse DragTarget type for hover
  
  // State for morph animation
  const [visualMorphFactor, setVisualMorphFactor] = useState(0); // 0=diamond, 1=X
  const morphAnimationRef = useRef<number | null>(null);
  const morphDirectionRef = useRef<number>(1); // 1 for X, -1 for Diamond
  const morphSpeed = 0.01; // Adjust for desired morph speed (0 to 1 range)
  // No need for local morphFactor state unless displaying it

  // Constants for interaction
  const HANDLE_RADIUS = 10; // Pixel radius for interaction
  const CENTER_RADIUS = 12;

  // Set up observer to detect theme changes
  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"))
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          setIsDarkMode(document.documentElement.classList.contains("dark"))
        }
      })
    })
    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])
  
  // Initialize the audio player and update it when shape changes
  useEffect(() => {
    const audioPlayer = shapeToolAudio.getShapeToolAudioPlayer();
    // Update the base shape parameters in the audio player when they change
    // The morph factor will be applied on top during animation
    audioPlayer.updateShape(shapeParams); 
    // No cleanup needed here unless the component itself unmounts
  }, [shapeParams])

  // Separate effect for initializing/cleaning up audio player on mount/unmount
  useEffect(() => {
    // Initialize on mount (getInstance handles singleton)
    shapeToolAudio.getShapeToolAudioPlayer(); 
    
    return () => {
      // Clean up audio on unmount
      shapeToolAudio.cleanupShapeToolAudioPlayer();
    }
  }, [])
  
  // Update audio player playing state
  useEffect(() => {
    const audioPlayer = shapeToolAudio.getShapeToolAudioPlayer()
    audioPlayer.setPlaying(isPlaying && !disabled)
  }, [isPlaying, disabled])
  
  // Update canvas size on resize (Identical to GlyphGrid)
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr)
    }
    updateCanvasSize()
    window.addEventListener('resize', updateCanvasSize)
    return () => window.removeEventListener('resize', updateCanvasSize)
  }, [])
  
  // Morph Animation Loop
  useEffect(() => {
    let currentMorphFactor = visualMorphFactor; // Start from current visual state
    const animate = () => {
      if (!isPlaying || disabled) {
        if (morphAnimationRef.current) cancelAnimationFrame(morphAnimationRef.current); 
        morphAnimationRef.current = null;
        return; 
      }

      // Calculate next morph factor
      currentMorphFactor += morphDirectionRef.current * morphSpeed;

      // Clamp and reverse direction
      if (currentMorphFactor >= 1) {
        currentMorphFactor = 1;
        morphDirectionRef.current = -1; // Move towards diamond
      } else if (currentMorphFactor <= 0) {
        currentMorphFactor = 0;
        morphDirectionRef.current = 1; // Move towards X
      }

      // Update the audio player's morph factor
      shapeToolAudio.getShapeToolAudioPlayer().setMorphFactor(currentMorphFactor);
      // Update the visual morph factor state
      setVisualMorphFactor(currentMorphFactor);

      morphAnimationRef.current = requestAnimationFrame(animate);
    };

    if (isPlaying && !disabled) {
      // Start animation only if not already running
      if (morphAnimationRef.current === null) {
          // Reset starting factor and direction when play starts
          setVisualMorphFactor(0); // Reset visual state
          const player = shapeToolAudio.getShapeToolAudioPlayer();
          player.setMorphFactor(0); // Start as diamond
          currentMorphFactor = 0;
          morphDirectionRef.current = 1; // Start moving towards X
        morphAnimationRef.current = requestAnimationFrame(animate);
      }
    } else {
      // Stop animation if playing stops or component is disabled
      if (morphAnimationRef.current !== null) {
        cancelAnimationFrame(morphAnimationRef.current);
        morphAnimationRef.current = null;
        // Optionally reset morph factor when stopping?
        // shapeToolAudio.getShapeToolAudioPlayer().setMorphFactor(0);
        // setVisualMorphFactor(0);
      }
    }

    // Cleanup function to stop animation on unmount or when isPlaying changes
    return () => {
      if (morphAnimationRef.current !== null) {
        cancelAnimationFrame(morphAnimationRef.current);
        morphAnimationRef.current = null;
      }
    };
  }, [isPlaying, disabled]); // Rerun effect if isPlaying or disabled changes
  
  // Draw the diamond and points on the canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    
    // --- Calculate Diamond Vertices (Canvas Coords) --- 
    const { center, size } = shapeParams;
    const topY_norm = Math.min(1, center.y + size.height / 2);
    const bottomY_norm = Math.max(-1, center.y - size.height / 2);
    const rightX_norm = Math.min(1, center.x + size.width / 2);
    const leftX_norm = Math.max(-1, center.x - size.width / 2);

    // Function to convert normalized (-1 to 1) to canvas coords
    const normToCanvas = (normX: number, normY: number) => ({
        x: (normX + 1) / 2 * rect.width,
        y: (1 - normY) / 2 * rect.height // Y is inverted
    });

    // Define normalized vertices array *after* normToCanvas is defined, but *before* use
    const vertices = [
      { x: center.x, y: bottomY_norm }, // Bottom (normalized)
      { x: rightX_norm, y: center.y },  // Right (normalized)
      { x: center.x, y: topY_norm },    // Top (normalized)
      { x: leftX_norm, y: center.y },   // Left (normalized)
    ];

    const center_canvas = normToCanvas(center.x, center.y);
    const vertices_canvas = [
      normToCanvas(center.x, bottomY_norm), // Bottom
      normToCanvas(rightX_norm, center.y),  // Right
      normToCanvas(center.x, topY_norm),    // Top
      normToCanvas(leftX_norm, center.y)    // Left
    ];
    
    // --- Draw Diamond Outline (always draw the base diamond) --- 
    ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vertices_canvas[0].x, vertices_canvas[0].y);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(vertices_canvas[i].x, vertices_canvas[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    // --- Calculate and Draw Perimeter Points --- 
    const pointsPerEdge = Math.max(1, Math.floor(shapeParams.pointCount / 4));
    const totalPointsToGenerate = pointsPerEdge * 4;
    const pointRadius = 4;
    ctx.fillStyle = isDarkMode ? "#38bdf8" : "#0284c7"; // Sky blue color

    let currentPointIndex = 0;
    for (let i = 0; i < 4; i++) {
        const startVertex = vertices_canvas[i];
        const startVertexNorm = vertices[i]; // Use correct normalized vertices
        const endVertex = vertices_canvas[(i + 1) % 4];
        const endVertexNorm = vertices[(i + 1) % 4]; // Use correct normalized vertices
        
        for (let j = 0; j < pointsPerEdge; j++) {
            if (currentPointIndex >= totalPointsToGenerate) break;
            
            const t = j / pointsPerEdge;
            // Calculate diamond point position in canvas coords
            const pointX = startVertex.x + t * (endVertex.x - startVertex.x);
            const pointY = startVertex.y + t * (endVertex.y - startVertex.y);
            
            // Calculate diamond point position in normalized coords
            const pointX_norm = startVertexNorm.x + t * (endVertexNorm.x - startVertexNorm.x);
            const pointY_norm = startVertexNorm.y + t * (endVertexNorm.y - startVertexNorm.y);

            // --- Calculate Target X position (Normalized Coords) ---
            let targetX_norm, targetY_norm;
            const diamondCenter = shapeParams.center; // Center of the diamond
            const t_edge = t; // t is j / pointsPerEdge, progress along current diamond edge

            // Normalized bounding box corners (topY_norm, bottomY_norm, etc. are already defined in this scope)
            const corner_BR_bb = { x: rightX_norm, y: bottomY_norm };
            const corner_TR_bb = { x: rightX_norm, y: topY_norm };
            const corner_TL_bb = { x: leftX_norm, y: topY_norm };
            const corner_BL_bb = { x: leftX_norm, y: bottomY_norm };

            if (i === 0) { // Edge 0: Diamond\'s Bottom point to Right point
                           // Target: X-arm from diamondCenter to bounding_box_BottomRight_corner
                targetX_norm = diamondCenter.x + t_edge * (corner_BR_bb.x - diamondCenter.x);
                targetY_norm = diamondCenter.y + t_edge * (corner_BR_bb.y - diamondCenter.y);
            } else if (i === 1) { // Edge 1: Diamond\'s Right point to Top point
                                  // Target: X-arm from diamondCenter to bounding_box_TopRight_corner
                targetX_norm = diamondCenter.x + t_edge * (corner_TR_bb.x - diamondCenter.x);
                targetY_norm = diamondCenter.y + t_edge * (corner_TR_bb.y - diamondCenter.y);
            } else if (i === 2) { // Edge 2: Diamond\'s Top point to Left point
                                  // Target: X-arm from diamondCenter to bounding_box_TopLeft_corner
                targetX_norm = diamondCenter.x + t_edge * (corner_TL_bb.x - diamondCenter.x);
                targetY_norm = diamondCenter.y + t_edge * (corner_TL_bb.y - diamondCenter.y);
            } else { // i === 3 // Edge 3: Diamond\'s Left point to Bottom point
                               // Target: X-arm from diamondCenter to bounding_box_BottomLeft_corner
                targetX_norm = diamondCenter.x + t_edge * (corner_BL_bb.x - diamondCenter.x);
                targetY_norm = diamondCenter.y + t_edge * (corner_BL_bb.y - diamondCenter.y);
            }

            // --- Interpolate (Normalized Coords) ---
            const interpolatedX_norm = pointX_norm + (targetX_norm - pointX_norm) * visualMorphFactor;
            const interpolatedY_norm = pointY_norm + (targetY_norm - pointY_norm) * visualMorphFactor;

            // Convert final interpolated position to canvas coords
            const finalCanvasPos = normToCanvas(interpolatedX_norm, interpolatedY_norm);

            // Draw the point at the final interpolated position
            ctx.beginPath();
            ctx.arc(finalCanvasPos.x, finalCanvasPos.y, pointRadius, 0, Math.PI * 2);
            ctx.fill();
            currentPointIndex++;
        }
    }

    // --- Draw Interaction Handles --- 
    if (!disabled) {
      const handleTargets: { pos: { x: number; y: number }; target: DragTarget }[] = [
        { pos: center_canvas, target: 'center' },
        { pos: vertices_canvas[0], target: 'bottom' },
        { pos: vertices_canvas[1], target: 'right' },
        { pos: vertices_canvas[2], target: 'top' },
        { pos: vertices_canvas[3], target: 'left' },
      ];

      handleTargets.forEach(({ pos, target }) => {
          const radius = target === 'center' ? CENTER_RADIUS : HANDLE_RADIUS;
          const isHovering = hoverState === target && !isDragging && !isResizing;
          
          // Hover highlight
          if (isHovering) {
            ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
            ctx.fill();
          }
          
          // Handle itself
          ctx.fillStyle = isDarkMode ? 'white' : 'black';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
          ctx.fill();
      });
    }

  }, [shapeParams, isPlaying, disabled, isDarkMode, hoverState, isDragging, isResizing, visualMorphFactor])
  
  // Function to check what interaction handle is under the cursor
  const checkHoverTarget = (mouseX: number, mouseY: number): DragTarget => {
    const canvas = canvasRef.current;
    if (!canvas) return 'none';
    const rect = canvas.getBoundingClientRect();

    // Calculate handle positions in canvas coords
    const { center, size } = shapeParams;
    const topY_norm = Math.min(1, center.y + size.height / 2);
    const bottomY_norm = Math.max(-1, center.y - size.height / 2);
    const rightX_norm = Math.min(1, center.x + size.width / 2);
    const leftX_norm = Math.max(-1, center.x - size.width / 2);
    const normToCanvas = (normX: number, normY: number) => ({ x: (normX + 1) / 2 * rect.width, y: (1 - normY) / 2 * rect.height });
    const center_canvas = normToCanvas(center.x, center.y);
    const bottom_canvas = normToCanvas(center.x, bottomY_norm);
    const right_canvas = normToCanvas(rightX_norm, center.y);
    const top_canvas = normToCanvas(center.x, topY_norm);
    const left_canvas = normToCanvas(leftX_norm, center.y);

    const handleTargets: { pos: { x: number; y: number }; target: DragTarget; radius: number }[] = [
      { pos: center_canvas, target: 'center', radius: CENTER_RADIUS },
      { pos: bottom_canvas, target: 'bottom', radius: HANDLE_RADIUS },
      { pos: right_canvas, target: 'right', radius: HANDLE_RADIUS },
      { pos: top_canvas, target: 'top', radius: HANDLE_RADIUS },
      { pos: left_canvas, target: 'left', radius: HANDLE_RADIUS },
    ];

    // Check handles first (priority)
    for (const { pos, target, radius } of handleTargets) {
        const distance = Math.sqrt(Math.pow(mouseX - pos.x, 2) + Math.pow(mouseY - pos.y, 2));
        if (distance <= radius) {
            return target;
        }
    }
    return 'none';
  }

  // Handle mouse interactions
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    setLastMousePos({ x: mouseX, y: mouseY })
    
    const target = checkHoverTarget(mouseX, mouseY)
    setDragTarget(target)

    if (target === 'center') {
        setIsDragging(true);
        setIsResizing(false); // Explicitly not resizing
    } else if (target !== 'none') {
        setIsResizing(true);
        setIsDragging(false); // Explicitly not dragging center
    }
  }
  
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (!isDragging && !isResizing) {
        setHoverState(checkHoverTarget(mouseX, mouseY));
        return; // Only update hover state if not interacting
    }

    if (!lastMousePos || dragTarget === 'none') return;

    const deltaX_canvas = mouseX - lastMousePos.x;
    const deltaY_canvas = mouseY - lastMousePos.y;

    // Function to convert canvas coords to normalized (-1 to 1)
    const canvasToNorm = (canvasX: number, canvasY: number) => ({
        x: (canvasX / rect.width) * 2 - 1,
        y: 1 - (canvasY / rect.height) * 2 // Y is inverted
    });

    setShapeParams(prev => {
        let newCenter = { ...prev.center };
        let newSize = { ...prev.size };
        
        const currentMouseNorm = canvasToNorm(mouseX, mouseY);

        if (isDragging && dragTarget === 'center') {
            const deltaX_norm = deltaX_canvas / rect.width * 2;
            const deltaY_norm = -deltaY_canvas / rect.height * 2; // Inverted Y
            newCenter.x = Math.max(-1, Math.min(1, prev.center.x + deltaX_norm));
            newCenter.y = Math.max(-1, Math.min(1, prev.center.y + deltaY_norm));
        } else if (isResizing) {
            // Resizing based on which handle is dragged
            switch (dragTarget) {
                case 'top':
                    newSize.height = Math.max(0.05, (currentMouseNorm.y - prev.center.y) * 2);
                    break;
                case 'bottom':
                    newSize.height = Math.max(0.05, (prev.center.y - currentMouseNorm.y) * 2);
                    break;
                case 'right':
                    newSize.width = Math.max(0.05, (currentMouseNorm.x - prev.center.x) * 2);
                    break;
                case 'left':
                    newSize.width = Math.max(0.05, (prev.center.x - currentMouseNorm.x) * 2);
                    break;
            }
            // Ensure size doesn't make shape exceed bounds (optional, but good practice)
            newCenter.x = Math.max(-1 + newSize.width / 2, Math.min(1 - newSize.width / 2, newCenter.x));
            newCenter.y = Math.max(-1 + newSize.height / 2, Math.min(1 - newSize.height / 2, newCenter.y));
        }

        return { ...prev, center: newCenter, size: newSize };
    });

    setLastMousePos({ x: mouseX, y: mouseY });
  }
  
  const handleMouseUp = () => {
    setIsDragging(false)
    setIsResizing(false)
    setLastMousePos(null)
    setDragTarget('none') 
  }

  // Handler for point count slider
  const handlePointCountChange = (values: number[]) => {
    const count = Math.round(values[0]);
    // Ensure count is multiple of 4 for even distribution
    const adjustedCount = Math.max(4, Math.floor(count / 4) * 4); 
    setShapeParams(prev => ({ ...prev, pointCount: adjustedCount }));
  }

  // Update cursor style based on hover/drag state
  const getCursorStyle = () => {
    if (disabled) return "not-allowed";
    if (isDragging || isResizing) return "grabbing";
    switch (hoverState) {
        case 'center': return "move";
        case 'top': return "ns-resize";
        case 'bottom': return "ns-resize";
        case 'left': return "ew-resize";
        case 'right': return "ew-resize";
        default: return "default";
    }
  }

  return (
    <div className="space-y-4">
      {/* Canvas container */}
      <div className="relative bg-gray-100 dark:bg-background/50 rounded-lg p-2">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-[4/3] ${disabled ? "opacity-70" : ""}`}
          style={{ cursor: getCursorStyle() }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp} // Use same handler for leave to stop dragging
        />
      </div>
      
      {/* Controls */}
      <div className="space-y-3">
        {/* Point Count Control */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Points on Shape</span>
            <span className="text-xs text-muted-foreground">
              {shapeParams.pointCount}
            </span>
          </div>
          <Slider
            value={[shapeParams.pointCount]}
            min={4}
            max={32} // Max points
            step={4}  // Step by 4 to maintain divisibility
            onValueChange={handlePointCountChange}
            disabled={disabled}
            className="py-1"
          />
          <div className="flex text-xs text-muted-foreground justify-between">
            <span>Fewer</span>
            <span>More</span>
          </div>
        </div>

        {/* Add Playback Mode controls later if needed, like in DotCalibration */}
      </div>
    </div>
  )
} 
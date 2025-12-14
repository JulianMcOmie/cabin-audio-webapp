"use client"

import { useRef, useEffect, useState } from "react"
import { v4 as uuidv4 } from 'uuid'
import * as shapeGridAudio from '@/lib/audio/shapeGridAudio'
import {
  calculateCircleDots,
  calculateTriangleDots,
  calculateFiveGlyphDots,
  getTriangleVertices,
  type DotPosition
} from '@/lib/utils/shapeMath'

export interface ShapeGridProps {
  isPlaying: boolean;
  disabled?: boolean;
  numDots?: number;  // Default 12
  shapeType?: 'circle' | 'triangle' | 'five';
  stretchFactor?: number; // Width:Height ratio (e.g., 3.0 = 3x wider than tall)
}

interface ShapeData {
  id: string;
  type: 'circle' | 'triangle' | 'five';
  position: { x: number; y: number };  // -1 to 1 normalized
  size: number;
  numDots: number;
  rotation?: number;
}

export function ShapeGrid({ isPlaying, disabled = false, numDots = 12, shapeType = 'circle', stretchFactor = 3.0 }: ShapeGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shapes, setShapes] = useState<Map<string, ShapeData>>(new Map());
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragMode, setDragMode] = useState<'none' | 'move' | 'resize'>('none');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [lastMousePos, setLastMousePos] = useState<{ x: number, y: number } | null>(null);
  const [hoverMode, setHoverMode] = useState<'none' | 'move' | 'resize'>('none');

  // Theme detection (from glyph-grid.tsx)
  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          setIsDarkMode(document.documentElement.classList.contains("dark"));
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  // Initialize audio player
  useEffect(() => {
    shapeGridAudio.getShapeGridAudioPlayer();
    return () => {
      // Cleanup on unmount
      shapeGridAudio.cleanupShapeGridAudioPlayer();
    };
  }, []);

  // Update audio player when shapes change
  useEffect(() => {
    const audioPlayer = shapeGridAudio.getShapeGridAudioPlayer();
    shapes.forEach(shape => {
      audioPlayer.updateShape(shape);
    });
  }, [shapes]);

  // Update audio player when playing state changes
  useEffect(() => {
    const audioPlayer = shapeGridAudio.getShapeGridAudioPlayer();
    audioPlayer.setPlaying(isPlaying && !disabled);
  }, [isPlaying, disabled]);

  // Canvas size and DPI setup (from glyph-grid.tsx)
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw grid background (adjusted for stretch factor)
    ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;

    // Horizontal lines (fewer for stretched grid)
    const numHorizontalLines = 3;
    for (let i = 0; i <= numHorizontalLines; i++) {
      const y = (i / numHorizontalLines) * rect.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }

    // Vertical lines (more for stretched grid)
    const numVerticalLines = Math.round(numHorizontalLines * stretchFactor);
    for (let i = 0; i <= numVerticalLines; i++) {
      const x = (i / numVerticalLines) * rect.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    }

    // Draw shapes
    shapes.forEach((shape, shapeId) => {
      const isSelected = shapeId === selectedShapeId;
      drawShape(ctx, shape, isSelected, isDarkMode, rect, isPlaying, shapeGridAudio.getShapeGridAudioPlayer(), stretchFactor);
    });

    // Animation frame for pulsing effect during playback
    if (isPlaying && shapes.size > 0) {
      requestAnimationFrame(() => {
        setShapes(prev => new Map(prev));  // Trigger re-render
      });
    }
  }, [shapes, selectedShapeId, isDarkMode, isPlaying]);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Convert to normalized space (-1 to 1)
    const normalizedX = (canvasX / rect.width) * 2 - 1;
    const normalizedY = 1 - (canvasY / rect.height) * 2;

    setLastMousePos({ x: normalizedX, y: normalizedY });

    // Check if clicked on existing shape
    const clickedShapeId = findShapeAtPoint(normalizedX, normalizedY, shapes);

    if (clickedShapeId) {
      setSelectedShapeId(clickedShapeId);
      const shape = shapes.get(clickedShapeId);
      if (shape && isNearEdge(normalizedX, normalizedY, shape)) {
        setIsResizing(true);
        setDragMode('resize');
      } else {
        setIsDragging(true);
        setDragMode('move');
      }
    } else {
      // Create new shape at click position
      const newShape: ShapeData = {
        id: uuidv4(),
        type: shapeType,
        position: { x: normalizedX, y: normalizedY },
        size: 0.2,  // Default size
        numDots: numDots,
        rotation: 0
      };
      setShapes(prev => {
        const newMap = new Map(prev);
        newMap.set(newShape.id, newShape);
        return newMap;
      });
      setSelectedShapeId(newShape.id);

      // Add to audio player
      shapeGridAudio.getShapeGridAudioPlayer().addShape(newShape);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging && !isResizing) return;

    const canvas = canvasRef.current;
    if (!canvas || !selectedShapeId || !lastMousePos) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const normalizedX = (canvasX / rect.width) * 2 - 1;
    const normalizedY = 1 - (canvasY / rect.height) * 2;

    setShapes(prev => {
      const newShapes = new Map(prev);
      const shape = newShapes.get(selectedShapeId);
      if (!shape) return prev;

      if (dragMode === 'move') {
        // Move shape
        const newShape = {
          ...shape,
          position: { x: normalizedX, y: normalizedY }
        };
        newShapes.set(selectedShapeId, newShape);
      } else if (dragMode === 'resize') {
        // Resize shape
        const dx = normalizedX - shape.position.x;
        const dy = normalizedY - shape.position.y;
        const newSize = Math.max(0.1, Math.min(1.0, Math.sqrt(dx * dx + dy * dy)));
        const newShape = {
          ...shape,
          size: newSize
        };
        newShapes.set(selectedShapeId, newShape);
      }

      return newShapes;
    });

    setLastMousePos({ x: normalizedX, y: normalizedY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
    setDragMode('none');
    setLastMousePos(null);
  };

  const handleMouseHover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging || isResizing || disabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const normalizedX = (canvasX / rect.width) * 2 - 1;
    const normalizedY = 1 - (canvasY / rect.height) * 2;

    const hoveredShapeId = findShapeAtPoint(normalizedX, normalizedY, shapes);

    if (hoveredShapeId) {
      const shape = shapes.get(hoveredShapeId);
      if (shape && isNearEdge(normalizedX, normalizedY, shape)) {
        setHoverMode('resize');
      } else {
        setHoverMode('move');
      }
    } else {
      setHoverMode('none');
    }
  };

  // Keyboard handler for deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled || !selectedShapeId) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        shapeGridAudio.getShapeGridAudioPlayer().removeShape(selectedShapeId);
        setShapes(prev => {
          const newShapes = new Map(prev);
          newShapes.delete(selectedShapeId);
          return newShapes;
        });
        setSelectedShapeId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShapeId, disabled]);

  return (
    <div className="space-y-4">
      <div className="relative bg-gray-100 dark:bg-background/50 rounded-lg p-2">
        <canvas
          ref={canvasRef}
          className={`w-full aspect-[4/3] ${disabled ? "opacity-70" : ""}`}
          style={{ cursor: getCursorStyle(dragMode !== 'none' ? dragMode : hoverMode, disabled) }}
          onMouseDown={handleMouseDown}
          onMouseMove={(e) => {
            handleMouseMove(e);
            handleMouseHover(e);
          }}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      <div className="text-xs text-center text-muted-foreground">
        {shapes.size === 0
          ? "Click to add a shape"
          : `${shapes.size} shape${shapes.size > 1 ? 's' : ''} • Press Delete to remove`}
      </div>
    </div>
  );
}

// Helper functions
function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeData,
  isSelected: boolean,
  isDarkMode: boolean,
  rect: DOMRect,
  isPlaying: boolean,
  audioPlayer: ReturnType<typeof shapeGridAudio.getShapeGridAudioPlayer>,
  stretchFactor: number
) {
  // Calculate dots with aspect ratio for circles
  let dots: DotPosition[] = [];
  if (shape.type === 'circle') {
    // For circles, adjust the radius in Y to compensate for stretch
    // This makes circles appear truly circular on the stretched canvas
    dots = calculateCircleDots(shape.position, shape.size, shape.numDots, stretchFactor);
  } else if (shape.type === 'triangle') {
    const vertices = getTriangleVertices(shape.position, shape.size, shape.rotation || 0);
    dots = calculateTriangleDots(vertices, shape.numDots);
  } else if (shape.type === 'five') {
    dots = calculateFiveGlyphDots(shape.position, shape.size, shape.rotation || 0, shape.numDots);
  }

  // Convert normalized coordinates to canvas coordinates
  const toCanvasX = (x: number) => (x + 1) / 2 * rect.width;
  const toCanvasY = (y: number) => (1 - y) / 2 * rect.height;

  const centerX = toCanvasX(shape.position.x);
  const centerY = toCanvasY(shape.position.y);

  // Size calculation adjusted for stretch factor
  const baseSize = shape.size * rect.height / 2; // Base on height
  const sizeX = baseSize * stretchFactor;
  const sizeY = baseSize;

  // Draw shape outline
  ctx.strokeStyle = isSelected
    ? (isDarkMode ? '#38bdf8' : '#0284c7')
    : (isDarkMode ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)');
  ctx.lineWidth = isSelected ? 3 : 2;

  if (shape.type === 'circle') {
    // Draw ellipse for circle to maintain circular appearance
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, sizeX, sizeY, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.type === 'triangle') {
    const vertices = getTriangleVertices(shape.position, shape.size, shape.rotation || 0);
    ctx.beginPath();
    vertices.forEach((v, i) => {
      const x = toCanvasX(v.x);
      const y = toCanvasY(v.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  } else if (shape.type === 'five') {
    // Draw path for "5"
    ctx.beginPath();
    dots.forEach((dot, i) => {
      const x = toCanvasX(dot.x);
      const y = toCanvasY(dot.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Get current playing dot index
  const currentDotIndex = isPlaying ? audioPlayer.getCurrentDotIndex(shape.id) : -1;

  // Draw dots
  dots.forEach((dot, index) => {
    const dotX = toCanvasX(dot.x);
    const dotY = toCanvasY(dot.y);

    const isCurrentlyPlaying = isPlaying && index === currentDotIndex;

    ctx.beginPath();
    ctx.arc(dotX, dotY, isCurrentlyPlaying ? 8 : 5, 0, Math.PI * 2);
    ctx.fillStyle = isCurrentlyPlaying
      ? (isDarkMode ? '#38bdf8' : '#0284c7')
      : (isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)');
    ctx.fill();

    // Pulsing effect for currently playing dot
    if (isCurrentlyPlaying) {
      const pulseSize = 1.2 + Math.sin(Date.now() / 200) * 0.3;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 8 * pulseSize, 0, Math.PI * 2);
      ctx.fillStyle = isDarkMode ? 'rgba(56, 189, 248, 0.2)' : 'rgba(2, 132, 199, 0.2)';
      ctx.fill();
    }
  });

  // Draw resize handles for selected shape
  if (isSelected) {
    const handleRadius = 6;
    const handles = [
      { x: centerX + sizeX, y: centerY },
      { x: centerX - sizeX, y: centerY },
      { x: centerX, y: centerY + sizeY },
      { x: centerX, y: centerY - sizeY }
    ];

    handles.forEach(handle => {
      ctx.fillStyle = isDarkMode ? 'white' : 'black';
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function findShapeAtPoint(
  x: number,
  y: number,
  shapes: Map<string, ShapeData>
): string | null {
  // Check in reverse order (topmost shape first)
  const shapesArray = Array.from(shapes.entries()).reverse();

  for (const [id, shape] of shapesArray) {
    const dx = x - shape.position.x;
    const dy = y - shape.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Simple hit test: within shape bounds (with some margin)
    if (distance <= shape.size * 1.2) {
      return id;
    }
  }

  return null;
}

function isNearEdge(
  x: number,
  y: number,
  shape: ShapeData
): boolean {
  const dx = x - shape.position.x;
  const dy = y - shape.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Check if near edge (much larger threshold for easier grabbing)
  const threshold = 0.15; // Large hit area for resize
  return Math.abs(distance - shape.size) < threshold;
}

function getCursorStyle(
  mode: 'none' | 'move' | 'resize',
  disabled: boolean
): string {
  if (disabled) return "not-allowed";
  if (mode === 'move') return "grab";
  if (mode === 'resize') return "nwse-resize";
  return "crosshair"; // Indicate you can create shapes
}

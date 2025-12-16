// Shape mathematics utilities for distributing dots along shape perimeters

export interface DotPosition {
  x: number;
  y: number;
  z: number; // Depth after 3D rotation (negative = away from viewer)
  progress: number; // 0-1 along perimeter
}

export interface Point {
  x: number;
  y: number;
}

// ===== HELPER FUNCTIONS =====

/**
 * Calculate Euclidean distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Rotate a point around the origin by a given angle (2D rotation in XY plane)
 */
export function rotatePoint(point: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos
  };
}

/**
 * Apply 3D rotation around vertical Y-axis and perspective projection
 * Shapes start in the XY plane (z=0, facing viewer)
 * Positive rotation tilts the shape's right side away from viewer
 * @param point 2D point on the shape
 * @param rotationY Rotation angle around Y-axis in radians
 * @returns Object with projected 2D coordinates and z-depth
 */
export function apply3DRotation(point: Point, rotationY: number): { x: number; y: number; z: number } {
  // 3D coordinates before rotation (shape in XY plane, z=0)
  const x3d = point.x;
  const y3d = point.y;
  const z3d = 0;

  // Rotate around Y-axis (vertical)
  // Y-axis rotation matrix:
  // x' = x*cos(θ) + z*sin(θ)
  // y' = y
  // z' = -x*sin(θ) + z*cos(θ)
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);

  const xRotated = x3d * cos + z3d * sin;
  const yRotated = y3d;
  const zRotated = -x3d * sin + z3d * cos;

  // Perspective projection
  // Camera distance from the XY plane (larger = less perspective distortion)
  const cameraDistance = 3.0;

  // Perspective factor: objects farther away (more negative z) appear smaller
  const perspectiveFactor = cameraDistance / (cameraDistance - zRotated);

  const xProjected = xRotated * perspectiveFactor;
  const yProjected = yRotated * perspectiveFactor;

  return {
    x: xProjected,
    y: yProjected,
    z: zRotated  // Return z for loudness calculation (negative = away from viewer)
  };
}

/**
 * Sample a quadratic bezier curve at parameter t (0-1)
 */
export function getQuadraticBezierPoint(
  t: number,
  p0: Point,
  p1: Point,
  p2: Point
): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
  };
}

/**
 * Approximate arc length of a quadratic bezier curve using adaptive subdivision
 */
export function calculateBezierArcLength(
  p0: Point,
  p1: Point,
  p2: Point,
  subdivisions: number = 20
): number {
  let length = 0;
  let prevPoint = p0;

  for (let i = 1; i <= subdivisions; i++) {
    const t = i / subdivisions;
    const currentPoint = getQuadraticBezierPoint(t, p0, p1, p2);
    length += distance(prevPoint, currentPoint);
    prevPoint = currentPoint;
  }

  return length;
}

// ===== CIRCLE =====

/**
 * Distribute dots evenly around a circle perimeter
 * @param center Circle center position
 * @param radius Circle radius
 * @param numDots Number of dots to distribute
 * @param aspectRatio Width:Height ratio (e.g., 3.0 = 3x wider than tall)
 * @param rotationY 3D rotation around vertical Y-axis in radians
 * @returns Array of dot positions with progress and z-depth values
 */
export function calculateCircleDots(
  center: Point,
  radius: number,
  numDots: number,
  aspectRatio: number = 1.0,
  rotationY: number = 0
): DotPosition[] {
  const dots: DotPosition[] = [];

  // Adjust Y radius to compensate for aspect ratio
  // This makes the circle appear circular on a stretched canvas
  const radiusX = radius;
  const radiusY = radius / aspectRatio;

  for (let i = 0; i < numDots; i++) {
    const angle = (i / numDots) * 2 * Math.PI;
    const progress = i / numDots;

    // Calculate position on circle (relative to center)
    const localX = radiusX * Math.cos(angle);
    const localY = radiusY * Math.sin(angle);

    // Apply 3D rotation and perspective
    const rotated = apply3DRotation({ x: localX, y: localY }, rotationY);

    // Add center offset
    dots.push({
      x: center.x + rotated.x,
      y: center.y + rotated.y,
      z: rotated.z,
      progress
    });
  }

  return dots;
}

// ===== TRIANGLE =====

/**
 * Calculate vertices for an equilateral triangle
 * @param center Triangle center position
 * @param size Characteristic size (distance from center to vertex)
 * @param rotation Rotation angle in radians
 * @returns Array of three vertices
 */
export function getTriangleVertices(
  center: Point,
  size: number,
  rotation: number = 0
): Point[] {
  // Equilateral triangle with one vertex pointing up
  const baseVertices: Point[] = [
    { x: 0, y: size }, // Top vertex
    { x: -size * Math.sin(Math.PI / 3), y: -size * Math.cos(Math.PI / 3) }, // Bottom left
    { x: size * Math.sin(Math.PI / 3), y: -size * Math.cos(Math.PI / 3) }  // Bottom right
  ];

  // Apply rotation and translation
  return baseVertices.map(v => {
    const rotated = rotatePoint(v, rotation);
    return {
      x: rotated.x + center.x,
      y: rotated.y + center.y
    };
  });
}

/**
 * Distribute dots evenly around a triangle perimeter
 * Dots are distributed proportionally to edge lengths
 * @param vertices Array of three vertices defining the triangle
 * @param numDots Number of dots to distribute
 * @param rotationY 3D rotation around vertical Y-axis in radians
 * @param center Triangle center for 3D rotation
 * @returns Array of dot positions with progress and z-depth values
 */
export function calculateTriangleDots(
  vertices: Point[],
  numDots: number,
  rotationY: number = 0,
  center: Point = { x: 0, y: 0 }
): DotPosition[] {
  if (vertices.length !== 3) {
    throw new Error('Triangle must have exactly 3 vertices');
  }

  // Define edges
  const edges = [
    { start: vertices[0], end: vertices[1] },
    { start: vertices[1], end: vertices[2] },
    { start: vertices[2], end: vertices[0] }
  ];

  // Calculate edge lengths
  const edgeLengths = edges.map(edge => distance(edge.start, edge.end));
  const totalLength = edgeLengths.reduce((sum, len) => sum + len, 0);

  const dots: DotPosition[] = [];

  for (let i = 0; i < numDots; i++) {
    const targetDistance = (i / numDots) * totalLength;
    const progress = i / numDots;
    let accumulatedDistance = 0;

    // Find which edge this dot belongs to
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const edgeLength = edgeLengths[edgeIndex];

      if (targetDistance < accumulatedDistance + edgeLength) {
        // Point is on this edge
        const distanceAlongEdge = targetDistance - accumulatedDistance;
        const edgeProgress = distanceAlongEdge / edgeLength;

        const x = edge.start.x + edgeProgress * (edge.end.x - edge.start.x);
        const y = edge.start.y + edgeProgress * (edge.end.y - edge.start.y);

        // Apply 3D rotation and perspective (relative to center)
        const localX = x - center.x;
        const localY = y - center.y;
        const rotated = apply3DRotation({ x: localX, y: localY }, rotationY);

        dots.push({
          x: center.x + rotated.x,
          y: center.y + rotated.y,
          z: rotated.z,
          progress
        });
        break;
      }

      accumulatedDistance += edgeLength;
    }
  }

  return dots;
}

// ===== NUMBER "5" GLYPH =====

/**
 * Define the path segments for the number "5" glyph
 * Using a simplified 7-segment display style with straight lines
 */
interface PathSegment {
  type: 'line' | 'bezier';
  start: Point;
  end: Point;
  control?: Point; // For bezier curves
}

/**
 * Get path segments for the number "5" glyph
 * Normalized to unit size (-0.5 to 0.5 range)
 */
function getFiveGlyphPath(): PathSegment[] {
  const width = 0.6;
  const height = 1.0;

  // Define "5" as a series of segments
  // Starting from top-right, going counter-clockwise
  return [
    // Top horizontal
    {
      type: 'line',
      start: { x: width / 2, y: height / 2 },
      end: { x: -width / 2, y: height / 2 }
    },
    // Left vertical (top half)
    {
      type: 'line',
      start: { x: -width / 2, y: height / 2 },
      end: { x: -width / 2, y: 0 }
    },
    // Middle horizontal
    {
      type: 'line',
      start: { x: -width / 2, y: 0 },
      end: { x: width / 2, y: 0 }
    },
    // Right vertical (bottom half)
    {
      type: 'line',
      start: { x: width / 2, y: 0 },
      end: { x: width / 2, y: -height / 2 }
    },
    // Bottom horizontal
    {
      type: 'line',
      start: { x: width / 2, y: -height / 2 },
      end: { x: -width / 2, y: -height / 2 }
    }
  ];
}

/**
 * Calculate arc length of a path segment
 */
function calculateSegmentLength(segment: PathSegment): number {
  if (segment.type === 'line') {
    return distance(segment.start, segment.end);
  } else if (segment.type === 'bezier' && segment.control) {
    return calculateBezierArcLength(segment.start, segment.control, segment.end);
  }
  return 0;
}

/**
 * Sample a point at a specific distance along a path
 */
function samplePathAtDistance(
  segments: PathSegment[],
  segmentLengths: number[],
  targetDistance: number
): Point {
  let accumulatedDistance = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentLength = segmentLengths[i];

    if (targetDistance < accumulatedDistance + segmentLength) {
      // Point is on this segment
      const distanceAlongSegment = targetDistance - accumulatedDistance;
      const t = distanceAlongSegment / segmentLength;

      if (segment.type === 'line') {
        return {
          x: segment.start.x + t * (segment.end.x - segment.start.x),
          y: segment.start.y + t * (segment.end.y - segment.start.y)
        };
      } else if (segment.type === 'bezier' && segment.control) {
        return getQuadraticBezierPoint(t, segment.start, segment.control, segment.end);
      }
    }

    accumulatedDistance += segmentLength;
  }

  // If we get here, return the end of the last segment
  const lastSegment = segments[segments.length - 1];
  return lastSegment.end;
}

/**
 * Distribute dots evenly around a "5" glyph perimeter
 * @param center Glyph center position
 * @param size Size multiplier
 * @param rotation 2D rotation angle in radians (in-plane rotation before 3D)
 * @param numDots Number of dots to distribute
 * @param rotationY 3D rotation around vertical Y-axis in radians
 * @returns Array of dot positions with progress and z-depth values
 */
export function calculateFiveGlyphDots(
  center: Point,
  size: number,
  rotation: number,
  numDots: number,
  rotationY: number = 0
): DotPosition[] {
  // Get base path segments (normalized)
  const pathSegments = getFiveGlyphPath();

  // Calculate arc length for each segment
  const segmentLengths = pathSegments.map(seg => calculateSegmentLength(seg));
  const totalLength = segmentLengths.reduce((sum, len) => sum + len, 0);

  const dots: DotPosition[] = [];

  for (let i = 0; i < numDots; i++) {
    const targetDistance = (i / numDots) * totalLength;
    const progress = i / numDots;

    // Sample point at target distance
    const point = samplePathAtDistance(pathSegments, segmentLengths, targetDistance);

    // Apply size scaling
    const scaled = {
      x: point.x * size,
      y: point.y * size
    };

    // Apply 2D rotation (in-plane)
    const rotated = rotatePoint(scaled, rotation);

    // Apply 3D rotation and perspective
    const rotated3D = apply3DRotation(rotated, rotationY);

    // Apply translation to center
    dots.push({
      x: rotated3D.x + center.x,
      y: rotated3D.y + center.y,
      z: rotated3D.z,
      progress
    });
  }

  return dots;
}

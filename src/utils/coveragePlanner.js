function orderPolygonPoints(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
}

export const COVERAGE_STYLE_OPTIONS = [
  { value: "zigzag", label: "Zigzag" },
  { value: "ladder", label: "Ladder" },
  { value: "diagonal", label: "Diagonal" },
  { value: "straight_ab", label: "Straight AB Line / Düz AB Hattı" },
  { value: "a_plus_heading", label: "A+ Heading / A+ Yön Hattı" },
  { value: "curved_ab", label: "Curved AB / Eğrisel AB Hattı" },
  { value: "circle_pivot", label: "Circle Pivot / Daire-Pivot Hattı" },
  { value: "spiral", label: "Spiral Pattern / Spiral Hattı" },
  { value: "boundary_headland", label: "Boundary-Headland / Sınır-Çevre Hattı" },
  { value: "headland_turn", label: "Headland Turn / Otomatik Dönüş" },
];

const ADVANCED_COVERAGE_STYLES = new Set(COVERAGE_STYLE_OPTIONS.map(option => option.value));

function rotateXY(x, y, cx, cy, angle) {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const dx = x - cx;
  const dy = y - cy;
  return { x: c * dx - s * dy + cx, y: s * dx + c * dy + cy };
}

function horizontalIntersections(points, y) {
  const xs = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (Math.abs(b.y - a.y) < 1e-9) continue;
    if (y < Math.min(a.y, b.y) || y >= Math.max(a.y, b.y)) continue;
    const t = (y - a.y) / (b.y - a.y);
    xs.push(a.x + t * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  return xs;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function centroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function sampleSegment(a, b, spacing) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= 1e-9) return [a];
  const steps = Math.max(1, Math.ceil(length / Math.max(0.05, spacing)));
  const out = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    });
  }
  return out;
}

function polylineLength(points) {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function densifyPolyline(points, spacing) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const sampled = sampleSegment(points[i - 1], points[i], spacing);
    out.push(...sampled.slice(1));
  }
  return out;
}

function angleDegFromVector(dx, dy) {
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

function normalizeVector(dx, dy) {
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

function vectorFromHeadingDeg(headingDeg) {
  const radians = (Number(headingDeg) || 0) * Math.PI / 180;
  return {
    x: Math.sin(radians),
    y: Math.cos(radians)
  };
}

function headingToSweepAngleDeg(headingDeg) {
  return 90 - (Number(headingDeg) || 0);
}

function maxDistanceToCentroid(points, center) {
  return Math.max(...points.map(point => Math.hypot(point.x - center.x, point.y - center.y)));
}

function rotateDirection(value, clockwiseValue = "cw") {
  return value === clockwiseValue ? -1 : 1;
}

function shrinkPolygonTowardCentroid(points, offset) {
  const c = centroid(points);
  return points.map(point => {
    const dx = point.x - c.x;
    const dy = point.y - c.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= offset || distance <= 1e-9) return null;
    const scale = (distance - offset) / distance;
    return {
      x: c.x + dx * scale,
      y: c.y + dy * scale
    };
  }).filter(Boolean);
}

function pointsToRoute(points, prefix = "T") {
  return points.map((point, index) => ({
    x: point.x,
    y: point.y,
    label: `${prefix}${index + 1}`
  }));
}

function buildSweepByAngle(points, angleDeg, lineSpacing, pointDensity, navPoseSpacing, startCorner, alternateFlip = true) {
  const sweep = makeCoverageSweep(points, angleDeg, lineSpacing, alternateFlip, startCorner);
  if (sweep.length < 2) return [];
  const dense = densifyPath(sweep, pointDensity);
  return thinPathForNavigation(dense, navPoseSpacing);
}

function buildStraightAbPattern(points, options) {
  const anchorA = points[0];
  const anchorB = points[1] || points[0];
  const direction = normalizeVector(anchorB.x - anchorA.x, anchorB.y - anchorA.y);
  const angleDeg = angleDegFromVector(direction.x, direction.y);
  return buildSweepByAngle(points, angleDeg, options.lineSpacing, options.pointDensity, options.navPoseSpacing, options.startCorner, true);
}

function buildAPlusHeadingPattern(points, options) {
  const angleDeg = headingToSweepAngleDeg(options.headingDeg);
  return buildSweepByAngle(points, angleDeg, options.lineSpacing, options.pointDensity, options.navPoseSpacing, options.startCorner, true);
}

function buildCurvedAbPattern(points, options) {
  const base = buildStraightAbPattern(points, options);
  if (base.length < 2) return [];

  const start = points[0];
  const end = points[1] || points[0];
  const direction = normalizeVector(end.x - start.x, end.y - start.y);
  const normal = { x: -direction.y, y: direction.x };
  const totalLength = Math.max(polylineLength(base), 1);
  const amplitude = Math.max(0, Number(options.curveStrength) || 0);

  return base.map((point, index) => {
    const t = index / Math.max(1, base.length - 1);
    const offset = Math.sin(t * Math.PI * 2) * amplitude;
    const candidate = {
      x: point.x + normal.x * offset,
      y: point.y + normal.y * offset
    };
    return pointInPolygon(candidate, points) ? candidate : point;
  }).filter(point => pointInPolygon(point, points));
}

function buildCirclePivotPattern(points, options) {
  const center = centroid(points);
  const maxRadius = maxDistanceToCentroid(points, center);
  const clockwise = rotateDirection(options.circleDirection);
  const route = [];

  for (let radius = Math.max(0.2, options.lineSpacing); radius <= maxRadius + 1e-6; radius += options.lineSpacing) {
    const deltaTheta = Math.max(0.08, options.pointDensity / Math.max(radius, 0.25));
    const ring = [];
    for (let theta = 0; theta < Math.PI * 2 + 1e-6; theta += deltaTheta) {
      const signedTheta = theta * clockwise;
      const candidate = {
        x: center.x + radius * Math.cos(signedTheta),
        y: center.y + radius * Math.sin(signedTheta)
      };
      if (pointInPolygon(candidate, points)) ring.push(candidate);
    }
    if (ring.length >= 2) route.push(...ring);
  }

  return thinPathForNavigation(route, options.navPoseSpacing);
}

function buildSpiralPattern(points, options) {
  const center = centroid(points);
  const maxRadius = maxDistanceToCentroid(points, center);
  const clockwise = rotateDirection(options.spiralRotation);
  const b = options.lineSpacing / (2 * Math.PI);
  const startRadius = Math.max(0, Number(options.startRadius) || 0);
  const out = [];

  if (options.spiralDirection === "inward") {
    const maxTheta = Math.max((maxRadius - startRadius) / Math.max(b, 1e-6), 0);
    for (let theta = maxTheta; theta >= 0; ) {
      const radius = startRadius + b * theta;
      const angle = theta * clockwise;
      const point = {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle)
      };
      if (pointInPolygon(point, points)) out.push(point);
      theta -= Math.max(0.05, options.pointDensity / Math.max(Math.sqrt(radius * radius + b * b), 0.2));
    }
  } else {
    const maxTheta = Math.max((maxRadius - startRadius) / Math.max(b, 1e-6), 0);
    for (let theta = 0; theta <= maxTheta + 1e-6; ) {
      const radius = startRadius + b * theta;
      const angle = theta * clockwise;
      const point = {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle)
      };
      if (pointInPolygon(point, points)) out.push(point);
      theta += Math.max(0.05, options.pointDensity / Math.max(Math.sqrt(radius * radius + b * b), 0.2));
    }
  }

  return thinPathForNavigation(out, options.navPoseSpacing);
}

function buildBoundaryHeadlandPattern(points, options) {
  const ordered = orderPolygonPoints(points);
  const directionForward = options.boundaryDirection !== "ccw";
  const loops = [];

  for (let pass = 0; pass < Math.max(1, options.headlandPasses); pass += 1) {
    const inset = pass * options.lineSpacing;
    const shrunk = pass === 0 ? ordered : shrinkPolygonTowardCentroid(ordered, inset);
    if (shrunk.length < 3) break;
    const ringPoints = densifyPolyline([...shrunk, shrunk[0]], options.pointDensity);
    loops.push(directionForward || pass % 2 === 0 ? ringPoints : [...ringPoints].reverse());
  }

  return thinPathForNavigation(loops.flat(), options.navPoseSpacing);
}

function buildHeadlandTurnPattern(points, options) {
  const boundary = buildBoundaryHeadlandPattern(points, options);
  const insetPolygon = shrinkPolygonTowardCentroid(orderPolygonPoints(points), Math.max(options.lineSpacing * options.headlandPasses, options.lineSpacing));
  if (insetPolygon.length < 3) return boundary;
  const innerSweep = buildStraightAbPattern(insetPolygon, options);
  return thinPathForNavigation([...boundary, ...innerSweep], options.navPoseSpacing);
}

// Mirrors gps_coverage_planner_node.py _make_sweep, so the UI preview matches what the backend will actually fly.
function makeCoverageSweep(points, sweepDeg, spacing, alternateFlip, startCorner) {
  if (points.length < 3 || !(spacing > 0)) return [];

  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const angleRad = (-sweepDeg * Math.PI) / 180;
  const rotated = points.map(p => rotateXY(p.x, p.y, cx, cy, angleRad));

  const miny = Math.min(...rotated.map(p => p.y));
  const maxy = Math.max(...rotated.map(p => p.y));

  const segments = [];
  for (let y = miny + spacing * 0.5; y <= maxy + 1e-6; y += spacing) {
    const xs = horizontalIntersections(rotated, y);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = { x: xs[i], y };
      const b = { x: xs[i + 1], y };
      if (Math.abs(b.x - a.x) >= spacing * 0.3) segments.push([a, b, y]);
    }
  }
  if (segments.length === 0) return [];

  segments.sort((s1, s2) => s1[2] - s2[2]);

  const start = ((startCorner % 4) + 4) % 4;
  const startTop = start === 2 || start === 3;
  const startRight = start === 1 || start === 2;
  if (startTop) segments.reverse();

  let flip = startRight;
  const route = [];
  for (const [a0, b0] of segments) {
    let a = a0;
    let b = b0;
    if (a.x > b.x) { [a, b] = [b, a]; }
    if (flip) { [a, b] = [b, a]; }
    route.push(a, b);
    if (alternateFlip) flip = !flip;
  }

  const backAngleRad = (sweepDeg * Math.PI) / 180;
  return route.map(p => rotateXY(p.x, p.y, cx, cy, backAngleRad));
}

// Mirrors gps_coverage_planner_node.py _densify_path.
function densifyPath(points, density) {
  if (points.length < 2 || !(density > 0)) return points;

  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < density) {
      out.push(b);
      continue;
    }
    const steps = Math.ceil(length / density);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

// Mirrors gps_coverage_planner_node.py _thin_path_for_navigation.
function thinPathForNavigation(points, spacing) {
  if (points.length <= 2 || !(spacing > 0)) return points;

  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= spacing) {
      out.push(p);
      last = p;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function buildCoverageNavPoints(localCornerPoints, options) {
  const points = Array.isArray(localCornerPoints) ? localCornerPoints : [];
  if (points.length < 3) return [];

  const opts = options || {};
  const style = typeof opts.style === "string" && ADVANCED_COVERAGE_STYLES.has(opts.style)
    ? opts.style
    : "zigzag";
  const lineSpacing = Number(opts.lineSpacing) > 0 ? Number(opts.lineSpacing) : 0.4;
  const pointDensity = Number(opts.pointDensity) > 0 ? Number(opts.pointDensity) : 0.5;
  const navPoseSpacing = Number(opts.navPoseSpacing) > 0 ? Number(opts.navPoseSpacing) : 0.8;
  const startCorner = Number.isFinite(Number(opts.startCorner)) ? Math.trunc(Number(opts.startCorner)) : 0;
  const sweepDeg = style === "diagonal" ? Number(opts.diagonalAngleDeg) || 0 : Number(opts.sweepAngleDeg) || 0;

  const ordered = orderPolygonPoints(points);
  const patternOptions = {
    style,
    lineSpacing,
    pointDensity,
    navPoseSpacing,
    startCorner,
    sweepAngleDeg: Number(opts.sweepAngleDeg) || 0,
    diagonalAngleDeg: Number(opts.diagonalAngleDeg) || 0,
    headingDeg: Number(opts.headingDeg) || 0,
    curveStrength: Math.max(0, Number(opts.curveStrength) || 0),
    circleDirection: opts.circleDirection === "ccw" ? "ccw" : "cw",
    spiralDirection: opts.spiralDirection === "inward" ? "inward" : "outward",
    spiralRotation: opts.spiralRotation === "ccw" ? "ccw" : "cw",
    startRadius: Math.max(0, Number(opts.startRadius) || 0),
    headlandPasses: Math.max(1, Math.trunc(Number(opts.headlandPasses) || 1)),
    boundaryDirection: opts.boundaryDirection === "ccw" ? "ccw" : "cw",
  };

  let nav = [];
  if (style === "zigzag" || style === "ladder" || style === "diagonal") {
    const sweep = makeCoverageSweep(ordered, sweepDeg, lineSpacing, style !== "ladder", startCorner);
    if (sweep.length < 2) return [];
    const dense = densifyPath(sweep, pointDensity);
    nav = thinPathForNavigation(dense, navPoseSpacing);
  } else if (style === "straight_ab") {
    nav = buildStraightAbPattern(ordered, patternOptions);
  } else if (style === "a_plus_heading") {
    nav = buildAPlusHeadingPattern(ordered, patternOptions);
  } else if (style === "curved_ab") {
    nav = buildCurvedAbPattern(ordered, patternOptions);
  } else if (style === "circle_pivot") {
    nav = buildCirclePivotPattern(ordered, patternOptions);
  } else if (style === "spiral") {
    nav = buildSpiralPattern(ordered, patternOptions);
  } else if (style === "boundary_headland") {
    nav = buildBoundaryHeadlandPattern(ordered, patternOptions);
  } else if (style === "headland_turn") {
    nav = buildHeadlandTurnPattern(ordered, patternOptions);
  }

  if (nav.length === 0) return [];
  return nav.map((p, i) => ({ x: p.x, y: p.y, label: `T${i + 1}` }));
}

export function latLngToLocalMeters(latLng, anchor) {
  if (!latLng || !anchor) return null;

  const earthR = 6378137;
  const latRad = anchor.lat * Math.PI / 180;
  const dLat = (latLng.lat - anchor.lat) * Math.PI / 180;
  const dLng = (latLng.lng - anchor.lng) * Math.PI / 180;

  return {
    x: dLng * earthR * Math.cos(latRad),
    y: dLat * earthR
  };
}

export function localMetersToLatLng(point, anchor) {
  if (!point || !anchor) return null;

  const earthR = 6378137;
  const latRad = anchor.lat * Math.PI / 180;

  return {
    lat: anchor.lat + point.y / earthR * 180 / Math.PI,
    lng: anchor.lng + point.x / (earthR * Math.cos(latRad)) * 180 / Math.PI
  };
}

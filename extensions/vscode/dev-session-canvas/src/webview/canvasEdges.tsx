import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EdgeLabelRenderer, Position, type EdgeProps } from 'reactflow';

import {
  canvasEdgePresetColors,
  type CanvasEdgeArrowMode,
  type CanvasEdgeColor
} from '../common/protocol';
import type { CanvasEdgeData, CanvasPoint, CanvasRect, CanvasSize } from './canvasTypes';
import { isImeComposingKeyboardEvent, stopCanvasEvent } from './canvasDomEvents';
import type { WebviewI18nKey } from './i18n/webviewI18n';

type CanvasEdgeTranslator = (key: WebviewI18nKey, params?: Record<string, string | number>) => string;

const CANVAS_EDGE_ARROW_MENU_ITEMS: ReadonlyArray<{
  arrowMode: CanvasEdgeArrowMode;
  labelKey: WebviewI18nKey;
  icon: string;
}> = [
  {
    arrowMode: 'none',
    labelKey: 'edge.arrow.none',
    icon: 'remove'
  },
  {
    arrowMode: 'forward',
    labelKey: 'edge.arrow.forward',
    icon: 'arrow-right'
  },
  {
    arrowMode: 'both',
    labelKey: 'edge.arrow.both',
    icon: 'arrow-both'
  }
];

const CANVAS_EDGE_COLOR_MENU_ITEMS: ReadonlyArray<{
  color?: CanvasEdgeColor;
  labelKey: WebviewI18nKey;
}> = [
  {
    labelKey: 'edge.color.default'
  },
  {
    color: '1',
    labelKey: 'edge.color.red'
  },
  {
    color: '2',
    labelKey: 'edge.color.orange'
  },
  {
    color: '3',
    labelKey: 'edge.color.yellow'
  },
  {
    color: '4',
    labelKey: 'edge.color.green'
  },
  {
    color: '5',
    labelKey: 'edge.color.cyan'
  },
  {
    color: '6',
    labelKey: 'edge.color.purple'
  }
];

function isCanvasEdgePresetColor(value: string | undefined): value is (typeof canvasEdgePresetColors)[number] {
  return typeof value === 'string' && canvasEdgePresetColors.includes(value as (typeof canvasEdgePresetColors)[number]);
}

export function resolveCanvasEdgeStrokeColor(color: CanvasEdgeColor | undefined): string {
  if (!color) {
    return 'var(--canvas-edge-stroke-default)';
  }

  return isCanvasEdgePresetColor(color) ? `var(--canvas-edge-color-${color})` : color;
}

function createCanvasEdgeOverlayStyle(transform: string, accentColor: string): React.CSSProperties {
  return {
    transform,
    ['--canvas-edge-accent' as string]: accentColor
  } as React.CSSProperties;
}

type CanvasCubicCurve = {
  start: CanvasPoint;
  control1: CanvasPoint;
  control2: CanvasPoint;
  end: CanvasPoint;
};
type CanvasEdgeGeometry = {
  curve: CanvasCubicCurve;
  edgePath: string;
  labelT: number;
  labelX: number;
  labelY: number;
  toolbarX: number;
  toolbarY: number;
  toolbarPlacement: 'above' | 'below';
};
type CanvasEdgeVisibleSegment = {
  key: string;
  path: string;
  markerStart?: string;
  markerEnd?: string;
  isProbeSegment: boolean;
};
const CANVAS_EDGE_TOOLBAR_WIDTH = 106;
const CANVAS_EDGE_TOOLBAR_HEIGHT = 28;
const CANVAS_EDGE_TOOLBAR_GAP = 18;
const CANVAS_EDGE_LABEL_CLEARANCE_X = 8;
const CANVAS_EDGE_LABEL_CLEARANCE_Y = 6;
const CANVAS_EDGE_ENDPOINT_CLEARANCE_RADIUS = 34;
const CANVAS_EDGE_TOOLBAR_T_OFFSETS = [0, -0.14, 0.14, -0.28, 0.28, -0.4, 0.4] as const;

function resolveCanvasPointForPosition(position: Position): CanvasPoint {
  switch (position) {
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    case Position.Left:
    default:
      return { x: -1, y: 0 };
  }
}

function addCanvasPoint(base: CanvasPoint, offset: CanvasPoint, scale = 1): CanvasPoint {
  return {
    x: base.x + offset.x * scale,
    y: base.y + offset.y * scale
  };
}

function perpendicularCanvasPoint(point: CanvasPoint): CanvasPoint {
  return {
    x: -point.y,
    y: point.x
  };
}

function normalizeCanvasPoint(point: CanvasPoint): CanvasPoint {
  const magnitude = Math.hypot(point.x, point.y);
  if (magnitude < 0.001) {
    return { x: 0, y: -1 };
  }

  return {
    x: point.x / magnitude,
    y: point.y / magnitude
  };
}

function buildCanvasCubicPath(start: CanvasPoint, control1: CanvasPoint, control2: CanvasPoint, end: CanvasPoint): string {
  return `M ${start.x},${start.y} C ${control1.x},${control1.y} ${control2.x},${control2.y} ${end.x},${end.y}`;
}

function buildCanvasCurvePath(curve: CanvasCubicCurve): string {
  return buildCanvasCubicPath(curve.start, curve.control1, curve.control2, curve.end);
}

function interpolateCanvasPoint(start: CanvasPoint, end: CanvasPoint, t: number): CanvasPoint {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  };
}

function clampCanvasEdgeToolbarT(value: number): number {
  return Math.max(0.08, Math.min(0.92, value));
}

function buildCanvasRectFromCenter(center: CanvasPoint, size: CanvasSize): CanvasRect {
  return {
    left: center.x - size.width / 2,
    top: center.y - size.height / 2,
    right: center.x + size.width / 2,
    bottom: center.y + size.height / 2
  };
}

function expandCanvasRect(rect: CanvasRect, paddingX: number, paddingY: number): CanvasRect {
  return {
    left: rect.left - paddingX,
    top: rect.top - paddingY,
    right: rect.right + paddingX,
    bottom: rect.bottom + paddingY
  };
}

function doCanvasRectsIntersect(left: CanvasRect, right: CanvasRect): boolean {
  return !(
    left.right <= right.left ||
    left.left >= right.right ||
    left.bottom <= right.top ||
    left.top >= right.bottom
  );
}

function distanceFromCanvasPointToRect(point: CanvasPoint, rect: CanvasRect): number {
  const clampedX = Math.max(rect.left, Math.min(point.x, rect.right));
  const clampedY = Math.max(rect.top, Math.min(point.y, rect.bottom));
  return Math.hypot(point.x - clampedX, point.y - clampedY);
}

function buildCanvasEdgeToolbarRect(
  anchor: CanvasPoint,
  placement: 'above' | 'below'
): CanvasRect {
  const top =
    placement === 'above'
      ? anchor.y - CANVAS_EDGE_TOOLBAR_GAP - CANVAS_EDGE_TOOLBAR_HEIGHT
      : anchor.y + CANVAS_EDGE_TOOLBAR_GAP;

  return {
    left: anchor.x - CANVAS_EDGE_TOOLBAR_WIDTH / 2,
    top,
    right: anchor.x + CANVAS_EDGE_TOOLBAR_WIDTH / 2,
    bottom: top + CANVAS_EDGE_TOOLBAR_HEIGHT
  };
}

function sampleCanvasCubicPoint(
  start: CanvasPoint,
  control1: CanvasPoint,
  control2: CanvasPoint,
  end: CanvasPoint,
  t: number
): CanvasPoint {
  const inverseT = 1 - t;
  const inverseT2 = inverseT * inverseT;
  const inverseT3 = inverseT2 * inverseT;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: inverseT3 * start.x + 3 * inverseT2 * t * control1.x + 3 * inverseT * t2 * control2.x + t3 * end.x,
    y: inverseT3 * start.y + 3 * inverseT2 * t * control1.y + 3 * inverseT * t2 * control2.y + t3 * end.y
  };
}

function sampleCanvasCubicTangent(
  start: CanvasPoint,
  control1: CanvasPoint,
  control2: CanvasPoint,
  end: CanvasPoint,
  t: number
): CanvasPoint {
  const inverseT = 1 - t;

  return {
    x:
      3 * inverseT * inverseT * (control1.x - start.x) +
      6 * inverseT * t * (control2.x - control1.x) +
      3 * t * t * (end.x - control2.x),
    y:
      3 * inverseT * inverseT * (control1.y - start.y) +
      6 * inverseT * t * (control2.y - control1.y) +
      3 * t * t * (end.y - control2.y)
  };
}

function splitCanvasCubicCurve(curve: CanvasCubicCurve, t: number): { left: CanvasCubicCurve; right: CanvasCubicCurve } {
  const startControl = interpolateCanvasPoint(curve.start, curve.control1, t);
  const controlBridge = interpolateCanvasPoint(curve.control1, curve.control2, t);
  const endControl = interpolateCanvasPoint(curve.control2, curve.end, t);
  const leftInner = interpolateCanvasPoint(startControl, controlBridge, t);
  const rightInner = interpolateCanvasPoint(controlBridge, endControl, t);
  const splitPoint = interpolateCanvasPoint(leftInner, rightInner, t);

  return {
    left: {
      start: curve.start,
      control1: startControl,
      control2: leftInner,
      end: splitPoint
    },
    right: {
      start: splitPoint,
      control1: rightInner,
      control2: endControl,
      end: curve.end
    }
  };
}

function sliceCanvasCubicCurve(curve: CanvasCubicCurve, fromT: number, toT: number): CanvasCubicCurve | null {
  const safeFromT = Math.max(0, Math.min(1, fromT));
  const safeToT = Math.max(0, Math.min(1, toT));
  if (safeToT - safeFromT <= 0.001) {
    return null;
  }

  if (safeFromT <= 0.001 && safeToT >= 0.999) {
    return curve;
  }

  if (safeFromT <= 0.001) {
    return splitCanvasCubicCurve(curve, safeToT).left;
  }

  if (safeToT >= 0.999) {
    return splitCanvasCubicCurve(curve, safeFromT).right;
  }

  const { right } = splitCanvasCubicCurve(curve, safeFromT);
  const relativeT = (safeToT - safeFromT) / (1 - safeFromT);
  return splitCanvasCubicCurve(right, relativeT).left;
}

function createCanvasCubicArcTable(
  curve: CanvasCubicCurve,
  extraTs: number[] = []
): Array<{ t: number; length: number; point: CanvasPoint }> {
  const sampleCount = 96;
  const ts = new Set<number>([0, 1, ...extraTs.map((value) => Math.max(0, Math.min(1, value)))]);
  for (let index = 1; index < sampleCount; index += 1) {
    ts.add(index / sampleCount);
  }

  const sortedTs = [...ts].sort((left, right) => left - right);
  let accumulatedLength = 0;

  return sortedTs.map((t, index) => {
    const point = sampleCanvasCubicPoint(curve.start, curve.control1, curve.control2, curve.end, t);
    if (index > 0) {
      const previousT = sortedTs[index - 1] ?? 0;
      const previousPoint = sampleCanvasCubicPoint(curve.start, curve.control1, curve.control2, curve.end, previousT);
      accumulatedLength += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
    }

    return {
      t,
      point,
      length: accumulatedLength
    };
  });
}

function resolveCanvasTForArcLength(
  samples: Array<{ t: number; length: number; point: CanvasPoint }>,
  targetLength: number
): number {
  if (samples.length === 0) {
    return 0;
  }

  if (targetLength <= 0) {
    return samples[0]?.t ?? 0;
  }

  const totalLength = samples[samples.length - 1]?.length ?? 0;
  if (targetLength >= totalLength) {
    return samples[samples.length - 1]?.t ?? 1;
  }

  for (let index = 1; index < samples.length; index += 1) {
    const current = samples[index];
    const previous = samples[index - 1];
    if (!current || !previous || current.length < targetLength) {
      continue;
    }

    const span = current.length - previous.length;
    if (span <= 0.001) {
      return current.t;
    }

    const ratio = (targetLength - previous.length) / span;
    return previous.t + (current.t - previous.t) * ratio;
  }

  return samples[samples.length - 1]?.t ?? 1;
}

function calculateCanvasBezierControlOffset(distance: number, curvature: number): number {
  if (distance >= 0) {
    return distance * 0.5;
  }

  return curvature * 25 * Math.sqrt(-distance);
}

function resolveCanvasBezierControlPoint(
  current: CanvasPoint,
  currentPosition: Position,
  target: CanvasPoint,
  curvature: number
): CanvasPoint {
  switch (currentPosition) {
    case Position.Left:
      return {
        x: current.x - calculateCanvasBezierControlOffset(current.x - target.x, curvature),
        y: current.y
      };
    case Position.Right:
      return {
        x: current.x + calculateCanvasBezierControlOffset(target.x - current.x, curvature),
        y: current.y
      };
    case Position.Top:
      return {
        x: current.x,
        y: current.y - calculateCanvasBezierControlOffset(current.y - target.y, curvature)
      };
    case Position.Bottom:
    default:
      return {
        x: current.x,
        y: current.y + calculateCanvasBezierControlOffset(target.y - current.y, curvature)
      };
  }
}

function resolveCanvasEdgeToolbarPlacement(params: {
  curve: CanvasCubicCurve;
  labelT: number;
  labelPoint: CanvasPoint;
  labelVisualSize: CanvasSize | null;
}): { point: CanvasPoint; placement: 'above' | 'below' } {
  const { curve, labelT, labelPoint, labelVisualSize } = params;
  const candidateTs = [...new Set(CANVAS_EDGE_TOOLBAR_T_OFFSETS.map((offset) => clampCanvasEdgeToolbarT(labelT + offset)))];
  const labelRect = labelVisualSize
    ? expandCanvasRect(
        buildCanvasRectFromCenter(
          {
            x: labelPoint.x,
            y: labelPoint.y - 2
          },
          labelVisualSize
        ),
        CANVAS_EDGE_LABEL_CLEARANCE_X,
        CANVAS_EDGE_LABEL_CLEARANCE_Y
      )
    : null;

  let bestCandidate: { point: CanvasPoint; placement: 'above' | 'below'; score: number } | null = null;

  for (const t of candidateTs) {
    const point = sampleCanvasCubicPoint(curve.start, curve.control1, curve.control2, curve.end, t);
    for (const placement of ['above', 'below'] as const) {
      const toolbarRect = buildCanvasEdgeToolbarRect(point, placement);
      const labelPenalty =
        labelRect && doCanvasRectsIntersect(toolbarRect, labelRect)
          ? 10_000
          : 0;
      const endpointPenalty =
        Math.max(
          0,
          CANVAS_EDGE_ENDPOINT_CLEARANCE_RADIUS - distanceFromCanvasPointToRect(curve.start, toolbarRect)
        ) +
        Math.max(
          0,
          CANVAS_EDGE_ENDPOINT_CLEARANCE_RADIUS - distanceFromCanvasPointToRect(curve.end, toolbarRect)
        );
      const score =
        labelPenalty +
        endpointPenalty * 1_000 +
        Math.abs(t - labelT) * 100 +
        (placement === 'above' ? 0 : 12);

      if (!bestCandidate || score < bestCandidate.score) {
        bestCandidate = {
          point,
          placement,
          score
        };
      }
    }
  }

  return bestCandidate ?? { point: labelPoint, placement: 'above' };
}

function createCanvasCubicEdgeGeometry(
  start: CanvasPoint,
  control1: CanvasPoint,
  control2: CanvasPoint,
  end: CanvasPoint,
  labelT = 0.5,
  labelVisualSize: CanvasSize | null = null
): CanvasEdgeGeometry {
  const curve = { start, control1, control2, end };
  const labelPoint = sampleCanvasCubicPoint(start, control1, control2, end, labelT);
  const toolbar = resolveCanvasEdgeToolbarPlacement({
    curve,
    labelT,
    labelPoint,
    labelVisualSize
  });

  return {
    curve,
    edgePath: buildCanvasCurvePath(curve),
    labelT,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    toolbarX: toolbar.point.x,
    toolbarY: toolbar.point.y,
    toolbarPlacement: toolbar.placement
  };
}

function createCanvasSameNodeEdgeGeometry(props: EdgeProps<CanvasEdgeData>): CanvasEdgeGeometry {
  const start = { x: props.sourceX, y: props.sourceY };
  const end = { x: props.targetX, y: props.targetY };
  const sourceVector = resolveCanvasPointForPosition(props.sourcePosition);
  const targetVector = resolveCanvasPointForPosition(props.targetPosition);
  const sameAnchor = props.sourcePosition === props.targetPosition;
  const labelText = typeof props.label === 'string' ? props.label : undefined;
  const labelVisualSize = labelText ? estimateCanvasEdgeLabelVisualSize(labelText) : null;

  if (sameAnchor) {
    const outwardDistance = 68;
    const spreadDistance = 34;
    const tangent = perpendicularCanvasPoint(sourceVector);
    const control1 = addCanvasPoint(addCanvasPoint(start, sourceVector, outwardDistance), tangent, -spreadDistance);
    const control2 = addCanvasPoint(addCanvasPoint(end, targetVector, outwardDistance), tangent, spreadDistance);
    return createCanvasCubicEdgeGeometry(start, control1, control2, end, 0.72, labelVisualSize);
  }

  const chordLength = Math.hypot(end.x - start.x, end.y - start.y);
  const outwardDistance = Math.max(54, chordLength * 0.8);
  const combinedDirection = normalizeCanvasPoint({
    x: sourceVector.x + targetVector.x,
    y: sourceVector.y + targetVector.y
  });
  const bendDirection =
    Math.abs(sourceVector.x + targetVector.x) < 0.001 && Math.abs(sourceVector.y + targetVector.y) < 0.001
      ? perpendicularCanvasPoint(sourceVector)
      : combinedDirection;
  const bendDistance = Math.max(28, outwardDistance * 0.7);
  const control1 = addCanvasPoint(addCanvasPoint(start, sourceVector, outwardDistance), bendDirection, bendDistance);
  const control2 = addCanvasPoint(addCanvasPoint(end, targetVector, outwardDistance), bendDirection, bendDistance);
  return createCanvasCubicEdgeGeometry(start, control1, control2, end, 0.5, labelVisualSize);
}

function createCanvasEdgeGeometry(props: EdgeProps<CanvasEdgeData>): CanvasEdgeGeometry {
  if (props.source === props.target) {
    return createCanvasSameNodeEdgeGeometry(props);
  }

  const start = { x: props.sourceX, y: props.sourceY };
  const end = { x: props.targetX, y: props.targetY };
  const curvature = 0.25;
  const control1 = resolveCanvasBezierControlPoint(start, props.sourcePosition, end, curvature);
  const control2 = resolveCanvasBezierControlPoint(end, props.targetPosition, start, curvature);
  const labelText = typeof props.label === 'string' ? props.label : undefined;
  const labelVisualSize = labelText ? estimateCanvasEdgeLabelVisualSize(labelText) : null;

  return createCanvasCubicEdgeGeometry(start, control1, control2, end, 0.5, labelVisualSize);
}

function estimateCanvasEdgeLabelVisualSize(label: string): CanvasSize {
  let glyphUnits = 0;

  for (const character of label) {
    if (/\s/.test(character)) {
      glyphUnits += 0.45;
      continue;
    }

    const codePoint = character.codePointAt(0) ?? 0;
    const isWideGlyph = codePoint >= 0x1100;
    glyphUnits += isWideGlyph ? 1.7 : 0.96;
  }

  return {
    width: Math.max(12, Math.ceil(glyphUnits * 7 + 8)),
    height: 18
  };
}

function createCanvasEdgeVisibleSegments(params: {
  curve: CanvasCubicCurve;
  edgePath: string;
  labelT: number;
  labelVisualSize: CanvasSize | null;
  markerStart?: string;
  markerEnd?: string;
}): CanvasEdgeVisibleSegment[] {
  const { curve, edgePath, labelT, labelVisualSize, markerStart, markerEnd } = params;
  if (!labelVisualSize) {
    return [
      {
        key: 'full',
        path: edgePath,
        markerStart,
        markerEnd,
        isProbeSegment: true
      }
    ];
  }

  const tangent = normalizeCanvasPoint(
    sampleCanvasCubicTangent(curve.start, curve.control1, curve.control2, curve.end, labelT)
  );
  const knockoutWidth = labelVisualSize.width + 4;
  const knockoutHeight = labelVisualSize.height + 4;
  const projectedGap = Math.abs(tangent.x) * knockoutWidth + Math.abs(tangent.y) * knockoutHeight + 2;
  const samples = createCanvasCubicArcTable(curve, [labelT]);
  const labelArcSample = samples.find((sample) => Math.abs(sample.t - labelT) < 0.0001);
  const labelLength = labelArcSample?.length;
  const totalLength = samples[samples.length - 1]?.length ?? 0;

  if (labelLength === undefined || totalLength <= projectedGap + 4) {
    return [
      {
        key: 'full',
        path: edgePath,
        markerStart,
        markerEnd,
        isProbeSegment: true
      }
    ];
  }

  const halfGap = projectedGap / 2;
  const startT = resolveCanvasTForArcLength(samples, Math.max(0, labelLength - halfGap));
  const endT = resolveCanvasTForArcLength(samples, Math.min(totalLength, labelLength + halfGap));
  const segments = [
    {
      key: 'leading',
      fromT: 0,
      toT: startT
    },
    {
      key: 'trailing',
      fromT: endT,
      toT: 1
    }
  ].reduce<CanvasEdgeVisibleSegment[]>((items, segment) => {
    const slicedCurve = sliceCanvasCubicCurve(curve, segment.fromT, segment.toT);
    if (!slicedCurve) {
      return items;
    }

    items.push({
      key: segment.key,
      path: buildCanvasCurvePath(slicedCurve),
      markerStart: segment.fromT <= 0.001 ? markerStart : undefined,
      markerEnd: segment.toT >= 0.999 ? markerEnd : undefined,
      isProbeSegment: false
    });
    return items;
  }, []);

  const normalizedSegments = segments.map((segment, index) => ({
    ...segment,
    isProbeSegment: index === 0
  }));

  return normalizedSegments.length > 0
    ? normalizedSegments
    : [
        {
          key: 'full',
          path: edgePath,
          markerStart,
          markerEnd,
          isProbeSegment: true
        }
      ];
}


function resolveCanvasEdgeArrowIcon(arrowMode: CanvasEdgeArrowMode): string {
  switch (arrowMode) {
    case 'both':
      return 'arrow-both';
    case 'forward':
      return 'arrow-right';
    default:
      return 'remove';
  }
}

export interface CanvasEdgeDependencies {
  t: CanvasEdgeTranslator;
}

export function createCanvasEdgeTypes(
  dependencies: CanvasEdgeDependencies
): { canvas: React.ComponentType<EdgeProps<CanvasEdgeData>> } {
  return {
    canvas: createCanvasEdgeComponent(dependencies.t)
  };
}

function createCanvasEdgeComponent(t: CanvasEdgeTranslator): React.ComponentType<EdgeProps<CanvasEdgeData>> {
  return function CanvasEdge(props: EdgeProps<CanvasEdgeData>): JSX.Element {
    const { curve, edgePath, labelT, labelX, labelY, toolbarX, toolbarY, toolbarPlacement } = createCanvasEdgeGeometry(props);
    const owner = props.data?.owner ?? 'user';
    const arrowMode = props.data?.arrowMode ?? 'none';
    const labelText = typeof props.label === 'string' ? props.label : undefined;
    const edgeColor = props.data?.color;
    const strokeColor = props.data?.strokeColor ?? resolveCanvasEdgeStrokeColor(edgeColor);
    const isLabelEditing = props.data?.isLabelEditing === true;
    const isArrowMenuOpen = props.data?.isArrowMenuOpen === true;
    const isColorMenuOpen = props.data?.isColorMenuOpen === true;
    const inputRef = useRef<HTMLInputElement | null>(null);
    const labelSurfaceRef = useRef<HTMLDivElement | null>(null);
    const labelEditorMeasureRef = useRef<HTMLSpanElement | null>(null);
    const commitLabelOnBlurRef = useRef(true);
    const [labelDraft, setLabelDraft] = useState(labelText ?? '');
    const [isComposing, setIsComposing] = useState(false);
    const [labelEditorWidth, setLabelEditorWidth] = useState<number | null>(null);
    const [labelVisualSize, setLabelVisualSize] = useState<CanvasSize | null>(null);

    useEffect(() => {
      if (isLabelEditing) {
        return;
      }

      setLabelDraft(labelText ?? '');
      setIsComposing(false);
    }, [isLabelEditing, labelText]);

    useLayoutEffect(() => {
      if (!isLabelEditing || !inputRef.current) {
        return;
      }

      commitLabelOnBlurRef.current = true;
      setIsComposing(false);
      setLabelDraft(labelText ?? '');
      inputRef.current.focus();
      inputRef.current.select();
    }, [isLabelEditing]);

    useLayoutEffect(() => {
      if (!isLabelEditing || !labelEditorMeasureRef.current) {
        return;
      }

      const measuredWidth = Math.ceil(labelEditorMeasureRef.current.getBoundingClientRect().width);
      setLabelEditorWidth(Math.max(18, Math.min(220, measuredWidth + 2)));
    }, [isLabelEditing, labelDraft]);

    useLayoutEffect(() => {
      if (isLabelEditing || !labelText || !labelSurfaceRef.current) {
        setLabelVisualSize((current) => (current ? null : current));
        return;
      }

      const element = labelSurfaceRef.current;
      const updateLabelVisualSize = (): void => {
        const rect = element.getBoundingClientRect();
        const nextSize = {
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height)
        };
        setLabelVisualSize((current) =>
          current && current.width === nextSize.width && current.height === nextSize.height ? current : nextSize
        );
      };

      updateLabelVisualSize();
      const resizeObserver = new ResizeObserver(updateLabelVisualSize);
      resizeObserver.observe(element);
      return () => resizeObserver.disconnect();
    }, [isLabelEditing, labelText]);

    const arrowIcon = resolveCanvasEdgeArrowIcon(arrowMode);
    const labelStyle = createCanvasEdgeOverlayStyle(
      `translate(-50%, -50%) translate(${labelX}px, ${labelY - 2}px)`,
      strokeColor
    );
    const toolbarStyle = createCanvasEdgeOverlayStyle(
      toolbarPlacement === 'above'
        ? `translate(-50%, -100%) translate(${toolbarX}px, ${toolbarY - CANVAS_EDGE_TOOLBAR_GAP}px)`
        : `translate(-50%, 0) translate(${toolbarX}px, ${toolbarY + CANVAS_EDGE_TOOLBAR_GAP}px)`,
      strokeColor
    );
    const visibleEdgeSegments = createCanvasEdgeVisibleSegments({
      curve,
      edgePath,
      labelT,
      labelVisualSize: labelText && !isLabelEditing ? labelVisualSize ?? estimateCanvasEdgeLabelVisualSize(labelText) : null,
      markerStart: props.markerStart,
      markerEnd: props.markerEnd
    });
    const labelNeedsMask = Boolean(labelText && !isLabelEditing && visibleEdgeSegments.length < 2);

    return (
      <>
        {visibleEdgeSegments.map((segment) => (
          <path
            key={`outline-${segment.key}`}
            d={segment.path}
            fill="none"
            className={`canvas-edge-outline ${props.selected ? 'is-selected' : ''}`}
          />
        ))}
        {visibleEdgeSegments.map((segment) => (
          <path
            key={`path-${segment.key}`}
            d={segment.path}
            fill="none"
            className="canvas-edge-path"
            style={{
              ...props.style,
              stroke: strokeColor,
              strokeWidth: props.style?.strokeWidth ?? 1.8
            }}
            markerStart={segment.markerStart}
            markerEnd={segment.markerEnd}
            data-edge-visible-segment={segment.key}
            data-edge-probe={segment.isProbeSegment ? 'true' : undefined}
            data-edge-id={props.id}
            data-edge-source={props.source}
            data-edge-target={props.target}
            data-edge-owner={owner}
            data-edge-arrow-mode={arrowMode}
            data-edge-color={edgeColor}
            data-edge-label={labelText}
            data-edge-selected={props.selected ? 'true' : 'false'}
          />
        ))}
        <path
          d={edgePath}
          fill="none"
          className="canvas-edge-hitbox"
          data-edge-hitbox="true"
          data-edge-id={props.id}
        />
        {props.selected ? (
          <EdgeLabelRenderer>
            <div
              className="canvas-edge-toolbar-anchor"
              data-edge-toolbar-anchor="true"
              style={toolbarStyle}
              onMouseDown={stopCanvasEvent}
              onClick={stopCanvasEvent}
              onContextMenu={(event) => {
                event.preventDefault();
                stopCanvasEvent(event);
              }}
            >
              {isArrowMenuOpen ? (
                <div
                  className="canvas-edge-arrow-menu"
                  data-edge-arrow-menu="true"
                  data-edge-arrow-menu-edge-id={props.id}
                >
                  {CANVAS_EDGE_ARROW_MENU_ITEMS.map((item) => (
                    <button
                      key={item.arrowMode}
                      type="button"
                      className={`canvas-edge-arrow-menu-item ${item.arrowMode === arrowMode ? 'is-active' : ''}`}
                      data-edge-arrow-mode={item.arrowMode}
                      onClick={() => props.data?.onSetArrowMode?.(item.arrowMode)}
                    >
                      <span className={`canvas-edge-toolbar-icon codicon codicon-${item.icon}`} aria-hidden="true" />
                      <span>{t(item.labelKey)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {isColorMenuOpen ? (
                <div
                  className="canvas-edge-arrow-menu"
                  data-edge-color-menu="true"
                  data-edge-color-menu-edge-id={props.id}
                >
                  {CANVAS_EDGE_COLOR_MENU_ITEMS.map((item) => {
                    const itemStrokeColor = resolveCanvasEdgeStrokeColor(item.color);
                    const isActive = item.color === undefined ? edgeColor === undefined : item.color === edgeColor;
                    return (
                      <button
                        key={item.color ?? 'default'}
                        type="button"
                        className={`canvas-edge-arrow-menu-item ${isActive ? 'is-active' : ''}`}
                        data-edge-color-option={item.color ?? 'default'}
                        onClick={() => props.data?.onSetColor?.(item.color ?? null)}
                      >
                        <span
                          className="canvas-edge-color-swatch"
                          aria-hidden="true"
                          style={createCanvasEdgeOverlayStyle('none', itemStrokeColor)}
                        />
                        <span>{t(item.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div
                className="canvas-edge-toolbar"
                data-edge-toolbar="true"
                data-edge-toolbar-edge-id={props.id}
              >
                <button
                  type="button"
                  className={`canvas-edge-toolbar-button ${isArrowMenuOpen ? 'is-active' : ''}`}
                  title={t('edge.toolbar.arrowMode')}
                  aria-label={t('edge.toolbar.arrowMode')}
                  aria-haspopup="menu"
                  aria-expanded={isArrowMenuOpen}
                  onClick={() => props.data?.onToggleArrowMenu?.()}
                >
                  <span className={`canvas-edge-toolbar-icon codicon codicon-${arrowIcon}`} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`canvas-edge-toolbar-button ${isColorMenuOpen ? 'is-active' : ''}`}
                  title={t('edge.toolbar.color')}
                  aria-label={t('edge.toolbar.color')}
                  aria-haspopup="menu"
                  aria-expanded={isColorMenuOpen}
                  onClick={() => props.data?.onToggleColorMenu?.()}
                >
                  <span
                    className="canvas-edge-toolbar-icon codicon codicon-symbol-color"
                    aria-hidden="true"
                    style={{ color: strokeColor }}
                  />
                </button>
                <button
                  type="button"
                  className="canvas-edge-toolbar-button"
                  title={t('edge.toolbar.editLabel')}
                  aria-label={t('edge.toolbar.editLabel')}
                  onClick={() => props.data?.onStartLabelEdit?.()}
                >
                  <span className="canvas-edge-toolbar-icon codicon codicon-edit" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="canvas-edge-toolbar-button danger"
                  title={t('edge.toolbar.delete')}
                  aria-label={t('edge.toolbar.delete')}
                  onClick={() => props.data?.onDeleteEdge?.()}
                >
                  <span className="canvas-edge-toolbar-icon codicon codicon-trash" aria-hidden="true" />
                </button>
              </div>
            </div>
          </EdgeLabelRenderer>
        ) : null}
        {isLabelEditing ? (
          <EdgeLabelRenderer>
            <div
              className="canvas-edge-label-editor-shell"
              style={labelStyle}
              onMouseDown={stopCanvasEvent}
              onClick={stopCanvasEvent}
              onContextMenu={(event) => {
                event.preventDefault();
                stopCanvasEvent(event);
              }}
            >
              <span ref={labelEditorMeasureRef} className="canvas-edge-label-editor-measure" aria-hidden="true">
                {labelDraft || t('edge.label.placeholder')}
              </span>
              <input
                ref={inputRef}
                type="text"
                className="canvas-edge-label-editor"
                data-edge-label-editor="true"
                data-edge-label-editor-edge-id={props.id}
                value={labelDraft}
                placeholder={t('edge.label.placeholder')}
                maxLength={120}
                style={labelEditorWidth ? { width: `${labelEditorWidth}px` } : undefined}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(event) => {
                  setIsComposing(false);
                  setLabelDraft(event.currentTarget.value);
                }}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  stopCanvasEvent(event);

                  if (isComposing || isImeComposingKeyboardEvent(event)) {
                    return;
                  }

                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitLabelOnBlurRef.current = false;
                    props.data?.onSubmitLabelEdit?.(event.currentTarget.value);
                    return;
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault();
                    commitLabelOnBlurRef.current = false;
                    setIsComposing(false);
                    props.data?.onCancelLabelEdit?.();
                  }
                }}
                onBlur={(event) => {
                  setIsComposing(false);
                  if (!commitLabelOnBlurRef.current) {
                    commitLabelOnBlurRef.current = true;
                    return;
                  }

                  props.data?.onSubmitLabelEdit?.(event.currentTarget.value);
                }}
              />
            </div>
          </EdgeLabelRenderer>
        ) : null}
        {labelText && !isLabelEditing ? (
          <EdgeLabelRenderer>
            <div
              ref={labelSurfaceRef}
              className={`canvas-edge-label ${labelNeedsMask ? 'needs-mask' : ''}`}
              data-edge-label="true"
              data-edge-label-edge-id={props.id}
              data-edge-label-mask={labelNeedsMask ? 'true' : undefined}
              style={labelStyle}
              onMouseDown={stopCanvasEvent}
              onClick={(event) => {
                stopCanvasEvent(event);
                props.data?.onSelectEdge?.();
              }}
              onDoubleClick={(event) => {
                stopCanvasEvent(event);
                props.data?.onStartLabelEdit?.();
              }}
            >
              <span className="canvas-edge-label-text">{labelText}</span>
            </div>
          </EdgeLabelRenderer>
        ) : null}
      </>
    );
  };
}

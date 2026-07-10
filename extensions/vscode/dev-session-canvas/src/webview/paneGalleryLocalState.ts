import type { Viewport } from 'reactflow';

export type PaneGalleryLayoutMode = 'dynamic' | 'grid' | 'topThumbnails' | 'sideThumbnails';
export type PaneGalleryOverviewLayoutMode = Extract<PaneGalleryLayoutMode, 'dynamic' | 'grid'>;
export type PaneGalleryThumbnailLayoutMode = Extract<PaneGalleryLayoutMode, 'topThumbnails' | 'sideThumbnails'>;
export type PaneGalleryViewportRole = 'overview' | 'main';

export const PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT: PaneGalleryOverviewLayoutMode = 'dynamic';
export const PANE_GALLERY_DEFAULT_THUMBNAIL_LAYOUT: PaneGalleryThumbnailLayoutMode = 'sideThumbnails';

export interface PaneGalleryLocalState {
  layout?: PaneGalleryLayoutMode;
  activeRootGroupId?: string;
  lastOverviewLayout?: PaneGalleryOverviewLayoutMode;
  lastThumbnailLayout?: PaneGalleryThumbnailLayoutMode;
  overviewViewports?: Record<string, Viewport>;
  mainViewports?: Record<string, Viewport>;
}

export function normalizePaneGalleryLocalState(value: unknown): PaneGalleryLocalState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<PaneGalleryLocalState> & {
    paneViewports?: unknown;
    mainFitRootGroupIds?: unknown;
  };
  const legacyPaneViewports = normalizePaneGalleryViewportRecord(candidate.paneViewports);
  const legacyMainRootIds = new Set(normalizeUniqueStringArray(candidate.mainFitRootGroupIds) ?? []);
  const overviewViewports =
    normalizePaneGalleryViewportRecord(candidate.overviewViewports) ??
    filterPaneGalleryViewportRecord(legacyPaneViewports, (rootGroupId) => !legacyMainRootIds.has(rootGroupId));
  const mainViewports =
    normalizePaneGalleryViewportRecord(candidate.mainViewports) ??
    filterPaneGalleryViewportRecord(legacyPaneViewports, (rootGroupId) => legacyMainRootIds.has(rootGroupId));
  const normalizedLayout = normalizePaneGalleryLayoutMode(candidate.layout);
  const normalized: PaneGalleryLocalState = {
    layout: normalizedLayout,
    activeRootGroupId: typeof candidate.activeRootGroupId === 'string' ? candidate.activeRootGroupId : undefined,
    lastOverviewLayout:
      normalizePaneGalleryOverviewLayoutMode(candidate.lastOverviewLayout) ??
      normalizePaneGalleryOverviewLayoutMode(normalizedLayout),
    lastThumbnailLayout:
      normalizePaneGalleryThumbnailLayoutMode(candidate.lastThumbnailLayout) ??
      normalizePaneGalleryThumbnailLayoutMode(normalizedLayout),
    overviewViewports: overviewViewports && Object.keys(overviewViewports).length > 0 ? overviewViewports : undefined,
    mainViewports: mainViewports && Object.keys(mainViewports).length > 0 ? mainViewports : undefined
  };

  return Object.values(normalized).some((entry) => entry !== undefined) ? normalized : undefined;
}

function normalizePaneGalleryViewportRecord(value: unknown): Record<string, Viewport> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(value).flatMap(([rootGroupId, viewport]) => {
      if (
        typeof rootGroupId !== 'string' ||
        !viewport ||
        typeof viewport !== 'object' ||
        typeof (viewport as Partial<Viewport>).x !== 'number' ||
        typeof (viewport as Partial<Viewport>).y !== 'number' ||
        typeof (viewport as Partial<Viewport>).zoom !== 'number'
      ) {
        return [];
      }

      const normalizedViewport = viewport as Viewport;
      if (
        !Number.isFinite(normalizedViewport.x) ||
        !Number.isFinite(normalizedViewport.y) ||
        !Number.isFinite(normalizedViewport.zoom) ||
        normalizedViewport.zoom <= 0
      ) {
        return [];
      }

      return [[rootGroupId, normalizedViewport]];
    })
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function filterPaneGalleryViewportRecord(
  record: Record<string, Viewport> | undefined,
  predicate: (rootGroupId: string) => boolean
): Record<string, Viewport> | undefined {
  if (!record) {
    return undefined;
  }

  const filtered = Object.fromEntries(Object.entries(record).filter(([rootGroupId]) => predicate(rootGroupId)));
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function normalizeUniqueStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))];
  return entries.length > 0 ? entries : undefined;
}

export function normalizePaneGalleryLayoutMode(value: unknown): PaneGalleryLayoutMode | undefined {
  return value === 'dynamic' || value === 'grid' || value === 'topThumbnails' || value === 'sideThumbnails'
    ? value
    : undefined;
}

export function isPaneGalleryThumbnailLayout(layout: PaneGalleryLayoutMode): boolean {
  return layout === 'topThumbnails' || layout === 'sideThumbnails';
}

export function resolvePaneGalleryViewportRole(layout: PaneGalleryLayoutMode): PaneGalleryViewportRole {
  return isPaneGalleryThumbnailLayout(layout) ? 'main' : 'overview';
}

export function normalizePaneGalleryOverviewLayoutMode(value: unknown): PaneGalleryOverviewLayoutMode | undefined {
  return value === 'dynamic' || value === 'grid' ? value : undefined;
}

export function normalizePaneGalleryThumbnailLayoutMode(value: unknown): PaneGalleryThumbnailLayoutMode | undefined {
  return value === 'topThumbnails' || value === 'sideThumbnails' ? value : undefined;
}

export function resolvePaneGalleryLastOverviewLayout(state: PaneGalleryLocalState | undefined): PaneGalleryOverviewLayoutMode {
  return (
    normalizePaneGalleryOverviewLayoutMode(state?.lastOverviewLayout) ??
    normalizePaneGalleryOverviewLayoutMode(state?.layout) ??
    PANE_GALLERY_DEFAULT_OVERVIEW_LAYOUT
  );
}

export function resolvePaneGalleryLastThumbnailLayout(
  state: PaneGalleryLocalState | undefined
): PaneGalleryThumbnailLayoutMode {
  return (
    normalizePaneGalleryThumbnailLayoutMode(state?.lastThumbnailLayout) ??
    normalizePaneGalleryThumbnailLayoutMode(state?.layout) ??
    PANE_GALLERY_DEFAULT_THUMBNAIL_LAYOUT
  );
}

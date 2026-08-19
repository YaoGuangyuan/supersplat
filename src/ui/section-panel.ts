import { Container } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from './tooltips';

type SplatLike = {
    splatData: {
        numSplats: number;
        getProp: (name: string) => unknown;
    };
    numDeleted?: number;
    numLocked?: number;
};

type SectionSettings = {
    topAxes: string;
    topVerticalDirection: string;
    sectionHeightDirection: string;
    thickness: number;
    sideMode: string;
    scope: string;
    maxDisplayPoints: number;
    interactiveMaxDisplayPoints: number;
    renderMode: string;
    pointSize: number;
    pixelCellSize: number;
};

type TopBounds = {
    minA: number;
    maxA: number;
    minB: number;
    maxB: number;
};

type SectionLine = {
    a0: number;
    b0: number;
    a1: number;
    b1: number;
};

type SectionPoint = {
    index: number;
    along: number;
    height: number;
    r: number;
    g: number;
    b: number;
};

type TopDrawData = {
    candidates: number[];
    a: Float32Array;
    b: Float32Array;
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    fdc0: Float32Array | null;
    fdc1: Float32Array | null;
    fdc2: Float32Array | null;
    colorR: Uint8Array | null;
    colorG: Uint8Array | null;
    colorB: Uint8Array | null;
    settings: SectionSettings;
};

type SectionViewerData = {
    points: SectionPoint[];
    length: number;
    minHeight: number;
    maxHeight: number;
    settings: SectionSettings;
};

type SectionViewBounds = {
    minAlong: number;
    maxAlong: number;
    minHeight: number;
    maxHeight: number;
};

type TopPolygonPoint = {
    a: number;
    b: number;
};

type SectionPolygonPoint = {
    along: number;
    height: number;
};

type CanvasPoint = {
    x: number;
    y: number;
};

type TopSelectionTool = 'rect' | 'polygon' | 'lasso' | 'brush' | 'flood' | 'eyedropper';
type ViewerSelectionTool = 'none' | 'rect' | 'polygon' | 'lasso' | 'brush' | 'flood' | 'eyedropper';

type ViewportTransform = {
    scale: number;
    offsetX: number;
    offsetY: number;
    drawWidth: number;
    drawHeight: number;
};

type CanvasResizeResult = {
    changed: boolean;
    prevWidth: number;
    prevHeight: number;
    nextWidth: number;
    nextHeight: number;
};

type DragState = {
    mode: 'pan' | 'select' | 'lasso' | 'brush';
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    startTopBounds?: TopBounds;
    startViewerBounds?: SectionViewBounds;
};

type FloatingWindowDragState = {
    viewer: HTMLDivElement;
    kind: 'top' | 'viewer';
    offsetX: number;
    offsetY: number;
};

type FloatingWindowDragStart = {
    kind: 'top' | 'viewer';
    startX: number;
    startY: number;
};

const GS_STATE = {
    selected: 1,
    locked: 2,
    deleted: 4
};

const SH_C0 = 0.28209479177387814;

const DEFAULT_SECTION_SETTINGS: SectionSettings = {
    topAxes: 'xy',
    topVerticalDirection: 'normal',
    sectionHeightDirection: 'normal',
    thickness: 1.0,
    sideMode: 'both',
    scope: 'all',
    maxDisplayPoints: 50000,
    interactiveMaxDisplayPoints: 12000,
    renderMode: 'color',
    pointSize: 1,
    pixelCellSize: 2
};

const COMPOSE_EDGE_GAP = 12;
const COMPOSE_MIN_WIDTH = 360;
const COMPOSE_MAX_WIDTH = 960;
const COMPOSE_DEFAULT_WIDTH_RATIO = 0.44;

const finiteNumber = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const loadJson = <T>(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            return {
                ...(fallback as any),
                ...JSON.parse(raw)
            } as T;
        }
    } catch {
        // ignore malformed localStorage data
    }

    return { ...(fallback as any) } as T;
};

const saveJson = (key: string, value: unknown) => {
    localStorage.setItem(key, JSON.stringify(value));
};

const getFloatArray = (splat: SplatLike, name: string): Float32Array | null => {
    const prop = splat.splatData.getProp(name);
    return prop instanceof Float32Array ? prop : null;
};

const getUint8Array = (splat: SplatLike, name: string): Uint8Array | null => {
    const prop = splat.splatData.getProp(name);
    return prop instanceof Uint8Array ? prop : null;
};

const isValidGaussian = (state: Uint8Array | null, i: number) => {
    if (!state) return true;
    return (state[i] & (GS_STATE.locked | GS_STATE.deleted)) === 0;
};

const isSelectedGaussian = (state: Uint8Array | null, i: number) => {
    if (!state) return false;
    return (state[i] & GS_STATE.selected) !== 0;
};

const decodeColorChannel = (value: number) => {
    return Math.max(0, Math.min(1, SH_C0 * value + 0.5));
};

const prepareArrays = (splat: SplatLike) => {
    const x = getFloatArray(splat, 'x');
    const y = getFloatArray(splat, 'y');
    const z = getFloatArray(splat, 'z');

    if (!x || !y || !z) {
        throw new Error('Selected splat does not have x/y/z properties.');
    }

    return {
        n: splat.splatData.numSplats,
        x,
        y,
        z,
        state: getUint8Array(splat, 'state'),
        fdc0: getFloatArray(splat, 'f_dc_0'),
        fdc1: getFloatArray(splat, 'f_dc_1'),
        fdc2: getFloatArray(splat, 'f_dc_2')
    };
};

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const updateProgress = (events: Events, text: string, progress: number) => {
    events.fire('progressUpdate', {
        text,
        progress: Math.max(0, Math.min(1, progress))
    });
};

const getCoords = (
    axes: string,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    i: number
) => {
    if (axes === 'xz') {
        return { a: x[i], b: z[i], h: y[i], topA: 'X', topB: 'Z', height: 'Y' };
    }

    if (axes === 'yz') {
        return { a: y[i], b: z[i], h: x[i], topA: 'Y', topB: 'Z', height: 'X' };
    }

    return { a: x[i], b: y[i], h: z[i], topA: 'X', topB: 'Y', height: 'Z' };
};

const pointInPolygon = (a: number, b: number, polygon: TopPolygonPoint[]) => {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const pi = polygon[i];
        const pj = polygon[j];
        const minA = Math.min(pi.a, pj.a);
        const maxA = Math.max(pi.a, pj.a);
        const minB = Math.min(pi.b, pj.b);
        const maxB = Math.max(pi.b, pj.b);
        const cross = (pj.a - pi.a) * (b - pi.b) - (pj.b - pi.b) * (a - pi.a);

        if (Math.abs(cross) < 1e-9 && a >= minA - 1e-9 && a <= maxA + 1e-9 && b >= minB - 1e-9 && b <= maxB + 1e-9) {
            return true;
        }

        const intersects = ((pi.b > b) !== (pj.b > b)) &&
            (a < ((pj.a - pi.a) * (b - pi.b)) / (pj.b - pi.b) + pi.a);

        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
};

const pointInSectionPolygon = (along: number, height: number, polygon: SectionPolygonPoint[]) => {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const pi = polygon[i];
        const pj = polygon[j];
        const minAlong = Math.min(pi.along, pj.along);
        const maxAlong = Math.max(pi.along, pj.along);
        const minHeight = Math.min(pi.height, pj.height);
        const maxHeight = Math.max(pi.height, pj.height);
        const cross = (pj.along - pi.along) * (height - pi.height) - (pj.height - pi.height) * (along - pi.along);

        if (Math.abs(cross) < 1e-9 &&
            along >= minAlong - 1e-9 && along <= maxAlong + 1e-9 &&
            height >= minHeight - 1e-9 && height <= maxHeight + 1e-9) {
            return true;
        }

        const intersects = ((pi.height > height) !== (pj.height > height)) &&
            (along < ((pj.along - pi.along) * (height - pi.height)) / (pj.height - pi.height) + pi.along);

        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
};

const pointInScreenPolygon = (x: number, y: number, polygon: CanvasPoint[]) => {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const pi = polygon[i];
        const pj = polygon[j];
        const minX = Math.min(pi.x, pj.x);
        const maxX = Math.max(pi.x, pj.x);
        const minY = Math.min(pi.y, pj.y);
        const maxY = Math.max(pi.y, pj.y);
        const cross = (pj.x - pi.x) * (y - pi.y) - (pj.y - pi.y) * (x - pi.x);

        if (Math.abs(cross) < 1e-6 && x >= minX - 1e-6 && x <= maxX + 1e-6 && y >= minY - 1e-6 && y <= maxY + 1e-6) {
            return true;
        }

        const intersects = ((pi.y > y) !== (pj.y > y)) &&
            (x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x);

        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
};

const distancePointToSegmentSquared = (point: CanvasPoint, a: CanvasPoint, b: CanvasPoint) => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;

    if (len2 <= 1e-9) {
        const dx = point.x - a.x;
        const dy = point.y - a.y;
        return dx * dx + dy * dy;
    }

    const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / len2));
    const projX = a.x + abx * t;
    const projY = a.y + aby * t;
    const dx = point.x - projX;
    const dy = point.y - projY;
    return dx * dx + dy * dy;
};

const floodFillAlphaMask = (
    alpha: Uint8Array,
    width: number,
    height: number,
    startX: number,
    startY: number,
    threshold: number
) => {
    const sx = Math.max(0, Math.min(width - 1, Math.floor(startX)));
    const sy = Math.max(0, Math.min(height - 1, Math.floor(startY)));
    const start = sy * width + sx;
    const seedAlpha = alpha[start];

    if (seedAlpha <= 0) {
        return null;
    }

    const limit = Math.max(1, Math.min(255, threshold * 255));
    const mask = new Uint8Array(width * height);
    const queued = new Uint8Array(width * height);
    const stack: number[] = [start];
    queued[start] = 1;

    while (stack.length > 0) {
        const idx = stack.pop()!;
        if (mask[idx]) {
            continue;
        }

        if (Math.abs(alpha[idx] - seedAlpha) > limit) {
            continue;
        }

        mask[idx] = 255;
        const x = idx % width;
        const y = Math.floor(idx / width);

        if (x > 0) {
            const next = idx - 1;
            if (!queued[next]) {
                queued[next] = 1;
                stack.push(next);
            }
        }
        if (x < width - 1) {
            const next = idx + 1;
            if (!queued[next]) {
                queued[next] = 1;
                stack.push(next);
            }
        }
        if (y > 0) {
            const next = idx - width;
            if (!queued[next]) {
                queued[next] = 1;
                stack.push(next);
            }
        }
        if (y < height - 1) {
            const next = idx + width;
            if (!queued[next]) {
                queued[next] = 1;
                stack.push(next);
            }
        }
    }

    return mask;
};

const rasterizeAlphaRect = (
    alpha: Uint8Array,
    width: number,
    height: number,
    x: number,
    y: number,
    rectWidth: number,
    rectHeight: number,
    value: number
) => {
    if (width <= 0 || height <= 0 || value <= 0) {
        return;
    }

    const w = Math.max(1, rectWidth);
    const h = Math.max(1, rectHeight);
    const minX = Math.max(0, Math.floor(x));
    const maxX = Math.min(width - 1, Math.ceil(x + w) - 1);
    const minY = Math.max(0, Math.floor(y));
    const maxY = Math.min(height - 1, Math.ceil(y + h) - 1);

    for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
            const offset = py * width + px;
            alpha[offset] = Math.min(255, alpha[offset] + value);
        }
    }
};

const rectTouchesFloodMask = (
    floodMask: Uint8Array,
    width: number,
    height: number,
    x: number,
    y: number,
    rectWidth: number,
    rectHeight: number
) => {
    const w = Math.max(1, rectWidth);
    const h = Math.max(1, rectHeight);
    const minX = Math.max(0, Math.floor(x));
    const maxX = Math.min(width - 1, Math.ceil(x + w) - 1);
    const minY = Math.max(0, Math.floor(y));
    const maxY = Math.min(height - 1, Math.ceil(y + h) - 1);

    for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
            if (floodMask[py * width + px]) {
                return true;
            }
        }
    }

    return false;
};

const collectCandidates = (
    n: number,
    state: Uint8Array | null,
    scope: string
) => {
    const out: number[] = [];

    for (let i = 0; i < n; i++) {
        if (!isValidGaussian(state, i)) continue;

        if (scope === 'selected') {
            if (state && (state[i] & GS_STATE.selected) !== 0) {
                out.push(i);
            }
        } else {
            out.push(i);
        }
    }

    return out;
};

const buildTopAxisArrays = (
    candidates: number[],
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    axes: string
) => {
    const a = new Float32Array(candidates.length);
    const b = new Float32Array(candidates.length);

    if (axes === 'xz') {
        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            a[i] = x[idx];
            b[i] = z[idx];
        }
    } else if (axes === 'yz') {
        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            a[i] = y[idx];
            b[i] = z[idx];
        }
    } else {
        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            a[i] = x[idx];
            b[i] = y[idx];
        }
    }

    return { a, b };
};

const buildTopColorArrays = (
    candidates: number[],
    fdc0: Float32Array | null,
    fdc1: Float32Array | null,
    fdc2: Float32Array | null
) => {
    if (!fdc0 || !fdc1 || !fdc2) {
        return { colorR: null, colorG: null, colorB: null };
    }

    const colorR = new Uint8Array(candidates.length);
    const colorG = new Uint8Array(candidates.length);
    const colorB = new Uint8Array(candidates.length);

    for (let i = 0; i < candidates.length; i++) {
        const idx = candidates[i];
        colorR[i] = Math.round(decodeColorChannel(fdc0[idx]) * 255);
        colorG[i] = Math.round(decodeColorChannel(fdc1[idx]) * 255);
        colorB[i] = Math.round(decodeColorChannel(fdc2[idx]) * 255);
    }

    return { colorR, colorG, colorB };
};

const cloneTopBounds = (b: TopBounds): TopBounds => ({
    minA: b.minA,
    maxA: b.maxA,
    minB: b.minB,
    maxB: b.maxB
});

const cloneViewBounds = (b: SectionViewBounds): SectionViewBounds => ({
    minAlong: b.minAlong,
    maxAlong: b.maxAlong,
    minHeight: b.minHeight,
    maxHeight: b.maxHeight
});

class SectionPanel extends Container {
    private events: Events;
    private topAxesInput!: HTMLSelectElement;
    private topVerticalDirectionInput!: HTMLSelectElement;
    private thicknessInput!: HTMLInputElement;
    private sideModeInput!: HTMLSelectElement;
    private scopeInput!: HTMLSelectElement;
    private maxDisplayInput!: HTMLInputElement;
    private interactiveMaxDisplayInput!: HTMLInputElement;
    private renderModeInput!: HTMLSelectElement;
    private pointSizeInput!: HTMLInputElement;
    private pixelCellSizeInput!: HTMLInputElement;
    private sectionHeightDirectionInput!: HTMLSelectElement;
    private topCanvasHost!: HTMLDivElement;
    private topCanvas: HTMLCanvasElement;
    private dockHost!: HTMLDivElement;
    private dockWidthSplitter!: HTMLDivElement;
    private topDockSlot!: HTMLDivElement;
    private dockSplitter!: HTMLDivElement;
    private viewerDockSlot!: HTMLDivElement;
    private topViewDom: HTMLDivElement;
    private viewerCanvasHost!: HTMLDivElement;
    private viewerDom: HTMLDivElement;
    private viewerCanvas: HTMLCanvasElement;
    private statsDom!: HTMLDivElement;
    private topViewStatsDom!: HTMLDivElement;
    private viewerStatsDom!: HTMLDivElement;
    private topSelectButton!: HTMLButtonElement;
    private topPolySelectButton!: HTMLButtonElement;
    private topLassoButton!: HTMLButtonElement;
    private topBrushButton!: HTMLButtonElement;
    private topFloodButton!: HTMLButtonElement;
    private topEyedropperButton!: HTMLButtonElement;
    private topSelectAddButton!: HTMLButtonElement;
    private topInvertButton!: HTMLButtonElement;
    private topResetSelectionButton!: HTMLButtonElement;
    private viewerRectSelectButton!: HTMLButtonElement;
    private viewerPolySelectButton!: HTMLButtonElement;
    private viewerLassoButton!: HTMLButtonElement;
    private viewerBrushButton!: HTMLButtonElement;
    private viewerFloodButton!: HTMLButtonElement;
    private viewerEyedropperButton!: HTMLButtonElement;
    private topDockButton!: HTMLButtonElement;
    private viewerDockButton!: HTMLButtonElement;
    private brushRadiusInput!: HTMLInputElement;
    private floodThresholdInput!: HTMLInputElement;
    private eyedropperThresholdInput!: HTMLInputElement;
    private floodEyedropperScopeInput!: HTMLSelectElement;
    private fullBounds: TopBounds | null = null;
    private bounds: TopBounds | null = null;
    private topDrawData: TopDrawData | null = null;
    private topSelectionMask: Uint32Array | null = null;
    private sectionLine: SectionLine | null = null;
    private drawingPoint = 0;
    private pickingWidth = false;
    private topSelectionMode = false;
    private topSelectionAdditive = false;
    private topSelectionTool: TopSelectionTool = 'rect';
    private topPolygonPoints: TopPolygonPoint[] = [];
    private topPolygonHoverPoint: TopPolygonPoint | null = null;
    private topLassoPoints: CanvasPoint[] = [];
    private topBrushPoints: CanvasPoint[] = [];
    private topBrushCursor: CanvasPoint | null = null;
    private viewerData: SectionViewerData | null = null;
    private viewerView: SectionViewBounds | null = null;
    private viewerSelectionMask: Uint8Array | null = null;
    private sectionSliceMask: Uint8Array | null = null;
    private sectionSliceCount = 0;
    private sectionSliceSignature = '';
    private sectionSliceSplat: SplatLike | null = null;
    private topDataSplat: SplatLike | null = null;
    private viewerDataSplat: SplatLike | null = null;
    private viewerSelectionTool: ViewerSelectionTool = 'none';
    private viewerPolygonPoints: SectionPolygonPoint[] = [];
    private viewerPolygonHoverPoint: SectionPolygonPoint | null = null;
    private viewerLassoPoints: CanvasPoint[] = [];
    private viewerBrushPoints: CanvasPoint[] = [];
    private viewerBrushCursor: CanvasPoint | null = null;
    private topDrag: DragState | null = null;
    private viewerDrag: DragState | null = null;
    private topRenderPending = false;
    private viewerRenderPending = false;
    private topInteractiveUntil = 0;
    private viewerInteractiveUntil = 0;
    private suppressNextDeleteRefresh = false;
    private suppressNextEditApplyRefresh = false;
    private lastTopDeletedCount = -1;
    private lastTopLockedCount = -1;
    private lastViewerDeletedCount = -1;
    private lastViewerLockedCount = -1;
    private lastMask: Uint8Array | Uint32Array | null = null;
    private lastPreviewCount = 0;
    private lastPreviewKind = '';
    private topViewDocked = true;
    private viewerDocked = true;
    private dockWidthRatio = COMPOSE_DEFAULT_WIDTH_RATIO;
    private dockSplitRatio = 0.5;
    private dockWidthResizeActive = false;
    private dockResizeActive = false;
    private topFitOnNextResize = false;
    private floatingWindowDragStart: FloatingWindowDragStart | null = null;
    private floatingWindowDrag: FloatingWindowDragState | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private deferredCanvasSyncHandle: number | null = null;
    private topInteractiveResetHandle: number | null = null;

    constructor(events: Events, _tooltips?: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'section-panel',
            class: 'panel',
            hidden: true
        };

        super(args);

        this.events = events;

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick', 'keydown'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = document.createElement('div');
        header.className = 'panel-header';

        const icon = document.createElement('span');
        icon.className = 'panel-header-icon';
        icon.textContent = '\uE198';

        const title = document.createElement('span');
        title.className = 'panel-header-label';
        title.textContent = 'SECTION LINE';

        const close = document.createElement('span');
        close.className = 'panel-header-button';
        close.textContent = '\uE132';
        close.title = 'Close';
        close.addEventListener('click', () => {
            this.hidden = true;
        });

        header.appendChild(icon);
        header.appendChild(title);
        header.appendChild(close);
        this.dom.appendChild(header);

        this.dockSplitRatio = Math.max(0.2, Math.min(0.8, finiteNumber(localStorage.getItem('supersplat.sectionCompose.splitRatio'), 0.5)));
        this.dockWidthRatio = Math.max(0.28, Math.min(0.72, finiteNumber(localStorage.getItem('supersplat.sectionCompose.widthRatio'), COMPOSE_DEFAULT_WIDTH_RATIO)));
        this.buildRows();
        const dock = this.createDockHost();
        this.dockHost = dock.host;
        this.dockWidthSplitter = dock.widthSplitter;
        this.topDockSlot = dock.topSlot;
        this.dockSplitter = dock.splitter;
        this.viewerDockSlot = dock.viewerSlot;
        this.topViewDom = this.createTopViewWindow();
        this.viewerDom = this.createViewerWindow();
        this.applyWindowDock(this.topViewDom, this.topViewDocked);
        this.applyWindowDock(this.viewerDom, this.viewerDocked);
        this.updateComposeLayout();

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.syncCanvasSizes();
            });
            this.resizeObserver.observe(this.dockHost);
            this.resizeObserver.observe(this.topCanvasHost);
            this.resizeObserver.observe(this.topViewDom);
            this.resizeObserver.observe(this.viewerCanvasHost);
            this.resizeObserver.observe(this.viewerDom);
        }

        window.addEventListener('mousemove', (event) => this.handleGlobalMouseMove(event));
        window.addEventListener('mouseup', (event) => this.handleGlobalMouseUp(event));
        window.addEventListener('resize', () => this.handleWindowResize());
        window.addEventListener('keydown', (event) => this.handleWindowKeyDown(event), true);

        events.on('section.toggle', () => {
            this.hidden = !this.hidden;
        });

        events.on('section.show', () => {
            this.hidden = false;
        });

        events.on('section.hide', () => {
            this.hidden = true;
        });

        events.on('select.delete', () => {
            if (this.suppressNextDeleteRefresh) {
                this.suppressNextDeleteRefresh = false;
                return;
            }

            setTimeout(() => {
                if (this.viewerData && this.sectionLine) {
                    void this.rebuildSectionViewFromCurrentSplatState('External delete refresh');
                    return;
                }

                if (this.topDrawData || !this.topViewDom.hidden) {
                    void this.rebuildTopViewFromCurrentSplatState('External delete refresh');
                }
            }, 0);
        });

        events.on('selection.changed', () => {
            this.syncSelectionHighlightsFromGlobalState();
        });

        events.on('splat.stateChanged', (splat: SplatLike) => {
            const current = this.events.invoke('selection') as SplatLike | null;
            if (!current || splat !== current) return;

            const topStateChanged = this.topDataSplat === splat &&
                (this.lastTopDeletedCount !== splat.numDeleted || this.lastTopLockedCount !== splat.numLocked);
            const viewerStateChanged = this.viewerDataSplat === splat &&
                (this.lastViewerDeletedCount !== splat.numDeleted || this.lastViewerLockedCount !== splat.numLocked);

            if (viewerStateChanged || topStateChanged) {
                void this.refreshViewsFromCurrentSplatState('Splat state changed');
            }

            this.syncSelectionHighlightsFromGlobalState();
        });

        events.on('edit.apply', (editOp: { name?: string } | null) => {
            if (!this.shouldRefreshFromEditOp(editOp)) {
                return;
            }

            if (this.suppressNextEditApplyRefresh) {
                this.suppressNextEditApplyRefresh = false;
                return;
            }

            void this.refreshViewsFromCurrentSplatState(`History ${editOp?.name || 'apply'}`);
        });
    }

    private shouldRefreshFromEditOp(editOp: { name?: string } | null) {
        const name = editOp?.name || '';
        return name === 'deleteSelection' ||
            name === 'reset' ||
            name === 'hideSelection' ||
            name === 'unhideAll';
    }

    private async refreshViewsFromCurrentSplatState(reason = 'refresh') {
        await yieldToBrowser();

        if (this.viewerData && this.sectionLine) {
            await this.rebuildSectionViewFromCurrentSplatState(reason);
            return;
        }

        if (this.topDrawData || !this.topViewDom.hidden) {
            await this.rebuildTopViewFromCurrentSplatState(reason);
        }
    }

    private getSplatStateSignature(splat: SplatLike | null) {
        return {
            deleted: splat?.numDeleted ?? 0,
            locked: splat?.numLocked ?? 0
        };
    }

    private cacheTopStateSignature(splat: SplatLike | null) {
        const sig = this.getSplatStateSignature(splat);
        this.lastTopDeletedCount = sig.deleted;
        this.lastTopLockedCount = sig.locked;
    }

    private cacheViewerStateSignature(splat: SplatLike | null) {
        const sig = this.getSplatStateSignature(splat);
        this.lastViewerDeletedCount = sig.deleted;
        this.lastViewerLockedCount = sig.locked;
    }

    private getSectionSliceSignature(settings: SectionSettings) {
        const line = this.sectionLine;
        if (!line) return '';

        return [
            settings.topAxes,
            settings.scope,
            settings.sideMode || 'both',
            settings.thickness.toFixed(6),
            line.a0.toFixed(6),
            line.b0.toFixed(6),
            line.a1.toFixed(6),
            line.b1.toFixed(6)
        ].join('|');
    }

    private hasCurrentSectionSliceCache(splat: SplatLike | null, settings: SectionSettings) {
        return !!(
            splat &&
            this.sectionLine &&
            this.sectionSliceMask &&
            this.sectionSliceCount > 0 &&
            this.sectionSliceSplat === splat &&
            this.sectionSliceSignature === this.getSectionSliceSignature(settings)
        );
    }

    private invalidateSectionSliceCache() {
        this.sectionSliceMask = null;
        this.sectionSliceCount = 0;
        this.sectionSliceSignature = '';
        this.sectionSliceSplat = null;

        if (this.lastPreviewKind === 'sectionLineSlice') {
            this.lastMask = null;
            this.lastPreviewCount = 0;
            this.lastPreviewKind = '';
        }
    }

    private markSectionSliceDirty(message: string) {
        this.invalidateSectionSliceCache();
        this.setTopStatus(message);

        if (this.viewerData) {
            this.viewerStatsDom.textContent = message;
        }
    }

    private syncSelectionHighlightsFromGlobalState() {
        const splat = this.events.invoke('selection') as SplatLike | null;

        if (!splat) {
            if (this.topSelectionMask) {
                this.topSelectionMask = null;
                if (this.topDrawData) {
                    this.drawTopView();
                }
            }

            if (this.viewerSelectionMask) {
                this.viewerSelectionMask = null;
                if (this.viewerData) {
                    this.scheduleSectionViewerRender();
                }
            }
            return;
        }

        const { n, state } = prepareArrays(splat);

        if (!state) {
            return;
        }

        const fullMask = new Uint8Array(n);
        let selectedCount = 0;

        for (let i = 0; i < n; i++) {
            if (isSelectedGaussian(state, i)) {
                fullMask[i] = 255;
                selectedCount++;
            }
        }

        this.applyLocalSelectionHighlights(selectedCount > 0 ? fullMask : null, splat);
    }

    private maskToFullSelection(mask: Uint8Array | Uint32Array | null, n: number) {
        if (!mask) {
            return null;
        }

        if (mask instanceof Uint8Array && mask.length === n) {
            return mask.slice();
        }

        const fullMask = new Uint8Array(n);

        if (mask instanceof Uint32Array) {
            for (let i = 0; i < mask.length; i++) {
                const idx = mask[i];
                if (idx >= 0 && idx < n) {
                    fullMask[idx] = 255;
                }
            }
            return fullMask;
        }

        const limit = Math.min(mask.length, n);
        for (let i = 0; i < limit; i++) {
            fullMask[i] = mask[i] ? 255 : 0;
        }
        return fullMask;
    }

    private getPredictedSelectionMask(
        splat: SplatLike | null,
        op: 'add' | 'remove' | 'set' | 'intersect',
        mask: Uint8Array | Uint32Array | null
    ) {
        if (!splat) {
            return null;
        }

        const { n, state } = prepareArrays(splat);
        if (!state || n <= 0) {
            return null;
        }

        const deltaMask = this.maskToFullSelection(mask, n);
        if (!deltaMask) {
            return null;
        }

        const fullMask = new Uint8Array(n);

        if (op !== 'set') {
            for (let i = 0; i < n; i++) {
                if (isSelectedGaussian(state, i)) {
                    fullMask[i] = 255;
                }
            }
        }

        switch (op) {
        case 'set':
            return deltaMask;
        case 'add':
            for (let i = 0; i < n; i++) {
                if (deltaMask[i]) {
                    fullMask[i] = 255;
                }
            }
            return fullMask;
        case 'remove':
            for (let i = 0; i < n; i++) {
                if (deltaMask[i]) {
                    fullMask[i] = 0;
                }
            }
            return fullMask;
        case 'intersect':
            for (let i = 0; i < n; i++) {
                fullMask[i] = fullMask[i] && deltaMask[i] ? 255 : 0;
            }
            return fullMask;
        default:
            return fullMask;
        }
    }

    private applyLocalSelectionHighlights(fullMask: Uint8Array | null, splat: SplatLike | null) {
        if (this.topDrawData && this.topDataSplat === splat) {
            if (fullMask) {
                const selectedCandidates: number[] = [];
                const candidates = this.topDrawData.candidates;

                for (let i = 0; i < candidates.length; i++) {
                    const idx = candidates[i];
                    if (fullMask[idx]) {
                        selectedCandidates.push(idx);
                    }
                }

                this.topSelectionMask = selectedCandidates.length > 0 ? new Uint32Array(selectedCandidates) : null;
            } else {
                this.topSelectionMask = null;
            }

            this.drawTopView();
        } else if (this.topSelectionMask) {
            this.topSelectionMask = null;
            if (this.topDrawData) {
                this.drawTopView();
            }
        }

        if (this.viewerData && this.viewerDataSplat === splat) {
            if (fullMask) {
                let selectedCount = 0;
                const selectedMask = new Uint8Array(fullMask.length);

                for (let i = 0; i < this.viewerData.points.length; i++) {
                    const idx = this.viewerData.points[i].index;
                    if (fullMask[idx]) {
                        selectedMask[idx] = 255;
                        selectedCount++;
                    }
                }

                this.viewerSelectionMask = selectedCount > 0 ? selectedMask : null;
            } else {
                this.viewerSelectionMask = null;
            }

            this.scheduleSectionViewerRender();
        } else if (this.viewerSelectionMask) {
            this.viewerSelectionMask = null;
            if (this.viewerData) {
                this.scheduleSectionViewerRender();
            }
        }
    }

    private createDockHost() {
        const host = document.createElement('div');
        host.id = 'section-compose-host';
        host.hidden = true;

        const widthSplitter = document.createElement('div');
        widthSplitter.id = 'section-compose-width-splitter';
        widthSplitter.title = 'Drag to resize compose view width.';
        widthSplitter.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.dockWidthResizeActive = true;
            document.body.style.cursor = 'col-resize';
        });

        const topSlot = document.createElement('div');
        topSlot.className = 'section-compose-slot';

        const splitter = document.createElement('div');
        splitter.id = 'section-compose-splitter';
        splitter.title = 'Drag to resize TopView and Section View.';
        splitter.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.dockResizeActive = true;
            document.body.style.cursor = 'row-resize';
        });

        const viewerSlot = document.createElement('div');
        viewerSlot.className = 'section-compose-slot';

        const content = document.createElement('div');
        content.className = 'section-compose-content';
        content.appendChild(topSlot);
        content.appendChild(splitter);
        content.appendChild(viewerSlot);

        host.appendChild(widthSplitter);
        host.appendChild(content);

        const canvasContainer = document.getElementById('canvas-container');
        (canvasContainer || document.body).appendChild(host);

        return { host, widthSplitter, topSlot, splitter, viewerSlot };
    }

    private createWindowHeader(
        titleText: string,
        kind: 'top' | 'viewer',
        isDocked: () => boolean,
        onToggleDock: () => void,
        onClose: () => void
    ) {
        const header = document.createElement('div');
        header.className = 'section-viewer-header';
        header.addEventListener('mousedown', (event) => this.handleWindowHeaderMouseDown(event, kind));

        const title = document.createElement('span');
        title.textContent = titleText;

        const actions = document.createElement('div');
        actions.className = 'section-viewer-actions';
        actions.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        const dock = document.createElement('button');
        dock.type = 'button';
        dock.className = 'section-viewer-dock';
        if (kind === 'top') {
            this.topDockButton = dock;
        } else {
            this.viewerDockButton = dock;
        }
        dock.addEventListener('click', () => {
            onToggleDock();
        });

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'section-viewer-close';
        close.textContent = '\uE132';
        close.title = 'Close';
        close.addEventListener('click', onClose);

        actions.appendChild(dock);
        actions.appendChild(close);

        header.appendChild(title);
        header.appendChild(actions);

        this.updateDockToggleLabels();

        return header;
    }

    private updateDockToggleLabels() {
        if (this.topDockButton) {
            this.topDockButton.textContent = this.topViewDocked ? 'Float' : 'Dock';
            this.topDockButton.title = this.topViewDocked ? 'Show as floating window' : 'Dock into compose view';
        }

        if (this.viewerDockButton) {
            this.viewerDockButton.textContent = this.viewerDocked ? 'Float' : 'Dock';
            this.viewerDockButton.title = this.viewerDocked ? 'Show as floating window' : 'Dock into compose view';
        }
    }

    private applyWindowDock(viewer: HTMLDivElement, docked: boolean) {
        const wasHidden = viewer.hidden;

        if (docked) {
            viewer.classList.add('is-docked');
            viewer.style.left = '';
            viewer.style.top = '';
            viewer.style.right = '';
            viewer.style.bottom = '';
            if (viewer === this.topViewDom) {
                this.topDockSlot.appendChild(viewer);
            } else {
                this.viewerDockSlot.appendChild(viewer);
            }
        } else {
            viewer.classList.remove('is-docked');
            document.body.appendChild(viewer);
        }

        viewer.hidden = wasHidden;
        this.updateDockToggleLabels();
        this.updateComposeLayout();
    }

    private toggleTopViewDock() {
        const wasDocked = this.topViewDocked;
        const rect = this.topViewDom.getBoundingClientRect();
        this.topViewDocked = !this.topViewDocked;
        this.applyWindowDock(this.topViewDom, this.topViewDocked);
        if (wasDocked && !this.topViewDocked) {
            this.setFloatingWindowPosition(this.topViewDom, rect.left, rect.top);
        }
    }

    private toggleViewerDock() {
        const wasDocked = this.viewerDocked;
        const rect = this.viewerDom.getBoundingClientRect();
        this.viewerDocked = !this.viewerDocked;
        this.applyWindowDock(this.viewerDom, this.viewerDocked);
        if (wasDocked && !this.viewerDocked) {
            this.setFloatingWindowPosition(this.viewerDom, rect.left, rect.top);
        }
    }

    private getFloatingWindow(kind: 'top' | 'viewer') {
        return kind === 'top' ? this.topViewDom : this.viewerDom;
    }

    private setFloatingWindowPosition(viewer: HTMLDivElement, left: number, top: number) {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const width = viewer.offsetWidth || 780;
        const height = viewer.offsetHeight || 480;
        const clampedLeft = Math.max(8, Math.min(left, Math.max(8, viewportWidth - width - 8)));
        const clampedTop = Math.max(8, Math.min(top, Math.max(8, viewportHeight - height - 8)));
        viewer.style.left = `${clampedLeft}px`;
        viewer.style.top = `${clampedTop}px`;
        viewer.style.right = 'auto';
        viewer.style.bottom = 'auto';
    }

    private beginFloatingWindowDrag(kind: 'top' | 'viewer', clientX: number, clientY: number) {
        const viewer = this.getFloatingWindow(kind);
        const rect = viewer.getBoundingClientRect();

        if (kind === 'top' ? this.topViewDocked : this.viewerDocked) {
            if (kind === 'top') {
                this.topViewDocked = false;
            } else {
                this.viewerDocked = false;
            }
            this.applyWindowDock(viewer, false);
            this.setFloatingWindowPosition(viewer, rect.left, rect.top);
        } else if (!viewer.style.left && !viewer.style.top) {
            this.setFloatingWindowPosition(viewer, rect.left, rect.top);
        }

        const nextRect = viewer.getBoundingClientRect();
        this.floatingWindowDrag = {
            viewer,
            kind,
            offsetX: clientX - nextRect.left,
            offsetY: clientY - nextRect.top
        };
        document.body.style.cursor = 'move';
    }

    private shouldDockWindow(clientX: number, clientY: number) {
        const canvasContainer = document.getElementById('canvas-container');
        if (!canvasContainer) return false;

        const rect = canvasContainer.getBoundingClientRect();
        if (clientY < rect.top || clientY > rect.bottom) return false;

        const dockWidth = Math.min(rect.width * 0.44, 720);
        return clientX >= rect.right - dockWidth - 24;
    }

    private handleWindowHeaderMouseDown(event: MouseEvent, kind: 'top' | 'viewer') {
        if (event.button !== 0) return;
        this.floatingWindowDragStart = {
            kind,
            startX: event.clientX,
            startY: event.clientY
        };
        event.preventDefault();
    }

    private getComposeDockWidth() {
        const canvasContainer = document.getElementById('canvas-container');
        if (!canvasContainer) {
            return Math.round(COMPOSE_MIN_WIDTH / 0.72 * this.dockWidthRatio);
        }

        const canvasWidth = Math.max(1, canvasContainer.getBoundingClientRect().width || canvasContainer.clientWidth || 1);
        const preferred = Math.round(canvasWidth * this.dockWidthRatio);
        const maxAllowed = Math.max(COMPOSE_MIN_WIDTH, Math.min(COMPOSE_MAX_WIDTH, canvasWidth - 220));
        return Math.max(COMPOSE_MIN_WIDTH, Math.min(maxAllowed, preferred));
    }

    private updateComposeLayout() {
        const topVisible = this.topViewDocked && !this.topViewDom.hidden;
        const viewerVisible = this.viewerDocked && !this.viewerDom.hidden;
        const hostVisible = topVisible || viewerVisible;
        const dualVisible = topVisible && viewerVisible;
        const dockWidth = hostVisible ? this.getComposeDockWidth() : 0;

        this.dockHost.hidden = !hostVisible;
        this.dockHost.style.width = hostVisible ? `${dockWidth}px` : '';
        this.topDockSlot.hidden = !topVisible;
        this.dockSplitter.hidden = !dualVisible;
        this.viewerDockSlot.hidden = !viewerVisible;

        if (dualVisible) {
            this.topDockSlot.style.flex = `${this.dockSplitRatio} 1 0`;
            this.viewerDockSlot.style.flex = `${1 - this.dockSplitRatio} 1 0`;
        } else {
            this.topDockSlot.style.flex = '';
            this.viewerDockSlot.style.flex = '';
        }

        const canvasContainer = document.getElementById('canvas-container');
        if (canvasContainer) {
            canvasContainer.classList.toggle('section-compose-active', hostVisible);
            canvasContainer.classList.toggle('section-compose-single', hostVisible && (topVisible !== viewerVisible));
        }

        this.updateComposeCompanionLayout(hostVisible, dockWidth);
        this.syncCanvasSizes();
        this.scheduleDeferredCanvasSync();
    }

    private scheduleDeferredCanvasSync() {
        if (this.deferredCanvasSyncHandle !== null) {
            cancelAnimationFrame(this.deferredCanvasSyncHandle);
        }

        this.deferredCanvasSyncHandle = requestAnimationFrame(() => {
            this.deferredCanvasSyncHandle = requestAnimationFrame(() => {
                this.deferredCanvasSyncHandle = null;
                this.syncCanvasSizes();
            });
        });
    }

    private updateComposeCompanionLayout(hostVisible: boolean, dockWidth: number) {
        const canvasContainer = document.getElementById('canvas-container');
        if (!canvasContainer) return;

        const reservedWidth = hostVisible ? dockWidth + COMPOSE_EDGE_GAP : 0;
        canvasContainer.style.setProperty('--canvas-overlay-right', hostVisible ? `${reservedWidth}px` : '0px');

        // Reserve the compose width plus its outer gap so the dock border never sits on top of Main View.
        canvasContainer.style.paddingRight = hostVisible ? `${reservedWidth}px` : '';

        const rightToolbar = document.getElementById('right-toolbar');
        if (rightToolbar) {
            rightToolbar.style.right = hostVisible ? `${dockWidth + 36}px` : '';
        }

        const panelBaseRight = dockWidth + 114;
        const panelGap = 12;
        const panelWidth = 320;
        const filterPanel = document.getElementById('filter-panel');
        const sectionPanel = document.getElementById('section-panel');
        const filterVisible = !!(filterPanel && !filterPanel.classList.contains('pcui-hidden'));
        const sectionVisible = !!(sectionPanel && !sectionPanel.classList.contains('pcui-hidden'));

        ['settings-panel', 'color-panel'].forEach((id) => {
            const panel = document.getElementById(id);
            if (panel) {
                panel.style.right = hostVisible ? `${panelBaseRight}px` : '';
            }
        });

        if (filterPanel) {
            const filterRight = hostVisible && filterVisible && sectionVisible
                ? panelBaseRight + panelWidth + panelGap
                : panelBaseRight;
            filterPanel.style.right = hostVisible ? `${filterRight}px` : '';
        }

        if (sectionPanel) {
            sectionPanel.style.right = hostVisible ? `${panelBaseRight}px` : '';
        }

        const bottomToolbar = document.getElementById('bottom-toolbar');
        if (bottomToolbar) {
            bottomToolbar.style.left = hostVisible ? `calc(50% - ${Math.round(reservedWidth / 2)}px)` : '';
        }

        canvasContainer.querySelectorAll('.select-toolbar').forEach((el) => {
            (el as HTMLElement).style.left = hostVisible ? `calc(50% - ${Math.round(reservedWidth / 2)}px)` : '';
        });

        const modeToggle = document.getElementById('mode-toggle');
        if (modeToggle) {
            modeToggle.style.left = hostVisible ? `calc(50% - 60px - ${Math.round(reservedWidth / 2)}px)` : '';
        }

        const viewCube = document.getElementById('view-cube-container');
        if (viewCube) {
            viewCube.style.right = hostVisible ? `${reservedWidth + 8}px` : '';
            viewCube.style.top = hostVisible ? '8px' : '';
        }
    }

    private updateDockWidthFromPointer(clientX: number) {
        const canvasContainer = document.getElementById('canvas-container');
        if (!canvasContainer) return;

        const rect = canvasContainer.getBoundingClientRect();
        const maxAllowed = Math.max(COMPOSE_MIN_WIDTH, Math.min(COMPOSE_MAX_WIDTH, rect.width - 220));
        const width = Math.max(
            COMPOSE_MIN_WIDTH,
            Math.min(maxAllowed, rect.right - clientX - COMPOSE_EDGE_GAP)
        );

        this.dockWidthRatio = Math.max(0.28, Math.min(0.72, width / Math.max(1, rect.width)));
        localStorage.setItem('supersplat.sectionCompose.widthRatio', String(this.dockWidthRatio));
        this.updateComposeLayout();
    }

    private updateDockSplitFromPointer(clientY: number) {
        const rect = this.dockHost.getBoundingClientRect();
        if (!rect.height) return;

        const localY = clientY - rect.top;
        const splitterHeight = this.dockSplitter.hidden ? 0 : this.dockSplitter.getBoundingClientRect().height;
        const ratio = (localY - splitterHeight * 0.5) / Math.max(1, rect.height - splitterHeight);
        this.dockSplitRatio = Math.max(0.2, Math.min(0.8, ratio));
        saveJson('supersplat.sectionCompose.splitRatio', this.dockSplitRatio);
        this.updateComposeLayout();
    }

    private syncCanvasSize(canvas: HTMLCanvasElement, fallbackWidth: number, fallbackHeight: number): CanvasResizeResult {
        const host = canvas.parentElement as HTMLElement | null;
        const prevWidth = canvas.width;
        const prevHeight = canvas.height;
        const nextWidth = Math.max(1, Math.round(host?.clientWidth || fallbackWidth));
        const nextHeight = Math.max(1, Math.round(host?.clientHeight || fallbackHeight));
        if (canvas.width === nextWidth && canvas.height === nextHeight) {
            return {
                changed: false,
                prevWidth,
                prevHeight,
                nextWidth,
                nextHeight
            };
        }
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        return {
            changed: true,
            prevWidth,
            prevHeight,
            nextWidth,
            nextHeight
        };
    }

    private syncCanvasSizes() {
        const topResize = this.syncCanvasSize(this.topCanvas, 760, 420);
        const viewerResize = this.syncCanvasSize(this.viewerCanvas, 760, 420);

        if (topResize.changed) {
            if (this.topFitOnNextResize && this.fullBounds) {
                this.bounds = this.fitTopBoundsToCanvas(
                    this.fullBounds,
                    topResize.nextWidth,
                    topResize.nextHeight
                );
                this.topFitOnNextResize = false;
            } else {
                this.adjustTopBoundsForCanvasResize(
                    topResize.prevWidth,
                    topResize.prevHeight,
                    topResize.nextWidth,
                    topResize.nextHeight
                );
            }
            this.drawTopView();
        }

        if (viewerResize.changed) {
            this.adjustSectionViewForCanvasResize(
                viewerResize.prevWidth,
                viewerResize.prevHeight,
                viewerResize.nextWidth,
                viewerResize.nextHeight
            );
            this.scheduleSectionViewerRender();
        }
    }

    private handleWindowResize() {
        this.syncCanvasSizes();
    }

    private createTopViewWindow() {
        const viewer = document.createElement('div');
        viewer.id = 'section-topview-panel';
        viewer.hidden = true;

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick', 'keydown'].forEach((eventName) => {
            viewer.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = this.createWindowHeader('TOP VIEW', 'top', () => this.topViewDocked, () => {
            this.toggleTopViewDock();
        }, () => {
            viewer.hidden = true;
            this.updateComposeLayout();
        });

        this.topCanvasHost = document.createElement('div');
        this.topCanvasHost.className = 'section-viewer-canvas-host';

        this.topViewStatsDom = document.createElement('div');
        this.topViewStatsDom.className = 'section-viewer-stats';
        this.topViewStatsDom.textContent = 'Refresh Top to open a larger top view. Click two points to draw a section line.';

        viewer.appendChild(header);
        this.topCanvasHost.appendChild(this.topCanvas);
        viewer.appendChild(this.topCanvasHost);
        viewer.appendChild(this.topViewStatsDom);

        document.body.appendChild(viewer);

        return viewer;
    }

    private createViewerWindow() {
        const viewer = document.createElement('div');
        viewer.id = 'section-viewer-panel';
        viewer.hidden = true;

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick', 'keydown'].forEach((eventName) => {
            viewer.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = this.createWindowHeader('SECTION VIEW', 'viewer', () => this.viewerDocked, () => {
            this.toggleViewerDock();
        }, () => {
            viewer.hidden = true;
            this.updateComposeLayout();
        });

        this.viewerCanvasHost = document.createElement('div');
        this.viewerCanvasHost.className = 'section-viewer-canvas-host';

        this.viewerCanvas = document.createElement('canvas');
        this.viewerCanvas.width = 760;
        this.viewerCanvas.height = 420;
        this.viewerCanvas.className = 'section-viewer-canvas';
        this.viewerCanvas.title = 'Left drag: rectangle select. Wheel: zoom. Shift/right drag: pan.';
        this.viewerCanvas.addEventListener('click', (event) => this.handleViewerCanvasClick(event));
        this.viewerCanvas.addEventListener('dblclick', (event) => this.handleViewerCanvasDoubleClick(event));
        this.viewerCanvas.addEventListener('wheel', (event) => this.handleViewerWheel(event), { passive: false });
        this.viewerCanvas.addEventListener('mousedown', (event) => this.handleViewerMouseDown(event));
        this.viewerCanvas.addEventListener('mousemove', (event) => this.handleViewerCanvasMouseMove(event));
        this.viewerCanvas.addEventListener('mouseleave', () => this.handleViewerCanvasMouseLeave());
        this.viewerCanvas.addEventListener('contextmenu', (event) => event.preventDefault());

        this.viewerStatsDom = document.createElement('div');
        this.viewerStatsDom.className = 'section-viewer-stats';
        this.viewerStatsDom.textContent = 'Build a section view, then choose Rect Select or Polygon Select. Wheel zooms; Shift/right drag pans.';

        viewer.appendChild(header);
        this.viewerCanvasHost.appendChild(this.viewerCanvas);
        viewer.appendChild(this.viewerCanvasHost);
        viewer.appendChild(this.viewerStatsDom);

        document.body.appendChild(viewer);

        return viewer;
    }

    private makeButton(text: string, kind = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = kind ? `section-panel-button ${kind}` : 'section-panel-button';
        button.textContent = text;
        return button;
    }

    private makeSelectRow(label: string, value: string, options: { value: string; text: string }[], help: string, parent: HTMLElement = this.dom) {
        const row = document.createElement('div');
        row.className = 'section-panel-row';
        row.title = help;

        const labelEl = document.createElement('span');
        labelEl.className = 'section-panel-row-label';
        labelEl.textContent = label;

        const select = document.createElement('select');
        select.className = 'section-panel-input';

        for (let i = 0; i < options.length; i++) {
            const option = document.createElement('option');
            option.value = options[i].value;
            option.textContent = options[i].text;
            select.appendChild(option);
        }

        select.value = value;

        row.appendChild(labelEl);
        row.appendChild(select);
        parent.appendChild(row);

        return select;
    }

    private makeInputRow(label: string, value: string, help: string, parent: HTMLElement = this.dom) {
        const row = document.createElement('div');
        row.className = 'section-panel-row';
        row.title = help;

        const labelEl = document.createElement('span');
        labelEl.className = 'section-panel-row-label';
        labelEl.textContent = label;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = value;
        input.className = 'section-panel-input';

        row.appendChild(labelEl);
        row.appendChild(input);
        parent.appendChild(row);

        return input;
    }

    private makeControlRow(buttons: HTMLButtonElement[], parent: HTMLElement = this.dom) {
        const row = document.createElement('div');
        row.className = 'section-panel-control-row';
        buttons.forEach((button) => row.appendChild(button));
        parent.appendChild(row);
    }

    private buildRows() {
        const settings = loadJson<SectionSettings>('supersplat.sectionLine.settings', DEFAULT_SECTION_SETTINGS);
        const tabs = document.createElement('div');
        tabs.className = 'section-panel-tabs';

        const tabPages = document.createElement('div');
        tabPages.className = 'section-panel-tab-pages';

        type TabPage = {
            key: string;
            button: HTMLButtonElement;
            page: HTMLDivElement;
        };

        const tabEntries: TabPage[] = [];
        const storedTab = localStorage.getItem('supersplat.sectionPanel.tab');
        const selectedTab = storedTab === 'view' ? 'slice' : (storedTab || 'slice');

        const makeTabPage = (key: string, label: string, description = '') => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'section-panel-tab';
            button.textContent = label;
            tabs.appendChild(button);

            const page = document.createElement('div');
            page.className = 'section-panel-tab-page';

            if (description) {
                const descriptionEl = document.createElement('div');
                descriptionEl.className = 'section-panel-tab-description';
                descriptionEl.textContent = description;
                page.appendChild(descriptionEl);
            }

            tabPages.appendChild(page);
            tabEntries.push({ key, button, page });
            return page;
        };

        const makeTabGroup = (title: string, description: string, parent: HTMLElement) => {
            const group = document.createElement('div');
            group.className = 'section-panel-subgroup';

            const titleEl = document.createElement('div');
            titleEl.className = 'section-panel-subgroup-title';
            titleEl.textContent = title;
            group.appendChild(titleEl);

            if (description) {
                const descriptionEl = document.createElement('div');
                descriptionEl.className = 'section-panel-subgroup-description';
                descriptionEl.textContent = description;
                group.appendChild(descriptionEl);
            }

            parent.appendChild(group);
            return group;
        };

        const setActiveTab = (key: string) => {
            tabEntries.forEach((entry) => {
                const active = entry.key === key;
                entry.button.classList.toggle('active', active);
                entry.page.classList.toggle('active', active);
            });
            localStorage.setItem('supersplat.sectionPanel.tab', key);
        };

        const slicePage = makeTabPage('slice', 'Slice', 'Set slice orientation and width, prepare the TopView line, then build the section result.');
        const selectPage = makeTabPage('select', 'Select', 'Pick points from TopView or Section View, then manage the current selection.');
        const displayPage = makeTabPage('display', 'Display', 'Tune draw density and rendering quality without changing the slice result.');
        const selectCommonGroup = makeTabGroup('Common', 'Shared actions and thresholds used by Top View and Section View tools.', selectPage);
        const selectTopGroup = makeTabGroup('Top View', 'Choose Rect, Polygon, Lasso, Brush, Flood, or Eyedropper for Top View picking.', selectPage);
        const selectSectionGroup = makeTabGroup('Section View', 'Choose Rect, Polygon, Lasso, Brush, Flood, or Eyedropper for Section View picking.', selectPage);

        this.dom.appendChild(tabs);
        this.dom.appendChild(tabPages);

        tabEntries.forEach((entry) => {
            entry.button.addEventListener('click', () => setActiveTab(entry.key));
        });

        setActiveTab(tabEntries.some((entry) => entry.key === selectedTab) ? selectedTab : 'slice');

        this.topAxesInput = this.makeSelectRow('TopView axes', settings.topAxes, [
            { value: 'xy', text: 'XY top / Z height' },
            { value: 'xz', text: 'XZ top / Y height' },
            { value: 'yz', text: 'YZ top / X height' }
        ], 'Choose which two axes form the TopView plane. The remaining axis is vertical in section view.', slicePage);
        this.topVerticalDirectionInput = this.makeSelectRow('TopView vertical', settings.topVerticalDirection || DEFAULT_SECTION_SETTINGS.topVerticalDirection, [
            { value: 'normal', text: 'Normal' },
            { value: 'flipped', text: 'Flipped' }
        ], 'Flip the vertical display direction in TopView without changing the actual point data.', slicePage);
        this.sectionHeightDirectionInput = this.makeSelectRow('Section height', settings.sectionHeightDirection || DEFAULT_SECTION_SETTINGS.sectionHeightDirection, [
            { value: 'normal', text: 'Normal' },
            { value: 'flipped', text: 'Flipped' }
        ], 'Flip the vertical height display direction in Section View without changing the actual section data.', slicePage);

        this.thicknessInput = this.makeInputRow('Thickness', String(settings.thickness), 'Section thickness/depth. Centered mode uses total width. Left/Right side modes use one-sided depth.', slicePage);
        this.sideModeInput = this.makeSelectRow('Thickness side', settings.sideMode || 'both', [
            { value: 'both', text: 'Centered / both sides' },
            { value: 'left', text: 'Left side only' },
            { value: 'right', text: 'Right side only' }
        ], 'Centered includes both sides of the section line. Left/Right modes include only one side of the line direction.', slicePage);

        this.scopeInput = this.makeSelectRow('Scope', settings.scope, [
            { value: 'all', text: 'Whole splat' },
            { value: 'selected', text: 'Current selection' }
        ], 'Use Current selection to draw/build from a rough selected area only.', slicePage);
        this.maxDisplayInput = this.makeInputRow('Max display', String(settings.maxDisplayPoints || DEFAULT_SECTION_SETTINGS.maxDisplayPoints), 'Maximum visible representative points when idle. Selection still uses all section data.', displayPage);
        this.interactiveMaxDisplayInput = this.makeInputRow('Drag display', String(settings.interactiveMaxDisplayPoints || DEFAULT_SECTION_SETTINGS.interactiveMaxDisplayPoints), 'Maximum visible representative points while panning, zooming, or drag-selecting.', displayPage);
        this.renderModeInput = this.makeSelectRow('Render mode', settings.renderMode || DEFAULT_SECTION_SETTINGS.renderMode, [
            { value: 'color', text: 'Adaptive color' },
            { value: 'fast', text: 'Adaptive mono / faster' }
        ], 'Adaptive color always displays point colors. Adaptive mono is faster for very large sections. Selection is always exact.', displayPage);
        this.pointSizeInput = this.makeInputRow('Point size', String(settings.pointSize || DEFAULT_SECTION_SETTINGS.pointSize), 'Canvas point size in pixels. 1 is fastest.', displayPage);
        this.pixelCellSizeInput = this.makeInputRow('Pixel gap', String(settings.pixelCellSize || DEFAULT_SECTION_SETTINGS.pixelCellSize), 'Screen pixel grid size. 1 shows most detail; 2~3 is faster. Selection is always exact.', displayPage);

        this.topCanvas = document.createElement('canvas');
        this.topCanvas.width = 760;
        this.topCanvas.height = 420;
        this.topCanvas.className = 'section-topview-canvas';
        this.topCanvas.title = 'Line mode: click two points to draw line. Rect Select and Polygon Select are available in the Select tab. Wheel: zoom. Shift/right drag: pan.';
        this.topCanvas.addEventListener('click', (event) => this.handleTopCanvasClick(event));
        this.topCanvas.addEventListener('dblclick', (event) => this.handleTopCanvasDoubleClick(event));
        this.topCanvas.addEventListener('wheel', (event) => this.handleTopWheel(event), { passive: false });
        this.topCanvas.addEventListener('mousedown', (event) => this.handleTopMouseDown(event));
        this.topCanvas.addEventListener('mousemove', (event) => this.handleTopCanvasMouseMove(event));
        this.topCanvas.addEventListener('mouseleave', () => this.handleTopCanvasMouseLeave());
        this.topCanvas.addEventListener('contextmenu', (event) => event.preventDefault());

        const refresh = this.makeButton('Refresh Top');
        refresh.addEventListener('click', () => { void this.refreshTopView(); });

        const openTop = this.makeButton('Open Top');
        openTop.title = 'Open the TopView window.';
        openTop.addEventListener('click', () => {
            this.topViewDom.hidden = false;
            this.updateComposeLayout();
            this.drawTopView();
            this.setTopStatus(this.statsDom.textContent || 'TopView opened.');
        });

        const fitTop = this.makeButton('Fit Top');
        fitTop.addEventListener('click', () => this.fitTopView());

        const zoomLine = this.makeButton('Zoom to Line');
        zoomLine.title = 'Zoom TopView to the current section line and its thickness corridor.';
        zoomLine.addEventListener('click', () => { void this.zoomTopToSectionLine(); });

        const pickWidth = this.makeButton('Pick Width');
        pickWidth.title = 'After drawing the section line, click a point in TopView to set thickness like a section tool.';
        pickWidth.addEventListener('click', () => {
            if (!this.sectionLine || this.drawingPoint !== 0) {
                this.setTopStatus('Draw the section line first, then click Pick Width.');
                return;
            }

            this.pickingWidth = true;
            this.setTopStatus('Pick Width mode: click beside the section line to set thickness/depth.');
        });

        const clearLine = this.makeButton('Clear Line');
        clearLine.addEventListener('click', () => {
            this.sectionLine = null;
            this.drawingPoint = 0;
            this.pickingWidth = false;
            this.invalidateSectionSliceCache();
            this.drawTopView();
            this.setTopStatus('Line cleared. Click two points in TopView.');
        });

        this.makeControlRow([refresh, openTop], slicePage);
        this.makeControlRow([fitTop, zoomLine], slicePage);
        this.makeControlRow([pickWidth, clearLine], slicePage);

        this.brushRadiusInput = this.makeInputRow(
            'Brush px',
            localStorage.getItem('supersplat.sectionSelect.brushRadius') || '24',
            'Brush radius in screen pixels for Top View and Section View brush selection.',
            selectCommonGroup
        );
        this.floodThresholdInput = this.makeInputRow(
            'Flood Threshold',
            localStorage.getItem('supersplat.sectionSelect.floodThreshold') || '0.2',
            'Flood threshold. Larger values grow through a wider connected region, matching the native tool direction.',
            selectCommonGroup
        );
        this.eyedropperThresholdInput = this.makeInputRow(
            'Eye Threshold',
            localStorage.getItem('supersplat.sectionSelect.eyedropperThreshold') || '0.2',
            'Eyedropper threshold. Larger values accept a broader color match, like the native tool.',
            selectCommonGroup
        );
        this.floodEyedropperScopeInput = this.makeSelectRow(
            'Flood/Eye scope',
            localStorage.getItem('supersplat.sectionSelect.floodEyeScope') || 'all',
            [
                { value: 'all', text: 'Visible candidates' },
                { value: 'selected', text: 'Current selection only' }
            ],
            'Limit Flood and Eyedropper to the current selection instead of all visible Top View or Section View candidates.',
            selectCommonGroup
        );
        this.brushRadiusInput.addEventListener('change', () => {
            localStorage.setItem('supersplat.sectionSelect.brushRadius', this.brushRadiusInput.value || '24');
        });
        this.floodThresholdInput.addEventListener('change', () => {
            localStorage.setItem('supersplat.sectionSelect.floodThreshold', this.floodThresholdInput.value || '0.2');
        });
        this.eyedropperThresholdInput.addEventListener('change', () => {
            localStorage.setItem('supersplat.sectionSelect.eyedropperThreshold', this.eyedropperThresholdInput.value || '0.2');
        });
        this.floodEyedropperScopeInput.addEventListener('change', () => {
            localStorage.setItem('supersplat.sectionSelect.floodEyeScope', this.floodEyedropperScopeInput.value || 'all');
            if (this.topSelectionMode && (this.topSelectionTool === 'flood' || this.topSelectionTool === 'eyedropper')) {
                this.setTopStatus(this.getTopModeStatusText());
            }
            if (this.viewerSelectionTool === 'flood' || this.viewerSelectionTool === 'eyedropper') {
                this.viewerStatsDom.textContent = this.getViewerModeStatusText();
            }
        });

        this.topSelectButton = this.makeButton('Rect Select');
        this.topSelectButton.title = 'Use rectangle selection in TopView. Left drag selects points instead of drawing a section line.';
        this.topSelectButton.addEventListener('click', () => {
            this.setTopSelectionTool('rect');
        });

        this.topPolySelectButton = this.makeButton('Polygon Select');
        this.topPolySelectButton.title = 'Use polygon selection in TopView. Click to place vertices, then click the first point or press Enter to finish.';
        this.topPolySelectButton.addEventListener('click', () => {
            this.setTopSelectionTool('polygon');
        });

        this.topLassoButton = this.makeButton('Lasso Select');
        this.topLassoButton.title = 'Use freehand lasso selection in TopView. Drag to sketch a closed region.';
        this.topLassoButton.addEventListener('click', () => {
            this.setTopSelectionTool('lasso');
        });

        this.topBrushButton = this.makeButton('Brush Select');
        this.topBrushButton.title = 'Use brush selection in TopView. Drag to paint points with a circular brush.';
        this.topBrushButton.addEventListener('click', () => {
            this.setTopSelectionTool('brush');
        });

        this.topFloodButton = this.makeButton('Flood Select');
        this.topFloodButton.title = 'Use flood selection in TopView. Click a seed point to select its connected cluster.';
        this.topFloodButton.addEventListener('click', () => {
            this.setTopSelectionTool('flood');
        });

        this.topEyedropperButton = this.makeButton('Eyedropper');
        this.topEyedropperButton.title = 'Use color-match selection in TopView. Click a point to select similar colors.';
        this.topEyedropperButton.addEventListener('click', () => {
            this.setTopSelectionTool('eyedropper');
        });

        this.topSelectAddButton = this.makeButton('Add Select');
        this.topSelectAddButton.title = 'When enabled, TopView and Section View selections add to the current selection instead of replacing it.';
        this.topSelectAddButton.addEventListener('click', () => {
            this.topSelectionAdditive = !this.topSelectionAdditive;
            localStorage.setItem('supersplat.sectionTopSelect.additive', this.topSelectionAdditive ? '1' : '0');
            this.updateTopSelectionButtons();
            this.setTopStatus(this.topSelectionAdditive
                ? 'Add Select is on. TopView and Section View picks add to the current selection.'
                : 'Add Select is off. New TopView and Section View picks replace the current selection.');
        });
        this.topSelectionAdditive = localStorage.getItem('supersplat.sectionTopSelect.additive') === '1';

        this.topInvertButton = this.makeButton('Invert Select');
        this.topInvertButton.title = 'Invert selection inside the current TopView candidate set.';
        this.topInvertButton.addEventListener('click', () => {
            void this.invertTopSelection();
        });

        this.topResetSelectionButton = this.makeButton('Reset Select');
        this.topResetSelectionButton.title = 'Clear the current TopView selection and deselect all splats.';
        this.topResetSelectionButton.addEventListener('click', () => {
            this.resetTopSelection();
        });

        this.updateTopSelectionButtons();
        this.makeControlRow([
            this.topSelectAddButton,
            this.topInvertButton,
            this.topResetSelectionButton
        ], selectCommonGroup);
        this.makeControlRow([
            this.topSelectButton,
            this.topPolySelectButton
        ], selectTopGroup);
        this.makeControlRow([
            this.topLassoButton,
            this.topBrushButton
        ], selectTopGroup);
        this.makeControlRow([
            this.topFloodButton,
            this.topEyedropperButton
        ], selectTopGroup);

        const build = this.makeButton('Build View', 'primary');
        build.title = 'Build the profile view in a separate floating window.';
        build.addEventListener('click', () => { void this.buildSectionView(true); });

        this.topAxesInput.addEventListener('change', () => {
            this.markSectionSliceDirty('TopView axes changed. Refresh Top, Build View, or Select Slice to recompute.');
        });
        this.thicknessInput.addEventListener('change', () => {
            this.markSectionSliceDirty('Thickness changed. Build View or Select Slice will use the latest corridor.');
        });
        this.sideModeInput.addEventListener('change', () => {
            this.markSectionSliceDirty('Thickness side changed. Build View or Select Slice will use the latest corridor.');
        });
        this.scopeInput.addEventListener('change', () => {
            this.markSectionSliceDirty('Scope changed. Refresh Top, Build View, or Select Slice to recompute.');
        });
        this.topVerticalDirectionInput.addEventListener('change', () => {
            if (this.topDrawData) {
                this.topDrawData.settings = this.getSettings();
            }
            this.drawTopView();
        });
        this.sectionHeightDirectionInput.addEventListener('change', () => {
            if (this.viewerData) {
                this.viewerData.settings = this.getSettings();
            }
            this.renderSectionViewer();
        });

        const fitView = this.makeButton('Fit View');
        fitView.title = 'Fit the section viewer to the current section points.';
        fitView.addEventListener('click', () => this.fitViewerView(true));

        const rebuildView = this.makeButton('Rebuild');
        rebuildView.title = 'Rebuild Section View from current live splat state.';
        rebuildView.addEventListener('click', () => { void this.rebuildSectionViewFromCurrentSplatState('Manual rebuild'); });

        this.viewerRectSelectButton = this.makeButton('Rect Select');
        this.viewerRectSelectButton.title = 'Enable rectangle selection in Section View. Left drag selects points.';
        this.viewerRectSelectButton.addEventListener('click', () => {
            this.setViewerSelectionTool(this.viewerSelectionTool === 'rect' ? 'none' : 'rect');
        });

        this.viewerPolySelectButton = this.makeButton('Polygon Select');
        this.viewerPolySelectButton.title = 'Enable polygon selection in Section View. Click to place vertices, then click the first point or press Enter to finish.';
        this.viewerPolySelectButton.addEventListener('click', () => {
            this.setViewerSelectionTool(this.viewerSelectionTool === 'polygon' ? 'none' : 'polygon');
        });

        this.viewerLassoButton = this.makeButton('Lasso Select');
        this.viewerLassoButton.title = 'Enable freehand lasso selection in Section View. Drag to sketch a closed region.';
        this.viewerLassoButton.addEventListener('click', () => {
            this.setViewerSelectionTool(this.viewerSelectionTool === 'lasso' ? 'none' : 'lasso');
        });

        this.viewerBrushButton = this.makeButton('Brush Select');
        this.viewerBrushButton.title = 'Enable brush selection in Section View. Drag to paint points with a circular brush.';
        this.viewerBrushButton.addEventListener('click', () => {
            this.setViewerSelectionTool(this.viewerSelectionTool === 'brush' ? 'none' : 'brush');
        });

        this.viewerFloodButton = this.makeButton('Flood Select');
        this.viewerFloodButton.title = 'Enable flood selection in Section View. Click a seed point to select its connected cluster.';
        this.viewerFloodButton.addEventListener('click', () => {
            this.setViewerSelectionTool(this.viewerSelectionTool === 'flood' ? 'none' : 'flood');
        });

        this.viewerEyedropperButton = this.makeButton('Eyedropper');
        this.viewerEyedropperButton.title = 'Enable color-match selection in Section View. Click a point to select similar colors.';
        this.viewerEyedropperButton.addEventListener('click', () => {
            this.setViewerSelectionTool(this.viewerSelectionTool === 'eyedropper' ? 'none' : 'eyedropper');
        });

        const del = this.makeButton('Delete', 'danger');
        del.title = 'Delete currently selected/previewed section points.';
        del.addEventListener('click', () => { void this.deletePreviewed(); });

        const selectSlice = this.makeButton('Select Slice');
        selectSlice.title = 'Select the Gaussians inside the line corridor.';
        selectSlice.addEventListener('click', () => { void this.selectSlice(); });

        this.updateViewerSelectionButtons();
        this.makeControlRow([selectSlice], selectCommonGroup);
        this.makeControlRow([del], selectCommonGroup);
        this.makeControlRow([this.viewerRectSelectButton, this.viewerPolySelectButton], selectSectionGroup);
        this.makeControlRow([this.viewerLassoButton, this.viewerBrushButton], selectSectionGroup);
        this.makeControlRow([this.viewerFloodButton, this.viewerEyedropperButton], selectSectionGroup);
        this.makeControlRow([build, fitView], slicePage);
        this.makeControlRow([rebuildView], slicePage);

        this.statsDom = document.createElement('div');
        this.statsDom.className = 'section-panel-stats';
        this.statsDom.textContent = 'Refresh Top. Click two points for a section line. Wheel zooms; Shift/right drag pans.';
        this.dom.appendChild(this.statsDom);
        this.setTopStatus(this.statsDom.textContent);

        this.drawTopView();
    }

    private setTopStatus(text: string) {
        this.statsDom.textContent = text;
        if (this.topViewStatsDom) {
            this.topViewStatsDom.textContent = text;
        }
    }

    private getTopModeStatusText() {
        const floodEyeScopeText = this.getFloodEyedropperScopeStatusText();

        if (!this.topSelectionMode) {
            return 'Line mode: click two points in TopView. Wheel zooms; Shift/right drag pans.';
        }

        switch (this.topSelectionTool) {
        case 'polygon':
            return `Top Polygon${this.topSelectionAdditive ? ' add' : ''}: left click adds points | click first point/Enter to finish | Esc clears | Shift/right drag: pan | Wheel: zoom`;
        case 'lasso':
            return `Top Lasso${this.topSelectionAdditive ? ' add' : ''}: left drag sketches a freehand region | Shift/right drag: pan | Wheel: zoom`;
        case 'brush':
            return `Top Brush${this.topSelectionAdditive ? ' add' : ''}: left drag paints points | brush ${this.getBrushRadiusPixels().toFixed(0)} px`;
        case 'flood':
            return `Top Flood${this.topSelectionAdditive ? ' add' : ''}: click a seed point to grow a connected cluster${floodEyeScopeText}`;
        case 'eyedropper':
            return `Top Eyedropper${this.topSelectionAdditive ? ' add' : ''}: click a point to select similar colors${floodEyeScopeText}`;
        default:
            return `Top Rect${this.topSelectionAdditive ? ' add' : ''}: left drag selects | Shift/right drag: pan | Wheel: zoom`;
        }
    }

    private clearTopPolygonDraft(redraw = false) {
        this.topPolygonPoints = [];
        this.topPolygonHoverPoint = null;
        if (redraw) {
            this.drawTopView();
        }
    }

    private clearViewerPolygonDraft(redraw = false) {
        this.viewerPolygonPoints = [];
        this.viewerPolygonHoverPoint = null;
        if (redraw) {
            this.scheduleSectionViewerRender();
        }
    }

    private clearTopToolDrafts(redraw = false) {
        this.topPolygonPoints = [];
        this.topPolygonHoverPoint = null;
        this.topLassoPoints = [];
        this.topBrushPoints = [];
        this.topBrushCursor = null;
        if (redraw) {
            this.drawTopView();
        }
    }

    private clearViewerToolDrafts(redraw = false) {
        this.viewerPolygonPoints = [];
        this.viewerPolygonHoverPoint = null;
        this.viewerLassoPoints = [];
        this.viewerBrushPoints = [];
        this.viewerBrushCursor = null;
        if (redraw) {
            this.scheduleSectionViewerRender();
        }
    }

    private setTopSelectionTool(tool: TopSelectionTool) {
        const sameTool = this.topSelectionMode && this.topSelectionTool === tool;

        this.topSelectionMode = !sameTool;
        this.topSelectionTool = tool;
        this.topDrag = null;
        this.clearTopToolDrafts();
        this.updateTopSelectionButtons();
        this.drawTopView();
        this.setTopStatus(this.getTopModeStatusText());
    }

    private getViewerModeStatusText() {
        const floodEyeScopeText = this.getFloodEyedropperScopeStatusText();

        if (this.viewerSelectionTool === 'polygon') {
            return `Section Polygon${this.topSelectionAdditive ? ' add' : ''}: click to add points | click first point/Enter to finish | Esc clears | Wheel: zoom | Shift/right drag: pan`;
        }

        if (this.viewerSelectionTool === 'rect') {
            return `Section Rect${this.topSelectionAdditive ? ' add' : ''}: left drag selects | Wheel: zoom | Shift/right drag: pan`;
        }

        if (this.viewerSelectionTool === 'lasso') {
            return `Section Lasso${this.topSelectionAdditive ? ' add' : ''}: left drag sketches a freehand region | Wheel: zoom | Shift/right drag: pan`;
        }

        if (this.viewerSelectionTool === 'brush') {
            return `Section Brush${this.topSelectionAdditive ? ' add' : ''}: left drag paints points | brush ${this.getBrushRadiusPixels().toFixed(0)} px`;
        }

        if (this.viewerSelectionTool === 'flood') {
            return `Section Flood${this.topSelectionAdditive ? ' add' : ''}: click a seed point to grow a connected cluster${floodEyeScopeText}`;
        }

        if (this.viewerSelectionTool === 'eyedropper') {
            return `Section Eyedropper${this.topSelectionAdditive ? ' add' : ''}: click a point to select similar colors${floodEyeScopeText}`;
        }

        return 'Section selection is off. Choose Rect, Polygon, Lasso, Brush, Flood, or Eyedropper first. Wheel zooms; Shift/right drag pans.';
    }

    private updateTopSelectionButtons() {
        if (this.topSelectButton) {
            this.topSelectButton.classList.toggle('active', this.topSelectionMode && this.topSelectionTool === 'rect');
        }
        if (this.topPolySelectButton) {
            this.topPolySelectButton.classList.toggle('active', this.topSelectionMode && this.topSelectionTool === 'polygon');
        }
        if (this.topLassoButton) {
            this.topLassoButton.classList.toggle('active', this.topSelectionMode && this.topSelectionTool === 'lasso');
        }
        if (this.topBrushButton) {
            this.topBrushButton.classList.toggle('active', this.topSelectionMode && this.topSelectionTool === 'brush');
        }
        if (this.topFloodButton) {
            this.topFloodButton.classList.toggle('active', this.topSelectionMode && this.topSelectionTool === 'flood');
        }
        if (this.topEyedropperButton) {
            this.topEyedropperButton.classList.toggle('active', this.topSelectionMode && this.topSelectionTool === 'eyedropper');
        }
        if (this.topSelectAddButton) {
            this.topSelectAddButton.classList.toggle('active', this.topSelectionAdditive);
        }
    }

    private updateViewerSelectionButtons() {
        if (this.viewerRectSelectButton) {
            this.viewerRectSelectButton.classList.toggle('active', this.viewerSelectionTool === 'rect');
        }
        if (this.viewerPolySelectButton) {
            this.viewerPolySelectButton.classList.toggle('active', this.viewerSelectionTool === 'polygon');
        }
        if (this.viewerLassoButton) {
            this.viewerLassoButton.classList.toggle('active', this.viewerSelectionTool === 'lasso');
        }
        if (this.viewerBrushButton) {
            this.viewerBrushButton.classList.toggle('active', this.viewerSelectionTool === 'brush');
        }
        if (this.viewerFloodButton) {
            this.viewerFloodButton.classList.toggle('active', this.viewerSelectionTool === 'flood');
        }
        if (this.viewerEyedropperButton) {
            this.viewerEyedropperButton.classList.toggle('active', this.viewerSelectionTool === 'eyedropper');
        }
    }

    private setViewerSelectionTool(tool: ViewerSelectionTool) {
        this.viewerSelectionTool = tool;
        this.viewerDrag = null;
        this.clearViewerToolDrafts();
        this.updateViewerSelectionButtons();
        if (this.viewerData) {
            this.scheduleSectionViewerRender();
        }
        if (this.viewerStatsDom) {
            this.viewerStatsDom.textContent = this.getViewerModeStatusText();
        }
    }

    private getBrushRadiusPixels() {
        return Math.max(2, Math.min(400, finiteNumber(this.brushRadiusInput?.value, 24)));
    }

    private getFloodThreshold() {
        return Math.max(0.001, Math.min(0.999, finiteNumber(this.floodThresholdInput?.value, 0.2)));
    }

    private getFloodConnectivityPixels() {
        return 4 + this.getFloodThreshold() * 36;
    }

    private isFloodEyedropperCurrentSelectionOnly() {
        return (this.floodEyedropperScopeInput?.value || 'all') === 'selected';
    }

    private getFloodEyedropperScopeStatusText() {
        return this.isFloodEyedropperCurrentSelectionOnly() ? ' | current selection only' : '';
    }

    private getEyedropperThreshold() {
        return Math.max(0, Math.min(1, finiteNumber(this.eyedropperThresholdInput?.value, 0.2)));
    }

    private appendStrokePoint(points: CanvasPoint[], next: CanvasPoint, spacing = 4) {
        if (points.length === 0) {
            points.push(next);
            return;
        }

        const prev = points[points.length - 1];
        if (Math.hypot(next.x - prev.x, next.y - prev.y) >= spacing) {
            points.push(next);
        } else {
            points[points.length - 1] = next;
        }
    }

    private getSettings(): SectionSettings {
        const settings: SectionSettings = {
            topAxes: this.topAxesInput.value || DEFAULT_SECTION_SETTINGS.topAxes,
            topVerticalDirection: this.topVerticalDirectionInput?.value || DEFAULT_SECTION_SETTINGS.topVerticalDirection,
            sectionHeightDirection: this.sectionHeightDirectionInput?.value || DEFAULT_SECTION_SETTINGS.sectionHeightDirection,
            thickness: Math.max(0.000001, finiteNumber(this.thicknessInput.value, DEFAULT_SECTION_SETTINGS.thickness)),
            sideMode: this.sideModeInput?.value || DEFAULT_SECTION_SETTINGS.sideMode,
            scope: this.scopeInput.value || DEFAULT_SECTION_SETTINGS.scope,
            maxDisplayPoints: Math.max(100, Math.floor(finiteNumber(this.maxDisplayInput.value, DEFAULT_SECTION_SETTINGS.maxDisplayPoints))),
            interactiveMaxDisplayPoints: Math.max(100, Math.floor(finiteNumber(this.interactiveMaxDisplayInput?.value, DEFAULT_SECTION_SETTINGS.interactiveMaxDisplayPoints))),
            renderMode: this.renderModeInput?.value || DEFAULT_SECTION_SETTINGS.renderMode,
            pointSize: Math.max(0.5, Math.min(4, finiteNumber(this.pointSizeInput?.value, DEFAULT_SECTION_SETTINGS.pointSize))),
            pixelCellSize: Math.max(1, Math.min(8, Math.floor(finiteNumber(this.pixelCellSizeInput?.value, DEFAULT_SECTION_SETTINGS.pixelCellSize))))
        };

        saveJson('supersplat.sectionLine.settings', settings);
        return settings;
    }

    private isTopVerticalFlipped() {
        return (this.topVerticalDirectionInput?.value || DEFAULT_SECTION_SETTINGS.topVerticalDirection) === 'flipped';
    }

    private isSectionHeightFlipped() {
        return (this.sectionHeightDirectionInput?.value || DEFAULT_SECTION_SETTINGS.sectionHeightDirection) === 'flipped';
    }

    private async showError(header: string, message: string) {
        try {
            await this.events.invoke('showPopup', {
                type: 'error',
                header,
                message
            });
        } catch {
            window.alert(`${header}\n\n${message}`);
        }
    }

    private drawEmptyTopView(text = 'Refresh TopView') {
        const ctx = this.topCanvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, this.topCanvas.width, this.topCanvas.height);
        ctx.fillStyle = '#1f2329';
        ctx.fillRect(0, 0, this.topCanvas.width, this.topCanvas.height);
        ctx.fillStyle = '#b8c1cc';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(text, this.topCanvas.width / 2, this.topCanvas.height / 2);
    }

    private async refreshTopView() {
        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            this.drawEmptyTopView('Select a splat first');
            await this.showError('Section Line', 'Please select a splat first.');
            return;
        }

        const settings = this.getSettings();
        const { n, x, y, z, state, fdc0, fdc1, fdc2 } = prepareArrays(splat);
        let candidates = collectCandidates(n, state, settings.scope);
        this.clearTopPolygonDraft();

        if (candidates.length === 0 && settings.scope === 'selected') {
            // Avoid a blank TopView when the previous persisted scope was "Current selection"
            // but there is no active Gaussian selection.
            settings.scope = 'all';
            this.scopeInput.value = 'all';
            saveJson('supersplat.sectionLine.settings', settings);
            candidates = collectCandidates(n, state, settings.scope);
            this.setTopStatus('No current selection. Switched Scope to Whole splat.');
        }

        if (candidates.length === 0) {
            this.fullBounds = null;
            this.bounds = null;
            this.topDrawData = null;
            this.drawEmptyTopView('No candidates');
            await this.showError('TopView', 'No candidate points. Choose Whole splat or select a rough region.');
            return;
        }

        let minA = Infinity, minB = Infinity;
        let maxA = -Infinity, maxB = -Infinity;

        for (let i = 0; i < candidates.length; i++) {
            const c = getCoords(settings.topAxes, x, y, z, candidates[i]);
            if (c.a < minA) minA = c.a;
            if (c.a > maxA) maxA = c.a;
            if (c.b < minB) minB = c.b;
            if (c.b > maxB) maxB = c.b;
        }

        if (!(maxA > minA) || !(maxB > minB)) {
            this.drawEmptyTopView('Invalid bounds');
            return;
        }

        const padA = (maxA - minA) * 0.05;
        const padB = (maxB - minB) * 0.05;
        this.fullBounds = {
            minA: minA - padA,
            maxA: maxA + padA,
            minB: minB - padB,
            maxB: maxB + padB
        };
        this.topFitOnNextResize = true;
        const { a, b } = buildTopAxisArrays(candidates, x, y, z, settings.topAxes);
        const { colorR, colorG, colorB } = buildTopColorArrays(candidates, fdc0, fdc1, fdc2);
        this.topDrawData = { candidates, a, b, x, y, z, fdc0, fdc1, fdc2, colorR, colorG, colorB, settings };
        this.topDataSplat = splat;
        this.cacheTopStateSignature(splat);
        this.topViewDom.hidden = false;
        this.updateComposeLayout();
        this.bounds = this.fitTopBoundsToCanvas(this.fullBounds, this.topCanvas.width, this.topCanvas.height);

        this.syncSelectionHighlightsFromGlobalState();
        this.setTopStatus(`TopView ready: ${candidates.length.toLocaleString()} candidates. Click two points. Wheel zooms. Shift/right drag pans.`);
    }

    private getTopScale() {
        if (!this.bounds) return 1;

        const w = this.topCanvas.width;
        const h = this.topCanvas.height;
        const margin = 10;
        const sx = (w - margin * 2) / Math.max(1e-9, this.bounds.maxA - this.bounds.minA);
        const sy = (h - margin * 2) / Math.max(1e-9, this.bounds.maxB - this.bounds.minB);
        return Math.min(sx, sy);
    }

    private getTopScaleForSize(bounds: TopBounds, width: number, height: number) {
        const margin = 10;
        const sx = (width - margin * 2) / Math.max(1e-9, bounds.maxA - bounds.minA);
        const sy = (height - margin * 2) / Math.max(1e-9, bounds.maxB - bounds.minB);
        return Math.min(sx, sy);
    }

    private fitTopBoundsToCanvas(bounds: TopBounds, width: number, height: number): TopBounds {
        const margin = 10;
        const availW = Math.max(1, width - margin * 2);
        const availH = Math.max(1, height - margin * 2);
        const canvasAspect = availW / Math.max(1e-9, availH);
        const centerA = (bounds.minA + bounds.maxA) * 0.5;
        const centerB = (bounds.minB + bounds.maxB) * 0.5;
        const spanA = Math.max(1e-9, bounds.maxA - bounds.minA);
        const spanB = Math.max(1e-9, bounds.maxB - bounds.minB);
        let nextSpanA = spanA;
        let nextSpanB = spanB;

        if (spanA / spanB > canvasAspect) {
            nextSpanB = spanA / Math.max(1e-9, canvasAspect);
        } else {
            nextSpanA = spanB * canvasAspect;
        }

        return {
            minA: centerA - nextSpanA * 0.5,
            maxA: centerA + nextSpanA * 0.5,
            minB: centerB - nextSpanB * 0.5,
            maxB: centerB + nextSpanB * 0.5
        };
    }

    private getTopViewport(): ViewportTransform | null {
        if (!this.bounds) return null;

        const w = this.topCanvas.width;
        const h = this.topCanvas.height;
        const margin = 10;
        const spanA = Math.max(1e-9, this.bounds.maxA - this.bounds.minA);
        const spanB = Math.max(1e-9, this.bounds.maxB - this.bounds.minB);
        const availW = Math.max(1, w - margin * 2);
        const availH = Math.max(1, h - margin * 2);
        const scale = Math.min(availW / spanA, availH / spanB);
        const drawWidth = spanA * scale;
        const drawHeight = spanB * scale;
        const offsetX = margin + (availW - drawWidth) * 0.5;
        const offsetY = margin + (availH - drawHeight) * 0.5;

        return {
            scale,
            offsetX,
            offsetY,
            drawWidth,
            drawHeight
        };
    }

    private worldToCanvas(a: number, b: number) {
        if (!this.bounds) return { x: 0, y: 0 };
        const viewport = this.getTopViewport();
        if (!viewport) return { x: 0, y: 0 };

        const cx = viewport.offsetX + (a - this.bounds.minA) * viewport.scale;
        const cy = this.isTopVerticalFlipped()
            ? viewport.offsetY + (b - this.bounds.minB) * viewport.scale
            : viewport.offsetY + (this.bounds.maxB - b) * viewport.scale;

        return { x: cx, y: cy };
    }

    private canvasToWorld(x: number, y: number) {
        if (!this.bounds) return null;
        const viewport = this.getTopViewport();
        if (!viewport) return null;

        const a = this.bounds.minA + (x - viewport.offsetX) / viewport.scale;
        const b = this.isTopVerticalFlipped()
            ? this.bounds.minB + (y - viewport.offsetY) / viewport.scale
            : this.bounds.maxB - (y - viewport.offsetY) / viewport.scale;

        return { a, b };
    }

    private fitTopView() {
        if (!this.fullBounds || !this.topDrawData) {
            void this.refreshTopView();
            return;
        }

        this.topFitOnNextResize = true;
        this.topViewDom.hidden = false;
        this.updateComposeLayout();
        this.bounds = this.fitTopBoundsToCanvas(this.fullBounds, this.topCanvas.width, this.topCanvas.height);
        this.drawTopView();
        this.setTopStatus('TopView fit to full extent.');
    }

    private async zoomTopToSectionLine() {
        if (!this.topDrawData || !this.fullBounds) {
            await this.refreshTopView();
            if (!this.topDrawData || !this.fullBounds) {
                return;
            }
        }

        if (!this.sectionLine) {
            this.setTopStatus('Draw the section line first, then use Zoom to Line.');
            return;
        }

        const measure = this.getLineMeasure(this.sectionLine.a1, this.sectionLine.b1);
        if (!measure) {
            this.setTopStatus('Section line is too short. Draw the line again.');
            return;
        }

        const settings = this.getSettings();
        const offsets = settings.sideMode === 'left'
            ? [0, settings.thickness]
            : settings.sideMode === 'right'
                ? [0, -settings.thickness]
                : [-settings.thickness * 0.5, settings.thickness * 0.5];

        const na = -measure.ub;
        const nb = measure.ua;
        const points = offsets.flatMap((offset) => ([
            { a: this.sectionLine!.a0 + na * offset, b: this.sectionLine!.b0 + nb * offset },
            { a: this.sectionLine!.a1 + na * offset, b: this.sectionLine!.b1 + nb * offset }
        ]));

        let minA = Infinity;
        let maxA = -Infinity;
        let minB = Infinity;
        let maxB = -Infinity;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.a < minA) minA = p.a;
            if (p.a > maxA) maxA = p.a;
            if (p.b < minB) minB = p.b;
            if (p.b > maxB) maxB = p.b;
        }

        const safeThickness = Math.max(1e-6, settings.thickness);
        const minSpan = Math.max(measure.len * 0.02, safeThickness * 1.5, 1e-6);

        if (maxA - minA < minSpan) {
            const centerA = (minA + maxA) * 0.5;
            minA = centerA - minSpan * 0.5;
            maxA = centerA + minSpan * 0.5;
        }

        if (maxB - minB < minSpan) {
            const centerB = (minB + maxB) * 0.5;
            minB = centerB - minSpan * 0.5;
            maxB = centerB + minSpan * 0.5;
        }

        const spanA = Math.max(minSpan, maxA - minA);
        const spanB = Math.max(minSpan, maxB - minB);
        const padA = Math.max(spanA * 0.08, safeThickness * 0.35, 1e-6);
        const padB = Math.max(spanB * 0.08, safeThickness * 0.35, 1e-6);

        this.topViewDom.hidden = false;
        this.updateComposeLayout();
        this.bounds = this.fitTopBoundsToCanvas({
            minA: minA - padA,
            maxA: maxA + padA,
            minB: minB - padB,
            maxB: maxB + padB
        }, this.topCanvas.width, this.topCanvas.height);
        this.drawTopView();
        this.setTopStatus('TopView zoomed to current section line.');
    }

    private handleTopWheel(event: WheelEvent) {
        if (!this.bounds) return;
        event.preventDefault();

        const rect = this.topCanvas.getBoundingClientRect();
        const p = this.canvasToWorld(event.clientX - rect.left, event.clientY - rect.top);
        if (!p) return;

        const factor = event.deltaY < 0 ? 0.8 : 1.25;
        const next = {
            minA: p.a - (p.a - this.bounds.minA) * factor,
            maxA: p.a + (this.bounds.maxA - p.a) * factor,
            minB: p.b - (p.b - this.bounds.minB) * factor,
            maxB: p.b + (this.bounds.maxB - p.b) * factor
        };

        if (!(next.maxA > next.minA) || !(next.maxB > next.minB)) {
            return;
        }

        // Clamp zoom so a single wheel/pad gesture cannot zoom into a totally empty microscopic area.
        if (this.fullBounds) {
            const fullA = Math.max(1e-9, this.fullBounds.maxA - this.fullBounds.minA);
            const fullB = Math.max(1e-9, this.fullBounds.maxB - this.fullBounds.minB);
            const spanA = next.maxA - next.minA;
            const spanB = next.maxB - next.minB;

            if (spanA < fullA / 100000 || spanB < fullB / 100000) {
                return;
            }
        }

        this.bounds = next;
        this.markTopInteractive();
        this.scheduleTopViewRender();
    }

    private handleTopMouseDown(event: MouseEvent) {
        if (!this.bounds) return;

        if (this.topSelectionMode && event.button === 0 && !event.shiftKey) {
            const rect = this.topCanvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            if (this.topSelectionTool === 'rect') {
                event.preventDefault();
                this.topDrag = {
                    mode: 'select',
                    startX: x,
                    startY: y,
                    currentX: x,
                    currentY: y
                };
                this.markTopInteractive();
                this.scheduleTopViewRender();
                return;
            }

            if (this.topSelectionTool === 'lasso') {
                event.preventDefault();
                this.topLassoPoints = [{ x, y }];
                this.topDrag = {
                    mode: 'lasso',
                    startX: x,
                    startY: y,
                    currentX: x,
                    currentY: y
                };
                this.markTopInteractive();
                this.scheduleTopViewRender();
                return;
            }

            if (this.topSelectionTool === 'brush') {
                event.preventDefault();
                this.topBrushPoints = [{ x, y }];
                this.topBrushCursor = { x, y };
                this.topDrag = {
                    mode: 'brush',
                    startX: x,
                    startY: y,
                    currentX: x,
                    currentY: y
                };
                this.markTopInteractive();
                this.scheduleTopViewRender();
                return;
            }
        }

        if (event.button === 2 || event.button === 1 || event.shiftKey) {
            event.preventDefault();
            this.topDrag = {
                mode: 'pan',
                startX: event.clientX,
                startY: event.clientY,
                currentX: event.clientX,
                currentY: event.clientY,
                startTopBounds: cloneTopBounds(this.bounds)
            };
            this.markTopInteractive();
        }
    }

    private panTopView(event: MouseEvent) {
        if (!this.topDrag?.startTopBounds || !this.bounds) return;

        const dx = event.clientX - this.topDrag.startX;
        const dy = event.clientY - this.topDrag.startY;
        const scale = this.getTopScale();
        const da = -dx / Math.max(1e-9, scale);
        const db = (this.isTopVerticalFlipped() ? -dy : dy) / Math.max(1e-9, scale);
        const b = this.topDrag.startTopBounds;

        this.bounds = {
            minA: b.minA + da,
            maxA: b.maxA + da,
            minB: b.minB + db,
            maxB: b.maxB + db
        };

        this.markTopInteractive();
        this.scheduleTopViewRender();
    }

    private scheduleTopViewRender() {
        if (this.topRenderPending) return;

        this.topRenderPending = true;
        requestAnimationFrame(() => {
            this.topRenderPending = false;
            this.drawTopView();
        });
    }

    private makeSortedIndexArray(indices: number[]) {
        return new Uint32Array(indices);
    }

    private applyTopSelectionResult(
        mask: Uint32Array | null,
        count: number,
        statusText: string,
        eventMask: Uint8Array | Uint32Array | null = mask,
        op: 'add' | 'set' = this.topSelectionAdditive ? 'add' : 'set'
    ) {
        const splat = this.events.invoke('selection') as SplatLike | null;
        this.topSelectionMask = count > 0 ? mask : null;
        this.lastMask = count > 0 ? mask : null;
        this.lastPreviewCount = count;
        this.lastPreviewKind = count > 0 ? 'topViewSelection' : '';
        this.applyLocalSelectionHighlights(
            count > 0 ? this.getPredictedSelectionMask(splat, op, eventMask) : null,
            splat
        );
        if (eventMask) {
            this.events.fire('select.mask', op, eventMask);
        }
        this.setTopStatus(statusText);
    }

    private getTopColorAtPosition(position: number) {
        const data = this.topDrawData;
        if (!data) {
            return { r: 0.8, g: 0.8, b: 0.8 };
        }

        if (data.colorR && data.colorG && data.colorB) {
            return {
                r: data.colorR[position] / 255,
                g: data.colorG[position] / 255,
                b: data.colorB[position] / 255
            };
        }

        return { r: 0.8, g: 0.8, b: 0.8 };
    }

    private getNearestTopCandidatePosition(x: number, y: number, maxDistance = 12, filter?: (position: number) => boolean) {
        if (!this.topDrawData) return -1;

        const { candidates, a, b } = this.topDrawData;
        const maxDist2 = maxDistance * maxDistance;
        let best = -1;
        let bestDist2 = maxDist2;

        for (let i = 0; i < candidates.length; i++) {
            if (filter && !filter(i)) continue;
            const c = this.worldToCanvas(a[i], b[i]);
            const dx = c.x - x;
            const dy = c.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= bestDist2) {
                bestDist2 = d2;
                best = i;
            }
        }

        return best;
    }

    private collectTopIndicesFromScreenPolygon(points: CanvasPoint[]) {
        if (!this.topDrawData || points.length < 3) return [];

        const { candidates, a, b } = this.topDrawData;
        const minX = Math.min(...points.map((p) => p.x));
        const maxX = Math.max(...points.map((p) => p.x));
        const minY = Math.min(...points.map((p) => p.y));
        const maxY = Math.max(...points.map((p) => p.y));
        const selected: number[] = [];

        for (let i = 0; i < candidates.length; i++) {
            const c = this.worldToCanvas(a[i], b[i]);
            if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
            if (pointInScreenPolygon(c.x, c.y, points)) {
                selected.push(candidates[i]);
            }
        }

        return selected;
    }

    private collectTopIndicesFromBrush(points: CanvasPoint[]) {
        if (!this.topDrawData || points.length === 0) return [];

        const { candidates, a, b } = this.topDrawData;
        const radius = this.getBrushRadiusPixels();
        const radius2 = radius * radius;
        const minX = Math.min(...points.map((p) => p.x)) - radius;
        const maxX = Math.max(...points.map((p) => p.x)) + radius;
        const minY = Math.min(...points.map((p) => p.y)) - radius;
        const maxY = Math.max(...points.map((p) => p.y)) + radius;
        const selected: number[] = [];

        for (let i = 0; i < candidates.length; i++) {
            const c = this.worldToCanvas(a[i], b[i]);
            if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;

            let hit = false;
            for (let j = 0; j < points.length; j++) {
                const dist2 = j === 0
                    ? ((c.x - points[j].x) ** 2 + (c.y - points[j].y) ** 2)
                    : distancePointToSegmentSquared(c, points[j - 1], points[j]);
                if (dist2 <= radius2) {
                    hit = true;
                    break;
                }
            }

            if (hit) {
                selected.push(candidates[i]);
            }
        }

        return selected;
    }

    private async selectTopLasso(points: CanvasPoint[]) {
        const selectedIndices = this.collectTopIndicesFromScreenPolygon(points);
        const count = selectedIndices.length;
        this.applyTopSelectionResult(
            count > 0 ? this.makeSortedIndexArray(selectedIndices) : null,
            count,
            count > 0
                ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} ${count.toLocaleString()} point${count === 1 ? '' : 's'} with TopView lasso.`
                : 'No TopView points inside the lasso.'
        );
    }

    private async selectTopBrush(points: CanvasPoint[]) {
        const selectedIndices = this.collectTopIndicesFromBrush(points);
        const count = selectedIndices.length;
        this.applyTopSelectionResult(
            count > 0 ? this.makeSortedIndexArray(selectedIndices) : null,
            count,
            count > 0
                ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} ${count.toLocaleString()} point${count === 1 ? '' : 's'} with TopView brush.`
                : 'No TopView points touched by the brush.'
        );
    }

    private async selectTopFlood(x: number, y: number) {
        if (!this.topDrawData) return;

        const width = this.topCanvas.width;
        const height = this.topCanvas.height;
        if (width <= 0 || height <= 0) return;

        const splat = this.events.invoke('selection') as SplatLike | null;
        const state = splat ? getUint8Array(splat, 'state') : null;
        const viewport = this.getTopViewport();
        if (!viewport) return;

        const { candidates, a, b, settings } = this.topDrawData;
        const selectedOnly = this.isFloodEyedropperCurrentSelectionOnly();
        const pointWidth = Math.max(1, settings.pointSize || 1);
        const pointHeight = pointWidth;
        const pointAlpha = 32;
        const viewportMinX = viewport.offsetX;
        const viewportMaxX = viewport.offsetX + viewport.drawWidth;
        const viewportMinY = viewport.offsetY;
        const viewportMaxY = viewport.offsetY + viewport.drawHeight;
        const allowPoint = (position: number) => {
            if (selectedOnly && !isSelectedGaussian(state, candidates[position])) {
                return false;
            }

            const c = this.worldToCanvas(a[position], b[position]);
            return c.x + pointWidth >= viewportMinX &&
                c.x <= viewportMaxX &&
                c.y + pointHeight >= viewportMinY &&
                c.y <= viewportMaxY;
        };
        const alpha = new Uint8Array(width * height);
        const pixelX = new Int32Array(candidates.length);
        const pixelY = new Int32Array(candidates.length);
        const rectX = new Float32Array(candidates.length);
        const rectY = new Float32Array(candidates.length);
        pixelX.fill(-1);
        pixelY.fill(-1);
        rectX.fill(-1);
        rectY.fill(-1);

        for (let i = 0; i < candidates.length; i++) {
            if (!allowPoint(i)) continue;
            const c = this.worldToCanvas(a[i], b[i]);
            const px = Math.floor(c.x + pointWidth * 0.5);
            const py = Math.floor(c.y + pointHeight * 0.5);
            pixelX[i] = px;
            pixelY[i] = py;
            rectX[i] = c.x;
            rectY[i] = c.y;
            rasterizeAlphaRect(alpha, width, height, c.x, c.y, pointWidth, pointHeight, pointAlpha);
        }

        let startX = Math.max(0, Math.min(width - 1, Math.floor(x)));
        let startY = Math.max(0, Math.min(height - 1, Math.floor(y)));
        if (alpha[startY * width + startX] <= 0) {
            const seed = this.getNearestTopCandidatePosition(x, y, 18, allowPoint);
            if (seed < 0) {
                this.applyTopSelectionResult(
                    null,
                    0,
                    selectedOnly
                        ? 'No TopView seed point found in the current selection for Flood Select.'
                        : 'No TopView seed point found for Flood Select.',
                    null
                );
                return;
            }
            startX = Math.max(0, Math.min(width - 1, pixelX[seed]));
            startY = Math.max(0, Math.min(height - 1, pixelY[seed]));
        }

        const floodMask = floodFillAlphaMask(
            alpha,
            width,
            height,
            startX,
            startY,
            this.getFloodThreshold()
        );

        if (!floodMask) {
            this.applyTopSelectionResult(null, 0, 'TopView flood did not find a connected region.', null);
            return;
        }

        const selected: number[] = [];
        for (let i = 0; i < candidates.length; i++) {
            if (allowPoint(i) && rectX[i] >= 0 && rectTouchesFloodMask(floodMask, width, height, rectX[i], rectY[i], pointWidth, pointHeight)) {
                selected.push(candidates[i]);
            }
        }

        const count = selected.length;
        this.applyTopSelectionResult(
            count > 0 ? this.makeSortedIndexArray(selected) : null,
            count,
            count > 0
                ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} ${count.toLocaleString()} point${count === 1 ? '' : 's'} with TopView flood.`
                : 'TopView flood did not find a connected cluster.'
        );
    }

    private async selectTopEyedropper(x: number, y: number) {
        if (!this.topDrawData) return;

        const splat = this.events.invoke('selection') as SplatLike | null;
        const state = splat ? getUint8Array(splat, 'state') : null;
        const { candidates } = this.topDrawData;
        const selectedOnly = this.isFloodEyedropperCurrentSelectionOnly();
        const allowPoint = (position: number) => !selectedOnly || isSelectedGaussian(state, candidates[position]);
        const seed = this.getNearestTopCandidatePosition(x, y, 12, allowPoint);
        if (seed < 0) {
            this.applyTopSelectionResult(
                null,
                0,
                selectedOnly
                    ? 'No TopView seed point found in the current selection for Eyedropper.'
                    : 'No TopView seed point found for Eyedropper.',
                null
            );
            return;
        }

        const threshold = this.getEyedropperThreshold();
        const threshold2 = threshold * threshold;
        const seedColor = this.getTopColorAtPosition(seed);
        const selected: number[] = [];

        for (let i = 0; i < candidates.length; i++) {
            if (!allowPoint(i)) continue;
            const c = this.getTopColorAtPosition(i);
            const dr = c.r - seedColor.r;
            const dg = c.g - seedColor.g;
            const db = c.b - seedColor.b;
            const dist2 = (dr * dr + dg * dg + db * db) / 3;
            if (dist2 <= threshold2) {
                selected.push(candidates[i]);
            }
        }

        const count = selected.length;
        this.applyTopSelectionResult(
            count > 0 ? this.makeSortedIndexArray(selected) : null,
            count,
            count > 0
                ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} ${count.toLocaleString()} point${count === 1 ? '' : 's'} with TopView eyedropper.`
                : 'TopView eyedropper did not find a color match.'
        );
    }

    private async selectTopRectangle(minX: number, minY: number, maxX: number, maxY: number) {
        if (!this.topDrawData || !this.bounds) return;

        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            await this.showError('Top Select', 'Please select a splat first.');
            return;
        }

        const { candidates, a, b } = this.topDrawData;
        const selectedIndices: number[] = [];
        const chunkSize = 200000;
        const pickThreshold = 5;
        const tinyDrag = Math.abs(maxX - minX) <= pickThreshold && Math.abs(maxY - minY) <= pickThreshold;

        if (candidates.length > chunkSize) {
            this.events.fire('progressStart', { title: 'TopView Select' });
        }

        try {
            if (tinyDrag) {
                const center = this.canvasToWorld((minX + maxX) * 0.5, (minY + maxY) * 0.5);
                const viewport = this.getTopViewport();
                if (!center || !viewport) return;

                const radiusPixels = 10;
                const radiusWorld = radiusPixels / Math.max(1e-9, viewport.scale);
                const radiusWorld2 = radiusWorld * radiusWorld;
                let bestIndex = -1;
                let bestDist2 = Number.POSITIVE_INFINITY;

                for (let i = 0; i < candidates.length; i++) {
                    const da = a[i] - center.a;
                    const db = b[i] - center.b;
                    const d2 = da * da + db * db;
                    if (d2 <= radiusWorld2 && d2 < bestDist2) {
                        bestDist2 = d2;
                        bestIndex = candidates[i];
                    }

                    if (candidates.length > chunkSize && i % chunkSize === 0) {
                        updateProgress(this.events, `Picking ${i.toLocaleString()} / ${candidates.length.toLocaleString()}`, i / Math.max(1, candidates.length));
                        await yieldToBrowser();
                    }
                }

                if (bestIndex >= 0) {
                    selectedIndices.push(bestIndex);
                }
            } else {
                const p0 = this.canvasToWorld(minX, minY);
                const p1 = this.canvasToWorld(maxX, maxY);
                if (!p0 || !p1) return;

                const minA = Math.min(p0.a, p1.a);
                const maxA = Math.max(p0.a, p1.a);
                const minB = Math.min(p0.b, p1.b);
                const maxB = Math.max(p0.b, p1.b);

                for (let i = 0; i < candidates.length; i++) {
                    if (a[i] >= minA && a[i] <= maxA && b[i] >= minB && b[i] <= maxB) {
                        selectedIndices.push(candidates[i]);
                    }

                    if (candidates.length > chunkSize && i % chunkSize === 0) {
                        updateProgress(this.events, `Selecting ${i.toLocaleString()} / ${candidates.length.toLocaleString()}`, i / Math.max(1, candidates.length));
                        await yieldToBrowser();
                    }
                }
            }

            const count = selectedIndices.length;
            this.applyTopSelectionResult(
                count > 0 ? this.makeSortedIndexArray(selectedIndices) : null,
                count,
                count > 0
                    ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} ${count.toLocaleString()} point${count === 1 ? '' : 's'} from TopView.`
                    : 'No TopView points selected.'
            );
        } finally {
            if (candidates.length > chunkSize) {
                this.events.fire('progressEnd');
            }
        }
    }

    private async selectTopPolygon(points: TopPolygonPoint[]) {
        if (!this.topDrawData || !this.bounds || points.length < 3) return;

        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            await this.showError('Top Poly Select', 'Please select a splat first.');
            return;
        }

        const { candidates, a, b } = this.topDrawData;
        const selectedIndices: number[] = [];
        const chunkSize = 200000;
        const minA = Math.min(...points.map((p) => p.a));
        const maxA = Math.max(...points.map((p) => p.a));
        const minB = Math.min(...points.map((p) => p.b));
        const maxB = Math.max(...points.map((p) => p.b));

        if (candidates.length > chunkSize) {
            this.events.fire('progressStart', { title: 'Top Polygon Select' });
        }

        try {
            for (let i = 0; i < candidates.length; i++) {
                if (a[i] >= minA && a[i] <= maxA && b[i] >= minB && b[i] <= maxB && pointInPolygon(a[i], b[i], points)) {
                    selectedIndices.push(candidates[i]);
                }

                if (candidates.length > chunkSize && i % chunkSize === 0) {
                    updateProgress(this.events, `Selecting ${i.toLocaleString()} / ${candidates.length.toLocaleString()}`, i / Math.max(1, candidates.length));
                    await yieldToBrowser();
                }
            }

            const count = selectedIndices.length;
            this.applyTopSelectionResult(
                count > 0 ? this.makeSortedIndexArray(selectedIndices) : null,
                count,
                count > 0
                    ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} ${count.toLocaleString()} point${count === 1 ? '' : 's'} with TopView polygon.`
                    : 'No TopView points inside polygon.'
            );
        } finally {
            if (candidates.length > chunkSize) {
                this.events.fire('progressEnd');
            }
        }
    }

    private async invertTopSelection() {
        if (!this.topDrawData) {
            this.setTopStatus('Refresh Top first, then invert selection.');
            return;
        }

        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            await this.showError('TopView Invert', 'Please select a splat first.');
            return;
        }

        const { n, state } = prepareArrays(splat);
        const { candidates } = this.topDrawData;
        const nextFullSelection: number[] = [];
        const candidateSelection: number[] = [];
        let candidateCursor = 0;

        for (let i = 0; i < n; i++) {
            const idx = candidateCursor < candidates.length ? candidates[candidateCursor] : -1;
            if (i === idx) {
                const nextSelected = !isSelectedGaussian(state, i);
                if (nextSelected) {
                    nextFullSelection.push(i);
                    candidateSelection.push(i);
                }
                candidateCursor++;
            } else if (isValidGaussian(state, i) && isSelectedGaussian(state, i)) {
                nextFullSelection.push(i);
            }
        }

        const count = candidateSelection.length;
        this.applyTopSelectionResult(
            count > 0 ? this.makeSortedIndexArray(candidateSelection) : null,
            count,
            count > 0
                ? `Inverted TopView selection. ${count.toLocaleString()} candidate point${count === 1 ? '' : 's'} selected.`
                : 'Inverted TopView selection. No candidate points remain selected.',
            this.makeSortedIndexArray(nextFullSelection),
            'set'
        );
    }

    private resetTopSelection() {
        this.clearTopToolDrafts();
        this.clearViewerToolDrafts();
        this.topSelectionMask = null;
        this.viewerSelectionMask = null;
        if (this.viewerData && this.sectionSliceMask && this.sectionSliceCount > 0) {
            this.lastMask = this.sectionSliceMask;
            this.lastPreviewCount = this.sectionSliceCount;
            this.lastPreviewKind = 'sectionLineSlice';
        } else {
            this.lastMask = null;
            this.lastPreviewCount = 0;
            this.lastPreviewKind = '';
        }
        this.events.fire('select.none');
        this.drawTopView();
        this.scheduleSectionViewerRender();
        this.setTopStatus('TopView selection cleared.');
    }

    private handleTopCanvasMouseMove(event: MouseEvent) {
        const rect = this.topCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (!this.topSelectionMode || !this.bounds) return;

        if (this.topSelectionTool === 'polygon' && this.topPolygonPoints.length > 0) {
            this.topPolygonHoverPoint = this.canvasToWorld(x, y);
            this.scheduleTopViewRender();
            return;
        }

        if (this.topSelectionTool === 'brush') {
            this.topBrushCursor = { x, y };
            this.scheduleTopViewRender();
        }
    }

    private handleTopCanvasMouseLeave() {
        if (!this.topSelectionMode) return;

        let needsRender = false;
        if (this.topSelectionTool === 'polygon' && this.topPolygonHoverPoint) {
            this.topPolygonHoverPoint = null;
            needsRender = true;
        }
        if (this.topSelectionTool === 'brush' && this.topBrushCursor) {
            this.topBrushCursor = null;
            needsRender = true;
        }
        if (needsRender) {
            this.scheduleTopViewRender();
        }
    }

    private async commitTopPolygonSelection() {
        if (this.topPolygonPoints.length < 3) return;
        const points = [...this.topPolygonPoints];
        this.clearTopPolygonDraft();
        await this.selectTopPolygon(points);
    }

    private handleWindowKeyDown(event: KeyboardEvent) {
        if (event.target !== document.body) return;

        if (this.viewerSelectionTool === 'polygon') {
            if (event.key === 'Escape' && this.viewerPolygonPoints.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                this.clearViewerToolDrafts(true);
                this.viewerStatsDom.textContent = 'Section polygon cleared.';
                return;
            }

            if (event.key === 'Enter' && this.viewerPolygonPoints.length >= 3 && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                void this.commitViewerPolygonSelection();
                return;
            }
        }

        if (!this.topSelectionMode || this.topSelectionTool !== 'polygon') return;

        if (event.key === 'Escape' && this.topPolygonPoints.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            this.clearTopToolDrafts(true);
            this.setTopStatus('TopView polygon cleared.');
            return;
        }

        if (event.key === 'Enter' && this.topPolygonPoints.length >= 3 && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            void this.commitTopPolygonSelection();
        }
    }

    private markViewerInteractive() {
        this.viewerInteractiveUntil = performance.now() + 180;
    }

    private markTopInteractive() {
        this.topInteractiveUntil = performance.now() + 180;

        if (this.topInteractiveResetHandle !== null) {
            window.clearTimeout(this.topInteractiveResetHandle);
        }

        this.topInteractiveResetHandle = window.setTimeout(() => {
            this.topInteractiveResetHandle = null;
            if (!this.topDrag) {
                this.scheduleTopViewRender();
            }
        }, 200);
    }

    private scheduleSectionViewerRender() {
        if (this.viewerRenderPending) return;

        this.viewerRenderPending = true;
        requestAnimationFrame(() => {
            this.viewerRenderPending = false;
            this.renderSectionViewer();
        });
    }

    private getLineMeasure(a: number, b: number) {
        if (!this.sectionLine) return null;

        const da = this.sectionLine.a1 - this.sectionLine.a0;
        const db = this.sectionLine.b1 - this.sectionLine.b0;
        const len = Math.sqrt(da * da + db * db);

        if (len < 1e-9) return null;

        const ua = da / len;
        const ub = db / len;
        const va = a - this.sectionLine.a0;
        const vb = b - this.sectionLine.b0;

        return {
            len,
            ua,
            ub,
            along: va * ua + vb * ub,
            perp: va * -ub + vb * ua
        };
    }

    private sectionPointAllowed(perp: number, thickness: number, sideMode: string) {
        const safeThickness = Math.max(0.000001, thickness);

        if (sideMode === 'left') {
            return perp >= 0 && perp <= safeThickness;
        }

        if (sideMode === 'right') {
            return perp <= 0 && perp >= -safeThickness;
        }

        return Math.abs(perp) <= safeThickness * 0.5;
    }

    private drawSectionCorridor(ctx: CanvasRenderingContext2D, settings: SectionSettings) {
        if (!this.sectionLine) return;

        const da = this.sectionLine.a1 - this.sectionLine.a0;
        const db = this.sectionLine.b1 - this.sectionLine.b0;
        const len = Math.sqrt(da * da + db * db);

        if (len < 1e-9) return;

        const ua = da / len;
        const ub = db / len;
        const na = -ub;
        const nb = ua;
        const offsets = settings.sideMode === 'left'
            ? [0, settings.thickness]
            : settings.sideMode === 'right'
                ? [0, -settings.thickness]
                : [-settings.thickness * 0.5, settings.thickness * 0.5];

        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#f0c674';
        ctx.lineWidth = 1;

        for (let i = 0; i < offsets.length; i++) {
            const o = offsets[i];
            const p0 = this.worldToCanvas(this.sectionLine.a0 + na * o, this.sectionLine.b0 + nb * o);
            const p1 = this.worldToCanvas(this.sectionLine.a1 + na * o, this.sectionLine.b1 + nb * o);

            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
        }

        ctx.restore();
    }

    private drawTopView() {
        const ctx = this.topCanvas.getContext('2d');
        if (!ctx) return;

        let candidates: number[] | undefined;
        let a: Float32Array | undefined;
        let b: Float32Array | undefined;
        let x: Float32Array | undefined;
        let y: Float32Array | undefined;
        let z: Float32Array | undefined;
        let settings: SectionSettings | undefined;
        let fdc0: Float32Array | null | undefined;
        let fdc1: Float32Array | null | undefined;
        let fdc2: Float32Array | null | undefined;
        let colorR: Uint8Array | null | undefined;
        let colorG: Uint8Array | null | undefined;
        let colorB: Uint8Array | null | undefined;

        if (this.topDrawData) {
            candidates = this.topDrawData.candidates;
            a = this.topDrawData.a;
            b = this.topDrawData.b;
            x = this.topDrawData.x;
            y = this.topDrawData.y;
            z = this.topDrawData.z;
            fdc0 = this.topDrawData.fdc0;
            fdc1 = this.topDrawData.fdc1;
            fdc2 = this.topDrawData.fdc2;
            colorR = this.topDrawData.colorR;
            colorG = this.topDrawData.colorG;
            colorB = this.topDrawData.colorB;
            settings = this.getSettings();
            this.topDrawData.settings = settings;
        }

        ctx.clearRect(0, 0, this.topCanvas.width, this.topCanvas.height);
        ctx.fillStyle = '#1f2329';
        ctx.fillRect(0, 0, this.topCanvas.width, this.topCanvas.height);

        const viewport = this.getTopViewport();
        if (viewport) {
            ctx.save();
            ctx.strokeStyle = '#f0c674';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(
                Math.round(viewport.offsetX) + 0.5,
                Math.round(viewport.offsetY) + 0.5,
                Math.max(1, Math.round(viewport.drawWidth) - 1),
                Math.max(1, Math.round(viewport.drawHeight) - 1)
            );
            ctx.setLineDash([]);
            ctx.fillStyle = '#f0c674';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(
                `viewport ${Math.round(viewport.drawWidth)} x ${Math.round(viewport.drawHeight)}`,
                Math.round(viewport.offsetX) + 6,
                Math.round(viewport.offsetY) + 14
            );
            ctx.restore();
        }

        if (!this.bounds || !candidates || !a || !b || !x || !y || !z || !settings) {
            ctx.fillStyle = '#b8c1cc';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Refresh TopView', this.topCanvas.width / 2, this.topCanvas.height / 2);
        } else {
            const interactive = !!this.topDrag || performance.now() < this.topInteractiveUntil;
            const drawLimit = interactive
                ? Math.min(candidates.length, settings.interactiveMaxDisplayPoints || 12000)
                : Math.min(candidates.length, settings.maxDisplayPoints || 50000);
            const pointSize = Math.max(0.5, Math.min(4, settings.pointSize || 1));
            const basePixelCellSize = Math.max(1, Math.min(8, Math.floor(settings.pixelCellSize || 2)));
            const pixelCellSize = interactive
                ? Math.max(basePixelCellSize, Math.min(16, basePixelCellSize * 2))
                : basePixelCellSize;
            const colorRender = settings.renderMode === 'color' && !!colorR && !!colorG && !!colorB;
            const gridW = Math.max(1, Math.ceil(this.topCanvas.width / pixelCellSize));
            const gridH = Math.max(1, Math.ceil(this.topCanvas.height / pixelCellSize));
            const occupied = new Uint8Array(gridW * gridH);
            const scanStride = candidates.length > drawLimit * (interactive ? 6 : 10)
                ? Math.max(1, Math.floor(candidates.length / (drawLimit * (interactive ? 6 : 10))))
                : 1;
            let drawn = 0;

            // Adaptive screen-grid render:
            // keep more visible structure than fixed stride sampling while still
            // capping overdraw in dense views.
            if (!colorRender) {
                ctx.fillStyle = interactive ? '#8f99a6' : '#b7c0cc';
            }

            for (let i = 0; i < candidates.length && drawn < drawLimit; i += scanStride) {
                const idx = candidates[i];
                const aa = a[i];
                const bb = b[i];
                if (aa < this.bounds.minA || aa > this.bounds.maxA || bb < this.bounds.minB || bb > this.bounds.maxB) continue;
                const p = this.worldToCanvas(aa, bb);
                const gx = Math.max(0, Math.min(gridW - 1, Math.floor(p.x / pixelCellSize)));
                const gy = Math.max(0, Math.min(gridH - 1, Math.floor(p.y / pixelCellSize)));
                const key = gy * gridW + gx;

                if (occupied[key]) {
                    continue;
                }

                occupied[key] = 1;

                if (colorRender && colorR && colorG && colorB) {
                    const rr = colorR[i];
                    const gg = colorG[i];
                    const bb = colorB[i];
                    ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
                }
                ctx.fillRect(p.x, p.y, pointSize, pointSize);
                drawn++;
            }

            if (drawn === 0 && candidates.length > 0) {
                ctx.fillStyle = '#f0c674';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No points in current TopView. Click Fit Top.', this.topCanvas.width / 2, this.topCanvas.height / 2);
            }

            if (this.topSelectionMask) {
                ctx.fillStyle = '#ffff66';
                const selectedCellSize = Math.max(1, Math.min(4, interactive ? pixelCellSize : (Math.floor(basePixelCellSize * 0.5) || 1)));
                const selectedGridW = Math.max(1, Math.ceil(this.topCanvas.width / selectedCellSize));
                const selectedGridH = Math.max(1, Math.ceil(this.topCanvas.height / selectedCellSize));
                const selectedOccupied = new Uint8Array(selectedGridW * selectedGridH);
                const selectedLimit = Math.min(
                    selectedGridW * selectedGridH,
                    interactive ? Math.max(20000, drawLimit * 2) : Math.max(120000, drawLimit * 4)
                );
                let selectedDrawn = 0;

                for (let i = 0; i < this.topSelectionMask.length && selectedDrawn < selectedLimit; i++) {
                    const idx = this.topSelectionMask[i];
                    const c = getCoords(settings.topAxes, x, y, z, idx);
                    if (c.a < this.bounds.minA || c.a > this.bounds.maxA || c.b < this.bounds.minB || c.b > this.bounds.maxB) continue;
                    const p = this.worldToCanvas(c.a, c.b);
                    const gx = Math.max(0, Math.min(selectedGridW - 1, Math.floor(p.x / selectedCellSize)));
                    const gy = Math.max(0, Math.min(selectedGridH - 1, Math.floor(p.y / selectedCellSize)));
                    const key = gy * selectedGridW + gx;
                    if (selectedOccupied[key]) continue;
                    selectedOccupied[key] = 1;
                    ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
                    selectedDrawn++;
                }
            }

            this.setTopStatus(
                `${drawn.toLocaleString()} / ${candidates.length.toLocaleString()} representative top pixels shown${this.topSelectionMask ? ` (${this.topSelectionMask.length.toLocaleString()} selected)` : ''}. Zoom in to reveal more.`
            );
        }

        if (this.topSelectionMode && this.topSelectionTool === 'polygon' && this.topPolygonPoints.length > 0) {
            const canvasPoints = this.topPolygonPoints.map((p) => this.worldToCanvas(p.a, p.b));
            const hoverCanvasPoint = this.topPolygonHoverPoint ? this.worldToCanvas(this.topPolygonHoverPoint.a, this.topPolygonHoverPoint.b) : null;

            ctx.save();
            ctx.strokeStyle = '#ffff66';
            ctx.fillStyle = 'rgba(255, 255, 102, 0.12)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
            for (let i = 1; i < canvasPoints.length; i++) {
                ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y);
            }
            if (hoverCanvasPoint) {
                ctx.lineTo(hoverCanvasPoint.x, hoverCanvasPoint.y);
            }
            if (canvasPoints.length >= 3) {
                ctx.closePath();
                ctx.fill();
            }
            ctx.stroke();

            for (let i = 0; i < canvasPoints.length; i++) {
                const p = canvasPoints[i];
                ctx.beginPath();
                ctx.arc(p.x, p.y, i === 0 ? 4 : 3, 0, Math.PI * 2);
                ctx.fillStyle = i === 0 ? '#f0c674' : '#ffff66';
                ctx.fill();
            }
            ctx.restore();
        }

        if (this.topSelectionMode && this.topSelectionTool === 'lasso' && this.topLassoPoints.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#66d9ff';
            ctx.fillStyle = 'rgba(102, 217, 255, 0.10)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(this.topLassoPoints[0].x, this.topLassoPoints[0].y);
            for (let i = 1; i < this.topLassoPoints.length; i++) {
                ctx.lineTo(this.topLassoPoints[i].x, this.topLassoPoints[i].y);
            }
            if (this.topDrag?.mode === 'lasso' && this.topLassoPoints.length >= 3) {
                ctx.closePath();
                ctx.fill();
            }
            ctx.stroke();
            ctx.restore();
        }

        if (this.topSelectionMode && this.topSelectionTool === 'brush') {
            ctx.save();
            ctx.strokeStyle = '#66d9ff';
            ctx.fillStyle = 'rgba(102, 217, 255, 0.10)';
            ctx.lineWidth = 1.25;
            if (this.topBrushPoints.length > 1) {
                ctx.beginPath();
                ctx.moveTo(this.topBrushPoints[0].x, this.topBrushPoints[0].y);
                for (let i = 1; i < this.topBrushPoints.length; i++) {
                    ctx.lineTo(this.topBrushPoints[i].x, this.topBrushPoints[i].y);
                }
                ctx.stroke();
            }
            if (this.topBrushCursor) {
                ctx.beginPath();
                ctx.arc(this.topBrushCursor.x, this.topBrushCursor.y, this.getBrushRadiusPixels(), 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }

        if (this.sectionLine && settings) {
            this.drawSectionCorridor(ctx, settings);
        }

        if (this.sectionLine) {
            const p0 = this.worldToCanvas(this.sectionLine.a0, this.sectionLine.b0);
            const p1 = this.worldToCanvas(this.sectionLine.a1, this.sectionLine.b1);

            ctx.strokeStyle = '#2d6cdf';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(p0.x, p0.y, 3, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(p1.x, p1.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        if (this.topDrag?.mode === 'select') {
            const x0 = this.topDrag.startX;
            const y0 = this.topDrag.startY;
            const x1 = this.topDrag.currentX;
            const y1 = this.topDrag.currentY;
            ctx.strokeStyle = '#ffff66';
            ctx.fillStyle = 'rgba(255, 255, 102, 0.12)';
            ctx.lineWidth = 1;
            ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
            ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        }

        ctx.fillStyle = '#8b96a3';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(
            this.topSelectionMode
                ? this.getTopModeStatusText()
                : 'Wheel: zoom | Shift/right drag: pan | Pick Width: set thickness',
            8,
            this.topCanvas.height - 8
        );
    }

    private handleTopCanvasClick(event: MouseEvent) {
        if (this.topDrag) return;

        if (!this.bounds || !this.topDrawData) {
            this.setTopStatus('Click Refresh Top first.');
            return;
        }

        if (event.shiftKey || event.button !== 0) {
            return;
        }

        if (this.topSelectionMode) {
            if (this.topSelectionTool === 'polygon') {
                const rect = this.topCanvas.getBoundingClientRect();
                const clickX = event.clientX - rect.left;
                const clickY = event.clientY - rect.top;
                const p = this.canvasToWorld(clickX, clickY);
                if (!p) return;

                if (this.topPolygonPoints.length > 0) {
                    const firstCanvas = this.worldToCanvas(this.topPolygonPoints[0].a, this.topPolygonPoints[0].b);
                    const closeToFirst = Math.hypot(clickX - firstCanvas.x, clickY - firstCanvas.y) <= 10;
                    const lastPoint = this.topPolygonPoints[this.topPolygonPoints.length - 1];
                    if (Math.hypot(p.a - lastPoint.a, p.b - lastPoint.b) <= 1e-9) {
                        return;
                    }

                    if (closeToFirst && this.topPolygonPoints.length >= 3) {
                        void this.commitTopPolygonSelection();
                        return;
                    }
                }

                this.topPolygonPoints.push(p);
                this.topPolygonHoverPoint = p;
                this.scheduleTopViewRender();
                this.setTopStatus(
                    this.topPolygonPoints.length >= 3
                        ? 'TopView polygon: keep adding points, then click the first point or press Enter to finish.'
                        : 'TopView polygon: add at least 3 points.'
                );
                return;
            }

            const rect = this.topCanvas.getBoundingClientRect();
            const clickX = event.clientX - rect.left;
            const clickY = event.clientY - rect.top;

            if (this.topSelectionTool === 'flood') {
                void this.selectTopFlood(clickX, clickY);
                return;
            }

            if (this.topSelectionTool === 'eyedropper') {
                void this.selectTopEyedropper(clickX, clickY);
            }
            return;
        }

        const rect = this.topCanvas.getBoundingClientRect();
        const p = this.canvasToWorld(event.clientX - rect.left, event.clientY - rect.top);
        if (!p) return;

        if (this.pickingWidth && this.sectionLine && this.drawingPoint === 0) {
            const measure = this.getLineMeasure(p.a, p.b);
            if (!measure) {
                this.setTopStatus('Section line is too short. Draw the line again.');
                return;
            }

            const sideMode = this.sideModeInput?.value || 'both';
            const distance = Math.abs(measure.perp);
            const thickness = sideMode === 'both' ? distance * 2 : distance;

            this.thicknessInput.value = String(Number(Math.max(0.000001, thickness).toFixed(6)));
            this.pickingWidth = false;
            this.invalidateSectionSliceCache();

            const sideText = sideMode === 'both'
                ? `centered total width = ${this.thicknessInput.value}`
                : `${sideMode} side depth = ${this.thicknessInput.value}`;

            if (this.topDrawData) {
                this.topDrawData.settings = this.getSettings();
            }

            this.setTopStatus(`Thickness picked from TopView: ${sideText}. Click Build View.`);
            this.drawTopView();
            return;
        }

        if (!this.sectionLine || this.drawingPoint === 0) {
            this.sectionLine = {
                a0: p.a,
                b0: p.b,
                a1: p.a,
                b1: p.b
            };
            this.drawingPoint = 1;
            this.invalidateSectionSliceCache();
            this.setTopStatus('Start point set. Click second point.');
        } else {
            this.sectionLine.a1 = p.a;
            this.sectionLine.b1 = p.b;
            this.drawingPoint = 0;
            this.invalidateSectionSliceCache();
            this.setTopStatus('Section line set. Click Build View.');
        }

        this.drawTopView();
    }

    private handleTopCanvasDoubleClick(event: MouseEvent) {
        if (!this.topSelectionMode || this.topSelectionTool !== 'polygon' || this.topPolygonPoints.length < 3) return;
        event.preventDefault();
        event.stopPropagation();
        void this.commitTopPolygonSelection();
    }

    private getSectionData(
        x: Float32Array,
        y: Float32Array,
        z: Float32Array,
        state: Uint8Array | null,
        fdc0: Float32Array | null,
        fdc1: Float32Array | null,
        fdc2: Float32Array | null,
        candidates: number[],
        settings: SectionSettings
    ) {
        if (!this.sectionLine) {
            throw new Error('No section line. Click two points in TopView first.');
        }

        const da = this.sectionLine.a1 - this.sectionLine.a0;
        const db = this.sectionLine.b1 - this.sectionLine.b0;
        const len = Math.sqrt(da * da + db * db);

        if (len < 1e-9) {
            throw new Error('Section line is too short.');
        }

        const ua = da / len;
        const ub = db / len;
        const mask = new Uint8Array(state ? state.length : x.length);
        const points: SectionPoint[] = [];

        let count = 0;
        let minAlong = Infinity, maxAlong = -Infinity;
        let minHeight = Infinity, maxHeight = -Infinity;

        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            if (!isValidGaussian(state, idx)) continue;

            const c = getCoords(settings.topAxes, x, y, z, idx);
            const va = c.a - this.sectionLine.a0;
            const vb = c.b - this.sectionLine.b0;
            const along = va * ua + vb * ub;
            const perp = va * -ub + vb * ua;

            if (along < 0 || along > len || !this.sectionPointAllowed(perp, settings.thickness, settings.sideMode || 'both')) {
                continue;
            }

            mask[idx] = 255;
            count++;

            const r = fdc0 ? decodeColorChannel(fdc0[idx]) : 0.8;
            const g = fdc1 ? decodeColorChannel(fdc1[idx]) : 0.8;
            const b = fdc2 ? decodeColorChannel(fdc2[idx]) : 0.8;

            points.push({ index: idx, along, height: c.h, r, g, b });

            if (along < minAlong) minAlong = along;
            if (along > maxAlong) maxAlong = along;
            if (c.h < minHeight) minHeight = c.h;
            if (c.h > maxHeight) maxHeight = c.h;
        }

        return {
            mask,
            points,
            count,
            length: len,
            minAlong,
            maxAlong,
            minHeight,
            maxHeight
        };
    }

    private makeViewerBounds(length: number, minHeight: number, maxHeight: number): SectionViewBounds {
        const heightRange = Math.max(1e-6, maxHeight - minHeight);
        const heightPad = heightRange * 0.08;
        const alongPad = Math.max(1e-6, length * 0.02);

        return {
            minAlong: -alongPad,
            maxAlong: length + alongPad,
            minHeight: minHeight - heightPad,
            maxHeight: maxHeight + heightPad
        };
    }

    private fitSectionBoundsToCanvas(view: SectionViewBounds, width: number, height: number): SectionViewBounds {
        const marginLeft = 48;
        const marginRight = 16;
        const marginTop = 16;
        const marginBottom = 32;
        const availW = Math.max(1, width - marginLeft - marginRight);
        const availH = Math.max(1, height - marginTop - marginBottom);
        const canvasAspect = availW / Math.max(1e-9, availH);
        const centerAlong = (view.minAlong + view.maxAlong) * 0.5;
        const centerHeight = (view.minHeight + view.maxHeight) * 0.5;
        const spanAlong = Math.max(1e-9, view.maxAlong - view.minAlong);
        const spanHeight = Math.max(1e-9, view.maxHeight - view.minHeight);
        let nextSpanAlong = spanAlong;
        let nextSpanHeight = spanHeight;

        if (spanAlong / spanHeight > canvasAspect) {
            nextSpanHeight = spanAlong / Math.max(1e-9, canvasAspect);
        } else {
            nextSpanAlong = spanHeight * canvasAspect;
        }

        return {
            minAlong: centerAlong - nextSpanAlong * 0.5,
            maxAlong: centerAlong + nextSpanAlong * 0.5,
            minHeight: centerHeight - nextSpanHeight * 0.5,
            maxHeight: centerHeight + nextSpanHeight * 0.5
        };
    }

    private fitViewerView(redraw = true) {
        if (!this.viewerData) return;
        const baseView = this.makeViewerBounds(this.viewerData.length, this.viewerData.minHeight, this.viewerData.maxHeight);
        this.viewerView = this.fitSectionBoundsToCanvas(baseView, this.viewerCanvas.width, this.viewerCanvas.height);
        if (redraw) {
            this.renderSectionViewer();
            this.viewerStatsDom.textContent = this.getViewerModeStatusText();
        }
    }

    private sectionToViewerCanvas(along: number, height: number) {
        const view = this.viewerView;
        if (!view) return { x: 0, y: 0 };

        const viewport = this.getSectionViewport(view);
        if (!viewport) return { x: 0, y: 0 };

        const x = viewport.offsetX + (along - view.minAlong) * viewport.scale;
        const y = this.isSectionHeightFlipped()
            ? viewport.offsetY + (height - view.minHeight) * viewport.scale
            : viewport.offsetY + (view.maxHeight - height) * viewport.scale;

        return { x, y };
    }

    private viewerCanvasToSection(x: number, y: number) {
        const view = this.viewerView;
        if (!view) return null;

        const viewport = this.getSectionViewport(view);
        if (!viewport) return null;

        const along = view.minAlong + (x - viewport.offsetX) / viewport.scale;
        const height = this.isSectionHeightFlipped()
            ? view.minHeight + (y - viewport.offsetY) / viewport.scale
            : view.maxHeight - (y - viewport.offsetY) / viewport.scale;

        return { along, height };
    }

    private getSectionViewport(view: SectionViewBounds): ViewportTransform | null {
        const w = this.viewerCanvas.width;
        const h = this.viewerCanvas.height;
        return this.getSectionViewportForSize(view, w, h);
    }

    private getSectionViewportForSize(view: SectionViewBounds, w: number, h: number): ViewportTransform | null {
        const marginLeft = 48;
        const marginRight = 16;
        const marginTop = 16;
        const marginBottom = 32;
        const availW = Math.max(1, w - marginLeft - marginRight);
        const availH = Math.max(1, h - marginTop - marginBottom);
        const spanAlong = Math.max(1e-9, view.maxAlong - view.minAlong);
        const spanHeight = Math.max(1e-9, view.maxHeight - view.minHeight);
        const scale = Math.min(availW / spanAlong, availH / spanHeight);
        const drawWidth = spanAlong * scale;
        const drawHeight = spanHeight * scale;
        const offsetX = marginLeft + (availW - drawWidth) * 0.5;
        const offsetY = marginTop + (availH - drawHeight) * 0.5;

        return {
            scale,
            offsetX,
            offsetY,
            drawWidth,
            drawHeight
        };
    }

    private adjustTopBoundsForCanvasResize(prevWidth: number, prevHeight: number, nextWidth: number, nextHeight: number) {
        if (!this.bounds || prevWidth <= 0 || prevHeight <= 0 || nextWidth <= 0 || nextHeight <= 0) return;

        const oldBounds = this.bounds;
        const centerA = (oldBounds.minA + oldBounds.maxA) * 0.5;
        const centerB = (oldBounds.minB + oldBounds.maxB) * 0.5;
        const oldScale = this.getTopScaleForSize(oldBounds, prevWidth, prevHeight);
        if (!Number.isFinite(oldScale) || oldScale <= 0) return;

        const margin = 10;
        const nextAvailW = Math.max(1, nextWidth - margin * 2);
        const nextAvailH = Math.max(1, nextHeight - margin * 2);
        const nextSpanA = nextAvailW / oldScale;
        const nextSpanB = nextAvailH / oldScale;

        this.bounds = {
            minA: centerA - nextSpanA * 0.5,
            maxA: centerA + nextSpanA * 0.5,
            minB: centerB - nextSpanB * 0.5,
            maxB: centerB + nextSpanB * 0.5
        };
    }

    private adjustSectionViewForCanvasResize(prevWidth: number, prevHeight: number, nextWidth: number, nextHeight: number) {
        if (!this.viewerView || prevWidth <= 0 || prevHeight <= 0 || nextWidth <= 0 || nextHeight <= 0) return;

        const oldView = this.viewerView;
        const oldViewport = this.getSectionViewportForSize(oldView, prevWidth, prevHeight);
        if (!oldViewport || !Number.isFinite(oldViewport.scale) || oldViewport.scale <= 0) return;

        const marginLeft = 48;
        const marginRight = 16;
        const marginTop = 16;
        const marginBottom = 32;
        const nextAvailW = Math.max(1, nextWidth - marginLeft - marginRight);
        const nextAvailH = Math.max(1, nextHeight - marginTop - marginBottom);
        const centerAlong = (oldView.minAlong + oldView.maxAlong) * 0.5;
        const centerHeight = (oldView.minHeight + oldView.maxHeight) * 0.5;
        const nextSpanAlong = nextAvailW / oldViewport.scale;
        const nextSpanHeight = nextAvailH / oldViewport.scale;

        this.viewerView = {
            minAlong: centerAlong - nextSpanAlong * 0.5,
            maxAlong: centerAlong + nextSpanAlong * 0.5,
            minHeight: centerHeight - nextSpanHeight * 0.5,
            maxHeight: centerHeight + nextSpanHeight * 0.5
        };
    }

    private renderSectionViewer() {
        const ctx = this.viewerCanvas.getContext('2d');
        if (!ctx) return;

        const data = this.viewerData;
        const view = this.viewerView;
        const w = this.viewerCanvas.width;
        const h = this.viewerCanvas.height;
        const marginLeft = 48;
        const marginRight = 16;
        const marginTop = 16;
        const marginBottom = 32;
        const fallbackPlotW = w - marginLeft - marginRight;
        const fallbackPlotH = h - marginTop - marginBottom;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#15191f';
        ctx.fillRect(0, 0, w, h);

        const viewport = view ? this.getSectionViewport(view) : null;
        const plotX = viewport ? viewport.offsetX : marginLeft;
        const plotY = viewport ? viewport.offsetY : marginTop;
        const plotW = viewport ? viewport.drawWidth : fallbackPlotW;
        const plotH = viewport ? viewport.drawHeight : fallbackPlotH;

        ctx.strokeStyle = '#3a414a';
        ctx.lineWidth = 1;
        ctx.strokeRect(plotX, plotY, plotW, plotH);

        if (!data || !view || data.points.length === 0) {
            ctx.fillStyle = '#b8c1cc';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No points in section slice', w / 2, h / 2);
            return;
        }

        // Pull latest viewer-only settings without recomputing the section data.
        const uiSettings = this.getSettings();
        data.settings = {
            ...data.settings,
            maxDisplayPoints: uiSettings.maxDisplayPoints,
            interactiveMaxDisplayPoints: uiSettings.interactiveMaxDisplayPoints,
            renderMode: uiSettings.renderMode,
            pointSize: uiSettings.pointSize,
            pixelCellSize: uiSettings.pixelCellSize
        };

        ctx.fillStyle = '#8b96a3';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('distance along line', plotX, h - 10);
        ctx.save();
        ctx.translate(12, plotY + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(`height (${data.settings.topAxes === 'xy' ? 'Z' : data.settings.topAxes === 'xz' ? 'Y' : 'X'})`, 0, 0);
        ctx.restore();

        const interactive = !!this.viewerDrag || performance.now() < this.viewerInteractiveUntil;
        const drawLimit = interactive
            ? Math.min(data.points.length, data.settings.interactiveMaxDisplayPoints || 12000)
            : Math.min(data.points.length, data.settings.maxDisplayPoints || 50000);

        const pointSize = Math.max(0.5, Math.min(4, data.settings.pointSize || 1));
        const pixelCellSize = Math.max(1, Math.min(8, Math.floor(data.settings.pixelCellSize || 2)));
        const colorRender = data.settings.renderMode === 'color';

        // Adaptive screen-grid render:
        // - It does NOT limit selection data.
        // - It only avoids drawing multiple points into the same small screen cell.
        // - When zoomed in, the same point cloud occupies more screen cells, so more real points become visible.
        const gridW = Math.max(1, Math.ceil(w / pixelCellSize));
        const gridH = Math.max(1, Math.ceil(h / pixelCellSize));
        const occupied = new Uint8Array(gridW * gridH);

        // While dragging, use a gentle scan stride for responsiveness.
        // At idle, scan all points until the visible-cell/draw limit is reached.
        const scanStride = interactive && data.points.length > drawLimit * 8
            ? Math.max(1, Math.floor(data.points.length / (drawLimit * 8)))
            : 1;

        let drawn = 0;
        let scannedVisible = 0;

        if (!colorRender) {
            ctx.fillStyle = interactive ? '#8f99a6' : '#b7c0cc';
        }

        for (let i = 0; i < data.points.length && drawn < drawLimit; i += scanStride) {
            const p = data.points[i];

            if (p.along < view.minAlong || p.along > view.maxAlong || p.height < view.minHeight || p.height > view.maxHeight) {
                continue;
            }

            scannedVisible++;
            const c = this.sectionToViewerCanvas(p.along, p.height);

            if (c.x < plotX || c.x > plotX + plotW || c.y < plotY || c.y > plotY + plotH) {
                continue;
            }

            const gx = Math.max(0, Math.min(gridW - 1, Math.floor(c.x / pixelCellSize)));
            const gy = Math.max(0, Math.min(gridH - 1, Math.floor(c.y / pixelCellSize)));
            const key = gy * gridW + gx;

            if (occupied[key]) {
                continue;
            }

            occupied[key] = 1;

            if (colorRender) {
                const rr = Math.round(p.r * 255);
                const gg = Math.round(p.g * 255);
                const bb = Math.round(p.b * 255);
                ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
            }

            ctx.fillRect(c.x, c.y, pointSize, pointSize);
            drawn++;
        }

        // Draw selected points on top as a separate adaptive overlay.
        // Important: this overlay is recomputed from the FULL selected mask on every
        // zoom/pan redraw. So if many selected points overlapped in a wide view,
        // zooming in will reveal/highlight more of them.
        let selectedDrawn = 0;
        let selectedVisible = 0;

        if (this.viewerSelectionMask) {
            ctx.fillStyle = '#ffff66';

            // Selection highlight uses a denser grid than the base cloud. This keeps
            // selection feedback accurate while still avoiding multiple highlights in
            // the exact same screen pixel.
            const selectedCellSize = Math.max(1, Math.min(3, Math.floor(pixelCellSize * 0.5) || 1));
            const selectedGridW = Math.max(1, Math.ceil(w / selectedCellSize));
            const selectedGridH = Math.max(1, Math.ceil(h / selectedCellSize));
            const selectedOccupied = new Uint8Array(selectedGridW * selectedGridH);

            // Much higher cap than base drawing. Selection feedback should prioritize
            // showing what is selected, especially after zooming into a selected region.
            const selectedLimit = Math.min(
                selectedGridW * selectedGridH,
                interactive ? Math.max(50000, drawLimit * 4) : Math.max(120000, drawLimit * 4)
            );

            for (let i = 0; i < data.points.length && selectedDrawn < selectedLimit; i++) {
                const p = data.points[i];
                if (!this.viewerSelectionMask[p.index]) continue;
                if (p.along < view.minAlong || p.along > view.maxAlong || p.height < view.minHeight || p.height > view.maxHeight) continue;

                selectedVisible++;

                const c = this.sectionToViewerCanvas(p.along, p.height);
                if (c.x < plotX || c.x > plotX + plotW || c.y < plotY || c.y > plotY + plotH) continue;

                const gx = Math.max(0, Math.min(selectedGridW - 1, Math.floor(c.x / selectedCellSize)));
                const gy = Math.max(0, Math.min(selectedGridH - 1, Math.floor(c.y / selectedCellSize)));
                const key = gy * selectedGridW + gx;

                if (selectedOccupied[key]) continue;
                selectedOccupied[key] = 1;

                ctx.fillRect(c.x - 1.5, c.y - 1.5, 3, 3);
                selectedDrawn++;
            }
        }

        if (this.viewerSelectionTool === 'polygon' && this.viewerPolygonPoints.length > 0) {
            const canvasPoints = this.viewerPolygonPoints.map((p) => this.sectionToViewerCanvas(p.along, p.height));
            const hoverCanvasPoint = this.viewerPolygonHoverPoint
                ? this.sectionToViewerCanvas(this.viewerPolygonHoverPoint.along, this.viewerPolygonHoverPoint.height)
                : null;

            ctx.save();
            ctx.strokeStyle = '#ffff66';
            ctx.fillStyle = 'rgba(255, 255, 102, 0.12)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
            for (let i = 1; i < canvasPoints.length; i++) {
                ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y);
            }
            if (hoverCanvasPoint) {
                ctx.lineTo(hoverCanvasPoint.x, hoverCanvasPoint.y);
            }
            if (canvasPoints.length >= 3) {
                ctx.closePath();
                ctx.fill();
            }
            ctx.stroke();

            for (let i = 0; i < canvasPoints.length; i++) {
                const p = canvasPoints[i];
                ctx.beginPath();
                ctx.arc(p.x, p.y, i === 0 ? 4 : 3, 0, Math.PI * 2);
                ctx.fillStyle = i === 0 ? '#f0c674' : '#ffff66';
                ctx.fill();
            }
            ctx.restore();
        }

        if (this.viewerSelectionTool === 'lasso' && this.viewerLassoPoints.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#66d9ff';
            ctx.fillStyle = 'rgba(102, 217, 255, 0.10)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(this.viewerLassoPoints[0].x, this.viewerLassoPoints[0].y);
            for (let i = 1; i < this.viewerLassoPoints.length; i++) {
                ctx.lineTo(this.viewerLassoPoints[i].x, this.viewerLassoPoints[i].y);
            }
            if (this.viewerDrag?.mode === 'lasso' && this.viewerLassoPoints.length >= 3) {
                ctx.closePath();
                ctx.fill();
            }
            ctx.stroke();
            ctx.restore();
        }

        if (this.viewerSelectionTool === 'brush') {
            ctx.save();
            ctx.strokeStyle = '#66d9ff';
            ctx.fillStyle = 'rgba(102, 217, 255, 0.10)';
            ctx.lineWidth = 1.25;
            if (this.viewerBrushPoints.length > 1) {
                ctx.beginPath();
                ctx.moveTo(this.viewerBrushPoints[0].x, this.viewerBrushPoints[0].y);
                for (let i = 1; i < this.viewerBrushPoints.length; i++) {
                    ctx.lineTo(this.viewerBrushPoints[i].x, this.viewerBrushPoints[i].y);
                }
                ctx.stroke();
            }
            if (this.viewerBrushCursor) {
                ctx.beginPath();
                ctx.arc(this.viewerBrushCursor.x, this.viewerBrushCursor.y, this.getBrushRadiusPixels(), 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }

        if (this.viewerDrag?.mode === 'select') {
            const x0 = this.viewerDrag.startX;
            const y0 = this.viewerDrag.startY;
            const x1 = this.viewerDrag.currentX;
            const y1 = this.viewerDrag.currentY;

            ctx.strokeStyle = '#ffff66';
            ctx.fillStyle = 'rgba(255, 255, 102, 0.12)';
            ctx.lineWidth = 1;
            ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
            ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        }

        ctx.fillStyle = '#8b96a3';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        const selectionText = this.viewerSelectionMask
            ? ` | selected pixels ${selectedDrawn.toLocaleString()}${selectedVisible > selectedDrawn ? ` / visible ${selectedVisible.toLocaleString()}` : ''}`
            : '';

        ctx.fillText(
            `${colorRender ? 'Adaptive color' : 'Adaptive mono'} | drawn ${drawn.toLocaleString()} / ${data.points.length.toLocaleString()}${selectionText}`,
            w - 12,
            h - 10
        );
    }

    private drawSectionViewer(
        points: SectionPoint[],
        length: number,
        minHeight: number,
        maxHeight: number,
        settings: SectionSettings
    ) {
        this.viewerData = { points, length, minHeight, maxHeight, settings };
        this.viewerSelectionMask = null;
        this.clearViewerToolDrafts();
        this.fitViewerView(false);
        this.syncSelectionHighlightsFromGlobalState();
    }

    private handleViewerWheel(event: WheelEvent) {
        if (!this.viewerView) return;
        event.preventDefault();

        const rect = this.viewerCanvas.getBoundingClientRect();
        const p = this.viewerCanvasToSection(event.clientX - rect.left, event.clientY - rect.top);
        if (!p) return;

        const factor = event.deltaY < 0 ? 0.8 : 1.25;
        const v = this.viewerView;
        this.viewerView = {
            minAlong: p.along - (p.along - v.minAlong) * factor,
            maxAlong: p.along + (v.maxAlong - p.along) * factor,
            minHeight: p.height - (p.height - v.minHeight) * factor,
            maxHeight: p.height + (v.maxHeight - p.height) * factor
        };

        this.markViewerInteractive();
        this.scheduleSectionViewerRender();
    }

    private handleViewerMouseDown(event: MouseEvent) {
        if (!this.viewerData || !this.viewerView) return;

        const rect = this.viewerCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (event.button === 2 || event.button === 1 || event.shiftKey) {
            event.preventDefault();
            this.viewerDrag = {
                mode: 'pan',
                startX: event.clientX,
                startY: event.clientY,
                currentX: event.clientX,
                currentY: event.clientY,
                startViewerBounds: cloneViewBounds(this.viewerView)
            };
            return;
        }

        if (this.viewerSelectionTool === 'polygon' || this.viewerSelectionTool === 'flood' || this.viewerSelectionTool === 'eyedropper') {
            return;
        }

        if (event.button === 0) {
            if (this.viewerSelectionTool === 'none') {
                this.viewerStatsDom.textContent = 'Section selection is off. Choose a selection tool first.';
                return;
            }
            event.preventDefault();
            if (this.viewerSelectionTool === 'lasso') {
                this.viewerLassoPoints = [{ x, y }];
            } else if (this.viewerSelectionTool === 'brush') {
                this.viewerBrushPoints = [{ x, y }];
                this.viewerBrushCursor = { x, y };
            }
            this.viewerDrag = {
                mode: this.viewerSelectionTool === 'lasso' ? 'lasso' : this.viewerSelectionTool === 'brush' ? 'brush' : 'select',
                startX: x,
                startY: y,
                currentX: x,
                currentY: y
            };
            this.markViewerInteractive();
            this.scheduleSectionViewerRender();
        }
    }

    private panViewer(event: MouseEvent) {
        if (!this.viewerDrag?.startViewerBounds || !this.viewerView) return;

        const start = this.viewerDrag.startViewerBounds;
        const viewport = this.getSectionViewport(start);
        if (!viewport) return;
        const dx = event.clientX - this.viewerDrag.startX;
        const dy = event.clientY - this.viewerDrag.startY;
        const dAlong = -dx / Math.max(1e-9, viewport.scale);
        const dHeight = (this.isSectionHeightFlipped() ? -dy : dy) / Math.max(1e-9, viewport.scale);

        this.viewerView = {
            minAlong: start.minAlong + dAlong,
            maxAlong: start.maxAlong + dAlong,
            minHeight: start.minHeight + dHeight,
            maxHeight: start.maxHeight + dHeight
        };

        this.markViewerInteractive();
        this.scheduleSectionViewerRender();
    }

    private handleViewerCanvasMouseMove(event: MouseEvent) {
        const rect = this.viewerCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (!this.viewerView) return;

        if (this.viewerSelectionTool === 'polygon') {
            this.viewerPolygonHoverPoint = this.viewerCanvasToSection(x, y);
            this.markViewerInteractive();
            this.scheduleSectionViewerRender();
            return;
        }

        if (this.viewerSelectionTool === 'brush') {
            this.viewerBrushCursor = { x, y };
            this.scheduleSectionViewerRender();
        }
    }

    private handleViewerCanvasMouseLeave() {
        let needsRender = false;
        if (this.viewerSelectionTool === 'polygon' && this.viewerPolygonHoverPoint) {
            this.viewerPolygonHoverPoint = null;
            needsRender = true;
        }
        if (this.viewerSelectionTool === 'brush' && this.viewerBrushCursor) {
            this.viewerBrushCursor = null;
            needsRender = true;
        }
        if (needsRender) {
            this.scheduleSectionViewerRender();
        }
    }

    private applyViewerSelectionResult(
        mask: Uint8Array | null,
        count: number,
        statusText: string,
        kind = 'sectionViewerSelection',
        op: 'add' | 'set' = this.topSelectionAdditive ? 'add' : 'set'
    ) {
        if (count <= 0 || !mask) {
            if (!this.topSelectionAdditive) {
                this.viewerSelectionMask = null;
                this.scheduleSectionViewerRender();
            }
            this.viewerStatsDom.textContent = statusText;
            return;
        }

        this.viewerSelectionMask = mask;
        this.lastMask = mask;
        this.lastPreviewCount = count;
        this.lastPreviewKind = kind;
        this.applyLocalSelectionHighlights(
            this.getPredictedSelectionMask(this.events.invoke('selection') as SplatLike | null, op, mask),
            this.events.invoke('selection') as SplatLike | null
        );
        this.events.fire('select.mask', op, mask);
        this.viewerStatsDom.textContent = statusText;
        this.statsDom.textContent = statusText;
    }

    private getNearestViewerPointPosition(x: number, y: number, maxDistance = 12, filter?: (position: number) => boolean) {
        if (!this.viewerData) return -1;

        const maxDist2 = maxDistance * maxDistance;
        let best = -1;
        let bestDist2 = maxDist2;

        for (let i = 0; i < this.viewerData.points.length; i++) {
            if (filter && !filter(i)) continue;
            const p = this.viewerData.points[i];
            const c = this.sectionToViewerCanvas(p.along, p.height);
            const dx = c.x - x;
            const dy = c.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= bestDist2) {
                bestDist2 = d2;
                best = i;
            }
        }

        return best;
    }

    private collectViewerMaskFromScreenPolygon(points: CanvasPoint[]) {
        if (!this.viewerData || !this.sectionSliceMask || points.length < 3) {
            return { mask: null, count: 0 };
        }

        const mask = new Uint8Array(this.sectionSliceMask.length);
        const minX = Math.min(...points.map((p) => p.x));
        const maxX = Math.max(...points.map((p) => p.x));
        const minY = Math.min(...points.map((p) => p.y));
        const maxY = Math.max(...points.map((p) => p.y));
        let count = 0;

        for (let i = 0; i < this.viewerData.points.length; i++) {
            const p = this.viewerData.points[i];
            const c = this.sectionToViewerCanvas(p.along, p.height);
            if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
            if (pointInScreenPolygon(c.x, c.y, points)) {
                mask[p.index] = 255;
                count++;
            }
        }

        return { mask: count > 0 ? mask : null, count };
    }

    private collectViewerMaskFromBrush(points: CanvasPoint[]) {
        if (!this.viewerData || !this.sectionSliceMask || points.length === 0) {
            return { mask: null, count: 0 };
        }

        const mask = new Uint8Array(this.sectionSliceMask.length);
        const radius = this.getBrushRadiusPixels();
        const radius2 = radius * radius;
        const minX = Math.min(...points.map((p) => p.x)) - radius;
        const maxX = Math.max(...points.map((p) => p.x)) + radius;
        const minY = Math.min(...points.map((p) => p.y)) - radius;
        const maxY = Math.max(...points.map((p) => p.y)) + radius;
        let count = 0;

        for (let i = 0; i < this.viewerData.points.length; i++) {
            const p = this.viewerData.points[i];
            const c = this.sectionToViewerCanvas(p.along, p.height);
            if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;

            let hit = false;
            for (let j = 0; j < points.length; j++) {
                const dist2 = j === 0
                    ? ((c.x - points[j].x) ** 2 + (c.y - points[j].y) ** 2)
                    : distancePointToSegmentSquared(c, points[j - 1], points[j]);
                if (dist2 <= radius2) {
                    hit = true;
                    break;
                }
            }

            if (hit) {
                mask[p.index] = 255;
                count++;
            }
        }

        return { mask: count > 0 ? mask : null, count };
    }

    private async selectViewerLasso(points: CanvasPoint[]) {
        const { mask, count } = this.collectViewerMaskFromScreenPolygon(points);
        this.applyViewerSelectionResult(
            mask,
            count,
            count > 0
                ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} in section lasso: ${count.toLocaleString()} points.`
                : 'No section points inside the lasso.',
            'sectionViewerLasso'
        );
    }

    private async selectViewerBrush(points: CanvasPoint[]) {
        const { mask, count } = this.collectViewerMaskFromBrush(points);
        this.applyViewerSelectionResult(
            mask,
            count,
            count > 0
                ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} in section brush: ${count.toLocaleString()} points.`
                : 'No section points touched by the brush.',
            'sectionViewerBrush'
        );
    }

    private async selectViewerFlood(x: number, y: number) {
        if (!this.viewerData || !this.sectionSliceMask || !this.viewerView) return;

        const width = this.viewerCanvas.width;
        const height = this.viewerCanvas.height;
        if (width <= 0 || height <= 0) return;

        const splat = this.events.invoke('selection') as SplatLike | null;
        const state = splat ? getUint8Array(splat, 'state') : null;
        const points = this.viewerData.points;
        const viewport = this.getSectionViewport(this.viewerView);
        if (!viewport) return;

        const selectedOnly = this.isFloodEyedropperCurrentSelectionOnly();
        const pointWidth = Math.max(1, this.viewerData.settings.pointSize || 1);
        const pointHeight = pointWidth;
        const pointAlpha = 32;
        const viewportMinX = viewport.offsetX;
        const viewportMaxX = viewport.offsetX + viewport.drawWidth;
        const viewportMinY = viewport.offsetY;
        const viewportMaxY = viewport.offsetY + viewport.drawHeight;
        const allowPoint = (position: number) => {
            if (selectedOnly && !isSelectedGaussian(state, points[position].index)) {
                return false;
            }

            const canvas = this.sectionToViewerCanvas(points[position].along, points[position].height);
            return canvas.x + pointWidth >= viewportMinX &&
                canvas.x <= viewportMaxX &&
                canvas.y + pointHeight >= viewportMinY &&
                canvas.y <= viewportMaxY;
        };
        const alpha = new Uint8Array(width * height);
        const pixelX = new Int32Array(points.length);
        const pixelY = new Int32Array(points.length);
        const rectX = new Float32Array(points.length);
        const rectY = new Float32Array(points.length);
        pixelX.fill(-1);
        pixelY.fill(-1);
        rectX.fill(-1);
        rectY.fill(-1);

        for (let i = 0; i < points.length; i++) {
            if (!allowPoint(i)) continue;
            const canvas = this.sectionToViewerCanvas(points[i].along, points[i].height);
            const px = Math.floor(canvas.x + pointWidth * 0.5);
            const py = Math.floor(canvas.y + pointHeight * 0.5);
            pixelX[i] = px;
            pixelY[i] = py;
            rectX[i] = canvas.x;
            rectY[i] = canvas.y;
            rasterizeAlphaRect(alpha, width, height, canvas.x, canvas.y, pointWidth, pointHeight, pointAlpha);
        }

        let startX = Math.max(0, Math.min(width - 1, Math.floor(x)));
        let startY = Math.max(0, Math.min(height - 1, Math.floor(y)));
        if (alpha[startY * width + startX] <= 0) {
            const seed = this.getNearestViewerPointPosition(x, y, 18, allowPoint);
            if (seed < 0) {
                this.applyViewerSelectionResult(
                    null,
                    0,
                    selectedOnly
                        ? 'No section seed point found in the current selection for Flood Select.'
                        : 'No section seed point found for Flood Select.'
                );
                return;
            }
            startX = Math.max(0, Math.min(width - 1, pixelX[seed]));
            startY = Math.max(0, Math.min(height - 1, pixelY[seed]));
        }

        const floodMask = floodFillAlphaMask(
            alpha,
            width,
            height,
            startX,
            startY,
            this.getFloodThreshold()
        );

        if (!floodMask) {
            this.applyViewerSelectionResult(null, 0, 'Section flood did not find a connected region.');
            return;
        }

        const mask = new Uint8Array(this.sectionSliceMask.length);
        let count = 0;
        for (let i = 0; i < points.length; i++) {
            if (!allowPoint(i) || rectX[i] < 0) continue;
            if (rectTouchesFloodMask(floodMask, width, height, rectX[i], rectY[i], pointWidth, pointHeight)) {
                mask[points[i].index] = 255;
                count++;
            }
        }

        this.applyViewerSelectionResult(
            count > 0 ? mask : null,
            count,
            count > 0
                ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} in section flood: ${count.toLocaleString()} points.`
                : 'Section flood did not find a connected cluster.',
            'sectionViewerFlood'
        );
    }

    private async selectViewerEyedropper(x: number, y: number) {
        if (!this.viewerData || !this.sectionSliceMask) return;

        const splat = this.events.invoke('selection') as SplatLike | null;
        const state = splat ? getUint8Array(splat, 'state') : null;
        const selectedOnly = this.isFloodEyedropperCurrentSelectionOnly();
        const points = this.viewerData.points;
        const allowPoint = (position: number) => !selectedOnly || isSelectedGaussian(state, points[position].index);
        const seed = this.getNearestViewerPointPosition(x, y, 12, allowPoint);
        if (seed < 0) {
            this.applyViewerSelectionResult(
                null,
                0,
                selectedOnly
                    ? 'No section seed point found in the current selection for Eyedropper.'
                    : 'No section seed point found for Eyedropper.'
            );
            return;
        }

        const threshold = this.getEyedropperThreshold();
        const threshold2 = threshold * threshold;
        const seedPoint = points[seed];
        const mask = new Uint8Array(this.sectionSliceMask.length);
        let count = 0;

        for (let i = 0; i < points.length; i++) {
            if (!allowPoint(i)) continue;
            const p = points[i];
            const dr = p.r - seedPoint.r;
            const dg = p.g - seedPoint.g;
            const db = p.b - seedPoint.b;
            const dist2 = (dr * dr + dg * dg + db * db) / 3;
            if (dist2 <= threshold2) {
                mask[p.index] = 255;
                count++;
            }
        }

        this.applyViewerSelectionResult(
            count > 0 ? mask : null,
            count,
            count > 0
                ? `${this.topSelectionAdditive ? 'Added' : 'Selected'} in section eyedropper: ${count.toLocaleString()} points.`
                : 'Section eyedropper did not find a color match.',
            'sectionViewerEyedropper'
        );
    }

    private async selectViewerRectangle(x0: number, y0: number, x1: number, y1: number) {
        if (!this.viewerData || !this.sectionSliceMask || !this.viewerView) return;

        const minX = Math.min(x0, x1);
        const maxX = Math.max(x0, x1);
        const minY = Math.min(y0, y1);
        const maxY = Math.max(y0, y1);
        const isClick = Math.abs(maxX - minX) < 4 && Math.abs(maxY - minY) < 4;
        const mask = new Uint8Array(this.sectionSliceMask.length);
        let count = 0;

        const points = this.viewerData.points;
        const chunkSize = 50000;

        this.events.fire('progressStart', isClick ? 'Section Pick' : 'Section Rectangle Select');

        try {
            if (isClick) {
                let bestIndex = -1;
                let bestDist2 = 36;

                for (let i = 0; i < points.length; i++) {
                    const p = points[i];

                    if (p.along < this.viewerView.minAlong || p.along > this.viewerView.maxAlong ||
                        p.height < this.viewerView.minHeight || p.height > this.viewerView.maxHeight) {
                        continue;
                    }

                    const c = this.sectionToViewerCanvas(p.along, p.height);
                    const dx = c.x - x0;
                    const dy = c.y - y0;
                    const d2 = dx * dx + dy * dy;

                    if (d2 < bestDist2) {
                        bestDist2 = d2;
                        bestIndex = p.index;
                    }

                    if (i % chunkSize === 0) {
                        updateProgress(this.events, `Picking ${i.toLocaleString()} / ${points.length.toLocaleString()}`, i / Math.max(1, points.length));
                        await yieldToBrowser();
                    }
                }

                if (bestIndex >= 0) {
                    mask[bestIndex] = 255;
                    count = 1;
                }
            } else {
                const s0 = this.viewerCanvasToSection(minX, minY);
                const s1 = this.viewerCanvasToSection(maxX, maxY);

                if (!s0 || !s1) return;

                const minAlong = Math.min(s0.along, s1.along);
                const maxAlong = Math.max(s0.along, s1.along);
                const minHeight = Math.min(s0.height, s1.height);
                const maxHeight = Math.max(s0.height, s1.height);

                for (let i = 0; i < points.length; i++) {
                    const p = points[i];

                    // No canvas projection here. This is much faster than v8.6:
                    // rectangle in screen space is converted once to section coordinates.
                    if (p.along >= minAlong && p.along <= maxAlong &&
                        p.height >= minHeight && p.height <= maxHeight) {
                        mask[p.index] = 255;
                        count++;
                    }

                    if (i % chunkSize === 0) {
                        updateProgress(this.events, `Selecting ${i.toLocaleString()} / ${points.length.toLocaleString()}`, i / Math.max(1, points.length));
                        await yieldToBrowser();
                    }
                }
            }

            if (count <= 0) {
                this.viewerStatsDom.textContent = 'No section points selected.';
                if (!this.topSelectionAdditive) {
                    this.viewerSelectionMask = null;
                    this.scheduleSectionViewerRender();
                }
                return;
            }

            const op: 'add' | 'set' = this.topSelectionAdditive ? 'add' : 'set';
            this.viewerSelectionMask = mask;
            this.lastMask = mask;
            this.lastPreviewCount = count;
            this.lastPreviewKind = 'sectionViewerSelection';
            this.applyLocalSelectionHighlights(
                this.getPredictedSelectionMask(this.events.invoke('selection') as SplatLike | null, op, mask),
                this.events.invoke('selection') as SplatLike | null
            );
            this.events.fire('select.mask', op, mask);

            this.viewerStatsDom.textContent = `${op === 'add' ? 'Added' : 'Selected'} in section view: ${count.toLocaleString()} points from full section data. Yellow pixels refresh when you zoom/pan.`;
            this.statsDom.textContent = `${op === 'add' ? 'Added' : 'Exact section selection'}: ${count.toLocaleString()} points. Zoom/pan refreshes selected pixels.`;
        } finally {
            this.events.fire('progressEnd');
        }
    }

    private async selectViewerPolygon(points: SectionPolygonPoint[]) {
        if (!this.viewerData || !this.sectionSliceMask || !this.viewerView || points.length < 3) return;

        const polygonMask = new Uint8Array(this.sectionSliceMask.length);
        const sectionPoints = this.viewerData.points;
        const chunkSize = 50000;
        const minAlong = Math.min(...points.map((p) => p.along));
        const maxAlong = Math.max(...points.map((p) => p.along));
        const minHeight = Math.min(...points.map((p) => p.height));
        const maxHeight = Math.max(...points.map((p) => p.height));
        let count = 0;

        this.events.fire('progressStart', 'Section Polygon Select');

        try {
            for (let i = 0; i < sectionPoints.length; i++) {
                const p = sectionPoints[i];
                if (p.along >= minAlong && p.along <= maxAlong &&
                    p.height >= minHeight && p.height <= maxHeight &&
                    pointInSectionPolygon(p.along, p.height, points)) {
                    polygonMask[p.index] = 255;
                    count++;
                }

                if (i % chunkSize === 0) {
                    updateProgress(this.events, `Selecting ${i.toLocaleString()} / ${sectionPoints.length.toLocaleString()}`, i / Math.max(1, sectionPoints.length));
                    await yieldToBrowser();
                }
            }

            if (count <= 0) {
                this.viewerStatsDom.textContent = 'No section points inside polygon.';
                if (!this.topSelectionAdditive) {
                    this.viewerSelectionMask = null;
                    this.scheduleSectionViewerRender();
                }
                return;
            }

            const op: 'add' | 'set' = this.topSelectionAdditive ? 'add' : 'set';
            this.viewerSelectionMask = polygonMask;
            this.lastMask = polygonMask;
            this.lastPreviewCount = count;
            this.lastPreviewKind = 'sectionViewerPolygonSelection';
            this.applyLocalSelectionHighlights(
                this.getPredictedSelectionMask(this.events.invoke('selection') as SplatLike | null, op, polygonMask),
                this.events.invoke('selection') as SplatLike | null
            );
            this.events.fire('select.mask', op, polygonMask);

            this.viewerStatsDom.textContent = `${op === 'add' ? 'Added' : 'Selected'} in section polygon: ${count.toLocaleString()} points.`;
            this.statsDom.textContent = `${op === 'add' ? 'Added section polygon selection' : 'Section polygon selection'}: ${count.toLocaleString()} points.`;
        } finally {
            this.events.fire('progressEnd');
        }
    }

    private async commitViewerPolygonSelection() {
        if (this.viewerPolygonPoints.length < 3) return;
        const points = [...this.viewerPolygonPoints];
        this.clearViewerPolygonDraft();
        await this.selectViewerPolygon(points);
    }

    private handleViewerCanvasClick(event: MouseEvent) {
        if (!this.viewerView) return;
        if (event.shiftKey || event.button !== 0 || this.viewerDrag) return;

        const rect = this.viewerCanvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;

        if (this.viewerSelectionTool === 'flood') {
            void this.selectViewerFlood(clickX, clickY);
            return;
        }

        if (this.viewerSelectionTool === 'eyedropper') {
            void this.selectViewerEyedropper(clickX, clickY);
            return;
        }

        if (this.viewerSelectionTool !== 'polygon') return;
        const p = this.viewerCanvasToSection(clickX, clickY);
        if (!p) return;

        if (this.viewerPolygonPoints.length > 0) {
            const firstCanvas = this.sectionToViewerCanvas(this.viewerPolygonPoints[0].along, this.viewerPolygonPoints[0].height);
            const closeToFirst = Math.hypot(clickX - firstCanvas.x, clickY - firstCanvas.y) <= 10;
            const lastPoint = this.viewerPolygonPoints[this.viewerPolygonPoints.length - 1];
            if (Math.hypot(p.along - lastPoint.along, p.height - lastPoint.height) <= 1e-9) {
                return;
            }

            if (closeToFirst && this.viewerPolygonPoints.length >= 3) {
                void this.commitViewerPolygonSelection();
                return;
            }
        }

        this.viewerPolygonPoints.push(p);
        this.viewerPolygonHoverPoint = p;
        this.markViewerInteractive();
        this.scheduleSectionViewerRender();
        this.viewerStatsDom.textContent = this.viewerPolygonPoints.length >= 3
            ? 'Section polygon: keep adding points, then click the first point or press Enter to finish.'
            : 'Section polygon: add at least 3 points.';
    }

    private handleViewerCanvasDoubleClick(event: MouseEvent) {
        if (this.viewerSelectionTool !== 'polygon' || this.viewerPolygonPoints.length < 3) return;
        event.preventDefault();
        event.stopPropagation();
        void this.commitViewerPolygonSelection();
    }

    private handleGlobalMouseMove(event: MouseEvent) {
        if (this.dockWidthResizeActive) {
            this.updateDockWidthFromPointer(event.clientX);
            return;
        }

        if (this.floatingWindowDragStart && !this.floatingWindowDrag) {
            const dx = event.clientX - this.floatingWindowDragStart.startX;
            const dy = event.clientY - this.floatingWindowDragStart.startY;
            if (Math.abs(dx) >= 4 || Math.abs(dy) >= 4) {
                this.beginFloatingWindowDrag(
                    this.floatingWindowDragStart.kind,
                    event.clientX,
                    event.clientY
                );
            } else {
                return;
            }
        }

        if (this.floatingWindowDrag) {
            this.setFloatingWindowPosition(
                this.floatingWindowDrag.viewer,
                event.clientX - this.floatingWindowDrag.offsetX,
                event.clientY - this.floatingWindowDrag.offsetY
            );
            return;
        }

        if (this.dockResizeActive) {
            this.updateDockSplitFromPointer(event.clientY);
            return;
        }

        if (this.topDrag?.mode === 'pan') {
            this.panTopView(event);
            return;
        }

        if (this.topDrag?.mode === 'select') {
            const rect = this.topCanvas.getBoundingClientRect();
            this.topDrag.currentX = event.clientX - rect.left;
            this.topDrag.currentY = event.clientY - rect.top;
            this.markTopInteractive();
            this.scheduleTopViewRender();
            return;
        }

        if (this.topDrag?.mode === 'lasso') {
            const rect = this.topCanvas.getBoundingClientRect();
            const next = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            this.topDrag.currentX = next.x;
            this.topDrag.currentY = next.y;
            this.appendStrokePoint(this.topLassoPoints, next, 3);
            this.markTopInteractive();
            this.scheduleTopViewRender();
            return;
        }

        if (this.topDrag?.mode === 'brush') {
            const rect = this.topCanvas.getBoundingClientRect();
            const next = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            this.topDrag.currentX = next.x;
            this.topDrag.currentY = next.y;
            this.topBrushCursor = next;
            this.appendStrokePoint(this.topBrushPoints, next, Math.max(3, this.getBrushRadiusPixels() * 0.25));
            this.markTopInteractive();
            this.scheduleTopViewRender();
            return;
        }

        if (this.viewerDrag?.mode === 'pan') {
            this.panViewer(event);
            return;
        }

        if (this.viewerDrag?.mode === 'select') {
            const rect = this.viewerCanvas.getBoundingClientRect();
            this.viewerDrag.currentX = event.clientX - rect.left;
            this.viewerDrag.currentY = event.clientY - rect.top;
            this.markViewerInteractive();
            this.scheduleSectionViewerRender();
            return;
        }

        if (this.viewerDrag?.mode === 'lasso') {
            const rect = this.viewerCanvas.getBoundingClientRect();
            const next = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            this.viewerDrag.currentX = next.x;
            this.viewerDrag.currentY = next.y;
            this.appendStrokePoint(this.viewerLassoPoints, next, 3);
            this.markViewerInteractive();
            this.scheduleSectionViewerRender();
            return;
        }

        if (this.viewerDrag?.mode === 'brush') {
            const rect = this.viewerCanvas.getBoundingClientRect();
            const next = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            this.viewerDrag.currentX = next.x;
            this.viewerDrag.currentY = next.y;
            this.viewerBrushCursor = next;
            this.appendStrokePoint(this.viewerBrushPoints, next, Math.max(3, this.getBrushRadiusPixels() * 0.25));
            this.markViewerInteractive();
            this.scheduleSectionViewerRender();
        }
    }

    private handleGlobalMouseUp(_event: MouseEvent) {
        if (this.dockWidthResizeActive) {
            this.dockWidthResizeActive = false;
            document.body.style.cursor = '';
            return;
        }

        if (this.floatingWindowDragStart && !this.floatingWindowDrag) {
            this.floatingWindowDragStart = null;
            return;
        }

        if (this.floatingWindowDrag) {
            const { kind, viewer } = this.floatingWindowDrag;
            const shouldDock = this.shouldDockWindow(_event.clientX, _event.clientY);
            this.floatingWindowDrag = null;
            this.floatingWindowDragStart = null;
            document.body.style.cursor = '';

            if (shouldDock) {
                if (kind === 'top') {
                    this.topViewDocked = true;
                } else {
                    this.viewerDocked = true;
                }
                viewer.style.left = '';
                viewer.style.top = '';
                viewer.style.right = '';
                viewer.style.bottom = '';
                this.applyWindowDock(viewer, true);
            }
            return;
        }

        if (this.dockResizeActive) {
            this.dockResizeActive = false;
            document.body.style.cursor = '';
            return;
        }

        if (this.viewerDrag?.mode === 'select') {
            const drag = this.viewerDrag;
            this.viewerDrag = null;
            void this.selectViewerRectangle(drag.startX, drag.startY, drag.currentX, drag.currentY);
            return;
        }

        if (this.viewerDrag?.mode === 'lasso') {
            const points = [...this.viewerLassoPoints];
            this.viewerDrag = null;
            this.viewerLassoPoints = [];
            this.scheduleSectionViewerRender();
            if (points.length >= 3) {
                void this.selectViewerLasso(points);
            }
            return;
        }

        if (this.viewerDrag?.mode === 'brush') {
            const points = [...this.viewerBrushPoints];
            this.viewerDrag = null;
            this.viewerBrushPoints = [];
            this.viewerBrushCursor = null;
            this.scheduleSectionViewerRender();
            if (points.length > 0) {
                void this.selectViewerBrush(points);
            }
            return;
        }

        if (this.topDrag?.mode === 'select') {
            const drag = this.topDrag;
            this.topDrag = null;
            void this.selectTopRectangle(drag.startX, drag.startY, drag.currentX, drag.currentY);
            return;
        }

        if (this.topDrag?.mode === 'lasso') {
            const points = [...this.topLassoPoints];
            this.topDrag = null;
            this.topLassoPoints = [];
            this.scheduleTopViewRender();
            if (points.length >= 3) {
                void this.selectTopLasso(points);
            }
            return;
        }

        if (this.topDrag?.mode === 'brush') {
            const points = [...this.topBrushPoints];
            this.topDrag = null;
            this.topBrushPoints = [];
            this.topBrushCursor = null;
            this.scheduleTopViewRender();
            if (points.length > 0) {
                void this.selectTopBrush(points);
            }
            return;
        }

        if (this.topDrag) {
            this.topDrag = null;
        }

        if (this.viewerDrag) {
            this.viewerDrag = null;
        }
    }

    private async buildSectionView(showWindow: boolean) {
        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            await this.showError('Section Line', 'Please select a splat first.');
            return;
        }

        if (!this.sectionLine) {
            await this.showError('Section Line', 'Click two points in TopView to draw a section line first.');
            return;
        }

        const settings = this.getSettings();
        const { n, x, y, z, state, fdc0, fdc1, fdc2 } = prepareArrays(splat);
        const candidates = collectCandidates(n, state, settings.scope);

        if (candidates.length === 0) {
            await this.showError('Build View', 'No candidate points. Choose Whole splat or select a rough region.');
            return;
        }

        this.events.fire('progressStart', 'Build Section View');

        try {
            await yieldToBrowser();
            const section = this.getSectionData(x, y, z, state, fdc0, fdc1, fdc2, candidates, settings);
            this.sectionSliceMask = section.mask;
            this.sectionSliceCount = section.count;
            this.sectionSliceSignature = this.getSectionSliceSignature(settings);
            this.sectionSliceSplat = splat;
            this.lastMask = section.mask;
            this.viewerSelectionMask = null;
            this.lastPreviewCount = section.count;
            this.lastPreviewKind = 'sectionLineSlice';
            this.viewerDataSplat = splat;
            this.topDataSplat = splat;

            this.drawSectionViewer(section.points, section.length, section.minHeight, section.maxHeight, settings);

            if (showWindow) {
                this.viewerDom.hidden = false;
                this.updateComposeLayout();
            }

            this.viewerStatsDom.textContent =
                `slice: ${section.count.toLocaleString()} / ${candidates.length.toLocaleString()} | ` +
                `length: ${section.length.toFixed(3)} | thickness: ${settings.thickness} | side: ${settings.sideMode || 'both'} | ` +
                `${this.viewerSelectionTool === 'none' ? 'choose a selection tool' : this.viewerSelectionTool === 'rect' ? 'rect select active' : 'polygon select active'}`;

            this.statsDom.textContent =
                `Section view built: ${section.count.toLocaleString()} points. Choose a Section View selection tool or use Select Slice.`;
        } catch (err: any) {
            await this.showError('Build View Error', String(err?.message ?? err));
        } finally {
            this.events.fire('progressEnd');
        }
    }

    private async selectSlice() {
        const splat = this.events.invoke('selection') as SplatLike | null;
        const settings = this.getSettings();

        if (!this.hasCurrentSectionSliceCache(splat, settings)) {
            await this.buildSectionView(false);
        }

        if (!this.sectionSliceMask || this.sectionSliceCount <= 0) {
            await this.showError('Select Slice', 'No section slice is available. Build View first.');
            return;
        }

        this.viewerSelectionMask = null;
        this.lastMask = this.sectionSliceMask;
        this.lastPreviewCount = this.sectionSliceCount;
        this.lastPreviewKind = 'sectionLineSlice';
        this.applyLocalSelectionHighlights(this.sectionSliceMask, this.events.invoke('selection') as SplatLike | null);
        this.events.fire('select.mask', 'set', this.sectionSliceMask);
        this.statsDom.textContent = `Selected: ${this.sectionSliceCount.toLocaleString()} points.`;
    }

    private async rebuildTopViewFromCurrentSplatState(reason = 'refresh') {
        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            this.fullBounds = null;
            this.bounds = null;
            this.topDrawData = null;
            this.topSelectionMask = null;
            this.drawEmptyTopView('Select a splat first');
            this.setTopStatus(`Could not refresh TopView: no selected splat.`);
            return { candidateCount: 0 };
        }

        const settings = this.getSettings();
        const { n, x, y, z, state, fdc0, fdc1, fdc2 } = prepareArrays(splat);
        let candidates = collectCandidates(n, state, settings.scope);

        if (candidates.length === 0 && settings.scope === 'selected') {
            settings.scope = 'all';
            this.scopeInput.value = 'all';
            saveJson('supersplat.sectionLine.settings', settings);
            candidates = collectCandidates(n, state, settings.scope);
        }

        this.topSelectionMask = null;
        this.lastMask = null;
        this.lastPreviewCount = 0;
        this.lastPreviewKind = '';
        this.clearTopPolygonDraft();

        if (candidates.length === 0) {
            this.fullBounds = null;
            this.bounds = null;
            this.topDrawData = null;
            this.drawEmptyTopView('No points after delete');
            this.setTopStatus(`${reason}: no remaining TopView points.`);
            return { candidateCount: 0 };
        }

        const hadBounds = !!(this.bounds && this.bounds.maxA > this.bounds.minA && this.bounds.maxB > this.bounds.minB);

        const { a, b } = buildTopAxisArrays(candidates, x, y, z, settings.topAxes);
        const { colorR, colorG, colorB } = buildTopColorArrays(candidates, fdc0, fdc1, fdc2);
        this.topDrawData = { candidates, a, b, x, y, z, fdc0, fdc1, fdc2, colorR, colorG, colorB, settings };
        this.topDataSplat = splat;
        this.cacheTopStateSignature(splat);
        this.rebuildTopBoundsFromCandidates(candidates, x, y, z, settings);

        if (!hadBounds && this.fullBounds) {
            this.bounds = this.fitTopBoundsToCanvas(this.fullBounds, this.topCanvas.width, this.topCanvas.height);
        }

        this.topViewDom.hidden = false;
        this.updateComposeLayout();
        this.syncSelectionHighlightsFromGlobalState();
        this.setTopStatus(`${reason}: TopView refreshed with ${candidates.length.toLocaleString()} candidates.`);

        return { candidateCount: candidates.length };
    }

    private rebuildTopBoundsFromCandidates(
        candidates: number[],
        x: Float32Array,
        y: Float32Array,
        z: Float32Array,
        settings: SectionSettings
    ) {
        if (candidates.length === 0) {
            this.fullBounds = null;
            this.bounds = null;
            return;
        }

        let minA = Infinity, minB = Infinity;
        let maxA = -Infinity, maxB = -Infinity;

        for (let i = 0; i < candidates.length; i++) {
            const c = getCoords(settings.topAxes, x, y, z, candidates[i]);
            if (c.a < minA) minA = c.a;
            if (c.a > maxA) maxA = c.a;
            if (c.b < minB) minB = c.b;
            if (c.b > maxB) maxB = c.b;
        }

        if (!(maxA > minA) || !(maxB > minB)) {
            this.fullBounds = null;
            this.bounds = null;
            return;
        }

        const padA = (maxA - minA) * 0.05;
        const padB = (maxB - minB) * 0.05;
        const oldBounds = this.bounds;

        this.fullBounds = {
            minA: minA - padA,
            maxA: maxA + padA,
            minB: minB - padB,
            maxB: maxB + padB
        };

        if (oldBounds && oldBounds.maxA > oldBounds.minA && oldBounds.maxB > oldBounds.minB) {
            this.bounds = oldBounds;
        } else {
            this.bounds = cloneTopBounds(this.fullBounds);
        }
    }

    private async rebuildSectionViewFromCurrentSplatState(reason = 'refresh') {
        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            this.viewerStatsDom.textContent = 'Could not refresh section view: no selected splat.';
            return { sectionCount: 0, candidateCount: 0 };
        }

        if (!this.sectionLine) {
            this.viewerStatsDom.textContent = 'Could not refresh section view: no section line.';
            return { sectionCount: 0, candidateCount: 0 };
        }

        const settings = this.viewerData?.settings || this.topDrawData?.settings || this.getSettings();
        const { n, x, y, z, state, fdc0, fdc1, fdc2 } = prepareArrays(splat);

        const candidates = collectCandidates(n, state, settings.scope);

        const { a, b } = buildTopAxisArrays(candidates, x, y, z, settings.topAxes);
        const { colorR, colorG, colorB } = buildTopColorArrays(candidates, fdc0, fdc1, fdc2);
        this.topDrawData = { candidates, a, b, x, y, z, fdc0, fdc1, fdc2, colorR, colorG, colorB, settings };
        this.rebuildTopBoundsFromCandidates(candidates, x, y, z, settings);

        if (candidates.length === 0) {
            this.viewerData = {
                points: [],
                length: 0,
                minHeight: 0,
                maxHeight: 0,
                settings
            };
            this.topDataSplat = splat;
            this.viewerDataSplat = splat;
            this.cacheTopStateSignature(splat);
            this.cacheViewerStateSignature(splat);
            this.sectionSliceMask = null;
            this.sectionSliceCount = 0;
            this.sectionSliceSignature = '';
            this.sectionSliceSplat = null;
            this.lastMask = null;
            this.viewerSelectionMask = null;
            this.lastPreviewCount = 0;
            this.lastPreviewKind = '';
            this.renderSectionViewer();
            this.drawEmptyTopView('No points after delete');
            return { sectionCount: 0, candidateCount: 0 };
        }

        const previousViewerView = this.viewerView ? cloneViewBounds(this.viewerView) : null;
        const section = this.getSectionData(x, y, z, state, fdc0, fdc1, fdc2, candidates, settings);

        this.sectionSliceMask = section.mask;
        this.sectionSliceCount = section.count;
        this.sectionSliceSignature = this.getSectionSliceSignature(settings);
        this.sectionSliceSplat = splat;
        this.lastMask = section.mask;
        this.viewerSelectionMask = null;
        this.lastPreviewCount = section.count;
        this.lastPreviewKind = 'sectionLineSlice';
        this.viewerDataSplat = splat;
        this.topDataSplat = splat;
        this.cacheTopStateSignature(splat);
        this.cacheViewerStateSignature(splat);

        this.viewerData = {
            points: section.points,
            length: section.length,
            minHeight: section.minHeight,
            maxHeight: section.maxHeight,
            settings
        };

        if (previousViewerView && previousViewerView.maxAlong > previousViewerView.minAlong && previousViewerView.maxHeight > previousViewerView.minHeight) {
            this.viewerView = previousViewerView;
        } else {
            this.fitViewerView(false);
        }

        this.syncSelectionHighlightsFromGlobalState();

        this.viewerStatsDom.textContent =
            `${reason}: rebuilt from live splat state. ` +
            `slice: ${section.count.toLocaleString()} / ${candidates.length.toLocaleString()}.`;

        return { sectionCount: section.count, candidateCount: candidates.length };
    }

    private async deletePreviewed() {
        if (this.lastPreviewCount <= 0) {
            await this.showError('Delete Previewed', 'No section slice or section-view selection is active.');
            return;
        }

        const ok = window.confirm(
            `Delete the currently selected ${this.lastPreviewCount.toLocaleString()} Gaussians?\n\n` +
            `Preview type: ${this.lastPreviewKind || 'unknown'}\n` +
            'This uses SuperSplat deletion, so you can undo it.'
        );

        if (!ok) return;

        const deleteMask = this.lastMask;

        if (deleteMask) {
            this.events.fire('select.mask', 'set', deleteMask);
        }

        this.suppressNextDeleteRefresh = true;
        this.suppressNextEditApplyRefresh = true;
        this.events.fire('select.delete');

        // Wait for SuperSplat to apply DeleteSelectionOp and update live state.
        await yieldToBrowser();
        await yieldToBrowser();

        let sectionCount = 0;
        let candidateCount = 0;

        try {
            if (this.viewerData && this.sectionLine) {
                const rebuilt = await this.rebuildSectionViewFromCurrentSplatState('Deleted');
                sectionCount = rebuilt.sectionCount;
                candidateCount = rebuilt.candidateCount;
            } else {
                const rebuiltTop = await this.rebuildTopViewFromCurrentSplatState('Deleted');
                candidateCount = rebuiltTop.candidateCount;
            }
        } catch (err: any) {
            const message = String(err?.message ?? err);
            if (this.viewerData && this.sectionLine) {
                this.viewerStatsDom.textContent = `Deleted, but section refresh failed: ${message}`;
            }
            this.setTopStatus(`Deleted, but TopView refresh failed: ${message}`);
        }

        this.lastPreviewCount = 0;
        this.lastPreviewKind = '';

        if (this.viewerData && this.sectionLine) {
            this.statsDom.textContent =
                `Deleted and rebuilt section view. Remaining section: ${sectionCount.toLocaleString()} / ${candidateCount.toLocaleString()}.`;
        } else {
            this.statsDom.textContent =
                `Deleted and refreshed TopView. Remaining candidates: ${candidateCount.toLocaleString()}.`;
        }
    }
}

export { SectionPanel };

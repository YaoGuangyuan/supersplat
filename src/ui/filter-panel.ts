import { Container } from '@playcanvas/pcui';

import { Events } from '../events';
import {
    DEFAULT_PLANE_SETTINGS,
    buildPlaneInlierMask,
    buildPlaneOutsideMask,
    collectPlaneCandidateIndices,
    collectSelectedValidIndices,
    fitRobustPlaneFromIndices,
    preparePlaneArrays
} from './plane-utils';
import { Tooltips } from './tooltips';

type SplatLike = {
    splatData: {
        numSplats: number;
        getProp: (name: string) => unknown;
    };
};

type OutlierSettings = {
    minOpacity: number;
    maxScale: number;
    radius: number;
    minNeighbors: number;
};

type BlackArtifactSettings = {
    maxBrightness: number;
    maxOpacity: number;
    minScale: number;
    radius: number;
    minNeighbors: number;
};

type PointCloudSettings = {
    enableFast: boolean;
    enableRadius: boolean;
    radius: number;
    minNeighbors: number;
    enableCluster: boolean;
    clusterRadius: number;
    minClusterSize: number;
    enableStatistical: boolean;
    kNeighbors: number;
    stdRatio: number;
};

type SkySettings = {
    upAxis: 'x' | 'y' | 'z';
    topPercent: number;
    minBrightness: number;
    maxWhiteSaturation: number;
    minBlueBias: number;
    maxOpacity: number;
    minScale: number;
    protectStructures: boolean;
    keepTopConnected: boolean;
    preferDiscreteSky: boolean;
};

type ObjectSettings = {
    method: 'euclidean' | 'color';
    seedMode: 'single' | 'all';
    radius: number;
    colorThreshold: number;
    fastPreview: boolean;
    maxPoints: number;
    limitToSelection: boolean;
};

type AdvancedSettings = {
    tool: 'plane';
    planeAction: 'select' | 'set' | 'outside';
    planeFitThreshold: number;
    outsideDistance: number;
    filterScope: string;
    filterSide: string;
};

type PlaneModel = {
    nx: number;
    ny: number;
    nz: number;
    d: number;
    seedCount: number;
    inlierCount: number;
};

type FilterResult = {
    mask: Uint8Array;
    total: number;
    count: number;
    reasonCounts: Record<string, number>;
    reasonMasks?: Record<string, Uint8Array>;
};

type FilterPresetAction = {
    label: string;
    title: string;
    apply: () => void;
};

type VoxelCell = {
    ix: number;
    iy: number;
    iz: number;
    count: number;
    indices: number[];
};

type FilterMode = 'outlier' | 'sky' | 'blackArtifact' | 'pointCloud' | 'object' | 'advanced';

type ReasonDisplayInfo = {
    label: string;
    className: string;
    order: number;
};

const GS_STATE = {
    selected: 1,
    locked: 2,
    deleted: 4
};

const SH_C0 = 0.28209479177387814;

const DEFAULT_OUTLIER_SETTINGS: OutlierSettings = {
    minOpacity: 0.005,
    maxScale: 0,
    radius: 0,
    minNeighbors: 0
};

const DEFAULT_BLACK_SETTINGS: BlackArtifactSettings = {
    maxBrightness: 0.04,
    maxOpacity: 0.20,
    minScale: 0,
    radius: 0,
    minNeighbors: 0
};

const DEFAULT_POINT_CLOUD_SETTINGS: PointCloudSettings = {
    enableFast: true,
    enableRadius: true,
    radius: 1.5,
    minNeighbors: 2,
    enableCluster: false,
    clusterRadius: 1.5,
    minClusterSize: 80,
    enableStatistical: false,
    kNeighbors: 32,
    stdRatio: 3.5
};

const DEFAULT_SKY_SETTINGS: SkySettings = {
    upAxis: 'y',
    topPercent: 15,
    minBrightness: 0.66,
    maxWhiteSaturation: 0.20,
    minBlueBias: 0.08,
    maxOpacity: 0.32,
    minScale: 1.00,
    protectStructures: false,
    keepTopConnected: false,
    preferDiscreteSky: false
};

const DEFAULT_OBJECT_SETTINGS: ObjectSettings = {
    method: 'euclidean',
    seedMode: 'single',
    radius: 1.8,
    colorThreshold: 0.18,
    fastPreview: true,
    maxPoints: 50000,
    limitToSelection: false
};

const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
    tool: 'plane',
    planeAction: 'select',
    planeFitThreshold: DEFAULT_PLANE_SETTINGS.planeFitThreshold,
    outsideDistance: DEFAULT_PLANE_SETTINGS.outsideDistance,
    filterScope: DEFAULT_PLANE_SETTINGS.filterScope,
    filterSide: DEFAULT_PLANE_SETTINGS.filterSide
};

const REASON_DISPLAY: Record<FilterMode, Record<string, ReasonDisplayInfo>> = {
    outlier: {
        opacity: { label: 'Low opacity', className: 'reason-opacity', order: 1 },
        scale: { label: 'Large scale', className: 'reason-scale', order: 2 },
        radius: { label: 'Sparse', className: 'reason-radius', order: 3 },
        clippedOutsideSelection: { label: 'Clipped', className: 'reason-clipped', order: 99 }
    },
    sky: {
        topBand: { label: 'Top band', className: 'reason-cluster', order: 1 },
        skyWhite: { label: 'White sky', className: 'reason-statistical', order: 2 },
        skyBlue: { label: 'Blue sky', className: 'reason-statistical', order: 3 },
        skyHaze: { label: 'Sky haze', className: 'reason-opacity', order: 4 },
        discreteSky: { label: 'Discrete sky', className: 'reason-clipped', order: 5 },
        clippedOutsideSelection: { label: 'Clipped', className: 'reason-clipped', order: 99 }
    },
    blackArtifact: {
        darkAndLowOpacity: { label: 'Dark+thin', className: 'reason-dark-opacity', order: 1 },
        darkAndLargeScale: { label: 'Dark+large', className: 'reason-dark-scale', order: 2 },
        darkAndIsolated: { label: 'Dark+sparse', className: 'reason-dark-isolated', order: 3 },
        clippedOutsideSelection: { label: 'Clipped', className: 'reason-clipped', order: 99 }
    },
    pointCloud: {
        radius: { label: 'Sparse', className: 'reason-radius', order: 1 },
        smallCluster: { label: 'Cluster', className: 'reason-cluster', order: 2 },
        statistical: { label: 'Statistical', className: 'reason-statistical', order: 3 },
        clippedOutsideSelection: { label: 'Clipped', className: 'reason-clipped', order: 99 }
    },
    object: {
        object: { label: 'Object', className: 'reason-cluster', order: 1 },
        colorObject: { label: 'Color object', className: 'reason-statistical', order: 2 },
        truncated: { label: 'Fast preview', className: 'reason-clipped', order: 98 },
        clippedOutsideSelection: { label: 'Clipped', className: 'reason-clipped', order: 99 }
    },
    advanced: {
        planeInlier: { label: 'Plane', className: 'reason-cluster', order: 1 },
        planeOutside: { label: 'Outside plane', className: 'reason-statistical', order: 2 },
        clippedOutsideSelection: { label: 'Clipped', className: 'reason-clipped', order: 99 }
    }
};

const sigmoid = (x: number) => {
    if (x >= 0) return 1 / (1 + Math.exp(-x));
    const ex = Math.exp(x);
    return ex / (1 + ex);
};

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

const isValidGaussian = (state: Uint8Array | null, i: number, limitToSelection = false) => {
    if (!state) {
        return !limitToSelection;
    }

    if ((state[i] & (GS_STATE.locked | GS_STATE.deleted)) !== 0) {
        return false;
    }

    if (limitToSelection && (state[i] & GS_STATE.selected) === 0) {
        return false;
    }

    return true;
};

const getCurrentSelectionMask = (state: Uint8Array | null, n: number) => {
    if (!state) {
        return {
            mask: null as Uint8Array | null,
            count: 0,
            indices: [] as number[]
        };
    }

    const mask = new Uint8Array(n);
    const indices: number[] = [];
    let count = 0;

    for (let i = 0; i < n; i++) {
        if ((state[i] & (GS_STATE.locked | GS_STATE.deleted)) !== 0) {
            continue;
        }

        if ((state[i] & GS_STATE.selected) !== 0) {
            mask[i] = 255;
            indices.push(i);
            count++;
        }
    }

    return { mask, count, indices };
};

const getValidGaussianIndices = (state: Uint8Array | null, n: number) => {
    const indices: number[] = [];

    for (let i = 0; i < n; i++) {
        if (isValidGaussian(state, i, false)) {
            indices.push(i);
        }
    }

    return indices;
};

const getProcessingIndices = (
    n: number,
    state: Uint8Array | null,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    if (scopeIndices) {
        return scopeIndices;
    }

    if (limitToSelection) {
        return getCurrentSelectionMask(state, n).indices;
    }

    return getValidGaussianIndices(state, n);
};

const intersectWithSelectionMask = (
    result: FilterResult,
    scopeMask: Uint8Array | null
): FilterResult => {
    if (!scopeMask) {
        return result;
    }

    const nextMask = new Uint8Array(result.mask.length);
    let nextCount = 0;
    let clipped = 0;

    for (let i = 0; i < result.mask.length; i++) {
        if (!result.mask[i]) {
            continue;
        }

        if (scopeMask[i]) {
            nextMask[i] = 255;
            nextCount++;
        } else {
            clipped++;
        }
    }

    return {
        ...result,
        mask: nextMask,
        count: nextCount,
        reasonMasks: result.reasonMasks ? Object.fromEntries(
            Object.entries(result.reasonMasks).map(([key, mask]) => {
                const nextReasonMask = new Uint8Array(mask.length);
                for (let i = 0; i < mask.length; i++) {
                    if (mask[i] && scopeMask[i]) {
                        nextReasonMask[i] = 255;
                    }
                }
                return [key, nextReasonMask];
            })
        ) : undefined,
        reasonCounts: {
            ...result.reasonCounts,
            clippedOutsideSelection: clipped
        }
    };
};

const countMaskBits = (mask: Uint8Array | null | undefined) => {
    if (!mask) return 0;

    let count = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) count++;
    }
    return count;
};

const cellKey = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`;

const intervalGap = (aMin: number, aMax: number, bMin: number, bMax: number) => {
    if (aMax < bMin) return bMin - aMax;
    if (bMax < aMin) return aMin - bMax;
    return 0;
};

const cellMinDistanceSquared = (a: VoxelCell, b: VoxelCell, voxelSize: number) => {
    const aMinX = a.ix * voxelSize;
    const aMaxX = (a.ix + 1) * voxelSize;
    const aMinY = a.iy * voxelSize;
    const aMaxY = (a.iy + 1) * voxelSize;
    const aMinZ = a.iz * voxelSize;
    const aMaxZ = (a.iz + 1) * voxelSize;

    const bMinX = b.ix * voxelSize;
    const bMaxX = (b.ix + 1) * voxelSize;
    const bMinY = b.iy * voxelSize;
    const bMaxY = (b.iy + 1) * voxelSize;
    const bMinZ = b.iz * voxelSize;
    const bMaxZ = (b.iz + 1) * voxelSize;

    const dx = intervalGap(aMinX, aMaxX, bMinX, bMaxX);
    const dy = intervalGap(aMinY, aMaxY, bMinY, bMaxY);
    const dz = intervalGap(aMinZ, aMaxZ, bMinZ, bMaxZ);

    return dx * dx + dy * dy + dz * dz;
};

const pointMinDistanceSquaredToCell = (
    px: number,
    py: number,
    pz: number,
    cell: VoxelCell,
    voxelSize: number
) => {
    const minX = cell.ix * voxelSize;
    const maxX = (cell.ix + 1) * voxelSize;
    const minY = cell.iy * voxelSize;
    const maxY = (cell.iy + 1) * voxelSize;
    const minZ = cell.iz * voxelSize;
    const maxZ = (cell.iz + 1) * voxelSize;

    const dx = px < minX ? minX - px : (px > maxX ? px - maxX : 0);
    const dy = py < minY ? minY - py : (py > maxY ? py - maxY : 0);
    const dz = pz < minZ ? minZ - pz : (pz > maxZ ? pz - maxZ : 0);

    return dx * dx + dy * dy + dz * dz;
};

const cellPairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const cellsHavePointPairWithinRadius = (
    aKey: string,
    aCell: VoxelCell,
    bKey: string,
    bCell: VoxelCell,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    voxelSize: number,
    r2: number,
    cache: Map<string, boolean>
) => {
    const key = cellPairKey(aKey, bKey);
    const cached = cache.get(key);
    if (cached !== undefined) {
        return cached;
    }

    if (cellMinDistanceSquared(aCell, bCell, voxelSize) > r2) {
        cache.set(key, false);
        return false;
    }

    for (let ia = 0; ia < aCell.indices.length; ia++) {
        const i = aCell.indices[ia];
        for (let ib = 0; ib < bCell.indices.length; ib++) {
            const j = bCell.indices[ib];
            const ddx = x[i] - x[j];
            const ddy = y[i] - y[j];
            const ddz = z[i] - z[j];
            if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) {
                cache.set(key, true);
                return true;
            }
        }
    }

    cache.set(key, false);
    return false;
};

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const updateProgress = (events: Events, text: string, progress: number) => {
    events.fire('progressUpdate', {
        text,
        progress: Math.max(0, Math.min(1, progress))
    });
};

const decodeColorChannel = (value: number) => {
    return Math.max(0, Math.min(1, SH_C0 * value + 0.5));
};

const computeBrightness = (r: number, g: number, b: number) => {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const computeSaturation = (r: number, g: number, b: number) => {
    const maxValue = Math.max(r, g, b);
    if (maxValue <= 1e-6) return 0;

    const minValue = Math.min(r, g, b);
    return (maxValue - minValue) / maxValue;
};

const estimateAverageSpacing = (
    indices: number[],
    x: Float32Array,
    y: Float32Array,
    z: Float32Array
) => {
    if (indices.length <= 1) {
        return 1;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let ii = 0; ii < indices.length; ii++) {
        const i = indices[ii];
        if (x[i] < minX) minX = x[i];
        if (y[i] < minY) minY = y[i];
        if (z[i] < minZ) minZ = z[i];
        if (x[i] > maxX) maxX = x[i];
        if (y[i] > maxY) maxY = y[i];
        if (z[i] > maxZ) maxZ = z[i];
    }

    const dx = Math.max(1e-6, maxX - minX);
    const dy = Math.max(1e-6, maxY - minY);
    const dz = Math.max(1e-6, maxZ - minZ);

    return Math.cbrt((dx * dy * dz) / Math.max(1, indices.length));
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
        opacity: getFloatArray(splat, 'opacity'),
        scale0: getFloatArray(splat, 'scale_0'),
        scale1: getFloatArray(splat, 'scale_1'),
        scale2: getFloatArray(splat, 'scale_2'),
        fdc0: getFloatArray(splat, 'f_dc_0'),
        fdc1: getFloatArray(splat, 'f_dc_1'),
        fdc2: getFloatArray(splat, 'f_dc_2')
    };
};

const computeRadiusIsolationMask = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    preSelectedMask: Uint8Array,
    radius: number,
    minNeighbors: number,
    progressBase: number,
    progressSpan: number,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    const isolated = new Uint8Array(n);

    if (!(radius > 0 && minNeighbors > 0)) {
        return isolated;
    }

    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    if (candidates.length === 0) {
        return isolated;
    }

    const invRadius = 1 / radius;
    const r2 = radius * radius;
    const grid = new Map<string, number[]>();
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        if (preSelectedMask[i]) continue;

        const ix = Math.floor(x[i] * invRadius);
        const iy = Math.floor(y[i] * invRadius);
        const iz = Math.floor(z[i] * invRadius);
        const key = cellKey(ix, iy, iz);

        let arr = grid.get(key);
        if (!arr) {
            arr = [];
            grid.set(key, arr);
        }

        arr.push(i);

        if (ci % step === 0) {
            updateProgress(events, `Building scoped radius grid ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.4));
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        if (preSelectedMask[i]) continue;

        const ix = Math.floor(x[i] * invRadius);
        const iy = Math.floor(y[i] * invRadius);
        const iz = Math.floor(z[i] * invRadius);

        let neighbors = 0;

        for (let dx = -1; dx <= 1 && neighbors < minNeighbors; dx++) {
            for (let dy = -1; dy <= 1 && neighbors < minNeighbors; dy++) {
                for (let dz = -1; dz <= 1 && neighbors < minNeighbors; dz++) {
                    const arr = grid.get(cellKey(ix + dx, iy + dy, iz + dz));
                    if (!arr) continue;

                    for (let j = 0; j < arr.length && neighbors < minNeighbors; j++) {
                        const k = arr[j];
                        if (k === i) continue;

                        const ddx = x[i] - x[k];
                        const ddy = y[i] - y[k];
                        const ddz = z[i] - z[k];

                        if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) {
                            neighbors++;
                        }
                    }
                }
            }
        }

        if (neighbors < minNeighbors) {
            isolated[i] = 255;
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoped radius isolation ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + progressSpan * 0.4 + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.6));
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    return isolated;
};


const computeSmallClusterMask = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    radius: number,
    minClusterSize: number,
    progressBase: number,
    progressSpan: number,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    const out = new Uint8Array(n);

    if (!(radius > 0 && minClusterSize > 0)) {
        return out;
    }

    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    if (candidates.length === 0) {
        return out;
    }

    const invRadius = 1 / radius;
    const r2 = radius * radius;
    const grid = new Map<string, number[]>();
    const valid = new Uint8Array(n);
    const visited = new Uint8Array(n);
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        valid[i] = 255;

        const ix = Math.floor(x[i] * invRadius);
        const iy = Math.floor(y[i] * invRadius);
        const iz = Math.floor(z[i] * invRadius);
        const key = cellKey(ix, iy, iz);

        let arr = grid.get(key);
        if (!arr) {
            arr = [];
            grid.set(key, arr);
        }

        arr.push(i);

        if (ci % step === 0) {
            updateProgress(events, `Building scoped cluster grid ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.2));
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    for (let si = 0; si < candidates.length; si++) {
        const seed = candidates[si];
        if (!valid[seed] || visited[seed]) continue;

        const queue: number[] = [seed];
        const members: number[] = [];
        visited[seed] = 255;

        while (queue.length > 0) {
            const i = queue.pop() as number;
            members.push(i);

            const ix = Math.floor(x[i] * invRadius);
            const iy = Math.floor(y[i] * invRadius);
            const iz = Math.floor(z[i] * invRadius);

            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const arr = grid.get(cellKey(ix + dx, iy + dy, iz + dz));
                        if (!arr) continue;

                        for (let a = 0; a < arr.length; a++) {
                            const k = arr[a];
                            if (visited[k]) continue;

                            const ddx = x[i] - x[k];
                            const ddy = y[i] - y[k];
                            const ddz = z[i] - z[k];

                            if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) {
                                visited[k] = 255;
                                queue.push(k);
                            }
                        }
                    }
                }
            }
        }

        if (members.length < minClusterSize) {
            for (let m = 0; m < members.length; m++) {
                out[members[m]] = 255;
            }
        }

        if (si % step === 0) {
            updateProgress(events, `Scoped cluster ${si.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + progressSpan * 0.2 + (si / Math.max(1, candidates.length)) * (progressSpan * 0.8));
            if (si % (step * 5) === 0) await yieldToBrowser();
        }
    }

    return out;
};


const buildVoxelCells = (
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    voxelSize: number,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    const inv = 1 / Math.max(1e-8, voxelSize);
    const cells = new Map<string, VoxelCell>();

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * inv);
        const iy = Math.floor(y[i] * inv);
        const iz = Math.floor(z[i] * inv);
        const key = cellKey(ix, iy, iz);

        let cell = cells.get(key);
        if (!cell) {
            cell = { ix, iy, iz, count: 0, indices: [] };
            cells.set(key, cell);
        }

        cell.count++;
        cell.indices.push(i);
    }

    return cells;
};

const buildVoxelCellsAsync = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    voxelSize: number,
    progressBase: number,
    progressSpan: number,
    progressLabel: string,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    const inv = 1 / Math.max(1e-8, voxelSize);
    const cells = new Map<string, VoxelCell>();
    const progressStep = Math.max(256, Math.floor(candidates.length / 100));
    const yieldStep = 4096;

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * inv);
        const iy = Math.floor(y[i] * inv);
        const iz = Math.floor(z[i] * inv);
        const key = cellKey(ix, iy, iz);

        let cell = cells.get(key);
        if (!cell) {
            cell = { ix, iy, iz, count: 0, indices: [] };
            cells.set(key, cell);
        }

        cell.count++;
        cell.indices.push(i);

        if (ci % progressStep === 0) {
            updateProgress(events, `${progressLabel} ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + (ci / Math.max(1, candidates.length)) * progressSpan);
        }

        if (ci > 0 && ci % yieldStep === 0) {
            await yieldToBrowser();
        }
    }

    return { candidates, cells };
};


const computeFastVoxelRadiusMask = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    voxelSize: number,
    minNeighbors: number,
    progressBase: number,
    progressSpan: number,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    const out = new Uint8Array(n);

    if (!(voxelSize > 0 && minNeighbors > 0)) {
        return out;
    }

    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    if (candidates.length === 0) {
        return out;
    }

    const cells = buildVoxelCells(n, x, y, z, state, voxelSize, limitToSelection, candidates);
    const inv = 1 / Math.max(1e-8, voxelSize);
    const r2 = voxelSize * voxelSize;
    const step = Math.max(1, Math.floor(candidates.length / 100));
    const quickAcceptSlack = Math.max(2, Math.ceil(minNeighbors * 0.5));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * inv);
        const iy = Math.floor(y[i] * inv);
        const iz = Math.floor(z[i] * inv);

        let possibleNeighbors = 0;
        let occupiedCells = 0;
        const candidateCells: VoxelCell[] = [];

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const cell = cells.get(cellKey(ix + dx, iy + dy, iz + dz));
                    if (!cell) continue;
                    if (pointMinDistanceSquaredToCell(x[i], y[i], z[i], cell, voxelSize) > r2) continue;

                    occupiedCells++;
                    possibleNeighbors += cell.count;
                    candidateCells.push(cell);
                }
            }
        }

        possibleNeighbors -= 1; // exclude self

        if (possibleNeighbors < minNeighbors) {
            out[i] = 255;
        } else if (possibleNeighbors <= minNeighbors + quickAcceptSlack || occupiedCells <= 2) {
            let exactNeighbors = 0;

            for (let c = 0; c < candidateCells.length && exactNeighbors < minNeighbors; c++) {
                const cell = candidateCells[c];
                for (let j = 0; j < cell.indices.length && exactNeighbors < minNeighbors; j++) {
                    const k = cell.indices[j];
                    if (k === i) continue;

                    const ddx = x[i] - x[k];
                    const ddy = y[i] - y[k];
                    const ddz = z[i] - z[k];

                    if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) {
                        exactNeighbors++;
                    }
                }
            }

            if (exactNeighbors < minNeighbors) {
                out[i] = 255;
            }
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoped fast voxel radius ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + (ci / Math.max(1, candidates.length)) * progressSpan);
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    return out;
};


const computeFastVoxelClusterMask = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    voxelSize: number,
    minClusterSize: number,
    progressBase: number,
    progressSpan: number,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    const out = new Uint8Array(n);

    if (!(voxelSize > 0 && minClusterSize > 0)) {
        return out;
    }

    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    if (candidates.length === 0) {
        return out;
    }

    const cells = buildVoxelCells(n, x, y, z, state, voxelSize, limitToSelection, candidates);
    const visited = new Set<string>();
    const keys = Array.from(cells.keys());
    const r2 = voxelSize * voxelSize;
    const connectionCache = new Map<string, boolean>();
    const step = Math.max(1, Math.floor(keys.length / 100));

    for (let seedIndex = 0; seedIndex < keys.length; seedIndex++) {
        const seedKey = keys[seedIndex];
        if (visited.has(seedKey)) continue;

        const queue: string[] = [seedKey];
        const componentKeys: string[] = [];
        let componentCount = 0;
        visited.add(seedKey);

        while (queue.length > 0) {
            const key = queue.pop() as string;
            componentKeys.push(key);

            const cell = cells.get(key);
            if (!cell) continue;

            componentCount += cell.count;

            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (dx === 0 && dy === 0 && dz === 0) continue;
                        const nk = cellKey(cell.ix + dx, cell.iy + dy, cell.iz + dz);
                        if (visited.has(nk)) continue;
                        const neighborCell = cells.get(nk);
                        if (!neighborCell) continue;
                        if (!cellsHavePointPairWithinRadius(key, cell, nk, neighborCell, x, y, z, voxelSize, r2, connectionCache)) continue;
                        visited.add(nk);
                        queue.push(nk);
                    }
                }
            }
        }

        if (componentCount < minClusterSize) {
            for (let c = 0; c < componentKeys.length; c++) {
                const cell = cells.get(componentKeys[c]);
                if (!cell) continue;
                for (let i = 0; i < cell.indices.length; i++) {
                    out[cell.indices[i]] = 255;
                }
            }
        }

        if (seedIndex % step === 0) {
            updateProgress(events, `Scoped fast voxel cluster ${seedIndex.toLocaleString()} / ${keys.length.toLocaleString()} cells`, progressBase + (seedIndex / Math.max(1, keys.length)) * progressSpan);
            if (seedIndex % (step * 5) === 0) await yieldToBrowser();
        }
    }

    return out;
};


const computeFastVoxelStatisticalMask = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    voxelSize: number,
    stdRatio: number,
    progressBase: number,
    progressSpan: number,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    const out = new Uint8Array(n);

    if (!(voxelSize > 0 && stdRatio > 0)) {
        return out;
    }

    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    if (candidates.length === 0) {
        return out;
    }

    const cells = buildVoxelCells(n, x, y, z, state, voxelSize, limitToSelection, candidates);
    const cellScores = new Map<string, number>();
    const keys = Array.from(cells.keys());
    const inv = 1 / Math.max(1e-8, voxelSize);
    const scores = new Float32Array(n);
    scores.fill(-1);
    const step = Math.max(1, Math.floor(candidates.length / 100));
    const cellStep = Math.max(1, Math.floor(keys.length / 100));

    // Score occupied cells using both global sparsity and local support contrast.
    for (let ki = 0; ki < keys.length; ki++) {
        const key = keys[ki];
        const cell = cells.get(key);
        if (!cell) continue;

        let neighborhoodCount = 0;
        let occupiedCells = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const neighbor = cells.get(cellKey(cell.ix + dx, cell.iy + dy, cell.iz + dz));
                    if (!neighbor) continue;
                    neighborhoodCount += neighbor.count;
                    occupiedCells++;
                }
            }
        }

        const localMeanCellCount = neighborhoodCount / Math.max(1, occupiedCells);
        const densityDeficit = Math.max(0, localMeanCellCount - cell.count) / Math.max(1, localMeanCellCount);
        let score = voxelSize / Math.cbrt(Math.max(1, neighborhoodCount));
        score *= 1 + densityDeficit * 1.5;

        if (occupiedCells <= 2) {
            score *= 1.15;
        } else if (occupiedCells >= 9 && cell.count >= localMeanCellCount * 0.6) {
            score *= 0.9;
        }

        cellScores.set(key, score);

        if (ki % cellStep === 0) {
            updateProgress(events, `Scoring voxel support ${ki.toLocaleString()} / ${keys.length.toLocaleString()} cells`, progressBase + (ki / Math.max(1, keys.length)) * (progressSpan * 0.45));
            if (ki % (cellStep * 5) === 0) await yieldToBrowser();
        }
    }

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        const ix = Math.floor(x[i] * inv);
        const iy = Math.floor(y[i] * inv);
        const iz = Math.floor(z[i] * inv);
        scores[i] = cellScores.get(cellKey(ix, iy, iz)) ?? -1;

        if (ci % step === 0) {
            updateProgress(events, `Scoped fast voxel statistical ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + progressSpan * 0.45 + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.30));
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    let mean = 0;
    let count = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        const v = scores[candidates[ci]];
        if (v >= 0 && Number.isFinite(v)) {
            mean += v;
            count++;
        }
    }

    if (count === 0) return out;
    mean /= count;

    let variance = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        const v = scores[candidates[ci]];
        if (v >= 0 && Number.isFinite(v)) {
            const d = v - mean;
            variance += d * d;
        }
    }

    const std = Math.sqrt(variance / Math.max(1, count));
    const threshold = mean + stdRatio * std;

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        const v = scores[i];
        if (v >= 0 && v > threshold) {
            out[i] = 255;
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoped fast voxel statistical threshold ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + progressSpan * 0.75 + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.25));
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    return out;
};


const computeStatisticalOutlierMask = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    kNeighbors: number,
    stdRatio: number,
    progressBase: number,
    progressSpan: number,
    limitToSelection = false,
    scopeIndices: number[] | null = null
) => {
    const out = new Uint8Array(n);

    if (!(kNeighbors > 0 && stdRatio > 0)) {
        return out;
    }

    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    if (candidates.length <= 1) {
        return out;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        if (x[i] < minX) minX = x[i];
        if (y[i] < minY) minY = y[i];
        if (z[i] < minZ) minZ = z[i];
        if (x[i] > maxX) maxX = x[i];
        if (y[i] > maxY) maxY = y[i];
        if (z[i] > maxZ) maxZ = z[i];
    }

    const dx = Math.max(1e-6, maxX - minX);
    const dy = Math.max(1e-6, maxY - minY);
    const dz = Math.max(1e-6, maxZ - minZ);
    const volume = dx * dy * dz;
    const avgSpacing = Math.cbrt(volume / Math.max(1, candidates.length));
    const cellSize = Math.max(1e-4, avgSpacing * 2.0);
    const invCell = 1 / cellSize;

    const grid = new Map<string, number[]>();
    const avgDistances = new Float32Array(n);
    avgDistances.fill(-1);
    let minIx = Infinity, minIy = Infinity, minIz = Infinity;
    let maxIx = -Infinity, maxIy = -Infinity, maxIz = -Infinity;
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * invCell);
        const iy = Math.floor(y[i] * invCell);
        const iz = Math.floor(z[i] * invCell);
        const key = cellKey(ix, iy, iz);

        if (ix < minIx) minIx = ix;
        if (iy < minIy) minIy = iy;
        if (iz < minIz) minIz = iz;
        if (ix > maxIx) maxIx = ix;
        if (iy > maxIy) maxIy = iy;
        if (iz > maxIz) maxIz = iz;

        let arr = grid.get(key);
        if (!arr) {
            arr = [];
            grid.set(key, arr);
        }
        arr.push(i);

        if (ci % step === 0) {
            updateProgress(events, `Building scoped statistical grid ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.25));
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * invCell);
        const iy = Math.floor(y[i] * invCell);
        const iz = Math.floor(z[i] * invCell);

        const dists: number[] = [];
        const maxShell = Math.max(
            ix - minIx,
            maxIx - ix,
            iy - minIy,
            maxIy - iy,
            iz - minIz,
            maxIz - iz
        );

        for (let shell = 0; shell <= maxShell && dists.length < kNeighbors; shell++) {
            for (let gx = ix - shell; gx <= ix + shell; gx++) {
                for (let gy = iy - shell; gy <= iy + shell; gy++) {
                    for (let gz = iz - shell; gz <= iz + shell; gz++) {
                        if (shell > 0 &&
                            gx !== ix - shell && gx !== ix + shell &&
                            gy !== iy - shell && gy !== iy + shell &&
                            gz !== iz - shell && gz !== iz + shell) {
                            continue;
                        }

                        const arr = grid.get(cellKey(gx, gy, gz));
                        if (!arr) continue;

                        for (let j = 0; j < arr.length; j++) {
                            const k = arr[j];
                            if (k === i) continue;

                            const ddx = x[i] - x[k];
                            const ddy = y[i] - y[k];
                            const ddz = z[i] - z[k];
                            dists.push(Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz));
                        }
                    }
                }
            }
        }

        if (dists.length === 0) {
            avgDistances[i] = Number.POSITIVE_INFINITY;
        } else {
            dists.sort((a, b) => a - b);
            const k = Math.min(kNeighbors, dists.length);
            let sum = 0;
            for (let j = 0; j < k; j++) sum += dists[j];
            avgDistances[i] = sum / k;
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoped statistical pass ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + progressSpan * 0.25 + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.50));
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    let mean = 0;
    let count = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        const v = avgDistances[candidates[ci]];
        if (Number.isFinite(v) && v >= 0) {
            mean += v;
            count++;
        }
    }
    if (count === 0) {
        return out;
    }
    mean /= count;

    let variance = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        const v = avgDistances[candidates[ci]];
        if (Number.isFinite(v) && v >= 0) {
            const d = v - mean;
            variance += d * d;
        }
    }
    const std = Math.sqrt(variance / Math.max(1, count));
    const threshold = mean + stdRatio * std;

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        const v = avgDistances[i];
        if ((Number.isFinite(v) && v > threshold) || !Number.isFinite(v)) {
            out[i] = 255;
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoped statistical threshold ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + progressSpan * 0.75 + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.25));
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    return out;
};


const computeOutlierMask = async (
    events: Events,
    splat: SplatLike,
    settings: OutlierSettings,
    limitToSelection = false,
    scopeIndices: number[] | null = null
): Promise<FilterResult> => {
    const { n, x, y, z, state, opacity, scale0, scale1, scale2 } = prepareArrays(splat);
    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    const mask = new Uint8Array(n);
    const reasonMasks: Record<string, Uint8Array> = {
        opacity: new Uint8Array(n),
        scale: new Uint8Array(n),
        radius: new Uint8Array(n)
    };
    const reasonCounts: Record<string, number> = { opacity: 0, scale: 0, radius: 0 };
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        let hit = false;

        if (settings.minOpacity > 0 && opacity) {
            if (sigmoid(opacity[i]) < settings.minOpacity) {
                hit = true;
                reasonMasks.opacity[i] = 255;
                reasonCounts.opacity++;
            }
        }

        if (settings.maxScale > 0 && scale0 && scale1 && scale2) {
            const maxScale = Math.max(Math.exp(scale0[i]), Math.exp(scale1[i]), Math.exp(scale2[i]));
            if (maxScale > settings.maxScale) {
                hit = true;
                reasonMasks.scale[i] = 255;
                reasonCounts.scale++;
            }
        }

        if (hit) {
            mask[i] = 255;
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoped outlier pass ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, (ci / Math.max(1, candidates.length)) * 0.55);
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    const isolated = await computeRadiusIsolationMask(events, n, x, y, z, state, mask, settings.radius, settings.minNeighbors, 0.55, 0.45, limitToSelection, candidates);

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        if (isolated[i]) {
            mask[i] = 255;
            reasonMasks.radius[i] = 255;
            reasonCounts.radius++;
        }
    }

    let count = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        if (mask[candidates[ci]]) count++;
    }

    return { mask, total: n, count, reasonCounts, reasonMasks };
};

const computeSkyMask = async (
    events: Events,
    splat: SplatLike,
    settings: SkySettings,
    limitToSelection = false,
    scopeIndices: number[] | null = null
): Promise<FilterResult> => {
    const { n, x, y, z, state, opacity, scale0, scale1, scale2, fdc0, fdc1, fdc2 } = prepareArrays(splat);

    if (!fdc0 || !fdc1 || !fdc2) {
        throw new Error('Selected splat does not have f_dc_0 / f_dc_1 / f_dc_2 color properties.');
    }

    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    if (candidates.length === 0) {
        throw new Error('No candidate sky points. Select a region first or disable Limit to current selection.');
    }

    const axis = settings.upAxis === 'x' ? x : settings.upAxis === 'z' ? z : y;
    const horizontalA = settings.upAxis === 'x' ? y : x;
    const horizontalB = settings.upAxis === 'z' ? y : z;
    let minAxis = Infinity;
    let maxAxis = -Infinity;
    const averageSpacing = estimateAverageSpacing(candidates, x, y, z);
    const structureCellSize = Math.max(averageSpacing * 3.5, 1e-4);
    const invStructureCellSize = 1 / structureCellSize;
    const structureDepthThreshold = Math.max(averageSpacing * 8, 1e-3);
    const structureColumnMinPoints = 6;
    const columnStats = new Map<string, { count: number; minUp: number; maxUp: number }>();

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        const value = axis[i];
        if (value < minAxis) minAxis = value;
        if (value > maxAxis) maxAxis = value;

        if (settings.protectStructures) {
            const key = `${Math.floor(horizontalA[i] * invStructureCellSize)},${Math.floor(horizontalB[i] * invStructureCellSize)}`;
            const column = columnStats.get(key);
            if (column) {
                column.count++;
                if (value < column.minUp) column.minUp = value;
                if (value > column.maxUp) column.maxUp = value;
            } else {
                columnStats.set(key, { count: 1, minUp: value, maxUp: value });
            }
        }
    }

    const histogramBins = 256;
    const histogram = new Uint32Array(histogramBins);
    const axisRange = Math.max(1e-6, maxAxis - minAxis);
    const histogramScale = (histogramBins - 1) / axisRange;
    const topFraction = Math.max(0.01, Math.min(0.80, settings.topPercent / 100));
    const targetTopCount = Math.max(1, Math.round(candidates.length * topFraction));
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const value = axis[candidates[ci]];
        const bin = Math.max(0, Math.min(histogramBins - 1, Math.floor((value - minAxis) * histogramScale)));
        histogram[bin]++;

        if (ci % step === 0) {
            updateProgress(events, `Building sky height histogram ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, (ci / Math.max(1, candidates.length)) * 0.20);
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    let accumulatedTopCount = 0;
    let thresholdBin = histogramBins - 1;
    for (let bi = histogramBins - 1; bi >= 0; bi--) {
        accumulatedTopCount += histogram[bi];
        if (accumulatedTopCount >= targetTopCount) {
            thresholdBin = bi;
            break;
        }
    }

    const topThreshold = minAxis + (thresholdBin / Math.max(1, histogramBins - 1)) * axisRange;
    const blueBrightnessThreshold = Math.max(0.35, settings.minBrightness * 0.8);
    const hazeBrightnessThreshold = Math.max(0.35, settings.minBrightness * 0.72);
    const useOpacity = !!opacity && settings.maxOpacity < 0.999;
    const useScale = !!scale0 && !!scale1 && !!scale2 && settings.minScale > 0;
    const topSeedThreshold = topThreshold + (maxAxis - topThreshold) * 0.55;
    const whiteSkyThreshold = topThreshold + (maxAxis - topThreshold) * 0.35;
    const localVoxelSize = Math.max(averageSpacing * 2.5, 1e-4);
    const localInv = 1 / localVoxelSize;
    const localCells = buildVoxelCells(n, x, y, z, state, localVoxelSize, limitToSelection, candidates);
    const mask = new Uint8Array(n);
    const reasonMasks: Record<string, Uint8Array> = {
        topBand: new Uint8Array(n),
        skyWhite: new Uint8Array(n),
        skyBlue: new Uint8Array(n),
        skyHaze: new Uint8Array(n),
        discreteSky: new Uint8Array(n)
    };
    const reasonCounts: Record<string, number> = {
        topBand: 0,
        skyWhite: 0,
        skyBlue: 0,
        skyHaze: 0,
        discreteSky: 0
    };

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        const heightHit = axis[i] >= topThreshold;
        if (!heightHit) {
            if (ci % step === 0) {
                updateProgress(events, `Scoring sky points ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, 0.20 + (ci / Math.max(1, candidates.length)) * 0.80);
                if (ci % (step * 5) === 0) await yieldToBrowser();
            }
            continue;
        }

        const r = decodeColorChannel(fdc0[i]);
        const g = decodeColorChannel(fdc1[i]);
        const b = decodeColorChannel(fdc2[i]);
        const brightness = computeBrightness(r, g, b);
        const saturation = computeSaturation(r, g, b);
        const blueBias = b - Math.max(r, g);
        const whiteHit = brightness >= settings.minBrightness && saturation <= settings.maxWhiteSaturation;
        const blueHit = brightness >= blueBrightnessThreshold && blueBias >= settings.minBlueBias;

        let hazeHit = false;
        if (brightness >= hazeBrightnessThreshold) {
            const opacityHit = useOpacity && opacity ? sigmoid(opacity[i]) <= settings.maxOpacity : false;
            const scaleHit = useScale && scale0 && scale1 && scale2
                ? Math.max(Math.exp(scale0[i]), Math.exp(scale1[i]), Math.exp(scale2[i])) >= settings.minScale
                : false;
            hazeHit = opacityHit || scaleHit;
        }

        const ix = Math.floor(x[i] * localInv);
        const iy = Math.floor(y[i] * localInv);
        const iz = Math.floor(z[i] * localInv);
        const currentKey = cellKey(ix, iy, iz);
        const currentCell = localCells.get(currentKey);
        let neighborhoodCount = 0;
        let occupiedCells = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = cellKey(ix + dx, iy + dy, iz + dz);
                    const cell = localCells.get(key);
                    if (!cell) continue;
                    occupiedCells++;
                    neighborhoodCount += cell.count;
                }
            }
        }

        const localMeanCellCount = occupiedCells > 0 ? neighborhoodCount / occupiedCells : 0;
        const localSupportRatio = currentCell && localMeanCellCount > 0 ? currentCell.count / localMeanCellCount : 0;
        const discreteSkyHint = neighborhoodCount <= 6 || occupiedCells <= 3 || localSupportRatio < 0.55;
        const nearTopSky = axis[i] >= whiteSkyThreshold;

        let protectedStructure = false;
        if (settings.protectStructures) {
            const key = `${Math.floor(horizontalA[i] * invStructureCellSize)},${Math.floor(horizontalB[i] * invStructureCellSize)}`;
            const column = columnStats.get(key);
            if (column) {
                const nearColumnTop = (column.maxUp - axis[i]) <= structureCellSize;
                const columnDepth = column.maxUp - column.minUp;
                protectedStructure = nearColumnTop &&
                    column.count >= structureColumnMinPoints &&
                    columnDepth >= structureDepthThreshold;
            }
        }

        const whiteSkyAllowed = !whiteHit || blueHit || hazeHit || (discreteSkyHint && nearTopSky);
        const whiteSurfaceRejected = whiteHit && !whiteSkyAllowed;
        const allowDiscrete = !settings.preferDiscreteSky || discreteSkyHint || blueHit;

        if ((whiteHit || blueHit || hazeHit) && !protectedStructure && !whiteSurfaceRejected && allowDiscrete) {
            mask[i] = 255;
            reasonMasks.topBand[i] = 255;
            reasonCounts.topBand++;

            if (whiteHit) {
                reasonMasks.skyWhite[i] = 255;
                reasonCounts.skyWhite++;
            }

            if (blueHit) {
                reasonMasks.skyBlue[i] = 255;
                reasonCounts.skyBlue++;
            }

            if (hazeHit) {
                reasonMasks.skyHaze[i] = 255;
                reasonCounts.skyHaze++;
            }

            if (discreteSkyHint) {
                reasonMasks.discreteSky[i] = 255;
                reasonCounts.discreteSky++;
            }
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoring sky points ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, 0.20 + (ci / Math.max(1, candidates.length)) * 0.80);
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    if (settings.keepTopConnected) {
        const connectedCellSize = Math.max(averageSpacing * 5, 1e-4);
        const invConnectedCellSize = 1 / connectedCellSize;
        const connectedCells = new Map<string, { a: number; b: number; maxUp: number; indices: number[] }>();

        for (let ci = 0; ci < candidates.length; ci++) {
            const i = candidates[ci];
            if (!mask[i]) continue;

            const a = Math.floor(horizontalA[i] * invConnectedCellSize);
            const b = Math.floor(horizontalB[i] * invConnectedCellSize);
            const key = `${a},${b}`;
            const existing = connectedCells.get(key);

            if (existing) {
                existing.indices.push(i);
                if (axis[i] > existing.maxUp) existing.maxUp = axis[i];
            } else {
                connectedCells.set(key, {
                    a,
                    b,
                    maxUp: axis[i],
                    indices: [i]
                });
            }
        }

        const keepCells = new Set<string>();
        const queue: string[] = [];

        connectedCells.forEach((cell, key) => {
            if (cell.maxUp >= topSeedThreshold) {
                keepCells.add(key);
                queue.push(key);
            }
        });

        for (let qi = 0; qi < queue.length; qi++) {
            const currentKey = queue[qi];
            const current = connectedCells.get(currentKey);
            if (!current) continue;

            for (let da = -1; da <= 1; da++) {
                for (let db = -1; db <= 1; db++) {
                    if (da === 0 && db === 0) continue;

                    const neighborKey = `${current.a + da},${current.b + db}`;
                    if (!connectedCells.has(neighborKey) || keepCells.has(neighborKey)) continue;

                    keepCells.add(neighborKey);
                    queue.push(neighborKey);
                }
            }
        }

        for (let ci = 0; ci < candidates.length; ci++) {
            const i = candidates[ci];
            if (!mask[i]) continue;

            const key = `${Math.floor(horizontalA[i] * invConnectedCellSize)},${Math.floor(horizontalB[i] * invConnectedCellSize)}`;
            if (!keepCells.has(key)) {
                mask[i] = 0;
                reasonMasks.topBand[i] = 0;
                reasonMasks.skyWhite[i] = 0;
                reasonMasks.skyBlue[i] = 0;
                reasonMasks.skyHaze[i] = 0;
                reasonMasks.discreteSky[i] = 0;
            }
        }

        reasonCounts.topBand = 0;
        reasonCounts.skyWhite = 0;
        reasonCounts.skyBlue = 0;
        reasonCounts.skyHaze = 0;
        reasonCounts.discreteSky = 0;

        for (let ci = 0; ci < candidates.length; ci++) {
            const i = candidates[ci];
            if (reasonMasks.topBand[i]) reasonCounts.topBand++;
            if (reasonMasks.skyWhite[i]) reasonCounts.skyWhite++;
            if (reasonMasks.skyBlue[i]) reasonCounts.skyBlue++;
            if (reasonMasks.skyHaze[i]) reasonCounts.skyHaze++;
            if (reasonMasks.discreteSky[i]) reasonCounts.discreteSky++;
        }
    }

    let count = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        if (mask[candidates[ci]]) count++;
    }

    return { mask, total: n, count, reasonCounts, reasonMasks };
};


const computeBlackArtifactMask = async (
    events: Events,
    splat: SplatLike,
    settings: BlackArtifactSettings,
    limitToSelection = false,
    scopeIndices: number[] | null = null
): Promise<FilterResult> => {
    const { n, x, y, z, state, opacity, scale0, scale1, scale2, fdc0, fdc1, fdc2 } = prepareArrays(splat);

    if (!fdc0 || !fdc1 || !fdc2) {
        throw new Error('Selected splat does not have f_dc_0 / f_dc_1 / f_dc_2 color properties.');
    }

    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    const mask = new Uint8Array(n);
    const reasonMasks: Record<string, Uint8Array> = {
        darkAndLowOpacity: new Uint8Array(n),
        darkAndLargeScale: new Uint8Array(n),
        darkAndIsolated: new Uint8Array(n)
    };
    const brightnessValues = new Float32Array(n);
    const contrastValues = new Float32Array(n);
    const weakSupportMask = new Uint8Array(n);
    const reasonCounts: Record<string, number> = {
        darkAndLowOpacity: 0,
        darkAndLargeScale: 0,
        darkAndIsolated: 0
    };
    const step = Math.max(1, Math.floor(candidates.length / 100));
    const localVoxelSize = Math.max(
        settings.radius > 0 ? settings.radius : estimateAverageSpacing(candidates, x, y, z) * 2.5,
        1e-4
    );
    const localInv = 1 / localVoxelSize;
    const localCells = buildVoxelCells(n, x, y, z, state, localVoxelSize, limitToSelection, candidates);
    const localBrightnessSums = new Map<string, number>();
    const darkContrastThreshold = Math.max(0.03, settings.maxBrightness * 0.75);
    const largeScaleContrastThreshold = darkContrastThreshold * 0.5;

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        const r = decodeColorChannel(fdc0[i]);
        const g = decodeColorChannel(fdc1[i]);
        const b = decodeColorChannel(fdc2[i]);
        const brightness = computeBrightness(r, g, b);
        brightnessValues[i] = brightness;

        const ix = Math.floor(x[i] * localInv);
        const iy = Math.floor(y[i] * localInv);
        const iz = Math.floor(z[i] * localInv);
        const key = cellKey(ix, iy, iz);
        localBrightnessSums.set(key, (localBrightnessSums.get(key) ?? 0) + brightness);

        if (ci % step === 0) {
            updateProgress(events, `Building black artifact context ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, (ci / Math.max(1, candidates.length)) * 0.15);
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        const brightness = brightnessValues[i];
        const ix = Math.floor(x[i] * localInv);
        const iy = Math.floor(y[i] * localInv);
        const iz = Math.floor(z[i] * localInv);
        const currentKey = cellKey(ix, iy, iz);
        const currentCell = localCells.get(currentKey);

        let neighborhoodBrightness = 0;
        let neighborhoodCount = 0;
        let occupiedCells = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = cellKey(ix + dx, iy + dy, iz + dz);
                    const cell = localCells.get(key);
                    if (!cell) continue;
                    occupiedCells++;
                    neighborhoodCount += cell.count;
                    neighborhoodBrightness += localBrightnessSums.get(key) ?? 0;
                }
            }
        }

        const localMeanBrightness = neighborhoodCount > 1
            ? (neighborhoodBrightness - brightness) / Math.max(1, neighborhoodCount - 1)
            : brightness;
        const brightnessContrast = Math.max(0, localMeanBrightness - brightness);
        const localMeanCellCount = occupiedCells > 0 ? neighborhoodCount / occupiedCells : 0;
        const localSupportRatio = currentCell && localMeanCellCount > 0 ? currentCell.count / localMeanCellCount : 0;
        const weakSupport = neighborhoodCount <= 3 || occupiedCells <= 2 || localSupportRatio < 0.45;

        contrastValues[i] = brightnessContrast;
        if (weakSupport) {
            weakSupportMask[i] = 255;
        }

        if (brightness <= settings.maxBrightness) {
            let hit = false;
            const actualOpacity = opacity ? sigmoid(opacity[i]) : 1.0;

            if (actualOpacity <= settings.maxOpacity && (brightnessContrast >= darkContrastThreshold || weakSupport)) {
                hit = true;
                reasonMasks.darkAndLowOpacity[i] = 255;
                reasonCounts.darkAndLowOpacity++;
            }

            if (!hit && settings.minScale > 0 && scale0 && scale1 && scale2) {
                const maxScale = Math.max(Math.exp(scale0[i]), Math.exp(scale1[i]), Math.exp(scale2[i]));
                if (maxScale >= settings.minScale && (brightnessContrast >= largeScaleContrastThreshold || (weakSupport && actualOpacity < 0.6))) {
                    hit = true;
                    reasonMasks.darkAndLargeScale[i] = 255;
                    reasonCounts.darkAndLargeScale++;
                }
            }

            if (hit) {
                mask[i] = 255;
            }
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoped black artifact pass ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, 0.15 + (ci / Math.max(1, candidates.length)) * 0.40);
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    const isolated = await computeRadiusIsolationMask(events, n, x, y, z, state, mask, settings.radius, settings.minNeighbors, 0.55, 0.45, limitToSelection, candidates);

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        if (mask[i]) continue;
        const brightness = brightnessValues[i];

        if (brightness <= settings.maxBrightness && isolated[i] && (contrastValues[i] >= largeScaleContrastThreshold || weakSupportMask[i])) {
            mask[i] = 255;
            reasonMasks.darkAndIsolated[i] = 255;
            reasonCounts.darkAndIsolated++;
        }
    }

    let count = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        if (mask[candidates[ci]]) count++;
    }

    return { mask, total: n, count, reasonCounts, reasonMasks };
};


const computePointCloudMask = async (
    events: Events,
    splat: SplatLike,
    settings: PointCloudSettings,
    limitToSelection = false,
    scopeIndices: number[] | null = null
): Promise<FilterResult> => {
    const { n, x, y, z, state } = prepareArrays(splat);
    const candidates = getProcessingIndices(n, state, limitToSelection, scopeIndices);
    const mask = new Uint8Array(n);
    const reasonMasks: Record<string, Uint8Array> = {
        radius: new Uint8Array(n),
        smallCluster: new Uint8Array(n),
        statistical: new Uint8Array(n)
    };
    const reasonCounts: Record<string, number> = {
        radius: 0,
        smallCluster: 0,
        statistical: 0
    };

    const enabledCount =
        (settings.enableRadius ? 1 : 0) +
        (settings.enableCluster ? 1 : 0) +
        (settings.enableStatistical ? 1 : 0);

    let section = 0;
    const nextBase = () => (enabledCount > 0 ? section / enabledCount : 0);
    const nextSpan = () => (enabledCount > 0 ? 1 / enabledCount : 1);

    if (settings.enableFast) {
        const voxelSize = Math.max(1e-6, settings.radius);

        if (settings.enableRadius) {
            const isolated = await computeFastVoxelRadiusMask(events, n, x, y, z, state, voxelSize, settings.minNeighbors, nextBase(), nextSpan(), limitToSelection, candidates);
            for (let ci = 0; ci < candidates.length; ci++) {
                const i = candidates[ci];
                if (isolated[i]) {
                    mask[i] = 255;
                    reasonMasks.radius[i] = 255;
                    reasonCounts.radius++;
                }
            }
            section++;
        }

        if (settings.enableCluster) {
            const smallClusterMask = await computeFastVoxelClusterMask(events, n, x, y, z, state, Math.max(1e-6, settings.clusterRadius), settings.minClusterSize, nextBase(), nextSpan(), limitToSelection, candidates);
            for (let ci = 0; ci < candidates.length; ci++) {
                const i = candidates[ci];
                if (smallClusterMask[i]) {
                    mask[i] = 255;
                    reasonMasks.smallCluster[i] = 255;
                    reasonCounts.smallCluster++;
                }
            }
            section++;
        }

        if (settings.enableStatistical) {
            const statisticalMask = await computeFastVoxelStatisticalMask(events, n, x, y, z, state, voxelSize, settings.stdRatio, nextBase(), nextSpan(), limitToSelection, candidates);
            for (let ci = 0; ci < candidates.length; ci++) {
                const i = candidates[ci];
                if (statisticalMask[i]) {
                    mask[i] = 255;
                    reasonMasks.statistical[i] = 255;
                    reasonCounts.statistical++;
                }
            }
            section++;
        }
    } else {
        if (settings.enableRadius) {
            const zero = new Uint8Array(n);
            const isolated = await computeRadiusIsolationMask(events, n, x, y, z, state, zero, settings.radius, settings.minNeighbors, nextBase(), nextSpan(), limitToSelection, candidates);
            for (let ci = 0; ci < candidates.length; ci++) {
                const i = candidates[ci];
                if (isolated[i]) {
                    mask[i] = 255;
                    reasonMasks.radius[i] = 255;
                    reasonCounts.radius++;
                }
            }
            section++;
        }

        if (settings.enableCluster) {
            const smallClusterMask = await computeSmallClusterMask(events, n, x, y, z, state, settings.clusterRadius, settings.minClusterSize, nextBase(), nextSpan(), limitToSelection, candidates);
            for (let ci = 0; ci < candidates.length; ci++) {
                const i = candidates[ci];
                if (smallClusterMask[i]) {
                    mask[i] = 255;
                    reasonMasks.smallCluster[i] = 255;
                    reasonCounts.smallCluster++;
                }
            }
            section++;
        }

        if (settings.enableStatistical) {
            const statisticalMask = await computeStatisticalOutlierMask(events, n, x, y, z, state, settings.kNeighbors, settings.stdRatio, nextBase(), nextSpan(), limitToSelection, candidates);
            for (let ci = 0; ci < candidates.length; ci++) {
                const i = candidates[ci];
                if (statisticalMask[i]) {
                    mask[i] = 255;
                    reasonMasks.statistical[i] = 255;
                    reasonCounts.statistical++;
                }
            }
            section++;
        }
    }

    let count = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        if (mask[candidates[ci]]) count++;
    }

    return { mask, total: n, count, reasonCounts, reasonMasks };
};

const computeObjectMask = async (
    events: Events,
    splat: SplatLike,
    settings: ObjectSettings
): Promise<FilterResult> => {
    const { n, x, y, z, state, fdc0, fdc1, fdc2 } = prepareArrays(splat);
    const selection = getCurrentSelectionMask(state, n);
    const scopeIndices = settings.limitToSelection ? selection.indices.slice() : null;

    if (settings.limitToSelection && (!scopeIndices || scopeIndices.length === 0)) {
        throw new Error('Scope is set to current selection, but no scoped Gaussians are selected.');
    }

    if (settings.method === 'color' && (!fdc0 || !fdc1 || !fdc2)) {
        throw new Error('Selected splat does not have f_dc_0 / f_dc_1 / f_dc_2 color properties.');
    }

    const radius = Math.max(1e-6, settings.radius);
    const r2 = radius * radius;
    const fastPreview = !!settings.fastPreview;
    const maxPoints = Math.max(1, Math.floor(settings.maxPoints));

    if (settings.limitToSelection && scopeIndices) {
        const { candidates, cells } = await buildVoxelCellsAsync(
            events,
            n,
            x,
            y,
            z,
            state,
            radius,
            0,
            0.2,
            'Building selection segments',
            true,
            scopeIndices
        );

        const visited = new Uint8Array(n);
        const pointProgressStep = Math.max(256, Math.floor(Math.max(1, candidates.length) / 100));
        const yieldStep = fastPreview ? 1024 : 2048;
        const segments: number[][] = [];
        let processed = 0;
        let truncated = false;

        for (let ci = 0; ci < candidates.length; ci++) {
            const seed = candidates[ci];
            if (visited[seed]) {
                continue;
            }

            const queue: number[] = [seed];
            const members: number[] = [];
            visited[seed] = 255;

            while (queue.length > 0) {
                const i = queue.pop()!;
                members.push(i);
                processed++;

                if (fastPreview && processed >= maxPoints) {
                    truncated = true;
                    break;
                }

                const ix = Math.floor(x[i] / radius);
                const iy = Math.floor(y[i] / radius);
                const iz = Math.floor(z[i] / radius);

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            const neighborKey = cellKey(ix + dx, iy + dy, iz + dz);
                            const cell = cells.get(neighborKey);
                            if (!cell) continue;
                            if (pointMinDistanceSquaredToCell(x[i], y[i], z[i], cell, radius) > r2) continue;

                            for (let a = 0; a < cell.indices.length; a++) {
                                const k = cell.indices[a];
                                if (visited[k]) continue;

                                const ddx = x[i] - x[k];
                                const ddy = y[i] - y[k];
                                const ddz = z[i] - z[k];
                                if (ddx * ddx + ddy * ddy + ddz * ddz > r2) {
                                    continue;
                                }

                                if (settings.method === 'color' && fdc0 && fdc1 && fdc2) {
                                    const dr = decodeColorChannel(fdc0[k]) - decodeColorChannel(fdc0[i]);
                                    const dg = decodeColorChannel(fdc1[k]) - decodeColorChannel(fdc1[i]);
                                    const db = decodeColorChannel(fdc2[k]) - decodeColorChannel(fdc2[i]);
                                    const dist2 = (dr * dr + dg * dg + db * db) / 3;
                                    if (dist2 > settings.colorThreshold * settings.colorThreshold) {
                                        continue;
                                    }
                                }

                                visited[k] = 255;
                                queue.push(k);
                            }
                        }
                    }
                }

                if (processed % pointProgressStep === 0) {
                    updateProgress(events, `Segmenting selection ${processed.toLocaleString()} / ${candidates.length.toLocaleString()}`, 0.2 + (processed / Math.max(1, candidates.length)) * 0.8);
                }

                if (processed % yieldStep === 0) {
                    await yieldToBrowser();
                }
            }

            if (members.length > 0) {
                segments.push(members);
            }

            if (truncated) {
                break;
            }
        }

        segments.sort((a, b) => b.length - a.length);

        const mask = new Uint8Array(n);
        const reasonCounts: Record<string, number> = {};
        const reasonMasks: Record<string, Uint8Array> = {};

        for (let si = 0; si < segments.length; si++) {
            const members = segments[si];
            const key = `segment:${si + 1}`;
            const segmentMask = new Uint8Array(n);

            for (let mi = 0; mi < members.length; mi++) {
                const idx = members[mi];
                mask[idx] = 255;
                segmentMask[idx] = 255;
            }

            reasonCounts[key] = members.length;
            reasonMasks[key] = segmentMask;
        }

        if (truncated) {
            reasonCounts.truncated = countMaskBits(mask);
            reasonMasks.truncated = mask.slice();
        }

        return {
            mask,
            total: n,
            count: countMaskBits(mask),
            reasonCounts,
            reasonMasks
        };
    }

    const seedSelection = settings.seedMode === 'single' ? selection.indices.slice(0, 1) : selection.indices.slice();

    if (seedSelection.length === 0) {
        throw new Error('Please select one or more seed Gaussians first, then run Object Preview.');
    }

    const { candidates, cells } = await buildVoxelCellsAsync(
        events,
        n,
        x,
        y,
        z,
        state,
        radius,
        0,
        0.18,
        'Building object grid',
        settings.limitToSelection,
        scopeIndices
    );

    const valid = new Uint8Array(n);
    const out = new Uint8Array(n);
    const pointVisited = new Uint8Array(n);
    const reachableCells = new Set<string>();
    const visitedCells = new Set<string>();
    const connectionCache = new Map<string, boolean>();
    const seedCellQueue: string[] = [];
    const cellProgressStep = Math.max(64, Math.floor(Math.max(1, cells.size) / 100));
    const pointProgressStep = Math.max(256, Math.floor(Math.max(1, candidates.length) / 100));
    const yieldStep = fastPreview ? 1024 : 2048;
    const maxReachableCells = fastPreview ? Math.max(512, Math.ceil(maxPoints / 8)) : Number.POSITIVE_INFINITY;

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        valid[i] = 255;
    }

    const seeds = Array.from(new Set(seedSelection.filter((i) => valid[i])));
    if (seeds.length === 0) {
        throw new Error('Current seed selection has no valid unlocked points left to grow from.');
    }

    for (let si = 0; si < seeds.length; si++) {
        const seed = seeds[si];
        const key = cellKey(
            Math.floor(x[seed] / radius),
            Math.floor(y[seed] / radius),
            Math.floor(z[seed] / radius)
        );

        if (!visitedCells.has(key) && cells.has(key)) {
            visitedCells.add(key);
            seedCellQueue.push(key);
        }
    }

    let processedCells = 0;
    while (seedCellQueue.length > 0) {
        const key = seedCellQueue.pop()!;
        const cell = cells.get(key);
        if (!cell) {
            continue;
        }

        reachableCells.add(key);
        processedCells++;

        if (processedCells >= maxReachableCells) {
            break;
        }

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    const neighborKey = cellKey(cell.ix + dx, cell.iy + dy, cell.iz + dz);
                    if (visitedCells.has(neighborKey)) continue;

                    const neighbor = cells.get(neighborKey);
                    if (!neighbor) continue;
                    if (!cellsHavePointPairWithinRadius(key, cell, neighborKey, neighbor, x, y, z, radius, r2, connectionCache)) continue;

                    visitedCells.add(neighborKey);
                    seedCellQueue.push(neighborKey);
                }
            }
        }

        if (processedCells % cellProgressStep === 0) {
            updateProgress(events, `Tracing object cells ${processedCells.toLocaleString()} / ${Math.max(1, cells.size).toLocaleString()}`, 0.18 + (processedCells / Math.max(1, cells.size)) * 0.17);
        }

        if (processedCells % yieldStep === 0) {
            await yieldToBrowser();
        }
    }

    if (reachableCells.size === 0) {
        throw new Error('Could not trace a connected object from the clicked seed.');
    }

    const queue: Array<{ index: number; seed: number }> = [];
    const seedColors = new Map<number, { r: number; g: number; b: number }>();

    for (let si = 0; si < seeds.length; si++) {
        const seed = seeds[si];
        pointVisited[seed] = 255;
        queue.push({ index: seed, seed });

        if (settings.method === 'color' && fdc0 && fdc1 && fdc2) {
            seedColors.set(seed, {
                r: decodeColorChannel(fdc0[seed]),
                g: decodeColorChannel(fdc1[seed]),
                b: decodeColorChannel(fdc2[seed])
            });
        }
    }

    const colorThreshold2 = settings.colorThreshold * settings.colorThreshold;
    let processed = 0;
    let truncated = false;

    while (queue.length > 0) {
        const current = queue.pop()!;
        const i = current.index;
        out[i] = 255;
        processed++;

        if (processed >= maxPoints) {
            truncated = true;
            break;
        }

        const ix = Math.floor(x[i] / radius);
        const iy = Math.floor(y[i] / radius);
        const iz = Math.floor(z[i] / radius);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const neighborKey = cellKey(ix + dx, iy + dy, iz + dz);
                    if (!reachableCells.has(neighborKey)) continue;

                    const cell = cells.get(neighborKey);
                    if (!cell) continue;
                    if (pointMinDistanceSquaredToCell(x[i], y[i], z[i], cell, radius) > r2) continue;

                    for (let a = 0; a < cell.indices.length; a++) {
                        const k = cell.indices[a];
                        if (pointVisited[k]) continue;

                        const ddx = x[i] - x[k];
                        const ddy = y[i] - y[k];
                        const ddz = z[i] - z[k];
                        if (ddx * ddx + ddy * ddy + ddz * ddz > r2) {
                            continue;
                        }

                        if (settings.method === 'color' && fdc0 && fdc1 && fdc2) {
                            const seedColor = seedColors.get(current.seed);
                            if (!seedColor) continue;
                            const dr = decodeColorChannel(fdc0[k]) - seedColor.r;
                            const dg = decodeColorChannel(fdc1[k]) - seedColor.g;
                            const db = decodeColorChannel(fdc2[k]) - seedColor.b;
                            const dist2 = (dr * dr + dg * dg + db * db) / 3;
                            if (dist2 > colorThreshold2) {
                                continue;
                            }
                        }

                        pointVisited[k] = 255;
                        queue.push({ index: k, seed: current.seed });
                    }
                }
            }
        }

        if (processed % pointProgressStep === 0) {
            updateProgress(events, `Growing object ${processed.toLocaleString()} / ${candidates.length.toLocaleString()}`, 0.35 + (processed / Math.max(1, candidates.length)) * 0.65);
        }

        if (processed % yieldStep === 0) {
            await yieldToBrowser();
        }
    }

    const count = countMaskBits(out);
    const reasonKey = settings.method === 'color' ? 'colorObject' : 'object';
    const reasonCounts: Record<string, number> = { [reasonKey]: count };
    const reasonMasks: Record<string, Uint8Array> = { [reasonKey]: out.slice() };

    if (truncated) {
        reasonCounts.truncated = count;
        reasonMasks.truncated = out.slice();
    }

    return {
        mask: out,
        total: n,
        count,
        reasonCounts,
        reasonMasks
    };
};

const computeAdvancedPlaneMask = async (
    events: Events,
    splat: SplatLike,
    settings: AdvancedSettings,
    savedPlane: PlaneModel | null
): Promise<{
    result: FilterResult;
    nextSavedPlane: PlaneModel | null;
    previewNote: string;
}> => {
    const { n, x, y, z, state } = preparePlaneArrays(splat);

    if (settings.planeAction === 'outside') {
        if (!savedPlane) {
            throw new Error('No saved plane. Run Set + Select first, then Preview Outside.');
        }

        const candidates = collectPlaneCandidateIndices(n, state, settings.filterScope);
        if (candidates.length === 0) {
            throw new Error('No candidate points. Select a region first or switch Filter scope to Whole splat.');
        }

        const { mask, count } = await buildPlaneOutsideMask(
            events,
            n,
            x,
            y,
            z,
            state,
            candidates,
            savedPlane,
            settings.outsideDistance,
            settings.filterSide,
            0,
            1,
            'Plane outside'
        );

        return {
            result: {
                mask,
                total: n,
                count,
                reasonCounts: { planeOutside: count },
                reasonMasks: { planeOutside: mask.slice() }
            },
            nextSavedPlane: savedPlane,
            previewNote: `outside distance: ${settings.outsideDistance} | side: ${settings.filterSide} | scope: ${settings.filterScope}`
        };
    }

    const selected = collectSelectedValidIndices(n, state);
    if (selected.length < 3) {
        throw new Error('Please roughly select an area containing the target plane first.');
    }

    const plane = await fitRobustPlaneFromIndices(
        events,
        x,
        y,
        z,
        selected,
        settings.planeFitThreshold
    );

    const { mask, count } = await buildPlaneInlierMask(
        events,
        n,
        x,
        y,
        z,
        state,
        selected,
        plane,
        settings.planeFitThreshold,
        0.75,
        0.25,
        'Selecting plane inliers'
    );

    return {
        result: {
            mask,
            total: n,
            count,
            reasonCounts: { planeInlier: count },
            reasonMasks: { planeInlier: mask.slice() }
        },
        nextSavedPlane: settings.planeAction === 'set' ? plane : savedPlane,
        previewNote:
            `inliers: ${plane.inlierCount.toLocaleString()} / ${selected.length.toLocaleString()} | ` +
            `normal: ${plane.nx.toFixed(3)}, ${plane.ny.toFixed(3)}, ${plane.nz.toFixed(3)}`,
    };
};


class FilterPanel extends Container {
    private events: Events;
    private mode: FilterMode = 'outlier';
    private rowsDom: HTMLDivElement;
    private statsDom: HTMLDivElement;
    private reasonButtonsRow: HTMLDivElement;
    private titleDom: HTMLSpanElement;
    private outlierTab: HTMLSpanElement;
    private skyTab: HTMLSpanElement;
    private blackTab: HTMLSpanElement;
    private pointTab: HTMLSpanElement;
    private objectTab: HTMLSpanElement;
    private advancedTab: HTMLSpanElement;
    private lastPreviewCount = 0;
    private lastPreviewKind = '';
    private lastPreviewBaseKind = '';
    private lastPreviewSummary = 'No preview yet.';
    private lastPreviewAllMask: Uint8Array | null = null;
    private lastPreviewReasonMasks: Record<string, Uint8Array> = {};
    private limitToSelectionInput!: HTMLInputElement;
    private objectPickButton: HTMLSpanElement | null = null;
    private previewButton: HTMLSpanElement;
    private objectPickingActive = false;
    private objectPickPointerId: number | null = null;
    private objectPickStartX = 0;
    private objectPickStartY = 0;
    private objectPickDragged = false;

    private outlierInputs!: {
        minOpacity: HTMLInputElement;
        maxScale: HTMLInputElement;
        radius: HTMLInputElement;
        minNeighbors: HTMLInputElement;
    };

    private blackInputs!: {
        maxBrightness: HTMLInputElement;
        maxOpacity: HTMLInputElement;
        minScale: HTMLInputElement;
        radius: HTMLInputElement;
        minNeighbors: HTMLInputElement;
    };

    private skyInputs!: {
        upAxis: HTMLSelectElement;
        topPercent: HTMLInputElement;
        minBrightness: HTMLInputElement;
        maxWhiteSaturation: HTMLInputElement;
        minBlueBias: HTMLInputElement;
        maxOpacity: HTMLInputElement;
        minScale: HTMLInputElement;
        protectStructures: HTMLInputElement;
        keepTopConnected: HTMLInputElement;
        preferDiscreteSky: HTMLInputElement;
    };

    private pointInputs!: {
        enableFast: HTMLInputElement;
        enableRadius: HTMLInputElement;
        radius: HTMLInputElement;
        minNeighbors: HTMLInputElement;
        enableCluster: HTMLInputElement;
        clusterRadius: HTMLInputElement;
        minClusterSize: HTMLInputElement;
        enableStatistical: HTMLInputElement;
        kNeighbors: HTMLInputElement;
        stdRatio: HTMLInputElement;
    };

    private objectInputs!: {
        method: HTMLSelectElement;
        seedMode: HTMLSelectElement;
        radius: HTMLInputElement;
        colorThreshold: HTMLInputElement;
        limitToSelection: HTMLInputElement;
        fastPreview: HTMLInputElement;
        maxPoints: HTMLInputElement;
    };

    private advancedInputs!: {
        tool: HTMLSelectElement;
        planeAction: HTMLSelectElement;
        planeFitThreshold: HTMLInputElement;
        outsideDistance: HTMLInputElement;
        filterScope: HTMLSelectElement;
        filterSide: HTMLSelectElement;
    };

    private savedPlane: PlaneModel | null = null;

    constructor(events: Events, _tooltips?: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'filter-panel',
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

        this.titleDom = document.createElement('span');
        this.titleDom.className = 'panel-header-label';
        this.titleDom.textContent = 'FILTERS';

        const close = document.createElement('span');
        close.className = 'panel-header-button';
        close.textContent = '\uE132';
        close.title = 'Close';
        close.addEventListener('click', () => {
            this.setObjectPickingActive(false);
            this.hidden = true;
        });

        header.appendChild(icon);
        header.appendChild(this.titleDom);
        header.appendChild(close);

        const tabs = document.createElement('div');
        tabs.className = 'filter-panel-tabs';

        this.outlierTab = document.createElement('span');
        this.outlierTab.className = 'filter-panel-tab active';
        this.outlierTab.textContent = 'Outlier';

        this.skyTab = document.createElement('span');
        this.skyTab.className = 'filter-panel-tab';
        this.skyTab.textContent = 'Sky';

        this.blackTab = document.createElement('span');
        this.blackTab.className = 'filter-panel-tab';
        this.blackTab.textContent = 'Black';

        this.pointTab = document.createElement('span');
        this.pointTab.className = 'filter-panel-tab';
        this.pointTab.textContent = 'Point';

        this.objectTab = document.createElement('span');
        this.objectTab.className = 'filter-panel-tab';
        this.objectTab.textContent = 'Object';

        this.advancedTab = document.createElement('span');
        this.advancedTab.className = 'filter-panel-tab';
        this.advancedTab.textContent = 'Advanced';

        this.outlierTab.addEventListener('click', () => this.setMode('outlier'));
        this.skyTab.addEventListener('click', () => this.setMode('sky'));
        this.blackTab.addEventListener('click', () => this.setMode('blackArtifact'));
        this.pointTab.addEventListener('click', () => this.setMode('pointCloud'));
        this.objectTab.addEventListener('click', () => this.setMode('object'));
        this.advancedTab.addEventListener('click', () => this.setMode('advanced'));

        tabs.appendChild(this.outlierTab);
        tabs.appendChild(this.skyTab);
        tabs.appendChild(this.blackTab);
        tabs.appendChild(this.pointTab);
        tabs.appendChild(this.objectTab);
        tabs.appendChild(this.advancedTab);

        this.rowsDom = document.createElement('div');
        this.rowsDom.className = 'filter-panel-rows';

        this.statsDom = document.createElement('div');
        this.statsDom.className = 'filter-panel-stats';
        this.statsDom.textContent = 'No preview yet.';

        this.reasonButtonsRow = document.createElement('div');
        this.reasonButtonsRow.className = 'filter-panel-reason-row hidden';

        const controlRow = document.createElement('div');
        controlRow.className = 'filter-panel-control-row';

        const clearButton = this.makeButton('Clear');
        clearButton.addEventListener('click', () => {
            this.events.fire('select.none');
            this.clearReasonPreview();
            this.statsDom.textContent = 'Selection cleared.';
        });

        const deleteButton = this.makeButton('Delete', 'danger');
        deleteButton.addEventListener('click', () => { void this.deletePreviewed(); });

        this.previewButton = this.makeButton('Preview', 'primary');
        this.previewButton.addEventListener('click', () => { void this.preview(); });

        controlRow.appendChild(clearButton);
        controlRow.appendChild(deleteButton);
        controlRow.appendChild(this.previewButton);

        this.dom.appendChild(header);
        this.dom.appendChild(tabs);
        this.dom.appendChild(this.rowsDom);
        this.dom.appendChild(this.statsDom);
        this.dom.appendChild(this.reasonButtonsRow);
        this.dom.appendChild(controlRow);

        events.on('outlier.preview', () => {
            this.setMode('outlier');
            this.hidden = false;
        });

        events.on('outlier.previewBlack', () => {
            this.setMode('blackArtifact');
            this.hidden = false;
        });

        events.on('outlier.deletePreview', () => {
            void this.deletePreviewed();
        });

        events.on('filter.toggle', () => {
            this.hidden = !this.hidden;
            if (!this.hidden) {
                this.setMode(this.mode);
            } else {
                this.setObjectPickingActive(false);
            }
        });

        events.on('filter.show', () => {
            this.hidden = false;
            if (this.mode === 'object') {
                this.setMode(this.mode);
            }
        });

        events.on('filter.hide', () => {
            this.setObjectPickingActive(false);
            this.hidden = true;
        });

        events.on('plane.toggle', () => {
            this.hidden = !this.hidden;
            if (!this.hidden) {
                this.setMode('advanced');
            } else {
                this.setObjectPickingActive(false);
            }
        });

        events.on('plane.show', () => {
            this.hidden = false;
            this.setMode('advanced');
        });

        events.on('plane.hide', () => {
            if (this.mode === 'advanced') {
                this.hidden = true;
            }
        });

        this.setMode('outlier');
    }

    private makeButton(text: string, kind = '') {
        const button = document.createElement('span');
        button.className = kind ? `filter-panel-button ${kind}` : 'filter-panel-button';
        button.textContent = text;
        return button;
    }

    private makeInputRow(label: string, value: string, help: string) {
        const row = document.createElement('div');
        row.className = 'filter-panel-row';
        row.title = help;

        const labelEl = document.createElement('span');
        labelEl.className = 'filter-panel-row-label';
        labelEl.textContent = label;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = value;
        input.className = 'filter-panel-input';

        row.appendChild(labelEl);
        row.appendChild(input);

        this.rowsDom.appendChild(row);
        return input;
    }

    private makeCheckboxRow(label: string, checked: boolean, help: string) {
        const row = document.createElement('div');
        row.className = 'filter-panel-row';
        row.title = help;

        const labelEl = document.createElement('span');
        labelEl.className = 'filter-panel-row-label';
        labelEl.textContent = label;

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.className = 'filter-panel-checkbox';

        row.appendChild(labelEl);
        row.appendChild(input);

        this.rowsDom.appendChild(row);
        return input;
    }

    private makeSelectRow(label: string, value: string, options: { value: string; text: string }[], help: string) {
        const row = document.createElement('div');
        row.className = 'filter-panel-row';
        row.title = help;

        const labelEl = document.createElement('span');
        labelEl.className = 'filter-panel-row-label';
        labelEl.textContent = label;

        const input = document.createElement('select');
        input.className = 'filter-panel-input';

        options.forEach((optionInfo) => {
            const option = document.createElement('option');
            option.value = optionInfo.value;
            option.textContent = optionInfo.text;
            input.appendChild(option);
        });
        input.value = value;

        row.appendChild(labelEl);
        row.appendChild(input);

        this.rowsDom.appendChild(row);
        return input;
    }

    private updateObjectPickButton() {
        if (!this.objectPickButton) return;

        const scopeMode = !!this.objectInputs?.limitToSelection?.checked;
        if (scopeMode) {
            this.objectPickButton.textContent = 'Use Preview';
            this.objectPickButton.className = 'filter-panel-button';
            this.objectPickButton.title = 'Scope to selection is on. The current selection is used directly as seeds, so viewport picking is not needed.';
            return;
        }

        this.objectPickButton.textContent = this.objectPickingActive ? 'Picking On' : 'Picking Off';
        this.objectPickButton.className = this.objectPickingActive ? 'filter-panel-button primary' : 'filter-panel-button';
        this.objectPickButton.title = this.objectPickingActive
            ? 'Click the main viewport to pick a seed and preview the object. Click again to pause picking.'
            : 'Enable interactive object picking in the main viewport.';
    }

    private getObjectPickSurface() {
        const canvasContainer = document.getElementById('canvas-container');
        const canvas = document.getElementById('canvas');
        const toolsContainer = document.getElementById('tools-container');
        return {
            canvasContainer,
            canvas,
            toolsContainer
        };
    }

    private isObjectPickTarget(target: EventTarget | null) {
        if (!(target instanceof Node)) {
            return false;
        }

        const { canvas, toolsContainer } = this.getObjectPickSurface();
        return target === canvas || !!toolsContainer?.contains(target);
    }

    private resetObjectPickPointer() {
        const { canvasContainer } = this.getObjectPickSurface();
        if (this.objectPickPointerId !== null) {
            try {
                canvasContainer?.releasePointerCapture(this.objectPickPointerId);
            } catch {
                // ignore missing capture
            }
            this.objectPickPointerId = null;
        }
        this.objectPickDragged = false;
    }

    private readonly handleObjectPickPointerDown = (event: PointerEvent) => {
        if (!this.objectPickingActive || this.mode !== 'object' || this.objectInputs?.limitToSelection?.checked) {
            return;
        }
        if (this.objectPickPointerId !== null) {
            return;
        }
        if (!(event.pointerType === 'mouse' ? event.button === 0 : event.isPrimary)) {
            return;
        }
        if (!this.isObjectPickTarget(event.target)) {
            return;
        }

        const { canvasContainer } = this.getObjectPickSurface();
        if (!canvasContainer) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.objectPickPointerId = event.pointerId;
        this.objectPickStartX = event.clientX;
        this.objectPickStartY = event.clientY;
        this.objectPickDragged = false;
        canvasContainer.setPointerCapture(event.pointerId);
    };

    private readonly handleObjectPickPointerMove = (event: PointerEvent) => {
        if (event.pointerId !== this.objectPickPointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const dx = event.clientX - this.objectPickStartX;
        const dy = event.clientY - this.objectPickStartY;
        if (dx * dx + dy * dy > 16) {
            this.objectPickDragged = true;
        }
    };

    private readonly handleObjectPickPointerCancel = (event: PointerEvent) => {
        if (event.pointerId !== this.objectPickPointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.resetObjectPickPointer();
    };

    private readonly handleObjectPickPointerUp = async (event: PointerEvent) => {
        if (event.pointerId !== this.objectPickPointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const { canvasContainer } = this.getObjectPickSurface();
        const wasDrag = this.objectPickDragged;
        this.resetObjectPickPointer();

        if (wasDrag || !canvasContainer) {
            return;
        }

        const rect = canvasContainer.getBoundingClientRect();
        const width = Math.max(1, rect.width || canvasContainer.clientWidth || 1);
        const height = Math.max(1, rect.height || canvasContainer.clientHeight || 1);
        const point = {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / height))
        };

        const settings = this.getObjectSettings();
        const op =
            settings.seedMode === 'all' &&
            this.lastPreviewBaseKind === 'object' &&
            this.lastPreviewCount > 0
                ? 'add'
                : 'set';

        const picked = await this.events.invoke('select.singlePoint', op, point) as boolean | undefined;
        if (!picked) {
            this.statsDom.textContent = 'Object mode: no Gaussian under cursor. Click a visible object in the main viewport.';
            return;
        }
        await this.preview();
    };

    private setObjectPickingActive(active: boolean) {
        if (this.objectPickingActive === active) {
            this.updateObjectPickButton();
            return;
        }

        const { canvasContainer } = this.getObjectPickSurface();
        this.objectPickingActive = active;

        if (canvasContainer) {
            if (active) {
                canvasContainer.addEventListener('pointerdown', this.handleObjectPickPointerDown, true);
                canvasContainer.addEventListener('pointermove', this.handleObjectPickPointerMove, true);
                canvasContainer.addEventListener('pointerup', this.handleObjectPickPointerUp, true);
                canvasContainer.addEventListener('pointercancel', this.handleObjectPickPointerCancel, true);
            } else {
                canvasContainer.removeEventListener('pointerdown', this.handleObjectPickPointerDown, true);
                canvasContainer.removeEventListener('pointermove', this.handleObjectPickPointerMove, true);
                canvasContainer.removeEventListener('pointerup', this.handleObjectPickPointerUp, true);
                canvasContainer.removeEventListener('pointercancel', this.handleObjectPickPointerCancel, true);
            }
        }

        if (!active) {
            this.resetObjectPickPointer();
        }

        this.updateObjectPickButton();
    }

    private makePresetRow(presets: FilterPresetAction[]) {
        const row = document.createElement('div');
        row.className = 'filter-panel-row filter-panel-preset-row';
        row.title = 'Quick starting points for common cleanup scenarios.';

        const labelEl = document.createElement('span');
        labelEl.className = 'filter-panel-row-label';
        labelEl.textContent = 'Presets';

        const buttons = document.createElement('div');
        buttons.className = 'filter-panel-preset-buttons';

        presets.forEach((preset) => {
            const button = document.createElement('span');
            button.className = 'filter-panel-preset-button';
            button.textContent = preset.label;
            button.title = preset.title;
            button.addEventListener('click', preset.apply);
            buttons.appendChild(button);
        });

        row.appendChild(labelEl);
        row.appendChild(buttons);
        this.rowsDom.appendChild(row);
    }

    private makeScopeRow() {
        const scopeSettings = loadJson<{ limitToSelection: boolean }>('supersplat.filter.scope', { limitToSelection: false });
        this.limitToSelectionInput = this.makeCheckboxRow(
            'Limit to current selection',
            scopeSettings.limitToSelection,
            'Only evaluate outliers inside the Gaussians currently selected by SuperSplat tools.'
        );

        this.limitToSelectionInput.addEventListener('change', () => {
            saveJson('supersplat.filter.scope', { limitToSelection: this.limitToSelectionInput.checked });
        });
    }

    private getLimitToSelection() {
        const value = !!this.limitToSelectionInput?.checked;
        saveJson('supersplat.filter.scope', { limitToSelection: value });
        return value;
    }

    private updatePreviewButtonLabel() {
        if (!this.previewButton) return;

        if (this.mode !== 'advanced') {
            this.previewButton.textContent = 'Preview';
            return;
        }

        const action = this.advancedInputs?.planeAction?.value ?? DEFAULT_ADVANCED_SETTINGS.planeAction;
        this.previewButton.textContent =
            action === 'set'
                ? 'Set + Select'
                : action === 'outside'
                    ? 'Preview Outside'
                    : 'Select Plane';
    }

    private getReasonDisplayInfo(reasonKey: string): ReasonDisplayInfo {
        const modeInfo = REASON_DISPLAY[this.lastPreviewBaseKind as FilterMode] ?? {};
        if (reasonKey.startsWith('segment:')) {
            const index = Number(reasonKey.split(':')[1] ?? '0');
            return {
                label: Number.isFinite(index) && index > 0 ? `Segment ${index}` : reasonKey,
                className: 'reason-cluster',
                order: 10 + index
            };
        }
        return modeInfo[reasonKey] ?? {
            label: reasonKey,
            className: 'reason-generic',
            order: 50
        };
    }

    private clearReasonPreview() {
        this.lastPreviewAllMask = null;
        this.lastPreviewReasonMasks = {};
        this.lastPreviewBaseKind = '';
        this.reasonButtonsRow.innerHTML = '';
        this.reasonButtonsRow.classList.add('hidden');
    }

    private applyReasonPreview(reasonKey: string | null, label: string) {
        const mask = reasonKey ? this.lastPreviewReasonMasks[reasonKey] : this.lastPreviewAllMask;
        if (!mask) {
            return;
        }

        this.events.fire('select.mask', 'set', mask);
        this.lastPreviewCount = countMaskBits(mask);
        this.lastPreviewKind = reasonKey ? `${this.lastPreviewBaseKind}:${reasonKey}` : this.lastPreviewBaseKind;
        this.statsDom.textContent = `${this.lastPreviewSummary} | focus: ${label} (${this.lastPreviewCount.toLocaleString()})`;

        Array.from(this.reasonButtonsRow.children).forEach((child) => {
            child.classList.toggle('active', child.getAttribute('data-reason-key') === (reasonKey ?? '__all__'));
        });
    }

    private refreshReasonButtons() {
        this.reasonButtonsRow.innerHTML = '';

        if (!this.lastPreviewAllMask) {
            this.reasonButtonsRow.classList.add('hidden');
            return;
        }

        const buttons: Array<{ key: string | null; label: string; count: number }> = [
            { key: null, label: 'All', count: countMaskBits(this.lastPreviewAllMask) }
        ];

        Object.entries(this.lastPreviewReasonMasks)
            .sort(([a], [b]) => this.getReasonDisplayInfo(a).order - this.getReasonDisplayInfo(b).order)
            .forEach(([key, mask]) => {
            const count = countMaskBits(mask);
            if (count > 0) {
                buttons.push({ key, label: this.getReasonDisplayInfo(key).label, count });
            }
            });

        if (buttons.length <= 1) {
            this.reasonButtonsRow.classList.add('hidden');
            return;
        }

        buttons.forEach((info, index) => {
            const button = document.createElement('span');
            button.className = 'filter-panel-reason-button';
            if (info.key) {
                button.classList.add(this.getReasonDisplayInfo(info.key).className);
            }
            button.setAttribute('data-reason-key', info.key ?? '__all__');
            button.textContent = `${info.label} ${info.count.toLocaleString()}`;
            button.title = `Preview only the ${info.label} hits from the last filter result.`;
            if (index === 0) {
                button.classList.add('active');
            }
            button.addEventListener('click', () => this.applyReasonPreview(info.key, info.label));
            this.reasonButtonsRow.appendChild(button);
        });

        this.reasonButtonsRow.classList.remove('hidden');
    }

    private applyOutlierPreset(kind: 'safe' | 'outdoor' | 'sky' | 'aggressive') {
        if (!this.outlierInputs) return;

        if (kind === 'safe') {
            this.outlierInputs.minOpacity.value = '0.003';
            this.outlierInputs.maxScale.value = '0';
            this.outlierInputs.radius.value = '0';
            this.outlierInputs.minNeighbors.value = '0';
            this.statsDom.textContent = 'Outlier preset: Safe. Start with opacity only and add radius later if needed.';
        } else if (kind === 'outdoor') {
            this.outlierInputs.minOpacity.value = '0.0045';
            this.outlierInputs.maxScale.value = '0';
            this.outlierInputs.radius.value = '1.8';
            this.outlierInputs.minNeighbors.value = '1';
            this.statsDom.textContent = 'Outlier preset: Outdoor. Balanced low-opacity and light isolation cleanup.';
        } else if (kind === 'sky') {
            this.outlierInputs.minOpacity.value = '0.009';
            this.outlierInputs.maxScale.value = '1.2';
            this.outlierInputs.radius.value = '0.8';
            this.outlierInputs.minNeighbors.value = '1';
            this.statsDom.textContent = 'Outlier preset: Sky. Tuned for bright sky haze and floating white fog. Best used with Limit to current selection.';
        } else {
            this.outlierInputs.minOpacity.value = '0.006';
            this.outlierInputs.maxScale.value = '0';
            this.outlierInputs.radius.value = '2.2';
            this.outlierInputs.minNeighbors.value = '2';
            this.statsDom.textContent = 'Outlier preset: Aggressive. Pushes harder on sparse low-opacity floaters.';
        }

        saveJson('supersplat.outlierFilter.settings', this.getOutlierSettings());
    }

    private applyBlackPreset(kind: 'dots' | 'fog' | 'safe') {
        if (!this.blackInputs) return;

        if (kind === 'dots') {
            this.blackInputs.maxBrightness.value = '0.04';
            this.blackInputs.maxOpacity.value = '0.22';
            this.blackInputs.minScale.value = '0';
            this.blackInputs.radius.value = '1.6';
            this.blackInputs.minNeighbors.value = '1';
            this.statsDom.textContent = 'Black preset: Dots. Tuned for sparse black floaters and pepper noise.';
        } else if (kind === 'fog') {
            this.blackInputs.maxBrightness.value = '0.05';
            this.blackInputs.maxOpacity.value = '0.8';
            this.blackInputs.minScale.value = '1.0';
            this.blackInputs.radius.value = '2.2';
            this.blackInputs.minNeighbors.value = '2';
            this.statsDom.textContent = 'Black preset: Fog. Better for dark blobs or hazy black Gaussian clouds.';
        } else {
            this.blackInputs.maxBrightness.value = '0.03';
            this.blackInputs.maxOpacity.value = '0.16';
            this.blackInputs.minScale.value = '0';
            this.blackInputs.radius.value = '0';
            this.blackInputs.minNeighbors.value = '0';
            this.statsDom.textContent = 'Black preset: Safe. Minimal dark-point cleanup with low risk to real dark surfaces.';
        }

        saveJson('supersplat.blackArtifactFilter.settings', this.getBlackSettings());
    }

    private applySkyPreset(kind: 'balanced' | 'blue' | 'haze') {
        if (!this.skyInputs) return;

        if (kind === 'blue') {
            this.skyInputs.topPercent.value = '16';
            this.skyInputs.minBrightness.value = '0.50';
            this.skyInputs.maxWhiteSaturation.value = '0.40';
            this.skyInputs.minBlueBias.value = '0.09';
            this.skyInputs.maxOpacity.value = '0.55';
            this.skyInputs.minScale.value = '0.40';
            this.skyInputs.protectStructures.checked = false;
            this.skyInputs.keepTopConnected.checked = false;
            this.skyInputs.preferDiscreteSky.checked = false;
            this.statsDom.textContent = 'Sky preset: Blue. Better for clean blue sky and horizon spill.';
        } else if (kind === 'haze') {
            this.skyInputs.topPercent.value = '24';
            this.skyInputs.minBrightness.value = '0.62';
            this.skyInputs.maxWhiteSaturation.value = '0.28';
            this.skyInputs.minBlueBias.value = '0.02';
            this.skyInputs.maxOpacity.value = '0.32';
            this.skyInputs.minScale.value = '0.95';
            this.skyInputs.protectStructures.checked = false;
            this.skyInputs.keepTopConnected.checked = false;
            this.skyInputs.preferDiscreteSky.checked = false;
            this.statsDom.textContent = 'Sky preset: Haze. Better for bright white fog, mist, and blown-out sky splats.';
        } else {
            this.skyInputs.topPercent.value = '15';
            this.skyInputs.minBrightness.value = '0.66';
            this.skyInputs.maxWhiteSaturation.value = '0.20';
            this.skyInputs.minBlueBias.value = '0.08';
            this.skyInputs.maxOpacity.value = '0.32';
            this.skyInputs.minScale.value = '1.00';
            this.skyInputs.protectStructures.checked = false;
            this.skyInputs.keepTopConnected.checked = false;
            this.skyInputs.preferDiscreteSky.checked = false;
            this.statsDom.textContent = 'Sky preset: Balanced. More biased toward real sky and less willing to keep plain white surfaces like road markings, walls, or bright ground.';
        }

        saveJson('supersplat.skyFilter.settings', this.getSkySettings());
    }

    private applyPointPreset(kind: 'outdoor' | 'structure' | 'cleanup') {
        if (!this.pointInputs) return;

        if (kind === 'outdoor') {
            this.pointInputs.enableFast.checked = true;
            this.pointInputs.enableRadius.checked = true;
            this.pointInputs.radius.value = '1.8';
            this.pointInputs.minNeighbors.value = '2';
            this.pointInputs.enableCluster.checked = true;
            this.pointInputs.clusterRadius.value = '1.8';
            this.pointInputs.minClusterSize.value = '48';
            this.pointInputs.enableStatistical.checked = true;
            this.pointInputs.kNeighbors.value = '24';
            this.pointInputs.stdRatio.value = '3.8';
            this.statsDom.textContent = 'Point preset: Outdoor. Good first pass for aerial and street-scale scenes.';
        } else if (kind === 'structure') {
            this.pointInputs.enableFast.checked = true;
            this.pointInputs.enableRadius.checked = true;
            this.pointInputs.radius.value = '1.4';
            this.pointInputs.minNeighbors.value = '1';
            this.pointInputs.enableCluster.checked = false;
            this.pointInputs.clusterRadius.value = '1.5';
            this.pointInputs.minClusterSize.value = '80';
            this.pointInputs.enableStatistical.checked = true;
            this.pointInputs.kNeighbors.value = '20';
            this.pointInputs.stdRatio.value = '4.4';
            this.statsDom.textContent = 'Point preset: Structure. Safer for thin members, edges, and sparse legal geometry.';
        } else {
            this.pointInputs.enableFast.checked = true;
            this.pointInputs.enableRadius.checked = true;
            this.pointInputs.radius.value = '2.0';
            this.pointInputs.minNeighbors.value = '2';
            this.pointInputs.enableCluster.checked = true;
            this.pointInputs.clusterRadius.value = '2.0';
            this.pointInputs.minClusterSize.value = '32';
            this.pointInputs.enableStatistical.checked = true;
            this.pointInputs.kNeighbors.value = '28';
            this.pointInputs.stdRatio.value = '3.2';
            this.statsDom.textContent = 'Point preset: Cleanup. Stronger isolated-noise pass for messy reconstructions.';
        }

        saveJson('supersplat.pointCloudFilter.settings', this.getPointCloudSettings());
    }


    private setMode(mode: FilterMode) {
        if (mode !== 'object') {
            this.setObjectPickingActive(false);
        }

        this.mode = mode;
        this.rowsDom.innerHTML = '';
        this.clearReasonPreview();
        this.objectPickButton = null;
        if (mode !== 'object' && mode !== 'advanced') {
            this.makeScopeRow();
        }

        this.outlierTab.classList.remove('active');
        this.skyTab.classList.remove('active');
        this.blackTab.classList.remove('active');
        this.pointTab.classList.remove('active');
        this.objectTab.classList.remove('active');
        this.advancedTab.classList.remove('active');

        if (mode === 'outlier') {
            this.outlierTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / OUTLIER';
            this.makePresetRow([
                {
                    label: 'Safe',
                    title: 'Light-touch low opacity cleanup.',
                    apply: () => this.applyOutlierPreset('safe')
                },
                {
                    label: 'Outdoor',
                    title: 'Balanced outdoor outlier cleanup.',
                    apply: () => this.applyOutlierPreset('outdoor')
                },
                {
                    label: 'Sky',
                    title: 'Brighter sky haze, floating white fog, and loose sky splats. Best after selecting the sky region first.',
                    apply: () => this.applyOutlierPreset('sky')
                },
                {
                    label: 'Aggro',
                    title: 'Stronger removal of sparse low-opacity floaters.',
                    apply: () => this.applyOutlierPreset('aggressive')
                }
            ]);

            const settings = loadJson<OutlierSettings>('supersplat.outlierFilter.settings', DEFAULT_OUTLIER_SETTINGS);
            this.outlierInputs = {
                minOpacity: this.makeInputRow('Min opacity', String(settings.minOpacity), 'Try 0.003 ~ 0.008. Set 0 to disable.'),
                maxScale: this.makeInputRow('Max scale', String(settings.maxScale), 'Large Gaussian filter. For outdoor, usually keep 0 first.'),
                radius: this.makeInputRow('Radius', String(settings.radius), 'Radius isolation filter. Set 0 to disable.'),
                minNeighbors: this.makeInputRow('Min neighbors', String(settings.minNeighbors), 'Only used when Radius > 0.')
            };

            this.statsDom.textContent = 'Outlier start: Outdoor for general cleanup, Sky for bright sky haze. For sky work, select the sky first and enable Limit to current selection.';
        } else if (mode === 'sky') {
            this.skyTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / SKY';
            this.makePresetRow([
                {
                    label: 'Balanced',
                    title: 'Mixed white haze and blue sky.',
                    apply: () => this.applySkyPreset('balanced')
                },
                {
                    label: 'Blue',
                    title: 'Cleaner blue sky and horizon spill.',
                    apply: () => this.applySkyPreset('blue')
                },
                {
                    label: 'Haze',
                    title: 'Bright white fog, mist, and overexposed sky splats.',
                    apply: () => this.applySkyPreset('haze')
                }
            ]);

            const settings = loadJson<SkySettings>('supersplat.skyFilter.settings', DEFAULT_SKY_SETTINGS);
            this.skyInputs = {
                upAxis: this.makeSelectRow('Up axis', settings.upAxis, [
                    { value: 'y', text: 'Y up' },
                    { value: 'z', text: 'Z up' },
                    { value: 'x', text: 'X up' }
                ], 'Pick the axis that points upward in your scene.'),
                topPercent: this.makeInputRow('Top region %', String(settings.topPercent), 'Only inspect the highest part of the scene. Try 12 ~ 28.'),
                minBrightness: this.makeInputRow('Min brightness', String(settings.minBrightness), 'Higher is safer. Lower catches dim sky spill.'),
                maxWhiteSaturation: this.makeInputRow('White saturation', String(settings.maxWhiteSaturation), 'Lower keeps only whiter sky/fog. Higher accepts more colored clouds.'),
                minBlueBias: this.makeInputRow('Blue bias', String(settings.minBlueBias), 'How much bluer than red/green a point should be to count as blue sky.'),
                maxOpacity: this.makeInputRow('Max opacity', String(settings.maxOpacity), 'Optional haze clue. Lower focuses on translucent sky fog. Use 1 to disable.'),
                minScale: this.makeInputRow('Min scale', String(settings.minScale), 'Optional haze clue. Larger splats often catch blown-out sky fog. Use 0 to disable.'),
                protectStructures: this.makeCheckboxRow('Protect structures', settings.protectStructures, 'Avoid points that look like dense vertical columns or solid roofs/walls even if their color resembles sky.'),
                keepTopConnected: this.makeCheckboxRow('Keep top connected', settings.keepTopConnected, 'Only keep sky hits that remain connected to the top sky band. Useful when bright roofs or walls still get picked.'),
                preferDiscreteSky: this.makeCheckboxRow('Prefer discrete sky', settings.preferDiscreteSky, '3DGS sky often trains as sparse, weakly supported splats. Turn this on to favor those discrete sky hits over solid surfaces.')
            };
            this.statsDom.textContent = 'Sky filter: start from color + top region. Turn on Prefer discrete sky when roofs or walls still look too sky-like in 3DGS captures.';
        } else if (mode === 'blackArtifact') {
            this.blackTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / BLACK';
            this.makePresetRow([
                {
                    label: 'Dots',
                    title: 'Sparse black speckles and floaters.',
                    apply: () => this.applyBlackPreset('dots')
                },
                {
                    label: 'Fog',
                    title: 'Dark blobs and fog-like black artifacts.',
                    apply: () => this.applyBlackPreset('fog')
                },
                {
                    label: 'Safe',
                    title: 'More conservative dark-surface cleanup.',
                    apply: () => this.applyBlackPreset('safe')
                }
            ]);

            const settings = loadJson<BlackArtifactSettings>('supersplat.blackArtifactFilter.settings', DEFAULT_BLACK_SETTINGS);
            this.blackInputs = {
                maxBrightness: this.makeInputRow('Max brightness', String(settings.maxBrightness), 'Try 0.03 ~ 0.06. Lower = safer.'),
                maxOpacity: this.makeInputRow('Max opacity', String(settings.maxOpacity), 'Try 0.15 ~ 0.25 for black floaters. Use 1 to disable.'),
                minScale: this.makeInputRow('Min scale', String(settings.minScale), 'Use 1.0+ for black fog blobs. Use 0 to disable.'),
                radius: this.makeInputRow('Radius', String(settings.radius), 'Optional isolation filter. Use 0 to disable.'),
                minNeighbors: this.makeInputRow('Min neighbors', String(settings.minNeighbors), 'Only used when Radius > 0.')
            };

            this.statsDom.textContent = 'Black dots: bright 0.04, opacity 0.20. Fog: bright 0.05, opacity 1, scale 1.';
        } else if (mode === 'object') {
            this.objectTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / OBJECT';

            const settings = loadJson<ObjectSettings>('supersplat.objectFilter.settings', DEFAULT_OBJECT_SETTINGS);
            const pickRow = document.createElement('div');
            pickRow.className = 'filter-panel-row filter-panel-preset-row';
            pickRow.title = 'Enable interactive picking, then click the main viewport to grow an object from the clicked seed.';

            const pickLabel = document.createElement('span');
            pickLabel.className = 'filter-panel-row-label';
            pickLabel.textContent = 'Viewport';

            const pickButtons = document.createElement('div');
            pickButtons.className = 'filter-panel-preset-buttons';

            this.objectPickButton = this.makeButton('Picking On', 'primary');
            this.objectPickButton.addEventListener('click', () => {
                if (this.objectInputs?.limitToSelection?.checked) {
                    this.statsDom.textContent = 'Object mode: Scope to selection is on. Click Preview to grow objects directly from the current selection.';
                    this.setObjectPickingActive(false);
                    return;
                }
                this.setObjectPickingActive(!this.objectPickingActive);
                if (this.mode === 'object' && this.objectPickingActive) {
                    this.statsDom.textContent = 'Object mode: click the main viewport to preview a whole object from the clicked seed.';
                }
            });

            pickButtons.appendChild(this.objectPickButton);
            pickRow.appendChild(pickLabel);
            pickRow.appendChild(pickButtons);
            this.rowsDom.appendChild(pickRow);

            this.objectInputs = {
                method: this.makeSelectRow('Method', settings.method, [
                    { value: 'euclidean', text: 'Euclidean' },
                    { value: 'color', text: 'Color + distance' }
                ], 'Euclidean grows by 3D connectivity only. Color + distance also checks color similarity while growing.'),
                seedMode: this.makeSelectRow('Seed mode', settings.seedMode, [
                    { value: 'single', text: 'Single object' },
                    { value: 'all', text: 'All selected seeds' }
                ], 'Single object uses the first selected seed only. All selected seeds expands every selected seed cluster.'),
                radius: this.makeInputRow('Radius', String(settings.radius), '3D connectivity radius for object growth.'),
                colorThreshold: this.makeInputRow('Color threshold', String(settings.colorThreshold), 'Only used by Color + distance. Lower is stricter.'),
                limitToSelection: this.makeCheckboxRow('Scope to selection', settings.limitToSelection, 'Only grow objects inside the points currently selected before you start object picking. Useful for a sky region or local work area.'),
                fastPreview: this.makeCheckboxRow('Fast preview', settings.fastPreview, 'Recommended ON. Caps growth earlier and yields more often so object picking stays responsive.'),
                maxPoints: this.makeInputRow('Max points', String(settings.maxPoints), 'Upper bound for a single object preview. Lower is faster and safer on huge scenes.')
            };

            this.objectInputs.limitToSelection.addEventListener('change', () => {
                const scopeMode = this.objectInputs.limitToSelection.checked;
                if (scopeMode) {
                    this.setObjectPickingActive(false);
                    this.statsDom.textContent = 'Object mode: Scope to selection is on. Click Preview to expand the currently selected point cloud directly, no seed pick needed.';
                } else {
                    this.setObjectPickingActive(true);
                    this.statsDom.textContent = 'Object mode: click the main viewport to preview a whole object from the clicked seed.';
                }
            });

            this.setObjectPickingActive(!settings.limitToSelection);
            this.statsDom.textContent = settings.limitToSelection
                ? 'Object mode: Scope to selection is on. Click Preview to expand the currently selected point cloud directly, no seed pick needed.'
                : 'Object mode: click the main viewport to preview a whole object from the clicked seed. Turn on Scope to selection to limit growth to a preselected region.';
        } else if (mode === 'advanced') {
            this.advancedTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / ADVANCED';

            const legacyPlaneSettings = loadJson('supersplat.planeTool.settings', DEFAULT_PLANE_SETTINGS);
            const settings = loadJson<AdvancedSettings>('supersplat.advancedFilter.settings', {
                ...DEFAULT_ADVANCED_SETTINGS,
                planeFitThreshold: legacyPlaneSettings.planeFitThreshold,
                outsideDistance: legacyPlaneSettings.outsideDistance,
                filterScope: legacyPlaneSettings.filterScope,
                filterSide: legacyPlaneSettings.filterSide
            });

            this.advancedInputs = {
                tool: this.makeSelectRow('Tool', settings.tool, [
                    { value: 'plane', text: 'Plane' }
                ], 'Advanced tools that are useful in specific cleanup workflows.'),
                planeAction: this.makeSelectRow('Plane action', settings.planeAction, [
                    { value: 'select', text: 'Select Plane' },
                    { value: 'set', text: 'Set + Select' },
                    { value: 'outside', text: 'Preview Outside' }
                ], 'Select Plane fits the dominant plane inside the current selection. Set + Select also saves it. Preview Outside uses the saved plane.'),
                planeFitThreshold: this.makeInputRow('Plane threshold', String(settings.planeFitThreshold), 'Distance for detecting or selecting plane inliers. Try 0.05 ~ 0.12.'),
                outsideDistance: this.makeInputRow('Outside distance', String(settings.outsideDistance), 'Distance for selecting points outside the saved plane. Try 0.10 ~ 0.30.'),
                filterScope: this.makeSelectRow('Filter scope', settings.filterScope, [
                    { value: 'selected', text: 'Selected only' },
                    { value: 'all', text: 'Whole splat' }
                ], 'Selected only is safer. Whole splat is useful after you already saved a clean plane.'),
                filterSide: this.makeSelectRow('Filter side', settings.filterSide, [
                    { value: 'both', text: 'Both sides' },
                    { value: 'positive', text: 'Positive side only' },
                    { value: 'negative', text: 'Negative side only' }
                ], 'Use Positive or Negative when artifacts sit only on one side of the plane.')
            };

            const planeToolsRow = document.createElement('div');
            planeToolsRow.className = 'filter-panel-row filter-panel-preset-row';
            planeToolsRow.title = 'Plane utilities used less often, but very handy for walls, floors, roofs, and slab cleanup.';

            const planeToolsLabel = document.createElement('span');
            planeToolsLabel.className = 'filter-panel-row-label';
            planeToolsLabel.textContent = 'Saved plane';

            const planeToolsButtons = document.createElement('div');
            planeToolsButtons.className = 'filter-panel-preset-buttons';

            const clearPlaneButton = document.createElement('span');
            clearPlaneButton.className = 'filter-panel-preset-button';
            clearPlaneButton.textContent = 'Clear';
            clearPlaneButton.title = 'Clear the saved plane used by Preview Outside.';
            clearPlaneButton.addEventListener('click', () => {
                this.savedPlane = null;
                this.statsDom.textContent = 'Advanced / Plane: saved plane cleared.';
            });
            planeToolsButtons.appendChild(clearPlaneButton);

            planeToolsRow.appendChild(planeToolsLabel);
            planeToolsRow.appendChild(planeToolsButtons);
            this.rowsDom.appendChild(planeToolsRow);

            const syncAdvancedSettings = () => {
                const nextSettings = this.getAdvancedSettings();
                saveJson('supersplat.advancedFilter.settings', nextSettings);
                saveJson('supersplat.planeTool.settings', {
                    planeFitThreshold: nextSettings.planeFitThreshold,
                    outsideDistance: nextSettings.outsideDistance,
                    filterScope: nextSettings.filterScope,
                    filterSide: nextSettings.filterSide
                });
                this.updatePreviewButtonLabel();
            };

            [
                this.advancedInputs.tool,
                this.advancedInputs.planeAction,
                this.advancedInputs.planeFitThreshold,
                this.advancedInputs.outsideDistance,
                this.advancedInputs.filterScope,
                this.advancedInputs.filterSide
            ].forEach((input) => {
                input.addEventListener('change', syncAdvancedSettings);
                input.addEventListener('input', syncAdvancedSettings);
            });

            this.statsDom.textContent = this.savedPlane
                ? 'Advanced / Plane: saved plane is ready. Use Preview Outside to isolate off-plane points.'
                : 'Advanced / Plane: rough-select a wall, floor, or roof, then run Select Plane or Set + Select.';
        } else {
            this.pointTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / POINT';
            this.makePresetRow([
                {
                    label: 'Outdoor',
                    title: 'Balanced preset for large outdoor scenes.',
                    apply: () => this.applyPointPreset('outdoor')
                },
                {
                    label: 'Structure',
                    title: 'Safer preset for thin structures and sparse edges.',
                    apply: () => this.applyPointPreset('structure')
                },
                {
                    label: 'Cleanup',
                    title: 'Stronger cleanup for messy reconstructions.',
                    apply: () => this.applyPointPreset('cleanup')
                }
            ]);

            const settings = loadJson<PointCloudSettings>('supersplat.pointCloudFilter.settings', DEFAULT_POINT_CLOUD_SETTINGS);
            this.pointInputs = {
                enableFast: this.makeCheckboxRow('Fast voxel mode', settings.enableFast, 'Recommended ON. Uses voxel-guided search with local exact checks near the threshold.'),
                enableRadius: this.makeCheckboxRow('Use radius outlier', settings.enableRadius, 'Pure point cloud filtering. Select isolated points.'),
                radius: this.makeInputRow('Radius / voxel', String(settings.radius), 'Recommended 1.5 ~ 2.0 for outdoor scenes. In fast mode this is the voxel size and local support radius.'),
                minNeighbors: this.makeInputRow('Min neighbors', String(settings.minNeighbors), 'Recommended 1 ~ 2 for outdoor scenes.'),
                enableCluster: this.makeCheckboxRow('Use small cluster', settings.enableCluster, 'Select tiny disconnected point groups.'),
                clusterRadius: this.makeInputRow('Cluster radius', String(settings.clusterRadius), 'Recommended 1.0 ~ 2.0.'),
                minClusterSize: this.makeInputRow('Min cluster size', String(settings.minClusterSize), 'Small connected components below this size are selected.'),
                enableStatistical: this.makeCheckboxRow('Use statistical', settings.enableStatistical, 'Statistical outlier by KNN mean distance. Good for sparse floating outliers.'),
                kNeighbors: this.makeInputRow('K neighbors', String(settings.kNeighbors), 'Recommended 16 ~ 32.'),
                stdRatio: this.makeInputRow('Std ratio', String(settings.stdRatio), 'Recommended 3.0 ~ 4.5. Lower = more aggressive.')
            };

            this.statsDom.textContent = 'Point cloud start: Fast ON, radius/voxel 1.5~2.0, neighbors 1~2. Fast mode now uses voxel-guided local exact checks for cleaner edge preservation.';
        }

        this.updatePreviewButtonLabel();
    }

    private getOutlierSettings(): OutlierSettings {
        return {
            minOpacity: Math.max(0, finiteNumber(this.outlierInputs.minOpacity.value, DEFAULT_OUTLIER_SETTINGS.minOpacity)),
            maxScale: Math.max(0, finiteNumber(this.outlierInputs.maxScale.value, DEFAULT_OUTLIER_SETTINGS.maxScale)),
            radius: Math.max(0, finiteNumber(this.outlierInputs.radius.value, DEFAULT_OUTLIER_SETTINGS.radius)),
            minNeighbors: Math.max(0, Math.floor(finiteNumber(this.outlierInputs.minNeighbors.value, DEFAULT_OUTLIER_SETTINGS.minNeighbors)))
        };
    }

    private getBlackSettings(): BlackArtifactSettings {
        return {
            maxBrightness: Math.max(0, Math.min(1, finiteNumber(this.blackInputs.maxBrightness.value, DEFAULT_BLACK_SETTINGS.maxBrightness))),
            maxOpacity: Math.max(0, Math.min(1, finiteNumber(this.blackInputs.maxOpacity.value, DEFAULT_BLACK_SETTINGS.maxOpacity))),
            minScale: Math.max(0, finiteNumber(this.blackInputs.minScale.value, DEFAULT_BLACK_SETTINGS.minScale)),
            radius: Math.max(0, finiteNumber(this.blackInputs.radius.value, DEFAULT_BLACK_SETTINGS.radius)),
            minNeighbors: Math.max(0, Math.floor(finiteNumber(this.blackInputs.minNeighbors.value, DEFAULT_BLACK_SETTINGS.minNeighbors)))
        };
    }

    private getSkySettings(): SkySettings {
        return {
            upAxis: this.skyInputs.upAxis.value === 'x'
                ? 'x'
                : (this.skyInputs.upAxis.value === 'z' ? 'z' : 'y'),
            topPercent: Math.max(1, Math.min(80, finiteNumber(this.skyInputs.topPercent.value, DEFAULT_SKY_SETTINGS.topPercent))),
            minBrightness: Math.max(0, Math.min(1, finiteNumber(this.skyInputs.minBrightness.value, DEFAULT_SKY_SETTINGS.minBrightness))),
            maxWhiteSaturation: Math.max(0, Math.min(1, finiteNumber(this.skyInputs.maxWhiteSaturation.value, DEFAULT_SKY_SETTINGS.maxWhiteSaturation))),
            minBlueBias: Math.max(-1, Math.min(1, finiteNumber(this.skyInputs.minBlueBias.value, DEFAULT_SKY_SETTINGS.minBlueBias))),
            maxOpacity: Math.max(0, Math.min(1, finiteNumber(this.skyInputs.maxOpacity.value, DEFAULT_SKY_SETTINGS.maxOpacity))),
            minScale: Math.max(0, finiteNumber(this.skyInputs.minScale.value, DEFAULT_SKY_SETTINGS.minScale)),
            protectStructures: this.skyInputs.protectStructures.checked,
            keepTopConnected: this.skyInputs.keepTopConnected.checked,
            preferDiscreteSky: this.skyInputs.preferDiscreteSky.checked
        };
    }

    private getPointCloudSettings(): PointCloudSettings {
        return {
            enableFast: this.pointInputs.enableFast.checked,
            enableRadius: this.pointInputs.enableRadius.checked,
            radius: Math.max(0, finiteNumber(this.pointInputs.radius.value, DEFAULT_POINT_CLOUD_SETTINGS.radius)),
            minNeighbors: Math.max(0, Math.floor(finiteNumber(this.pointInputs.minNeighbors.value, DEFAULT_POINT_CLOUD_SETTINGS.minNeighbors))),
            enableCluster: this.pointInputs.enableCluster.checked,
            clusterRadius: Math.max(0, finiteNumber(this.pointInputs.clusterRadius.value, DEFAULT_POINT_CLOUD_SETTINGS.clusterRadius)),
            minClusterSize: Math.max(1, Math.floor(finiteNumber(this.pointInputs.minClusterSize.value, DEFAULT_POINT_CLOUD_SETTINGS.minClusterSize))),
            enableStatistical: this.pointInputs.enableStatistical.checked,
            kNeighbors: Math.max(1, Math.floor(finiteNumber(this.pointInputs.kNeighbors.value, DEFAULT_POINT_CLOUD_SETTINGS.kNeighbors))),
            stdRatio: Math.max(0.1, finiteNumber(this.pointInputs.stdRatio.value, DEFAULT_POINT_CLOUD_SETTINGS.stdRatio))
        };
    }

    private getObjectSettings(): ObjectSettings {
        return {
            method: (this.objectInputs.method.value === 'color' ? 'color' : 'euclidean'),
            seedMode: (this.objectInputs.seedMode.value === 'all' ? 'all' : 'single'),
            radius: Math.max(0.1, finiteNumber(this.objectInputs.radius.value, DEFAULT_OBJECT_SETTINGS.radius)),
            colorThreshold: Math.max(0, Math.min(1, finiteNumber(this.objectInputs.colorThreshold.value, DEFAULT_OBJECT_SETTINGS.colorThreshold))),
            limitToSelection: this.objectInputs.limitToSelection.checked,
            fastPreview: this.objectInputs.fastPreview.checked,
            maxPoints: Math.max(1000, Math.floor(finiteNumber(this.objectInputs.maxPoints.value, DEFAULT_OBJECT_SETTINGS.maxPoints)))
        };
    }

    private getAdvancedSettings(): AdvancedSettings {
        return {
            tool: 'plane',
            planeAction: this.advancedInputs.planeAction.value === 'outside'
                ? 'outside'
                : (this.advancedInputs.planeAction.value === 'set' ? 'set' : 'select'),
            planeFitThreshold: Math.max(0.000001, finiteNumber(this.advancedInputs.planeFitThreshold.value, DEFAULT_ADVANCED_SETTINGS.planeFitThreshold)),
            outsideDistance: Math.max(0.000001, finiteNumber(this.advancedInputs.outsideDistance.value, DEFAULT_ADVANCED_SETTINGS.outsideDistance)),
            filterScope: this.advancedInputs.filterScope.value || DEFAULT_ADVANCED_SETTINGS.filterScope,
            filterSide: this.advancedInputs.filterSide.value || DEFAULT_ADVANCED_SETTINGS.filterSide
        };
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

    private async preview() {
        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            await this.showError('Filter', 'Please select a splat first.');
            return;
        }

        const limitToSelection = (this.mode === 'object' || this.mode === 'advanced') ? false : this.getLimitToSelection();
        let originalSelectionMask: Uint8Array | null = null;
        let originalSelectionCount = 0;
        let processingIndices: number[] | null = null;
        let previewNote = '';

        if (limitToSelection) {
            const { state, n } = prepareArrays(splat);
            const selection = getCurrentSelectionMask(state, n);
            originalSelectionMask = selection.mask;
            originalSelectionCount = selection.count;
            processingIndices = selection.indices;

            if (!originalSelectionMask || originalSelectionCount <= 0 || processingIndices.length <= 0) {
                await this.showError('Filter', 'Please select some Gaussians first, then run the filter with Limit to current selection.');
                return;
            }
        }

        this.events.fire('progressStart',
            this.mode === 'outlier'
                ? 'Outlier Filter'
                : this.mode === 'sky'
                    ? 'Sky Filter'
                : this.mode === 'blackArtifact'
                    ? 'Black Artifact Filter'
                    : this.mode === 'object'
                        ? 'Object Filter'
                        : this.mode === 'advanced'
                            ? 'Advanced Plane Filter'
                            : 'Point Cloud Filter'
        );

        try {
            let result: FilterResult;

            if (this.mode === 'outlier') {
                const settings = this.getOutlierSettings();
                saveJson('supersplat.outlierFilter.settings', settings);
                result = await computeOutlierMask(this.events, splat, settings, limitToSelection, processingIndices);
                this.lastPreviewKind = 'outlier';
            } else if (this.mode === 'sky') {
                const settings = this.getSkySettings();
                saveJson('supersplat.skyFilter.settings', settings);
                result = await computeSkyMask(this.events, splat, settings, limitToSelection, processingIndices);
                previewNote = `axis: ${settings.upAxis.toUpperCase()} | top: ${settings.topPercent}% | min brightness: ${settings.minBrightness}`;
                this.lastPreviewKind = 'sky';
            } else if (this.mode === 'blackArtifact') {
                const settings = this.getBlackSettings();
                saveJson('supersplat.blackArtifactFilter.settings', settings);
                result = await computeBlackArtifactMask(this.events, splat, settings, limitToSelection, processingIndices);
                this.lastPreviewKind = 'blackArtifact';
            } else if (this.mode === 'object') {
                const settings = this.getObjectSettings();
                saveJson('supersplat.objectFilter.settings', settings);
                result = await computeObjectMask(this.events, splat, settings);
                this.lastPreviewKind = 'object';
            } else if (this.mode === 'advanced') {
                const settings = this.getAdvancedSettings();
                saveJson('supersplat.advancedFilter.settings', settings);
                saveJson('supersplat.planeTool.settings', {
                    planeFitThreshold: settings.planeFitThreshold,
                    outsideDistance: settings.outsideDistance,
                    filterScope: settings.filterScope,
                    filterSide: settings.filterSide
                });
                const advanced = await computeAdvancedPlaneMask(this.events, splat, settings, this.savedPlane);
                result = advanced.result;
                this.savedPlane = advanced.nextSavedPlane;
                previewNote = advanced.previewNote;
                this.lastPreviewKind = 'advanced';
            } else {
                const settings = this.getPointCloudSettings();
                saveJson('supersplat.pointCloudFilter.settings', settings);
                result = await computePointCloudMask(this.events, splat, settings, limitToSelection, processingIndices);
                this.lastPreviewKind = 'pointCloud';
            }

            if (limitToSelection && this.mode !== 'object') {
                result = intersectWithSelectionMask(result, originalSelectionMask);
            }

            this.lastPreviewAllMask = result.mask.slice();
            this.lastPreviewReasonMasks = Object.fromEntries(
                Object.entries(result.reasonMasks ?? {}).map(([key, mask]) => [key, mask.slice()])
            );
            this.lastPreviewBaseKind = this.lastPreviewKind;
            this.lastPreviewCount = result.count;
            this.events.fire('select.mask', 'set', result.mask);

            const sortedReasonEntries = Object.entries(result.reasonCounts)
                .sort(([a], [b]) => this.getReasonDisplayInfo(a).order - this.getReasonDisplayInfo(b).order);

            const segmentEntries = sortedReasonEntries.filter(([key]) => key.startsWith('segment:'));
            const otherEntries = sortedReasonEntries.filter(([key]) => !key.startsWith('segment:'));

            const lines = [
                `${result.count.toLocaleString()} / ${result.total.toLocaleString()} selected${limitToSelection ? ` from scoped selection (${originalSelectionCount.toLocaleString()} candidates)` : ''}`
            ];

            if (segmentEntries.length > 0) {
                const topSegments = segmentEntries
                    .slice(0, 5)
                    .map(([k, v]) => `${this.getReasonDisplayInfo(k).label}: ${v.toLocaleString()}`);
                lines.push(`Segments: ${segmentEntries.length.toLocaleString()}`);
                lines.push(...topSegments);
                if (segmentEntries.length > 5) {
                    lines.push(`More segments: ${(segmentEntries.length - 5).toLocaleString()}`);
                }
            }

            lines.push(
                ...otherEntries.map(([k, v]) => `${this.getReasonDisplayInfo(k).label}: ${v.toLocaleString()}`)
            );

            if (previewNote) {
                lines.push(previewNote);
            }

            this.lastPreviewSummary = lines.join(' | ');
            this.statsDom.textContent = this.lastPreviewSummary;
            this.refreshReasonButtons();
        } catch (err: any) {
            this.clearReasonPreview();
            await this.showError('Filter Error', String(err?.message ?? err));
        } finally {
            this.events.fire('progressEnd');
        }
    }

    private async deletePreviewed() {
        if (this.lastPreviewCount <= 0) {
            await this.showError('Delete Previewed', 'No preview is active. Run Preview first.');
            return;
        }

        const ok = window.confirm(
            `Delete the currently selected ${this.lastPreviewCount.toLocaleString()} previewed Gaussians?\n\n` +
            `Preview type: ${this.lastPreviewKind || 'unknown'}\n` +
            'This uses SuperSplat deletion, so you can undo it.'
        );

        if (!ok) return;

        this.events.fire('select.delete');
        this.lastPreviewCount = 0;
        this.lastPreviewKind = '';
        this.clearReasonPreview();
        this.statsDom.textContent = 'Deleted. You can undo from SuperSplat.';
    }
}

export { FilterPanel };

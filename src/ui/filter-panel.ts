import { Container } from '@playcanvas/pcui';

import { Events } from '../events';
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

type FilterResult = {
    mask: Uint8Array;
    total: number;
    count: number;
    reasonCounts: Record<string, number>;
};

type VoxelCell = {
    ix: number;
    iy: number;
    iz: number;
    count: number;
    indices: number[];
};

type FilterMode = 'outlier' | 'blackArtifact' | 'pointCloud';

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
        reasonCounts: {
            ...result.reasonCounts,
            clippedOutsideSelection: clipped
        }
    };
};

const cellKey = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`;

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
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * inv);
        const iy = Math.floor(y[i] * inv);
        const iz = Math.floor(z[i] * inv);

        let count = -1; // exclude self from the current voxel neighborhood
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const cell = cells.get(cellKey(ix + dx, iy + dy, iz + dz));
                    if (cell) count += cell.count;
                }
            }
        }

        if (count < minNeighbors) {
            out[i] = 255;
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
                        if (visited.has(nk) || !cells.has(nk)) continue;
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
    const inv = 1 / Math.max(1e-8, voxelSize);
    const scores = new Float32Array(n);
    scores.fill(-1);
    const step = Math.max(1, Math.floor(candidates.length / 100));

    // Density score: low local voxel count => high sparse score.
    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * inv);
        const iy = Math.floor(y[i] * inv);
        const iz = Math.floor(z[i] * inv);

        let count = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const cell = cells.get(cellKey(ix + dx, iy + dy, iz + dz));
                    if (cell) count += cell.count;
                }
            }
        }

        scores[i] = voxelSize / Math.cbrt(Math.max(1, count));

        if (ci % step === 0) {
            updateProgress(events, `Scoped fast voxel statistical ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, progressBase + (ci / Math.max(1, candidates.length)) * (progressSpan * 0.75));
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
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * invCell);
        const iy = Math.floor(y[i] * invCell);
        const iz = Math.floor(z[i] * invCell);
        const key = cellKey(ix, iy, iz);

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

    const maxShell = 4;

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const ix = Math.floor(x[i] * invCell);
        const iy = Math.floor(y[i] * invCell);
        const iz = Math.floor(z[i] * invCell);

        const dists: number[] = [];

        for (let shell = 0; shell <= maxShell && dists.length < kNeighbors; shell++) {
            for (let gx = ix - shell; gx <= ix + shell; gx++) {
                for (let gy = iy - shell; gy <= iy + shell; gy++) {
                    for (let gz = iz - shell; gz <= iz + shell; gz++) {
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
    const reasonCounts: Record<string, number> = { opacity: 0, scale: 0, radius: 0 };
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        let hit = false;

        if (settings.minOpacity > 0 && opacity) {
            if (sigmoid(opacity[i]) < settings.minOpacity) {
                hit = true;
                reasonCounts.opacity++;
            }
        }

        if (settings.maxScale > 0 && scale0 && scale1 && scale2) {
            const maxScale = Math.max(Math.exp(scale0[i]), Math.exp(scale1[i]), Math.exp(scale2[i]));
            if (maxScale > settings.maxScale) {
                hit = true;
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
            reasonCounts.radius++;
        }
    }

    let count = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        if (mask[candidates[ci]]) count++;
    }

    return { mask, total: n, count, reasonCounts };
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
    const reasonCounts: Record<string, number> = {
        darkAndLowOpacity: 0,
        darkAndLargeScale: 0,
        darkAndIsolated: 0
    };
    const step = Math.max(1, Math.floor(candidates.length / 100));

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];

        const r = decodeColorChannel(fdc0[i]);
        const g = decodeColorChannel(fdc1[i]);
        const b = decodeColorChannel(fdc2[i]);
        const brightness = computeBrightness(r, g, b);

        if (brightness <= settings.maxBrightness) {
            let hit = false;
            const actualOpacity = opacity ? sigmoid(opacity[i]) : 1.0;

            if (actualOpacity <= settings.maxOpacity) {
                hit = true;
                reasonCounts.darkAndLowOpacity++;
            }

            if (!hit && settings.minScale > 0 && scale0 && scale1 && scale2) {
                const maxScale = Math.max(Math.exp(scale0[i]), Math.exp(scale1[i]), Math.exp(scale2[i]));
                if (maxScale >= settings.minScale) {
                    hit = true;
                    reasonCounts.darkAndLargeScale++;
                }
            }

            if (hit) {
                mask[i] = 255;
            }
        }

        if (ci % step === 0) {
            updateProgress(events, `Scoped black artifact pass ${ci.toLocaleString()} / ${candidates.length.toLocaleString()}`, (ci / Math.max(1, candidates.length)) * 0.55);
            if (ci % (step * 5) === 0) await yieldToBrowser();
        }
    }

    const isolated = await computeRadiusIsolationMask(events, n, x, y, z, state, mask, settings.radius, settings.minNeighbors, 0.55, 0.45, limitToSelection, candidates);

    for (let ci = 0; ci < candidates.length; ci++) {
        const i = candidates[ci];
        if (mask[i]) continue;

        const r = decodeColorChannel(fdc0[i]);
        const g = decodeColorChannel(fdc1[i]);
        const b = decodeColorChannel(fdc2[i]);
        const brightness = computeBrightness(r, g, b);

        if (brightness <= settings.maxBrightness && isolated[i]) {
            mask[i] = 255;
            reasonCounts.darkAndIsolated++;
        }
    }

    let count = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
        if (mask[candidates[ci]]) count++;
    }

    return { mask, total: n, count, reasonCounts };
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

    return { mask, total: n, count, reasonCounts };
};


class FilterPanel extends Container {
    private events: Events;
    private mode: FilterMode = 'outlier';
    private rowsDom: HTMLDivElement;
    private statsDom: HTMLDivElement;
    private titleDom: HTMLSpanElement;
    private outlierTab: HTMLSpanElement;
    private blackTab: HTMLSpanElement;
    private pointTab: HTMLSpanElement;
    private lastPreviewCount = 0;
    private lastPreviewKind = '';
    private limitToSelectionInput!: HTMLInputElement;

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

        this.blackTab = document.createElement('span');
        this.blackTab.className = 'filter-panel-tab';
        this.blackTab.textContent = 'Black';

        this.pointTab = document.createElement('span');
        this.pointTab.className = 'filter-panel-tab';
        this.pointTab.textContent = 'Point';

        this.outlierTab.addEventListener('click', () => this.setMode('outlier'));
        this.blackTab.addEventListener('click', () => this.setMode('blackArtifact'));
        this.pointTab.addEventListener('click', () => this.setMode('pointCloud'));

        tabs.appendChild(this.outlierTab);
        tabs.appendChild(this.blackTab);
        tabs.appendChild(this.pointTab);

        this.rowsDom = document.createElement('div');
        this.rowsDom.className = 'filter-panel-rows';

        this.statsDom = document.createElement('div');
        this.statsDom.className = 'filter-panel-stats';
        this.statsDom.textContent = 'No preview yet.';

        const controlRow = document.createElement('div');
        controlRow.className = 'filter-panel-control-row';

        const clearButton = this.makeButton('Clear');
        clearButton.addEventListener('click', () => {
            this.events.fire('select.none');
            this.statsDom.textContent = 'Selection cleared.';
        });

        const deleteButton = this.makeButton('Delete', 'danger');
        deleteButton.addEventListener('click', () => { void this.deletePreviewed(); });

        const previewButton = this.makeButton('Preview', 'primary');
        previewButton.addEventListener('click', () => { void this.preview(); });

        controlRow.appendChild(clearButton);
        controlRow.appendChild(deleteButton);
        controlRow.appendChild(previewButton);

        this.dom.appendChild(header);
        this.dom.appendChild(tabs);
        this.dom.appendChild(this.rowsDom);
        this.dom.appendChild(this.statsDom);
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
            }
        });

        events.on('filter.show', () => {
            this.hidden = false;
        });

        events.on('filter.hide', () => {
            this.hidden = true;
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


    private setMode(mode: FilterMode) {
        this.mode = mode;
        this.rowsDom.innerHTML = '';
        this.makeScopeRow();

        this.outlierTab.classList.remove('active');
        this.blackTab.classList.remove('active');
        this.pointTab.classList.remove('active');

        if (mode === 'outlier') {
            this.outlierTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / OUTLIER';

            const settings = loadJson<OutlierSettings>('supersplat.outlierFilter.settings', DEFAULT_OUTLIER_SETTINGS);
            this.outlierInputs = {
                minOpacity: this.makeInputRow('Min opacity', String(settings.minOpacity), 'Try 0.003 ~ 0.008. Set 0 to disable.'),
                maxScale: this.makeInputRow('Max scale', String(settings.maxScale), 'Large Gaussian filter. For outdoor, usually keep 0 first.'),
                radius: this.makeInputRow('Radius', String(settings.radius), 'Radius isolation filter. Set 0 to disable.'),
                minNeighbors: this.makeInputRow('Min neighbors', String(settings.minNeighbors), 'Only used when Radius > 0.')
            };

            this.statsDom.textContent = 'Outdoor: opacity 0.003~0.005, scale 0, radius 0.';
        } else if (mode === 'blackArtifact') {
            this.blackTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / BLACK';

            const settings = loadJson<BlackArtifactSettings>('supersplat.blackArtifactFilter.settings', DEFAULT_BLACK_SETTINGS);
            this.blackInputs = {
                maxBrightness: this.makeInputRow('Max brightness', String(settings.maxBrightness), 'Try 0.03 ~ 0.06. Lower = safer.'),
                maxOpacity: this.makeInputRow('Max opacity', String(settings.maxOpacity), 'Try 0.15 ~ 0.25 for black floaters. Use 1 to disable.'),
                minScale: this.makeInputRow('Min scale', String(settings.minScale), 'Use 1.0+ for black fog blobs. Use 0 to disable.'),
                radius: this.makeInputRow('Radius', String(settings.radius), 'Optional isolation filter. Use 0 to disable.'),
                minNeighbors: this.makeInputRow('Min neighbors', String(settings.minNeighbors), 'Only used when Radius > 0.')
            };

            this.statsDom.textContent = 'Black dots: bright 0.04, opacity 0.20. Fog: bright 0.05, opacity 1, scale 1.';
        } else {
            this.pointTab.classList.add('active');
            this.titleDom.textContent = 'FILTERS / POINT';

            const settings = loadJson<PointCloudSettings>('supersplat.pointCloudFilter.settings', DEFAULT_POINT_CLOUD_SETTINGS);
            this.pointInputs = {
                enableFast: this.makeCheckboxRow('Fast voxel mode', settings.enableFast, 'Recommended ON. Uses voxel approximation instead of exact point-neighbor search.'),
                enableRadius: this.makeCheckboxRow('Use radius outlier', settings.enableRadius, 'Pure point cloud filtering. Select isolated points.'),
                radius: this.makeInputRow('Radius / voxel', String(settings.radius), 'Recommended 1.5 ~ 2.0 for outdoor scenes. In fast mode this is the voxel size.'),
                minNeighbors: this.makeInputRow('Min neighbors', String(settings.minNeighbors), 'Recommended 1 ~ 2 for outdoor scenes.'),
                enableCluster: this.makeCheckboxRow('Use small cluster', settings.enableCluster, 'Select tiny disconnected point groups.'),
                clusterRadius: this.makeInputRow('Cluster radius', String(settings.clusterRadius), 'Recommended 1.0 ~ 2.0.'),
                minClusterSize: this.makeInputRow('Min cluster size', String(settings.minClusterSize), 'Small connected components below this size are selected.'),
                enableStatistical: this.makeCheckboxRow('Use statistical', settings.enableStatistical, 'Statistical outlier by KNN mean distance. Good for sparse floating outliers.'),
                kNeighbors: this.makeInputRow('K neighbors', String(settings.kNeighbors), 'Recommended 16 ~ 32.'),
                stdRatio: this.makeInputRow('Std ratio', String(settings.stdRatio), 'Recommended 3.0 ~ 4.5. Lower = more aggressive.')
            };

            this.statsDom.textContent = 'Point cloud start: Fast ON, radius/voxel 1.5~2.0, neighbors 1~2. Statistical exact is slow; fast mode approximates by voxel density.';
        }
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

        const limitToSelection = this.getLimitToSelection();
        let originalSelectionMask: Uint8Array | null = null;
        let originalSelectionCount = 0;
        let processingIndices: number[] | null = null;

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

        this.events.fire('progressStart', this.mode === 'outlier' ? 'Outlier Filter' : this.mode === 'blackArtifact' ? 'Black Artifact Filter' : 'Point Cloud Filter');

        try {
            let result: FilterResult;

            if (this.mode === 'outlier') {
                const settings = this.getOutlierSettings();
                saveJson('supersplat.outlierFilter.settings', settings);
                result = await computeOutlierMask(this.events, splat, settings, limitToSelection, processingIndices);
                this.lastPreviewKind = 'outlier';
            } else if (this.mode === 'blackArtifact') {
                const settings = this.getBlackSettings();
                saveJson('supersplat.blackArtifactFilter.settings', settings);
                result = await computeBlackArtifactMask(this.events, splat, settings, limitToSelection, processingIndices);
                this.lastPreviewKind = 'blackArtifact';
            } else {
                const settings = this.getPointCloudSettings();
                saveJson('supersplat.pointCloudFilter.settings', settings);
                result = await computePointCloudMask(this.events, splat, settings, limitToSelection, processingIndices);
                this.lastPreviewKind = 'pointCloud';
            }

            if (limitToSelection) {
                result = intersectWithSelectionMask(result, originalSelectionMask);
            }

            this.lastPreviewCount = result.count;
            this.events.fire('select.mask', 'set', result.mask);

            const lines = [
                `${result.count.toLocaleString()} / ${result.total.toLocaleString()} selected${limitToSelection ? ` from scoped selection (${originalSelectionCount.toLocaleString()} candidates)` : ''}`,
                ...Object.entries(result.reasonCounts).map(([k, v]) => `${k}: ${v.toLocaleString()}`)
            ];

            this.statsDom.textContent = lines.join(' | ');
        } catch (err: any) {
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
        this.statsDom.textContent = 'Deleted. You can undo from SuperSplat.';
    }
}

export { FilterPanel };

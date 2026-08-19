import { Events } from '../events';

type SplatLike = {
    splatData: {
        numSplats: number;
        getProp: (name: string) => unknown;
    };
};

type PlaneSettings = {
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

const GS_STATE = {
    selected: 1,
    locked: 2,
    deleted: 4
};

const DEFAULT_PLANE_SETTINGS: PlaneSettings = {
    planeFitThreshold: 0.08,
    outsideDistance: 0.15,
    filterScope: 'selected',
    filterSide: 'both'
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

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const updateProgress = (events: Events, text: string, progress: number) => {
    events.fire('progressUpdate', {
        text,
        progress: Math.max(0, Math.min(1, progress))
    });
};

const cross3 = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number
) => {
    return {
        x: ay * bz - az * by,
        y: az * bx - ax * bz,
        z: ax * by - ay * bx
    };
};

const normalize3 = (x: number, y: number, z: number) => {
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len < 1e-12) return null;
    return { x: x / len, y: y / len, z: z / len };
};

const squaredPointDistance = (
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    a: number,
    b: number
) => {
    const dx = x[a] - x[b];
    const dy = y[a] - y[b];
    const dz = z[a] - z[b];
    return dx * dx + dy * dy + dz * dz;
};

const fitPlaneFromThreePoints = (
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    a: number,
    b: number,
    c: number
): PlaneModel | null => {
    const abx = x[b] - x[a];
    const aby = y[b] - y[a];
    const abz = z[b] - z[a];

    const acx = x[c] - x[a];
    const acy = y[c] - y[a];
    const acz = z[c] - z[a];

    const n = cross3(abx, aby, abz, acx, acy, acz);
    const nn = normalize3(n.x, n.y, n.z);
    if (!nn) return null;

    const cx = (x[a] + x[b] + x[c]) / 3;
    const cy = (y[a] + y[b] + y[c]) / 3;
    const cz = (z[a] + z[b] + z[c]) / 3;
    const d = -(nn.x * cx + nn.y * cy + nn.z * cz);

    return {
        nx: nn.x,
        ny: nn.y,
        nz: nn.z,
        d,
        seedCount: 3,
        inlierCount: 3
    };
};

const signedDistanceToPlane = (plane: PlaneModel, px: number, py: number, pz: number) => {
    return plane.nx * px + plane.ny * py + plane.nz * pz + plane.d;
};

const distanceToPlane = (plane: PlaneModel, px: number, py: number, pz: number) => {
    return Math.abs(signedDistanceToPlane(plane, px, py, pz));
};

const fitPlaneLeastSquaresNormalEquations = (
    indices: number[],
    x: Float32Array,
    y: Float32Array,
    z: Float32Array
): PlaneModel | null => {
    if (indices.length < 3) return null;

    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        cx += x[idx];
        cy += y[idx];
        cz += z[idx];
    }

    cx /= indices.length;
    cy /= indices.length;
    cz /= indices.length;

    let xx = 0;
    let xy = 0;
    let xz = 0;
    let yy = 0;
    let yz = 0;
    let zz = 0;

    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const dx = x[idx] - cx;
        const dy = y[idx] - cy;
        const dz = z[idx] - cz;

        xx += dx * dx;
        xy += dx * dy;
        xz += dx * dz;
        yy += dy * dy;
        yz += dy * dz;
        zz += dz * dz;
    }

    let nx = 0.0;
    let ny = 0.0;
    let nz = 1.0;

    for (let iter = 0; iter < 12; iter++) {
        const a00 = xx + 1e-9;
        const a01 = xy;
        const a02 = xz;
        const a10 = xy;
        const a11 = yy + 1e-9;
        const a12 = yz;
        const a20 = xz;
        const a21 = yz;
        const a22 = zz + 1e-9;

        const det =
            a00 * (a11 * a22 - a12 * a21) -
            a01 * (a10 * a22 - a12 * a20) +
            a02 * (a10 * a21 - a11 * a20);

        if (Math.abs(det) < 1e-18) {
            return fitPlaneFromThreePoints(
                x, y, z,
                indices[0],
                indices[Math.floor(indices.length / 2)],
                indices[indices.length - 1]
            );
        }

        const ix00 = (a11 * a22 - a12 * a21) / det;
        const ix01 = (a02 * a21 - a01 * a22) / det;
        const ix02 = (a01 * a12 - a02 * a11) / det;
        const ix10 = (a12 * a20 - a10 * a22) / det;
        const ix11 = (a00 * a22 - a02 * a20) / det;
        const ix12 = (a02 * a10 - a00 * a12) / det;
        const ix20 = (a10 * a21 - a11 * a20) / det;
        const ix21 = (a01 * a20 - a00 * a21) / det;
        const ix22 = (a00 * a11 - a01 * a10) / det;

        const vx = ix00 * nx + ix01 * ny + ix02 * nz;
        const vy = ix10 * nx + ix11 * ny + ix12 * nz;
        const vz = ix20 * nx + ix21 * ny + ix22 * nz;

        const nn = normalize3(vx, vy, vz);
        if (!nn) return null;

        nx = nn.x;
        ny = nn.y;
        nz = nn.z;
    }

    const d = -(nx * cx + ny * cy + nz * cz);

    return {
        nx,
        ny,
        nz,
        d,
        seedCount: indices.length,
        inlierCount: indices.length
    };
};

const buildSampleIndices = (indices: number[], maxCount: number) => {
    if (indices.length <= maxCount) {
        return indices.slice();
    }

    const sample: number[] = [];
    const stride = indices.length / maxCount;

    for (let i = 0; i < maxCount; i++) {
        const start = Math.floor(i * stride);
        const end = Math.min(indices.length - 1, Math.max(start, Math.floor((i + 1) * stride) - 1));
        const offset = end > start ? Math.floor(Math.random() * (end - start + 1)) : 0;
        sample.push(indices[start + offset]);
    }

    return sample;
};

const estimateSceneDiagonal = (
    indices: number[],
    x: Float32Array,
    y: Float32Array,
    z: Float32Array
) => {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (x[idx] < minX) minX = x[idx];
        if (y[idx] < minY) minY = y[idx];
        if (z[idx] < minZ) minZ = z[idx];
        if (x[idx] > maxX) maxX = x[idx];
        if (y[idx] > maxY) maxY = y[idx];
        if (z[idx] > maxZ) maxZ = z[idx];
    }

    const dx = Math.max(1e-6, maxX - minX);
    const dy = Math.max(1e-6, maxY - minY);
    const dz = Math.max(1e-6, maxZ - minZ);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const collectPlaneInliers = async (
    events: Events,
    plane: PlaneModel,
    indices: number[],
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    threshold: number,
    progressBase: number,
    progressSpan: number,
    progressLabel: string
) => {
    const inliers: number[] = [];
    const safeThreshold = Math.max(1e-6, threshold);
    const step = Math.max(256, Math.floor(indices.length / 100));

    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (distanceToPlane(plane, x[idx], y[idx], z[idx]) <= safeThreshold) {
            inliers.push(idx);
        }

        if (i % step === 0) {
            updateProgress(events, `${progressLabel} ${i.toLocaleString()} / ${indices.length.toLocaleString()}`, progressBase + (i / Math.max(1, indices.length)) * progressSpan);
        }

        if (i > 0 && i % 4096 === 0) {
            await yieldToBrowser();
        }
    }

    return inliers;
};

const choosePlaneTriplet = (
    sample: number[],
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    minSeparation2: number
) => {
    const attempts = 12;

    for (let attempt = 0; attempt < attempts; attempt++) {
        const a = sample[Math.floor(Math.random() * sample.length)];
        const b = sample[Math.floor(Math.random() * sample.length)];
        const c = sample[Math.floor(Math.random() * sample.length)];

        if (a === b || a === c || b === c) continue;
        if (squaredPointDistance(x, y, z, a, b) < minSeparation2) continue;
        if (squaredPointDistance(x, y, z, a, c) < minSeparation2) continue;
        if (squaredPointDistance(x, y, z, b, c) < minSeparation2) continue;

        const plane = fitPlaneFromThreePoints(x, y, z, a, b, c);
        if (plane) {
            return plane;
        }
    }

    return null;
};

const preparePlaneArrays = (splat: SplatLike) => {
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
        state: getUint8Array(splat, 'state')
    };
};

const collectSelectedValidIndices = (n: number, state: Uint8Array | null) => {
    const selected: number[] = [];

    if (!state) return selected;

    for (let i = 0; i < n; i++) {
        if (!isValidGaussian(state, i)) continue;
        if ((state[i] & GS_STATE.selected) !== 0) {
            selected.push(i);
        }
    }

    return selected;
};

const collectPlaneCandidateIndices = (
    n: number,
    state: Uint8Array | null,
    scope: string
) => {
    const candidates: number[] = [];

    for (let i = 0; i < n; i++) {
        if (!isValidGaussian(state, i)) continue;

        if (scope === 'all') {
            candidates.push(i);
        } else if (state && (state[i] & GS_STATE.selected) !== 0) {
            candidates.push(i);
        }
    }

    return candidates;
};

const fitRobustPlaneFromIndices = async (
    events: Events,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    indices: number[],
    threshold: number
) => {
    if (indices.length < 3) {
        throw new Error('Please roughly select at least three points around the target plane.');
    }

    const safeThreshold = Math.max(1e-6, threshold);
    const sample = buildSampleIndices(indices, Math.min(indices.length, 4096));
    const diagonal = estimateSceneDiagonal(sample, x, y, z);
    const minSeparation = Math.max(safeThreshold * 3, diagonal * 0.0025);
    const minSeparation2 = minSeparation * minSeparation;
    const ransacIterations = Math.min(220, Math.max(72, Math.floor(sample.length / 14)));
    const earlyStopCount = Math.max(3, Math.floor(sample.length * 0.9));

    let bestPlane: PlaneModel | null = null;
    let bestCount = -1;

    for (let iter = 0; iter < ransacIterations; iter++) {
        const plane = choosePlaneTriplet(sample, x, y, z, minSeparation2);
        if (!plane) {
            continue;
        }

        let count = 0;
        for (let i = 0; i < sample.length; i++) {
            const idx = sample[i];
            if (distanceToPlane(plane, x[idx], y[idx], z[idx]) <= safeThreshold) {
                count++;
            }
        }

        if (count > bestCount) {
            bestCount = count;
            bestPlane = plane;
            if (count >= earlyStopCount) {
                break;
            }
        }

        if (iter % 8 === 0) {
            updateProgress(events, `Plane detection ${iter.toLocaleString()} / ${ransacIterations.toLocaleString()}`, (iter / Math.max(1, ransacIterations)) * 0.45);
            await yieldToBrowser();
        }
    }

    if (!bestPlane) {
        const fallback = fitPlaneLeastSquaresNormalEquations(indices, x, y, z);
        if (!fallback) {
            throw new Error('Could not fit a plane. Try a smaller or cleaner rough selection.');
        }
        fallback.seedCount = indices.length;
        fallback.inlierCount = indices.length;
        return fallback;
    }

    const firstPassInliers = await collectPlaneInliers(
        events,
        bestPlane,
        indices,
        x,
        y,
        z,
        safeThreshold,
        0.45,
        0.2,
        'Collecting plane inliers'
    );

    const refined = fitPlaneLeastSquaresNormalEquations(firstPassInliers.length >= 3 ? firstPassInliers : indices, x, y, z);
    if (!refined) {
        throw new Error('Could not refine the plane.');
    }

    const finalInliers = await collectPlaneInliers(
        events,
        refined,
        indices,
        x,
        y,
        z,
        safeThreshold,
        0.65,
        0.25,
        'Refining plane inliers'
    );

    const finalPlane = fitPlaneLeastSquaresNormalEquations(finalInliers.length >= 3 ? finalInliers : firstPassInliers, x, y, z) ?? refined;
    finalPlane.seedCount = indices.length;
    finalPlane.inlierCount = finalInliers.length;

    return finalPlane;
};

const buildPlaneInlierMask = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    candidateIndices: number[],
    plane: PlaneModel,
    threshold: number,
    progressBase = 0,
    progressSpan = 1,
    progressLabel = 'Selecting plane inliers'
) => {
    const mask = new Uint8Array(n);
    let count = 0;
    const safeThreshold = Math.max(0, threshold);
    const step = Math.max(256, Math.floor(candidateIndices.length / 100));

    for (let i = 0; i < candidateIndices.length; i++) {
        const idx = candidateIndices[i];
        if (!isValidGaussian(state, idx)) continue;

        if (distanceToPlane(plane, x[idx], y[idx], z[idx]) <= safeThreshold) {
            mask[idx] = 255;
            count++;
        }

        if (i % step === 0) {
            updateProgress(events, `${progressLabel} ${i.toLocaleString()} / ${candidateIndices.length.toLocaleString()}`, progressBase + (i / Math.max(1, candidateIndices.length)) * progressSpan);
        }

        if (i > 0 && i % 4096 === 0) {
            await yieldToBrowser();
        }
    }

    return { mask, count };
};

const planeSelectsPoint = (
    signedDistance: number,
    outsideDistance: number,
    side: string
) => {
    const d = Math.max(0, outsideDistance);

    if (side === 'positive') {
        return signedDistance > d;
    }

    if (side === 'negative') {
        return signedDistance < -d;
    }

    return Math.abs(signedDistance) > d;
};

const buildPlaneOutsideMask = async (
    events: Events,
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    candidateIndices: number[],
    plane: PlaneModel,
    outsideDistance: number,
    filterSide: string,
    progressBase = 0,
    progressSpan = 1,
    progressLabel = 'Plane outside preview'
) => {
    const mask = new Uint8Array(n);
    let count = 0;
    const step = Math.max(256, Math.floor(candidateIndices.length / 100));

    for (let i = 0; i < candidateIndices.length; i++) {
        const idx = candidateIndices[i];
        if (!isValidGaussian(state, idx)) continue;

        const signedDistance = signedDistanceToPlane(plane, x[idx], y[idx], z[idx]);
        if (planeSelectsPoint(signedDistance, outsideDistance, filterSide)) {
            mask[idx] = 255;
            count++;
        }

        if (i % step === 0) {
            updateProgress(events, `${progressLabel} ${i.toLocaleString()} / ${candidateIndices.length.toLocaleString()}`, progressBase + (i / Math.max(1, candidateIndices.length)) * progressSpan);
        }

        if (i > 0 && i % 4096 === 0) {
            await yieldToBrowser();
        }
    }

    return { mask, count };
};

export {
    DEFAULT_PLANE_SETTINGS,
    buildPlaneInlierMask,
    buildPlaneOutsideMask,
    collectPlaneCandidateIndices,
    collectSelectedValidIndices,
    fitRobustPlaneFromIndices,
    preparePlaneArrays
};

export type {
    PlaneModel,
    PlaneSettings
};

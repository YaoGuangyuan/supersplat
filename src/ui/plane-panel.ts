import { Container } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from './tooltips';

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
        state: getUint8Array(splat, 'state')
    };
};

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const updateProgress = (events: Events, text: string, progress: number) => {
    events.fire('progressUpdate', {
        text,
        progress: Math.max(0, Math.min(1, progress))
    });
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

const collectCandidateIndices = (
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

    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        cx += x[idx];
        cy += y[idx];
        cz += z[idx];
    }

    cx /= indices.length;
    cy /= indices.length;
    cz /= indices.length;

    let xx = 0, xy = 0, xz = 0;
    let yy = 0, yz = 0, zz = 0;

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

    let nx = 0.0, ny = 0.0, nz = 1.0;

    for (let iter = 0; iter < 12; iter++) {
        const a00 = xx + 1e-9, a01 = xy, a02 = xz;
        const a10 = xy, a11 = yy + 1e-9, a12 = yz;
        const a20 = xz, a21 = yz, a22 = zz + 1e-9;

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

    const sampleMax = Math.min(indices.length, 5000);
    const sample: number[] = [];

    if (indices.length <= sampleMax) {
        sample.push(...indices);
    } else {
        const stride = indices.length / sampleMax;
        for (let i = 0; i < sampleMax; i++) {
            sample.push(indices[Math.floor(i * stride)]);
        }
    }

    let bestPlane: PlaneModel | null = null;
    let bestCount = -1;
    const ransacIterations = Math.min(180, Math.max(60, Math.floor(sample.length / 18)));
    const safeThreshold = Math.max(1e-6, threshold);

    for (let iter = 0; iter < ransacIterations; iter++) {
        const a = sample[Math.floor(Math.random() * sample.length)];
        const b = sample[Math.floor(Math.random() * sample.length)];
        const c = sample[Math.floor(Math.random() * sample.length)];

        if (a === b || a === c || b === c) continue;

        const plane = fitPlaneFromThreePoints(x, y, z, a, b, c);
        if (!plane) continue;

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
        }

        if (iter % 10 === 0) {
            updateProgress(events, `Plane detection ${iter.toLocaleString()} / ${ransacIterations.toLocaleString()}`, iter / Math.max(1, ransacIterations));
            await yieldToBrowser();
        }
    }

    if (!bestPlane) {
        const fallback = fitPlaneLeastSquaresNormalEquations(indices, x, y, z);
        if (!fallback) {
            throw new Error('Could not fit a plane. Try a smaller/cleaner rough selection.');
        }
        return fallback;
    }

    const inliers: number[] = [];
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (distanceToPlane(bestPlane, x[idx], y[idx], z[idx]) <= safeThreshold) {
            inliers.push(idx);
        }
    }

    const refined = fitPlaneLeastSquaresNormalEquations(inliers.length >= 3 ? inliers : indices, x, y, z);
    if (!refined) {
        throw new Error('Could not refine the plane.');
    }

    refined.seedCount = indices.length;
    refined.inlierCount = inliers.length;

    return refined;
};

const buildPlaneInlierMask = (
    n: number,
    x: Float32Array,
    y: Float32Array,
    z: Float32Array,
    state: Uint8Array | null,
    candidateIndices: number[],
    plane: PlaneModel,
    threshold: number
) => {
    const mask = new Uint8Array(n);
    let count = 0;
    const safeThreshold = Math.max(0, threshold);

    for (let i = 0; i < candidateIndices.length; i++) {
        const idx = candidateIndices[i];
        if (!isValidGaussian(state, idx)) continue;

        if (distanceToPlane(plane, x[idx], y[idx], z[idx]) <= safeThreshold) {
            mask[idx] = 255;
            count++;
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

class PlanePanel extends Container {
    private events: Events;
    private savedPlane: PlaneModel | null = null;
    private statsDom: HTMLDivElement;
    private fitThresholdInput!: HTMLInputElement;
    private outsideDistanceInput!: HTMLInputElement;
    private filterScopeInput!: HTMLSelectElement;
    private filterSideInput!: HTMLSelectElement;
    private lastPreviewCount = 0;
    private lastPreviewKind = '';

    constructor(events: Events, _tooltips?: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'plane-panel',
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
        title.textContent = 'PLANE TOOL';

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

        this.buildRows();

        events.on('plane.toggle', () => {
            this.hidden = !this.hidden;
        });

        events.on('plane.show', () => {
            this.hidden = false;
        });

        events.on('plane.hide', () => {
            this.hidden = true;
        });
    }

    private makeButton(text: string, kind = '') {
        const button = document.createElement('span');
        button.className = kind ? `plane-panel-button ${kind}` : 'plane-panel-button';
        button.textContent = text;
        return button;
    }

    private makeInputRow(label: string, value: string, help: string) {
        const row = document.createElement('div');
        row.className = 'plane-panel-row';
        row.title = help;

        const labelEl = document.createElement('span');
        labelEl.className = 'plane-panel-row-label';
        labelEl.textContent = label;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = value;
        input.className = 'plane-panel-input';

        row.appendChild(labelEl);
        row.appendChild(input);
        this.dom.appendChild(row);

        return input;
    }

    private makeSelectRow(label: string, value: string, options: { value: string; text: string }[], help: string) {
        const row = document.createElement('div');
        row.className = 'plane-panel-row';
        row.title = help;

        const labelEl = document.createElement('span');
        labelEl.className = 'plane-panel-row-label';
        labelEl.textContent = label;

        const select = document.createElement('select');
        select.className = 'plane-panel-input';

        for (let i = 0; i < options.length; i++) {
            const option = document.createElement('option');
            option.value = options[i].value;
            option.textContent = options[i].text;
            select.appendChild(option);
        }

        select.value = value;

        row.appendChild(labelEl);
        row.appendChild(select);
        this.dom.appendChild(row);

        return select;
    }

    private makeControlRow(buttons: HTMLSpanElement[]) {
        const row = document.createElement('div');
        row.className = 'plane-panel-control-row';
        buttons.forEach((button) => row.appendChild(button));
        this.dom.appendChild(row);
    }

    private buildRows() {
        const settings = loadJson<PlaneSettings>('supersplat.planeTool.settings', DEFAULT_PLANE_SETTINGS);

        this.fitThresholdInput = this.makeInputRow('Plane threshold', String(settings.planeFitThreshold), 'Distance for detecting/selecting plane inliers. Try 0.05~0.12.');
        this.outsideDistanceInput = this.makeInputRow('Outside distance', String(settings.outsideDistance), 'Distance for selecting points outside the saved plane. Try 0.10~0.30.');

        this.filterScopeInput = this.makeSelectRow('Filter scope', settings.filterScope, [
            { value: 'selected', text: 'Selected only' },
            { value: 'all', text: 'Whole splat' }
        ], 'Selected only is safer.');

        this.filterSideInput = this.makeSelectRow('Filter side', settings.filterSide, [
            { value: 'both', text: 'Both sides' },
            { value: 'positive', text: 'Positive side only' },
            { value: 'negative', text: 'Negative side only' }
        ], 'Use Positive/Negative when the artifact is only on one side. If wrong, switch it.');

        const selectPlane = this.makeButton('Select Plane', 'primary');
        selectPlane.title = 'Detect dominant plane inside current rough selection and select only plane inliers.';
        selectPlane.addEventListener('click', () => { void this.selectPlane(false); });

        const setAndSelect = this.makeButton('Set + Select');
        setAndSelect.title = 'Detect dominant plane, save it, and select plane inliers.';
        setAndSelect.addEventListener('click', () => { void this.selectPlane(true); });

        this.makeControlRow([selectPlane, setAndSelect]);

        const previewOutside = this.makeButton('Preview Outside', 'primary');
        previewOutside.title = 'Preview points outside the saved plane.';
        previewOutside.addEventListener('click', () => { void this.previewOutside(); });

        const deletePreviewed = this.makeButton('Delete', 'danger');
        deletePreviewed.title = 'Delete currently previewed points.';
        deletePreviewed.addEventListener('click', () => { void this.deletePreviewed(); });

        const clearPlane = this.makeButton('Clear Plane');
        clearPlane.title = 'Clear saved plane.';
        clearPlane.addEventListener('click', () => {
            this.savedPlane = null;
            this.statsDom.textContent = 'Saved plane cleared.';
        });

        this.makeControlRow([previewOutside, deletePreviewed, clearPlane]);

        this.statsDom = document.createElement('div');
        this.statsDom.className = 'plane-panel-stats';
        this.statsDom.textContent = 'Rough-select an area, then Select Plane or Set + Select.';
        this.dom.appendChild(this.statsDom);
    }

    private getSettings(): PlaneSettings {
        const settings: PlaneSettings = {
            planeFitThreshold: Math.max(0.000001, finiteNumber(this.fitThresholdInput.value, DEFAULT_PLANE_SETTINGS.planeFitThreshold)),
            outsideDistance: Math.max(0.000001, finiteNumber(this.outsideDistanceInput.value, DEFAULT_PLANE_SETTINGS.outsideDistance)),
            filterScope: this.filterScopeInput.value || DEFAULT_PLANE_SETTINGS.filterScope,
            filterSide: this.filterSideInput.value || DEFAULT_PLANE_SETTINGS.filterSide
        };

        saveJson('supersplat.planeTool.settings', settings);
        return settings;
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

    private async selectPlane(savePlane: boolean) {
        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            await this.showError('Plane Tool', 'Please select a splat first.');
            return;
        }

        const settings = this.getSettings();
        const { n, x, y, z, state } = prepareArrays(splat);
        const selected = collectSelectedValidIndices(n, state);

        if (selected.length < 3) {
            await this.showError('Select Plane', 'Please roughly select an area containing the target plane first.');
            return;
        }

        this.events.fire('progressStart', savePlane ? 'Set + Select Plane' : 'Select Plane');

        try {
            const plane = await fitRobustPlaneFromIndices(
                this.events,
                x,
                y,
                z,
                selected,
                settings.planeFitThreshold
            );

            const result = buildPlaneInlierMask(
                n,
                x,
                y,
                z,
                state,
                selected,
                plane,
                settings.planeFitThreshold
            );

            if (savePlane) {
                this.savedPlane = plane;
            }

            this.events.fire('select.mask', 'set', result.mask);

            this.lastPreviewCount = result.count;
            this.lastPreviewKind = savePlane ? 'setAndSelectPlane' : 'selectPlane';

            this.statsDom.textContent =
                `${savePlane ? 'Saved and selected' : 'Selected'} plane: ${result.count.toLocaleString()} / ${selected.length.toLocaleString()} | ` +
                `inliers: ${plane.inlierCount.toLocaleString()} | normal: ${plane.nx.toFixed(3)}, ${plane.ny.toFixed(3)}, ${plane.nz.toFixed(3)}`;
        } catch (err: any) {
            await this.showError('Select Plane Error', String(err?.message ?? err));
        } finally {
            this.events.fire('progressEnd');
        }
    }

    private async previewOutside() {
        const splat = this.events.invoke('selection') as SplatLike | null;
        if (!splat) {
            await this.showError('Plane Tool', 'Please select a splat first.');
            return;
        }

        const settings = this.getSettings();
        const { n, x, y, z, state } = prepareArrays(splat);

        if (!this.savedPlane) {
            await this.showError('Preview Outside', 'No saved plane. First rough-select a plane area and click Set + Select.');
            return;
        }

        const candidates = collectCandidateIndices(n, state, settings.filterScope);
        if (candidates.length === 0) {
            await this.showError('Preview Outside', 'No candidate points. Select a region or choose Whole splat.');
            return;
        }

        this.events.fire('progressStart', 'Plane Outside Preview');

        try {
            const mask = new Uint8Array(n);
            let count = 0;
            const step = Math.max(1, Math.floor(candidates.length / 100));

            for (let i = 0; i < candidates.length; i++) {
                const idx = candidates[i];
                const signedDistance = signedDistanceToPlane(this.savedPlane, x[idx], y[idx], z[idx]);

                if (planeSelectsPoint(signedDistance, settings.outsideDistance, settings.filterSide)) {
                    mask[idx] = 255;
                    count++;
                }

                if (i % step === 0) {
                    updateProgress(this.events, `Plane outside ${i.toLocaleString()} / ${candidates.length.toLocaleString()}`, i / Math.max(1, candidates.length));
                    if (i % (step * 5) === 0) await yieldToBrowser();
                }
            }

            this.events.fire('select.mask', 'set', mask);

            this.lastPreviewCount = count;
            this.lastPreviewKind = 'planeOutside';

            this.statsDom.textContent =
                `Outside selected: ${count.toLocaleString()} / ${candidates.length.toLocaleString()} | ` +
                `side: ${settings.filterSide} | distance: ${settings.outsideDistance}`;
        } catch (err: any) {
            await this.showError('Plane Preview Error', String(err?.message ?? err));
        } finally {
            this.events.fire('progressEnd');
        }
    }

    private async deletePreviewed() {
        if (this.lastPreviewCount <= 0) {
            await this.showError('Delete Previewed', 'No preview is active. Run Select Plane or Preview Outside first.');
            return;
        }

        const ok = window.confirm(
            `Delete the currently selected ${this.lastPreviewCount.toLocaleString()} Gaussians?\n\n` +
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

export { PlanePanel };

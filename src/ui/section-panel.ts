import { Container } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from './tooltips';

type SplatLike = {
    splatData: {
        numSplats: number;
        getProp: (name: string) => unknown;
    };
};

type SectionSettings = {
    topAxes: string;
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
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
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

type DragState = {
    mode: 'pan' | 'select';
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    startTopBounds?: TopBounds;
    startViewerBounds?: SectionViewBounds;
};

const GS_STATE = {
    selected: 1,
    locked: 2,
    deleted: 4
};

const SH_C0 = 0.28209479177387814;

const DEFAULT_SECTION_SETTINGS: SectionSettings = {
    topAxes: 'xy',
    thickness: 1.0,
    sideMode: 'both',
    scope: 'all',
    maxDisplayPoints: 50000,
    interactiveMaxDisplayPoints: 12000,
    renderMode: 'color',
    pointSize: 1,
    pixelCellSize: 2
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
    private thicknessInput!: HTMLInputElement;
    private sideModeInput!: HTMLSelectElement;
    private scopeInput!: HTMLSelectElement;
    private maxDisplayInput!: HTMLInputElement;
    private interactiveMaxDisplayInput!: HTMLInputElement;
    private renderModeInput!: HTMLSelectElement;
    private pointSizeInput!: HTMLInputElement;
    private pixelCellSizeInput!: HTMLInputElement;
    private topCanvas: HTMLCanvasElement;
    private viewerDom: HTMLDivElement;
    private viewerCanvas: HTMLCanvasElement;
    private statsDom!: HTMLDivElement;
    private viewerStatsDom!: HTMLDivElement;
    private fullBounds: TopBounds | null = null;
    private bounds: TopBounds | null = null;
    private topDrawData: TopDrawData | null = null;
    private sectionLine: SectionLine | null = null;
    private drawingPoint = 0;
    private pickingWidth = false;
    private viewerData: SectionViewerData | null = null;
    private viewerView: SectionViewBounds | null = null;
    private viewerSelectionMask: Uint8Array | null = null;
    private topDrag: DragState | null = null;
    private viewerDrag: DragState | null = null;
    private topRenderPending = false;
    private viewerRenderPending = false;
    private viewerInteractiveUntil = 0;
    private suppressNextDeleteRefresh = false;
    private lastMask: Uint8Array | null = null;
    private lastPreviewCount = 0;
    private lastPreviewKind = '';

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

        this.buildRows();
        this.viewerDom = this.createViewerWindow();

        window.addEventListener('mousemove', (event) => this.handleGlobalMouseMove(event));
        window.addEventListener('mouseup', (event) => this.handleGlobalMouseUp(event));

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

            if (!this.viewerData || !this.sectionLine) return;

            setTimeout(() => {
                void this.rebuildSectionViewFromCurrentSplatState('External delete refresh');
            }, 0);
        });
    }

    private createViewerWindow() {
        const viewer = document.createElement('div');
        viewer.id = 'section-viewer-panel';
        viewer.hidden = true;

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick', 'keydown'].forEach((eventName) => {
            viewer.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = document.createElement('div');
        header.className = 'section-viewer-header';

        const title = document.createElement('span');
        title.textContent = 'SECTION VIEW';

        const close = document.createElement('span');
        close.className = 'section-viewer-close';
        close.textContent = '\uE132';
        close.title = 'Close';
        close.addEventListener('click', () => {
            viewer.hidden = true;
        });

        header.appendChild(title);
        header.appendChild(close);

        this.viewerCanvas = document.createElement('canvas');
        this.viewerCanvas.width = 760;
        this.viewerCanvas.height = 420;
        this.viewerCanvas.className = 'section-viewer-canvas';
        this.viewerCanvas.title = 'Left drag: rectangle select. Wheel: zoom. Shift/right drag: pan.';
        this.viewerCanvas.addEventListener('wheel', (event) => this.handleViewerWheel(event), { passive: false });
        this.viewerCanvas.addEventListener('mousedown', (event) => this.handleViewerMouseDown(event));
        this.viewerCanvas.addEventListener('contextmenu', (event) => event.preventDefault());

        this.viewerStatsDom = document.createElement('div');
        this.viewerStatsDom.className = 'section-viewer-stats';
        this.viewerStatsDom.textContent = 'Build a section view. Left drag to select, wheel to zoom, Shift/right drag to pan.';

        viewer.appendChild(header);
        viewer.appendChild(this.viewerCanvas);
        viewer.appendChild(this.viewerStatsDom);

        document.body.appendChild(viewer);

        return viewer;
    }

    private makeButton(text: string, kind = '') {
        const button = document.createElement('span');
        button.className = kind ? `section-panel-button ${kind}` : 'section-panel-button';
        button.textContent = text;
        return button;
    }

    private makeSelectRow(label: string, value: string, options: { value: string; text: string }[], help: string) {
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
        this.dom.appendChild(row);

        return select;
    }

    private makeInputRow(label: string, value: string, help: string) {
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
        this.dom.appendChild(row);

        return input;
    }

    private makeControlRow(buttons: HTMLSpanElement[]) {
        const row = document.createElement('div');
        row.className = 'section-panel-control-row';
        buttons.forEach((button) => row.appendChild(button));
        this.dom.appendChild(row);
    }

    private buildRows() {
        const settings = loadJson<SectionSettings>('supersplat.sectionLine.settings', DEFAULT_SECTION_SETTINGS);

        this.topAxesInput = this.makeSelectRow('TopView axes', settings.topAxes, [
            { value: 'xy', text: 'XY top / Z height' },
            { value: 'xz', text: 'XZ top / Y height' },
            { value: 'yz', text: 'YZ top / X height' }
        ], 'Choose which two axes form the TopView plane. The remaining axis is vertical in section view.');

        this.thicknessInput = this.makeInputRow('Thickness', String(settings.thickness), 'Section thickness/depth. Centered mode uses total width. Left/Right side modes use one-sided depth.');
        this.sideModeInput = this.makeSelectRow('Thickness side', settings.sideMode || 'both', [
            { value: 'both', text: 'Centered / both sides' },
            { value: 'left', text: 'Left side only' },
            { value: 'right', text: 'Right side only' }
        ], 'Centered includes both sides of the section line. Left/Right modes include only one side of the line direction.');

        this.scopeInput = this.makeSelectRow('Scope', settings.scope, [
            { value: 'all', text: 'Whole splat' },
            { value: 'selected', text: 'Current selection' }
        ], 'Use Current selection to draw/build from a rough selected area only.');
        this.maxDisplayInput = this.makeInputRow('Max display', String(settings.maxDisplayPoints || DEFAULT_SECTION_SETTINGS.maxDisplayPoints), 'Maximum visible representative points when idle. Selection still uses all section data.');
        this.interactiveMaxDisplayInput = this.makeInputRow('Drag display', String(settings.interactiveMaxDisplayPoints || DEFAULT_SECTION_SETTINGS.interactiveMaxDisplayPoints), 'Maximum visible representative points while panning, zooming, or drag-selecting.');
        this.renderModeInput = this.makeSelectRow('Render mode', settings.renderMode || DEFAULT_SECTION_SETTINGS.renderMode, [
            { value: 'color', text: 'Adaptive color' },
            { value: 'fast', text: 'Adaptive mono / faster' }
        ], 'Adaptive color always displays point colors. Adaptive mono is faster for very large sections. Selection is always exact.');
        this.pointSizeInput = this.makeInputRow('Point size', String(settings.pointSize || DEFAULT_SECTION_SETTINGS.pointSize), 'Canvas point size in pixels. 1 is fastest.');
        this.pixelCellSizeInput = this.makeInputRow('Pixel gap', String(settings.pixelCellSize || DEFAULT_SECTION_SETTINGS.pixelCellSize), 'Screen pixel grid size. 1 shows most detail; 2~3 is faster. Selection is always exact.');

        this.topCanvas = document.createElement('canvas');
        this.topCanvas.width = 300;
        this.topCanvas.height = 220;
        this.topCanvas.className = 'section-topview-canvas';
        this.topCanvas.title = 'Click two points to draw line. Wheel: zoom. Shift/right drag: pan.';
        this.topCanvas.addEventListener('click', (event) => this.handleTopCanvasClick(event));
        this.topCanvas.addEventListener('wheel', (event) => this.handleTopWheel(event), { passive: false });
        this.topCanvas.addEventListener('mousedown', (event) => this.handleTopMouseDown(event));
        this.topCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
        this.dom.appendChild(this.topCanvas);

        const refresh = this.makeButton('Refresh Top');
        refresh.addEventListener('click', () => { void this.refreshTopView(); });

        const fitTop = this.makeButton('Fit Top');
        fitTop.addEventListener('click', () => this.fitTopView());

        const pickWidth = this.makeButton('Pick Width');
        pickWidth.title = 'After drawing the section line, click a point in TopView to set thickness like a section tool.';
        pickWidth.addEventListener('click', () => {
            if (!this.sectionLine || this.drawingPoint !== 0) {
                this.statsDom.textContent = 'Draw the section line first, then click Pick Width.';
                return;
            }

            this.pickingWidth = true;
            this.statsDom.textContent = 'Pick Width mode: click beside the section line to set thickness/depth.';
        });

        const clearLine = this.makeButton('Clear Line');
        clearLine.addEventListener('click', () => {
            this.sectionLine = null;
            this.drawingPoint = 0;
            this.pickingWidth = false;
            this.drawTopView();
            this.statsDom.textContent = 'Line cleared. Click two points in TopView.';
        });

        this.makeControlRow([refresh, fitTop, pickWidth, clearLine]);

        const build = this.makeButton('Build View', 'primary');
        build.title = 'Build the profile view in a separate floating window.';
        build.addEventListener('click', () => { void this.buildSectionView(true); });

        const fitView = this.makeButton('Fit View');
        fitView.title = 'Fit the section viewer to the current section points.';
        fitView.addEventListener('click', () => this.fitViewerView(true));

        const rebuildView = this.makeButton('Rebuild');
        rebuildView.title = 'Rebuild Section View from current live splat state.';
        rebuildView.addEventListener('click', () => { void this.rebuildSectionViewFromCurrentSplatState('Manual rebuild'); });

        const selectSlice = this.makeButton('Select Slice');
        selectSlice.title = 'Select the Gaussians inside the line corridor.';
        selectSlice.addEventListener('click', () => { void this.selectSlice(); });

        const del = this.makeButton('Delete', 'danger');
        del.title = 'Delete currently selected/previewed section points.';
        del.addEventListener('click', () => { void this.deletePreviewed(); });

        this.makeControlRow([build, fitView, rebuildView]);
        this.makeControlRow([selectSlice, del]);

        this.statsDom = document.createElement('div');
        this.statsDom.className = 'section-panel-stats';
        this.statsDom.textContent = 'Refresh Top. Click two points for a section line. Wheel zooms; Shift/right drag pans.';
        this.dom.appendChild(this.statsDom);

        this.drawTopView();
    }

    private getSettings(): SectionSettings {
        const settings: SectionSettings = {
            topAxes: this.topAxesInput.value || DEFAULT_SECTION_SETTINGS.topAxes,
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
        const { n, x, y, z, state } = prepareArrays(splat);
        let candidates = collectCandidates(n, state, settings.scope);

        if (candidates.length === 0 && settings.scope === 'selected') {
            // Avoid a blank TopView when the previous persisted scope was "Current selection"
            // but there is no active Gaussian selection.
            settings.scope = 'all';
            this.scopeInput.value = 'all';
            saveJson('supersplat.sectionLine.settings', settings);
            candidates = collectCandidates(n, state, settings.scope);
            this.statsDom.textContent = 'No current selection. Switched Scope to Whole splat.';
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
        this.bounds = cloneTopBounds(this.fullBounds);
        this.topDrawData = { candidates, x, y, z, settings };

        this.drawTopView();
        this.statsDom.textContent = `TopView ready: ${candidates.length.toLocaleString()} candidates. Click two points. Wheel zooms. Shift/right drag pans.`;
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

    private worldToCanvas(a: number, b: number) {
        if (!this.bounds) return { x: 0, y: 0 };

        const h = this.topCanvas.height;
        const margin = 10;
        const scale = this.getTopScale();

        const cx = margin + (a - this.bounds.minA) * scale;
        const cy = h - margin - (b - this.bounds.minB) * scale;

        return { x: cx, y: cy };
    }

    private canvasToWorld(x: number, y: number) {
        if (!this.bounds) return null;

        const h = this.topCanvas.height;
        const margin = 10;
        const scale = this.getTopScale();

        const a = this.bounds.minA + (x - margin) / scale;
        const b = this.bounds.minB + (h - margin - y) / scale;

        return { a, b };
    }

    private fitTopView() {
        if (!this.fullBounds || !this.topDrawData) {
            void this.refreshTopView();
            return;
        }

        this.bounds = cloneTopBounds(this.fullBounds);
        this.drawTopView();
        this.statsDom.textContent = 'TopView fit to full extent.';
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
        this.scheduleTopViewRender();
    }

    private handleTopMouseDown(event: MouseEvent) {
        if (!this.bounds) return;

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
        }
    }

    private panTopView(event: MouseEvent) {
        if (!this.topDrag?.startTopBounds || !this.bounds) return;

        const dx = event.clientX - this.topDrag.startX;
        const dy = event.clientY - this.topDrag.startY;
        const scale = this.getTopScale();
        const da = -dx / Math.max(1e-9, scale);
        const db = dy / Math.max(1e-9, scale);
        const b = this.topDrag.startTopBounds;

        this.bounds = {
            minA: b.minA + da,
            maxA: b.maxA + da,
            minB: b.minB + db,
            maxB: b.maxB + db
        };

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

    private markViewerInteractive() {
        this.viewerInteractiveUntil = performance.now() + 180;
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

    private drawTopView(
        candidates?: number[],
        x?: Float32Array,
        y?: Float32Array,
        z?: Float32Array,
        settings?: SectionSettings
    ) {
        const ctx = this.topCanvas.getContext('2d');
        if (!ctx) return;

        if (!candidates && this.topDrawData) {
            candidates = this.topDrawData.candidates;
            x = this.topDrawData.x;
            y = this.topDrawData.y;
            z = this.topDrawData.z;
            settings = this.getSettings();
            this.topDrawData.settings = settings;
        }

        ctx.clearRect(0, 0, this.topCanvas.width, this.topCanvas.height);
        ctx.fillStyle = '#1f2329';
        ctx.fillRect(0, 0, this.topCanvas.width, this.topCanvas.height);

        if (!this.bounds || !candidates || !x || !y || !z || !settings) {
            ctx.fillStyle = '#b8c1cc';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Refresh TopView', this.topCanvas.width / 2, this.topCanvas.height / 2);
        } else {
            const maxDraw = Math.min(candidates.length, 10000);
            const stride = Math.max(1, Math.floor(candidates.length / maxDraw));

            ctx.fillStyle = '#aab4c0';
            let drawn = 0;

            for (let i = 0; i < candidates.length; i += stride) {
                const idx = candidates[i];
                const c = getCoords(settings.topAxes, x, y, z, idx);
                if (c.a < this.bounds.minA || c.a > this.bounds.maxA || c.b < this.bounds.minB || c.b > this.bounds.maxB) continue;
                const p = this.worldToCanvas(c.a, c.b);
                ctx.fillRect(p.x, p.y, 1, 1);
                drawn++;
            }

            if (drawn === 0 && candidates.length > 0) {
                ctx.fillStyle = '#f0c674';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No points in current TopView. Click Fit Top.', this.topCanvas.width / 2, this.topCanvas.height / 2);
            }
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

        ctx.fillStyle = '#8b96a3';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Wheel: zoom | Shift/right drag: pan | Pick Width: set thickness', 8, this.topCanvas.height - 8);
    }

    private handleTopCanvasClick(event: MouseEvent) {
        if (this.topDrag) return;

        if (!this.bounds || !this.topDrawData) {
            this.statsDom.textContent = 'Click Refresh Top first.';
            return;
        }

        if (event.shiftKey || event.button !== 0) {
            return;
        }

        const rect = this.topCanvas.getBoundingClientRect();
        const p = this.canvasToWorld(event.clientX - rect.left, event.clientY - rect.top);
        if (!p) return;

        if (this.pickingWidth && this.sectionLine && this.drawingPoint === 0) {
            const measure = this.getLineMeasure(p.a, p.b);
            if (!measure) {
                this.statsDom.textContent = 'Section line is too short. Draw the line again.';
                return;
            }

            const sideMode = this.sideModeInput?.value || 'both';
            const distance = Math.abs(measure.perp);
            const thickness = sideMode === 'both' ? distance * 2 : distance;

            this.thicknessInput.value = String(Number(Math.max(0.000001, thickness).toFixed(6)));
            this.pickingWidth = false;

            const sideText = sideMode === 'both'
                ? `centered total width = ${this.thicknessInput.value}`
                : `${sideMode} side depth = ${this.thicknessInput.value}`;

            if (this.topDrawData) {
                this.topDrawData.settings = this.getSettings();
            }

            this.statsDom.textContent = `Thickness picked from TopView: ${sideText}. Click Build View.`;
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
            this.statsDom.textContent = 'Start point set. Click second point.';
        } else {
            this.sectionLine.a1 = p.a;
            this.sectionLine.b1 = p.b;
            this.drawingPoint = 0;
            this.statsDom.textContent = 'Section line set. Click Build View.';
        }

        this.drawTopView();
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

    private fitViewerView(redraw = true) {
        if (!this.viewerData) return;
        this.viewerView = this.makeViewerBounds(this.viewerData.length, this.viewerData.minHeight, this.viewerData.maxHeight);
        if (redraw) {
            this.renderSectionViewer();
            this.viewerStatsDom.textContent = 'Section view fit. Left drag selects; wheel zooms; Shift/right drag pans.';
        }
    }

    private sectionToViewerCanvas(along: number, height: number) {
        const view = this.viewerView;
        if (!view) return { x: 0, y: 0 };

        const w = this.viewerCanvas.width;
        const h = this.viewerCanvas.height;
        const marginLeft = 48;
        const marginRight = 16;
        const marginTop = 16;
        const marginBottom = 32;
        const plotW = w - marginLeft - marginRight;
        const plotH = h - marginTop - marginBottom;

        const x = marginLeft + ((along - view.minAlong) / Math.max(1e-9, view.maxAlong - view.minAlong)) * plotW;
        const y = marginTop + (1 - (height - view.minHeight) / Math.max(1e-9, view.maxHeight - view.minHeight)) * plotH;

        return { x, y };
    }

    private viewerCanvasToSection(x: number, y: number) {
        const view = this.viewerView;
        if (!view) return null;

        const w = this.viewerCanvas.width;
        const h = this.viewerCanvas.height;
        const marginLeft = 48;
        const marginRight = 16;
        const marginTop = 16;
        const marginBottom = 32;
        const plotW = w - marginLeft - marginRight;
        const plotH = h - marginTop - marginBottom;

        const along = view.minAlong + ((x - marginLeft) / Math.max(1e-9, plotW)) * (view.maxAlong - view.minAlong);
        const height = view.minHeight + (1 - (y - marginTop) / Math.max(1e-9, plotH)) * (view.maxHeight - view.minHeight);

        return { along, height };
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
        const plotW = w - marginLeft - marginRight;
        const plotH = h - marginTop - marginBottom;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#15191f';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#3a414a';
        ctx.lineWidth = 1;
        ctx.strokeRect(marginLeft, marginTop, plotW, plotH);

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
        ctx.fillText('distance along line', marginLeft, h - 10);
        ctx.save();
        ctx.translate(12, marginTop + plotH / 2);
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

            if (c.x < marginLeft || c.x > w - marginRight || c.y < marginTop || c.y > h - marginBottom) {
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
                if (c.x < marginLeft || c.x > w - marginRight || c.y < marginTop || c.y > h - marginBottom) continue;

                const gx = Math.max(0, Math.min(selectedGridW - 1, Math.floor(c.x / selectedCellSize)));
                const gy = Math.max(0, Math.min(selectedGridH - 1, Math.floor(c.y / selectedCellSize)));
                const key = gy * selectedGridW + gx;

                if (selectedOccupied[key]) continue;
                selectedOccupied[key] = 1;

                ctx.fillRect(c.x - 1.5, c.y - 1.5, 3, 3);
                selectedDrawn++;
            }
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
        this.fitViewerView(false);
        this.renderSectionViewer();
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

        if (event.button === 0) {
            event.preventDefault();
            this.viewerDrag = {
                mode: 'select',
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

        const rect = this.viewerCanvas.getBoundingClientRect();
        const start = this.viewerDrag.startViewerBounds;
        const plotW = this.viewerCanvas.width - 48 - 16;
        const plotH = this.viewerCanvas.height - 16 - 32;
        const dx = event.clientX - this.viewerDrag.startX;
        const dy = event.clientY - this.viewerDrag.startY;
        const dAlong = -dx / Math.max(1e-9, plotW) * (start.maxAlong - start.minAlong);
        const dHeight = dy / Math.max(1e-9, plotH) * (start.maxHeight - start.minHeight);

        this.viewerView = {
            minAlong: start.minAlong + dAlong,
            maxAlong: start.maxAlong + dAlong,
            minHeight: start.minHeight + dHeight,
            maxHeight: start.maxHeight + dHeight
        };

        this.markViewerInteractive();
        this.scheduleSectionViewerRender();
    }

    private async selectViewerRectangle(x0: number, y0: number, x1: number, y1: number) {
        if (!this.viewerData || !this.lastMask || !this.viewerView) return;

        const minX = Math.min(x0, x1);
        const maxX = Math.max(x0, x1);
        const minY = Math.min(y0, y1);
        const maxY = Math.max(y0, y1);
        const isClick = Math.abs(maxX - minX) < 4 && Math.abs(maxY - minY) < 4;
        const mask = new Uint8Array(this.lastMask.length);
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
                this.viewerSelectionMask = null;
                this.scheduleSectionViewerRender();
                return;
            }

            this.viewerSelectionMask = mask;
            this.lastMask = mask;
            this.lastPreviewCount = count;
            this.lastPreviewKind = 'sectionViewerSelection';
            this.events.fire('select.mask', 'set', mask);
            this.renderSectionViewer();

            this.viewerStatsDom.textContent = `Selected in section view: ${count.toLocaleString()} points from full section data. Yellow pixels refresh when you zoom/pan.`;
            this.statsDom.textContent = `Exact section selection: ${count.toLocaleString()} points. Zoom/pan refreshes selected pixels.`;
        } finally {
            this.events.fire('progressEnd');
        }
    }

    private handleGlobalMouseMove(event: MouseEvent) {
        if (this.topDrag?.mode === 'pan') {
            this.panTopView(event);
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
        }
    }

    private handleGlobalMouseUp(_event: MouseEvent) {
        if (this.viewerDrag?.mode === 'select') {
            const drag = this.viewerDrag;
            this.viewerDrag = null;
            void this.selectViewerRectangle(drag.startX, drag.startY, drag.currentX, drag.currentY);
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
            this.lastMask = section.mask;
            this.viewerSelectionMask = null;
            this.lastPreviewCount = section.count;
            this.lastPreviewKind = 'sectionLineSlice';

            this.drawSectionViewer(section.points, section.length, section.minHeight, section.maxHeight, settings);

            if (showWindow) {
                this.viewerDom.hidden = false;
            }

            this.viewerStatsDom.textContent =
                `slice: ${section.count.toLocaleString()} / ${candidates.length.toLocaleString()} | ` +
                `length: ${section.length.toFixed(3)} | thickness: ${settings.thickness} | side: ${settings.sideMode || 'both'} | left drag to select, wheel to zoom`;

            this.statsDom.textContent =
                `Section view built: ${section.count.toLocaleString()} points. Drag-select in the section window or use Select Slice.`;
        } catch (err: any) {
            await this.showError('Build View Error', String(err?.message ?? err));
        } finally {
            this.events.fire('progressEnd');
        }
    }

    private async selectSlice() {
        if (!this.lastMask) {
            await this.buildSectionView(false);
        }

        if (!this.lastMask || this.lastPreviewCount <= 0) {
            await this.showError('Select Slice', 'No section slice is available. Build View first.');
            return;
        }

        this.events.fire('select.mask', 'set', this.lastMask);
        this.statsDom.textContent = `Selected: ${this.lastPreviewCount.toLocaleString()} points.`;
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

        let candidates: number[];

        if (this.topDrawData?.candidates?.length) {
            candidates = this.topDrawData.candidates.filter((idx) => idx >= 0 && idx < n && isValidGaussian(state, idx));
        } else {
            candidates = collectCandidates(n, state, settings.scope);
        }

        this.topDrawData = { candidates, x, y, z, settings };
        this.rebuildTopBoundsFromCandidates(candidates, x, y, z, settings);

        if (candidates.length === 0) {
            this.viewerData = {
                points: [],
                length: 0,
                minHeight: 0,
                maxHeight: 0,
                settings
            };
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

        this.lastMask = section.mask;
        this.viewerSelectionMask = null;
        this.lastPreviewCount = 0;
        this.lastPreviewKind = '';

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

        this.renderSectionViewer();
        this.drawTopView();

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
        this.events.fire('select.delete');

        // Wait for SuperSplat to apply DeleteSelectionOp and update live state.
        await yieldToBrowser();
        await yieldToBrowser();

        let sectionCount = 0;
        let candidateCount = 0;

        try {
            const rebuilt = await this.rebuildSectionViewFromCurrentSplatState('Deleted');
            sectionCount = rebuilt.sectionCount;
            candidateCount = rebuilt.candidateCount;
        } catch (err: any) {
            this.viewerStatsDom.textContent = `Deleted, but section refresh failed: ${String(err?.message ?? err)}`;
        }

        this.lastPreviewCount = 0;
        this.lastPreviewKind = '';

        this.statsDom.textContent =
            `Deleted and rebuilt section view. Remaining section: ${sectionCount.toLocaleString()} / ${candidateCount.toLocaleString()}.`;
    }
}

export { SectionPanel };

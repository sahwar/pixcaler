
import { observable, computed, action } from "mobx";
import { generateRandomString } from "../util/random";
import * as Jimp from "jimp";
import { Upscaler } from "./Upscaler";
import { Task } from "./Task";
import { Either, right, left } from "fp-ts/lib/Either";
import { DataUrlImage } from "./Image";
import { downsample_nearest_neighbor, upsample_nearest_neighbor } from "../util/tensor";

const SIZE_FACTOR = 64;

export class PatchUpscaleTask extends Task<DataUrlImage> {
    @observable _patch: DataUrlImage;
    private constructor(
        upscaler: Upscaler,
        patch: DataUrlImage,
        public readonly patchSize: number,
        private readonly _original: DataUrlImage,
    ) {
        super(async () => {
            const src = await upscaler.convert(patch);
            return await src.withJimp((img) => {
                img.crop(this.patchSize / 2, this.patchSize / 2, this.patchSize, this.patchSize);
            });
        });
        this._patch = patch;
    }
    @computed
    get original() {
        return this._original;
    }

    public static async create(upscaler: Upscaler, patch: DataUrlImage, patchSize: number) {
        return new PatchUpscaleTask(upscaler, patch, patchSize, await patch.withJimp((img) => {
            img.crop(patchSize / 2, patchSize / 2, patchSize, patchSize);
        }));
    }
}

export class UpscaleTask extends Task<DataUrlImage> {
    @observable private _patchUpscaleTasks: Array<Array<PatchUpscaleTask | null>> = [];
    @observable private _preprocessedImagePreview: DataUrlImage | null = null;

    public readonly patchSize = 32;
    constructor(upscaler: Upscaler, src: DataUrlImage) {
        super(async () => {
            const preprocessedImage = await this.scale2x(src)
                .then(this.padding)
                .then(this.align);
            this._preprocessedImagePreview = await preprocessedImage.withJimp((img) => {
                img.crop(
                    this.patchSize / 2,
                    this.patchSize / 2,
                    img.bitmap.width - this.patchSize / 2,
                    img.bitmap.height - this.patchSize / 2,
                );
            });
            const img = await preprocessedImage.toJimp();
            const [w, h] = [img.bitmap.width, img.bitmap.height];
            const [dstWidth, dstHeight] = [w - this.patchSize, h - this.patchSize];
            const ni = dstHeight / this.patchSize;
            const nj = dstWidth / this.patchSize;
            this._patchUpscaleTasks = Array(ni).fill([]).map(() => Array(nj).fill(null));
            const dst: Jimp.Jimp = new (Jimp.default as any)(dstWidth, dstHeight);
            for (let i = 0; i < ni; i++) {
                for (let j = 0; j < nj; j++) {
                    const y = i * this.patchSize;
                    const x = j * this.patchSize;
                    const patch = img.clone().crop(
                        x,
                        y,
                        2 * this.patchSize,
                        2 * this.patchSize,
                    );
                    const convertedPatchSrc = await (this.patchUpscaleTasks[i][j] = await PatchUpscaleTask.create(
                        upscaler,
                        await DataUrlImage.fromJimp(patch),
                        this.patchSize,
                    )).run();
                    const convertedPatch = await convertedPatchSrc.toJimp();
                    dst.composite(convertedPatch, x, y);
                }
            }
            return await this.crip(await DataUrlImage.fromJimp(dst), src);
        });
    }
    @computed
    get patchUpscaleTasks() {
        return this._patchUpscaleTasks;
    }
    @computed
    get preprocessedImagePreview() {
        return this._preprocessedImagePreview;
    }
    @computed
    get progress() {
        const all = this.patchUpscaleTasks.reduce((acc, v) => acc + v.length, 0);
        if (all === 0) {
            return NaN;
        }
        const done = this.patchUpscaleTasks.reduce(
            (acc, v) => acc + v.filter((t) => t !== null && t.state.status === Task.SUCCESS).length,
            0,
        );
        return 100 * (done / all);
    }
    
    @action.bound
    private async scale2x(src: DataUrlImage): Promise<DataUrlImage> {
        return DataUrlImage.fromTf(upsample_nearest_neighbor(await src.toTf()));
    }

    @action.bound
    private async padding(src: DataUrlImage): Promise<DataUrlImage> {
        const t = await src.toTf();
        const [h, w, c] = t.shape;
        const [nh, nw] = [h, w].map((x) => SIZE_FACTOR * Math.ceil(x / SIZE_FACTOR) + this.patchSize);
        const [ph, pw] = [
            Math.floor((nh - h) / 2),
            Math.floor((nw - w) / 2),
        ];
        return await DataUrlImage.fromTf(t.pad([
            [ph, nh - h - ph],
            [pw, nw - w - pw],
            [0, 0],
        ]));
    }

    @action.bound
    private async align(src: DataUrlImage): Promise<DataUrlImage> {
        return await DataUrlImage.fromTf(
            upsample_nearest_neighbor(
                downsample_nearest_neighbor(await src.toTf()),
            ),
        );
    }

    @action.bound
    private async crip(convertedSrc: DataUrlImage, originalSrc: DataUrlImage): Promise<DataUrlImage> {
        const convertedImage = await convertedSrc.toTf();
        const originalImage = await originalSrc.toTf();
        const [dstHeight, dstWidth] = [2 * originalImage.shape[0], 2 * originalImage.shape[1]];
        const [convertedHeight, convertedWidth, convertedChannel] = convertedImage.shape;
        return DataUrlImage.fromTf(convertedImage.slice([
            (convertedHeight - dstHeight) / 2,
            (convertedWidth - dstWidth) / 2,
            0,
        ], [
            dstHeight,
            dstWidth,
            convertedChannel,
        ]));
    }
}


export class UpscaleConversionFlow {

    @observable private _inputFile: File;
    @observable private _isRunning: boolean = false;
    @observable private _tasks: UpscaleConversionFlow.StageDef = {
        load: null,
        scale2x: null,
        upscale: null,
    };
    @observable private _currentStageId: UpscaleConversionFlow.StageId | null = null;
    @observable private _selectedStageId: UpscaleConversionFlow.StageId | null = null;

    constructor(
        public readonly id: string,
        inputFile: File,
        private readonly upscaler: Upscaler,
        private readonly imageConversionList: UpscaleConversionList,
    ) {
        this._inputFile = inputFile;
    }

    @computed
    get isRunning() {
        return this._isRunning;
    }

    @action.bound
    async run() {
        this._isRunning = true;
        try {
            const inputImage = await this.runTask("load", this.loadInputImage(this._inputFile));
            await this.runTask("scale2x", this.scaleInputImageByNearestNeighbor(inputImage));
            await this.runTask("upscale", new UpscaleTask(this.upscaler, inputImage));
        } finally {
            this._isRunning = false;
        }
    }

    getTask<K extends UpscaleConversionFlow.StageId>(id: K): UpscaleConversionFlow.StageDef[K] | null {
        return this._tasks[id];
    }

    getStage(id: UpscaleConversionFlow.StageId): UpscaleConversionFlow.Stage | null {
        return {
            id: this._currentStageId,
            task: this._tasks[id],
        } as UpscaleConversionFlow.Stage | null;
    }

    @computed
    get currentStage(): UpscaleConversionFlow.Stage | null {
        if (this._currentStageId === null) {
            return null;
        }
        return this.getStage(this._currentStageId);
    }

    @computed
    get selectedStageId(): UpscaleConversionFlow.StageId | null {
        return this._selectedStageId || this._currentStageId;
    }


    @computed
    get selectedStage(): UpscaleConversionFlow.Stage | null {
        if (this._selectedStageId === null) {
            return this.currentStage;
        } else {
            return this.getStage(this._selectedStageId);
        }
    }

    @computed
    get startedStages(): UpscaleConversionFlow.Stage[] {
        return (Object.keys(this._tasks) as UpscaleConversionFlow.StageId[])
            .reduce((acc: UpscaleConversionFlow.Stage[], id: UpscaleConversionFlow.StageId) =>
                this._tasks[id] === null
                    ? acc
                    : [...acc, { id, task: this._tasks[id] }] as UpscaleConversionFlow.Stage[],
                []);
    }

    @computed
    get finishedStages(): UpscaleConversionFlow.Stage[] {
        return this.startedStages.filter((stage) => stage.task.state.status === Task.SUCCESS);
    }

    @computed
    get allFinished() {
        return Object.values(this._tasks).every((task) => task.state.status === Task.SUCCESS);
    }

    @action.bound
    private async runTask<K extends keyof UpscaleConversionFlow.StageDef>(id: K, task: NonNullable<UpscaleConversionFlow.StageDef[K]>) {
        this._currentStageId = id;
        return await (this._tasks[id] = task).run();
    }

    @action.bound
    private loadInputImage(inputFile: File) {
        return new Task(() => DataUrlImage.fromFile(inputFile));
    }

    @action.bound
    private scaleInputImageByNearestNeighbor(src: DataUrlImage): Task<DataUrlImage> {
        return new Task(async () => {
            return await DataUrlImage.fromTf(upsample_nearest_neighbor(await src.toTf()));
        });
    }

    @action.bound
    selectStage(id: UpscaleConversionFlow.StageId): void {
        this._selectedStageId = id;
    }


    @computed
    get canClose() {
        return !this._isRunning;
    }

    @action.bound
    close() {
        this.imageConversionList.closeConversion(this);
    }
}

export namespace UpscaleConversionFlow {
    export interface StageDef {
        load: Task<DataUrlImage> | null;
        scale2x: Task<DataUrlImage> | null;
        upscale: UpscaleTask | null;
    }
    export type StageId = keyof StageDef;
    export type Stage = {
        [K in StageId]: { id: K, task: NonNullable<StageDef[K]> }
    }[StageId];
}

export class UpscaleConversionList {
    @observable private _conversions: UpscaleConversionFlow[]
    constructor() {
        this._conversions = [];
    }

    @computed
    get conversions() {
        return this._conversions;
    }

    @computed
    get isConverting() {
        return this._conversions.some((conversion) => conversion.isRunning);
    }

    @action.bound
    startConversion(inputFile: File, upscaler: Upscaler): UpscaleConversionFlow {
        const conversion = new UpscaleConversionFlow(
            generateRandomString(),
            inputFile,
            upscaler,
            this,
        );
        this._conversions.unshift(conversion);
        conversion.run();
        return conversion;
    }

    @action.bound
    closeConversion(conversion: UpscaleConversionFlow) {
        if (this._conversions.indexOf(conversion) === -1) {
            return;
        }
        if (!conversion.canClose) {
            return;
        }
        this._conversions = this._conversions.filter((c) => c !== conversion)
    }
}
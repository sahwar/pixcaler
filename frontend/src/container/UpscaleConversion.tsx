import * as React from "react";
import { observer } from "mobx-react"
import { UpscaleConversionList, UpscaleConversionFlow, UpscaleTask } from "../store/UpscaleConversion";
import { Row, Panel, Col, Well, Glyphicon, Button, ProgressBar, Tabs, Tab, Nav, NavItem } from "react-bootstrap";
import { Loading } from "../component/Loading";
import { DataUrlImage } from "../store/Image";
import { Task } from "../store/Task";

export const SimpleImageComponent = (props: { result: DataUrlImage }) => (
    <img src={props.result.dataUrl} />
);

export const GenericErrorComponent = (props: { message: string }) => (es: { error: Error }) => (
    <div>{props.message}: {es.error.message}</div>
);

export interface TaskContainerProps {
    task: Task<DataUrlImage> | null;
    title: string;
    resultComponent: React.ComponentType<{ result: DataUrlImage }>
    errorComponent: React.ComponentType<{ error: Error }>;
}

@observer
export class TaskContainer extends React.Component<TaskContainerProps> {
    renderTaskStatus() {
        if (this.props.task == null) {
            return <Loading />;
        }
        const ErrorComponent = this.props.errorComponent;
        switch (this.props.task.state.status) {
            case Task.PENDING:
            case Task.RUNNING:
                return <Loading />
            case Task.FAILURE:
                return <ErrorComponent error={this.props.task.state.error} />;
            case Task.SUCCESS:
                return <img src={this.props.task.state.result.dataUrl} />;
        }
    }

    render() {
        return (
            <Panel style={{ width: "100%", textAlign: "center" }}>
                <Panel.Heading>{this.props.title}</Panel.Heading>
                <Panel.Body style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "300px", backgroundColor: "black", color: "white" }}>
                    {this.renderTaskStatus()}
                </Panel.Body>
            </Panel>
        );
    }
}

export const RunningUpscaleTaskPreview = observer(({ task }: { task: UpscaleTask }) => {
    if (task.preprocessedImagePreview === null) {
        return null;
    }
    return (
        <div>
            <div style={{height: 0, overflow: "visible", position: "relative"}}>
                <img style={{ opacity: 0.5, zIndex: 1}} src={task.preprocessedImagePreview.dataUrl} />
            </div>
            <table style={{ position: "relative", top: 0, margin: 0, padding: 0, zIndex: 100 }}>
                {task.patchUpscaleTasks.map((row, i) =>
                    <tr key={i}>
                        {row.map((col, j) => (
                            <td>
                                {col === null
                                    ? <div style={{ width: `${task.patchSize}px`, height: `${task.patchSize}px` }} />
                                    : col.state.status === Task.SUCCESS
                                        ? <img src={col.state.result.dataUrl} />
                                        : <img src={col.original.dataUrl} />
                                }
                            </td>
                        ))}
                    </tr>
                )}
            </table>
        </div>
    );
});

export const LoadTaskContainer = observer(({ task }: { task: Task<DataUrlImage> | null }) => {
    if (task === null) {
        return <ProgressBar active={false} now={0} />;
    }
    switch (task.state.status) {
        case Task.PENDING:
            return <ProgressBar active={true} now={0} label={"待機中・・・"}></ProgressBar>;
        case Task.RUNNING:
            return <ProgressBar active={true} now={100} label={"ファイルの読み込み中・・・"}></ProgressBar>;
        case Task.FAILURE:
            return <div>ファイルの読み込みに失敗しました: {task.state.error.message} </div>
        case Task.SUCCESS:
            return <img src={task.state.result.dataUrl} />;
    }
});

export const Scale2xTaskContainer = observer(({ task }: { task: Task<DataUrlImage> | null }) => {
    if (task === null) {
        return <ProgressBar active={false} now={0} />;
    }
    switch (task.state.status) {
        case Task.PENDING:
            return <ProgressBar active={false} now={0} />;
        case Task.RUNNING:
            return <ProgressBar active={true} now={100} label={"処理中・・・"}></ProgressBar>;
        case Task.FAILURE:
            return <div>処理に失敗しました: {task.state.error.message} </div>
        case Task.SUCCESS:
            return <img src={task.state.result.dataUrl} />;
    }
});


export const UpscaleTaskContainer = observer(({ task }: { task: UpscaleTask | null }) => {
    if (task === null) {
        return <ProgressBar active={true} now={0} />;
    }
    switch (task.state.status) {
        case Task.PENDING:
            return <ProgressBar active={true} now={0} />;
        case Task.RUNNING:
            return (
                <div>
                    <ProgressBar active={true} now={task.progress} />
                    <RunningUpscaleTaskPreview task={task} />
                </div>
            );
        case Task.FAILURE:
            return <div>処理に失敗しました: {task.state.error.message} </div>
        case Task.SUCCESS:
            return <img src={task.state.result.dataUrl} />;
    }
});

@observer
export class UpscaleConversionContainer extends React.Component<{ store: UpscaleConversionFlow }> {
    render() {
        return (
            <Panel>
                <Panel.Heading style={{ textAlign: "right" }}>
                    <Button bsStyle="danger" onClick={this.props.store.close} disabled={!this.props.store.canClose}><Glyphicon glyph="remove" /></Button>
                </Panel.Heading>
                <Panel.Body style={{ overflow: "hidden" }}>
                    <Tab.Container
                        activeKey={this.props.store.selectedStageId}
                        onSelect={(key: any) => this.props.store.selectStage(key)}
                    >
                        <div>
                            <Nav bsStyle="pills" style={{display: "flex", justifyContent: "center", alignItems: "center"}}>
                                <NavItem eventKey="load">元画像</NavItem>
                                <NavItem eventKey="scale2x">元画像(2x)</NavItem>
                                <NavItem eventKey="upscale">変換結果</NavItem>
                            </Nav>
                            <Tab.Content animation={false} style={{marginTop: "20px", display: "flex", justifyContent: "center", alignItems: "center"}}>
                                <Tab.Pane eventKey={"load"}>
                                    <LoadTaskContainer task={this.props.store.getTask("load")} />
                                </Tab.Pane>
                                <Tab.Pane eventKey={"scale2x"}>
                                    <Scale2xTaskContainer task={this.props.store.getTask("scale2x")} />
                                </Tab.Pane>
                                <Tab.Pane eventKey={"upscale"}>
                                    <UpscaleTaskContainer task={this.props.store.getTask("upscale")} />
                                </Tab.Pane>
                            </Tab.Content>
                        </div>
                    </Tab.Container>
                    {/* {(() => {
                        const stage = this.props.store.selectedStage;
                        if (stage === null) {
                            return null;
                        }
                        switch (stage.id) {
                            case "load":
                                return <LoadTaskContainer task={stage.task} />
                            case "scale2x":
                                return <Scale2xTaskContainer task={stage.task} />
                            case "upscale":
                                return <UpscaleTaskContainer task={stage.task} />
                        }
                    })()} */}
                    {/* <Col md={12}>
                        <TaskContainer
                            title="元画像"
                            task={this.props.store.loadImageTask}
                            resultComponent={SimpleImageComponent}
                            errorComponent={GenericErrorComponent({ message: "ファイルの読み込みに失敗しました" })}
                        />
                    </Col>
                    <Col md={12}>
                        <TaskContainer
                            title="元画像(x2)"
                            task={this.props.store.loadImageTask}
                            resultComponent={SimpleImageComponent}
                            errorComponent={GenericErrorComponent({ message: "画像の拡大に失敗しました" })}
                        />
                    </Col> */}
                    {/* <Col md={12}>
                        <Panel style={{ width: "100%", textAlign: "center" }}>
                            <Panel.Heading>変換後</Panel.Heading>
                            <Panel.Body style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "300px", backgroundColor: "black", color: "white" }}>
                                {this.renderConvertedImage()}
                            </Panel.Body>
                        </Panel>
                    </Col> */}
                </Panel.Body>
            </Panel>
        );
    }
}
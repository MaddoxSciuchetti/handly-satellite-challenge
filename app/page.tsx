"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import type { Node } from "./GraphCanvas";
import { GraphCanvas } from "./GraphCanvas";

// ── Area calculation ──────────────────────────────────────────────────────────
// Convex hull (Andrew's monotone chain) → Shoelace formula → pixel² → m²
// Default GSD (ground sample distance): 0.5 m/pixel — typical medium-res satellite

const GSD_M_PER_PX = 0.5; // metres per pixel

function cross(O: Node, A: Node, B: Node) {
    return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
}

function convexHullArea(pts: Node[]): number {
    if (pts.length < 3) return 0;
    const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    const lower: Node[] = [];
    for (const p of sorted) {
        while (
            lower.length >= 2 &&
            cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
        )
            lower.pop();
        lower.push(p);
    }
    const upper: Node[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (
            upper.length >= 2 &&
            cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
        )
            upper.pop();
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    const hull = [...lower, ...upper];
    let area = 0;
    for (let i = 0; i < hull.length; i++) {
        const j = (i + 1) % hull.length;
        area += hull[i].x * hull[j].y - hull[j].x * hull[i].y;
    }
    return (Math.abs(area) / 2) * GSD_M_PER_PX * GSD_M_PER_PX;
}

function fmt(n: number, decimals = 0) {
    return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

// ── Shared drop zone ──────────────────────────────────────────────────────────

function DropZone({
    multiple,
    files,
    onFiles,
    label,
}: {
    multiple: boolean;
    files: File[];
    onFiles: (f: File[]) => void;
    label: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    function add(list: FileList | null) {
        if (!list) return;
        const incoming = Array.from(list);
        onFiles(multiple ? incoming : [incoming[0]]);
    }

    return (
        <div
            onDrop={(e) => {
                e.preventDefault();
                add(e.dataTransfer.files);
            }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 py-10 cursor-pointer hover:border-zinc-500 hover:bg-zinc-100 transition-colors"
        >
            <svg
                className="w-7 h-7 text-zinc-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
            </svg>
            {files.length === 0 ? (
                <>
                    <p className="text-sm text-zinc-600 font-medium">{label}</p>
                    <p className="text-xs text-zinc-400">
                        PNG, JPG, TIFF, WebP
                    </p>
                </>
            ) : (
                <p className="text-sm text-zinc-700 font-medium">
                    {files.length === 1
                        ? files[0].name
                        : `${files.length} images selected`}
                </p>
            )}
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple={multiple}
                className="hidden"
                onChange={(e) => add(e.target.files)}
            />
        </div>
    );
}

// ── Step 1: main image ────────────────────────────────────────────────────────

function StepMain({
    onContinue,
}: {
    onContinue: (f: File, taskId: Id<"tasks">) => void;
}) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const generateUploadUrl = useMutation(api.tasks.generateUploadUrl);
    const createTask = useMutation(api.tasks.createTask);

    async function handleContinue() {
        if (!file) return;
        setUploading(true);
        setError(null);
        console.log("test 1");
        try {
            const uploadUrl = await Promise.race([
                generateUploadUrl(),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () =>
                            reject(
                                new Error(
                                    "Connection timed out — check Convex is running.",
                                ),
                            ),
                        8000,
                    ),
                ),
            ]);
            console.log("test 2");
            const res = await fetch(uploadUrl, {
                method: "POST",
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                },
                body: file,
            });
            if (!res.ok)
                throw new Error(
                    `Upload failed: ${res.status} ${res.statusText}`,
                );
            console.log("test3");
            const { storageId } = await res.json();
            console.log("test createTask");
            const taskId = await createTask({ imageId: storageId });
            console.log("test createTask");
            onContinue(file, taskId);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Something went wrong.",
            );
            setUploading(false);
        }
    }

    return (
        <div className="w-full max-w-xl bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
            <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">
                    Step 1 of 2
                </span>
            </div>
            <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
                Primary image
            </h1>
            <p className="text-sm text-zinc-500 mb-6">
                This is the image the backend will read and process. Coordinates
                and graph output will be anchored to it.
            </p>

            <div className="flex flex-col gap-5">
                <DropZone
                    multiple={false}
                    files={file ? [file] : []}
                    onFiles={(f) => setFile(f[0])}
                    label="Click or drag image here"
                />

                {file && (
                    <div className="relative rounded-lg overflow-hidden border border-zinc-200 aspect-video">
                        <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 left-2 rounded px-2 py-0.5 bg-emerald-600 text-white text-xs font-medium">
                            Main image
                        </div>
                    </div>
                )}

                {error && <p className="text-sm text-red-500">{error}</p>}

                <button
                    onClick={handleContinue}
                    disabled={!file || uploading}
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {uploading ? "Uploading…" : "Continue →"}
                </button>
            </div>
        </div>
    );
}

// ── Step 2: flagged images ────────────────────────────────────────────────────

function StepFlagged({
    mainFile,
    onSubmit,
}: {
    mainFile: File;
    onSubmit: (flagged: File[]) => void;
}) {
    const [files, setFiles] = useState<File[]>([]);

    function remove(i: number) {
        setFiles((prev) => prev.filter((_, idx) => idx !== i));
    }

    return (
        <div className="w-full max-w-xl bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
            <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">
                    Step 2 of 2
                </span>
            </div>
            <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
                Reference images
            </h1>
            <p className="text-sm text-zinc-500 mb-6">
                These images will appear in the canvas alongside the main image
                but are{" "}
                <span className="font-medium text-amber-600">flagged</span> —
                the backend will not process them.
            </p>

            <div className="flex flex-col gap-5">
                {/* Main image reminder */}
                <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3">
                    <img
                        src={URL.createObjectURL(mainFile)}
                        alt={mainFile.name}
                        className="w-12 h-12 rounded object-cover flex-shrink-0"
                    />
                    <div className="min-w-0">
                        <p className="text-xs text-zinc-400">Main image</p>
                        <p className="text-sm text-zinc-700 font-medium truncate">
                            {mainFile.name}
                        </p>
                    </div>
                    <span className="ml-auto rounded px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-medium flex-shrink-0">
                        Active
                    </span>
                </div>

                <DropZone
                    multiple
                    files={files}
                    onFiles={(f) => setFiles((prev) => [...prev, ...f])}
                    label="Click or drag reference images here"
                />

                {files.length > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                        {files.map((f, i) => (
                            <div
                                key={i}
                                className="relative group rounded-lg overflow-hidden border border-amber-300 aspect-square"
                            >
                                <img
                                    src={URL.createObjectURL(f)}
                                    alt={f.name}
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-amber-400/20" />
                                <div className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 bg-amber-500 text-white text-xs font-medium">
                                    Flagged
                                </div>
                                <button
                                    onClick={() => remove(i)}
                                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs items-center justify-center hidden group-hover:flex"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <button
                    onClick={() => onSubmit(files)}
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
                >
                    {files.length === 0
                        ? "Continue without reference images"
                        : `Open canvas with ${files.length + 1} image${files.length > 1 ? "s" : ""}`}
                </button>
            </div>
        </div>
    );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
    nodes,
    edges,
    mainFile,
    flaggedFiles,
    selectedNode,
}: {
    nodes: Node[];
    edges: { _id: string; fromNodeId: string; toNodeId: string }[];
    mainFile: File;
    flaggedFiles: File[];
    selectedNode: Node | null;
}) {
    const areaSqM = convexHullArea(nodes);
    const areaSqKm = areaSqM / 1_000_000;
    const areaHa = areaSqM / 10_000;

    return (
        <div className="w-72 flex-shrink-0 border-l border-zinc-200 bg-white flex flex-col overflow-y-auto">
            {/* Status */}
            <Section title="Status">
                <Row label="State">
                    <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-zinc-700">Complete</span>
                    </span>
                </Row>
                <Row label="Resolution">
                    <span className="text-zinc-700">
                        {GSD_M_PER_PX * 100} cm / px
                    </span>
                </Row>
            </Section>

            <Divider />

            {/* Images */}
            <Section title="Images">
                <div className="flex items-center gap-2 py-1">
                    <img
                        src={URL.createObjectURL(mainFile)}
                        className="w-10 h-10 rounded object-cover flex-shrink-0 border border-zinc-200"
                        alt=""
                    />
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-800 truncate">
                            {mainFile.name}
                        </p>
                        <p className="text-xs text-zinc-400">
                            {(mainFile.size / 1024).toFixed(0)} KB
                        </p>
                    </div>
                    <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 flex-shrink-0">
                        Main
                    </span>
                </div>
                {flaggedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 py-1">
                        <img
                            src={URL.createObjectURL(f)}
                            className="w-10 h-10 rounded object-cover flex-shrink-0 border border-amber-200"
                            alt=""
                        />
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-zinc-800 truncate">
                                {f.name}
                            </p>
                            <p className="text-xs text-zinc-400">
                                {(f.size / 1024).toFixed(0)} KB
                            </p>
                        </div>
                        <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">
                            Flagged
                        </span>
                    </div>
                ))}
            </Section>

            <Divider />

            {/* Graph */}
            <Section title="Graph">
                <Row label="Nodes">
                    <span className="text-zinc-700 tabular-nums">
                        {nodes.length}
                    </span>
                </Row>
                <Row label="Edges">
                    <span className="text-zinc-700 tabular-nums">
                        {edges.length}
                    </span>
                </Row>
                <Row label="Avg degree">
                    <span className="text-zinc-700 tabular-nums">
                        {nodes.length
                            ? ((edges.length * 2) / nodes.length).toFixed(1)
                            : "—"}
                    </span>
                </Row>
            </Section>

            <Divider />

            {/* Coverage area */}
            <Section title="Coverage area">
                <p className="text-2xl font-semibold text-zinc-900 tabular-nums">
                    {fmt(areaSqM)} m²
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                    {areaSqKm >= 0.01
                        ? `${areaSqKm.toFixed(3)} km²`
                        : `${areaHa.toFixed(2)} ha`}
                </p>
                <p className="text-xs text-zinc-400 mt-3 leading-relaxed">
                    Convex hull of all nodes · GSD {GSD_M_PER_PX * 100} cm/px
                </p>
            </Section>

            {/* Selected node */}
            {selectedNode && (
                <>
                    <Divider />
                    <Section title="Selected node">
                        <Row label="ID">
                            <span className="font-mono text-xs text-zinc-600 truncate">
                                {selectedNode._id}
                            </span>
                        </Row>
                        <Row label="X">
                            <span className="text-blue-600 tabular-nums font-medium">
                                {Math.round(selectedNode.x)}
                            </span>
                        </Row>
                        <Row label="Y">
                            <span className="text-blue-600 tabular-nums font-medium">
                                {Math.round(selectedNode.y)}
                            </span>
                        </Row>
                        <Row label="X (m)">
                            <span className="text-zinc-700 tabular-nums">
                                {(selectedNode.x * GSD_M_PER_PX).toFixed(1)} m
                            </span>
                        </Row>
                        <Row label="Y (m)">
                            <span className="text-zinc-700 tabular-nums">
                                {(selectedNode.y * GSD_M_PER_PX).toFixed(1)} m
                            </span>
                        </Row>
                    </Section>
                </>
            )}
        </div>
    );
}

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="px-4 py-4 flex flex-col gap-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
                {title}
            </p>
            {children}
        </div>
    );
}

function Row({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">{label}</span>
            {children}
        </div>
    );
}

function Divider() {
    return <div className="h-px bg-zinc-100 mx-4" />;
}

// ── Canvas view ───────────────────────────────────────────────────────────────

function CanvasView({
    mainFile,
    taskId,
    flaggedFiles,
    onReset,
}: {
    mainFile: File;
    taskId: Id<"tasks">;
    flaggedFiles: File[];
    onReset: () => void;
}) {
    const task = useQuery(api.tasks.getTask, { taskId });

    // Map embedded arrays → typed objects with synthetic IDs for GraphCanvas
    const backendNodes = (task?.nodes ?? []).map((n, i) => ({
        _id: `n-${i}`,
        x: n.x,
        y: n.y,
    }));
    const backendEdges = (task?.edges ?? []).map((e, i) => ({
        _id: `e-${i}`,
        fromNodeId: `n-${e.from}`,
        toNodeId: `n-${e.to}`,
    }));

    const [liveNodes, setLiveNodes] = useState<Node[]>([]);
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);

    useEffect(() => {
        if (backendNodes.length > 0) setLiveNodes(backendNodes);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task?.nodes]);

    const nodes = liveNodes;
    const edges = backendEdges;

    const isDone = task?.status === "done";
    const hasNodes = nodes.length > 0;
    const isProcessing = !isDone || !hasNodes;
    const total = 1 + flaggedFiles.length;

    return (
        <div className="w-full max-w-7xl bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
                <div className="flex items-center gap-3">
                    <span
                        className={`w-2 h-2 rounded-full ${isDone && hasNodes ? "bg-emerald-500" : "bg-amber-400 animate-pulse"}`}
                    />
                    <span className="text-sm font-medium text-zinc-800">
                        {isDone && hasNodes
                            ? "Analysis complete"
                            : "Processing…"}
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-xs text-zinc-400">
                        {nodes.length} nodes · {edges.length} edges
                    </span>
                    <span className="text-xs text-zinc-400">
                        {total} image{total > 1 ? "s" : ""}
                        {flaggedFiles.length > 0
                            ? ` (${flaggedFiles.length} flagged)`
                            : ""}
                    </span>
                    <span
                        className="font-mono text-xs text-zinc-300"
                        title="Convex task ID"
                    >
                        {taskId.slice(0, 8)}…
                    </span>
                    <button
                        onClick={onReset}
                        className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
                    >
                        ← New task
                    </button>
                </div>
            </div>

            {/* Body: canvas + sidebar */}
            <div className="flex h-[680px] relative">
                <div className="flex-1 min-w-0">
                    <GraphCanvas
                        nodes={nodes}
                        edges={edges}
                        mainImage={mainFile}
                        flaggedImages={flaggedFiles}
                        onNodeSelect={(n) => {
                            setSelectedNode(n);
                            if (n)
                                setLiveNodes((prev) =>
                                    prev.map((p) => (p._id === n._id ? n : p)),
                                );
                        }}
                        onNodesChange={(updated) => {
                            setLiveNodes(updated);
                            setSelectedNode((sel) =>
                                sel
                                    ? (updated.find((n) => n._id === sel._id) ??
                                      null)
                                    : null,
                            );
                        }}
                    />
                </div>

                <Sidebar
                    nodes={nodes}
                    edges={edges}
                    mainFile={mainFile}
                    flaggedFiles={flaggedFiles}
                    selectedNode={selectedNode}
                />

                {/* Processing overlay — shown until backend delivers nodes */}
                {isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm pointer-events-none">
                        <div className="pointer-events-auto flex flex-col items-center gap-4 bg-white rounded-2xl border border-zinc-200 shadow-md px-8 py-7 max-w-xs text-center">
                            <svg
                                className="w-5 h-5 animate-spin text-zinc-400"
                                fill="none"
                                viewBox="0 0 24 24"
                            >
                                <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                />
                                <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8v8H4z"
                                />
                            </svg>
                            <div>
                                <p className="text-sm font-medium text-zinc-800">
                                    Waiting for analysis
                                </p>
                                <p className="text-xs text-zinc-400 mt-1">
                                    The backend will map nodes directly onto the
                                    image once processing is complete.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Root ──────────────────────────────────────────────────────────────────────

type Step = "main" | "flagged" | "canvas";

export default function Home() {
    const [step, setStep] = useState<Step>("main");
    const [mainFile, setMainFile] = useState<File | null>(null);
    const [taskId, setTaskId] = useState<Id<"tasks"> | null>(null);
    const [flaggedFiles, setFlaggedFiles] = useState<File[]>([]);

    function reset() {
        setStep("main");
        setMainFile(null);
        setTaskId(null);
        setFlaggedFiles([]);
    }

    return (
        <main className="min-h-screen bg-zinc-50 flex items-start justify-center py-16 px-4">
            {step === "main" && (
                <StepMain
                    onContinue={(f, id) => {
                        setMainFile(f);
                        setTaskId(id);
                        setStep("flagged");
                    }}
                />
            )}
            {step === "flagged" && mainFile && (
                <StepFlagged
                    mainFile={mainFile}
                    onSubmit={(f) => {
                        setFlaggedFiles(f);
                        setStep("canvas");
                    }}
                />
            )}
            {step === "canvas" && mainFile && taskId && (
                <CanvasView
                    mainFile={mainFile}
                    taskId={taskId}
                    flaggedFiles={flaggedFiles}
                    onReset={reset}
                />
            )}
        </main>
    );
}

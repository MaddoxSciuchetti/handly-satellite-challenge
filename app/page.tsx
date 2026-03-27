"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GraphCanvas } from "./GraphCanvas";

// ─── Upload view ────────────────────────────────────────────────────────────

function UploadView({ onTaskCreated }: { onTaskCreated: (id: Id<"tasks">) => void }) {
    const [images, setImages] = useState<File[]>([]);
    const [taskName, setTaskName] = useState("");
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const generateUploadUrl = useMutation(api.tasks.generateUploadUrl);
    const createTask = useMutation(api.tasks.createTask);

    function handleFiles(files: FileList | null) {
        if (!files) return;
        // Accept any file — satellite formats (GeoTIFF, etc.) often have no MIME type
        setImages((prev) => [...prev, ...Array.from(files)]);
    }

    function removeImage(index: number) {
        setImages((prev) => prev.filter((_, i) => i !== index));
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (images.length === 0) return;
        setUploading(true);
        setError(null);

        try {
            const uploadUrl = await generateUploadUrl();
            const res = await fetch(uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": images[0].type || "application/octet-stream" },
                body: images[0],
            });
            if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
            const { storageId } = await res.json();
            const taskId = await createTask({ imageId: storageId });
            onTaskCreated(taskId);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
            setUploading(false);
        }
    }

    return (
        <div className="w-full max-w-xl bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
            <h1 className="text-2xl font-semibold text-zinc-900 mb-1">New Task</h1>
            <p className="text-sm text-zinc-500 mb-6">Upload a satellite image for analysis.</p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-zinc-700" htmlFor="task-name">
                        Task name
                    </label>
                    <input
                        id="task-name"
                        type="text"
                        value={taskName}
                        onChange={(e) => setTaskName(e.target.value)}
                        placeholder="e.g. Field analysis – March 2026"
                        required
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                </div>

                <div
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => inputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 py-10 cursor-pointer hover:border-zinc-500 hover:bg-zinc-100 transition-colors"
                >
                    <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <p className="text-sm text-zinc-600 font-medium">Click or drag image here</p>
                    <p className="text-xs text-zinc-400">PNG, JPG, TIFF, WebP</p>
                    <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                </div>

                {images.length > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                        {images.map((file, i) => (
                            <div key={i} className="relative group rounded-lg overflow-hidden border border-zinc-200 aspect-square">
                                <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => removeImage(i)}
                                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    ✕
                                </button>
                                <p className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-xs px-1 py-0.5 truncate">{file.name}</p>
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <p className="text-sm text-red-500">{error}</p>
                )}

                <button
                    type="submit"
                    disabled={images.length === 0 || !taskName || uploading}
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {uploading ? "Uploading…" : "Submit task"}
                </button>
            </form>
        </div>
    );
}

// ─── Processing / Results view ───────────────────────────────────────────────

function ResultsView({ taskId, onReset }: { taskId: Id<"tasks">; onReset: () => void }) {
    const task = useQuery(api.tasks.getTask, { taskId });
    const nodes = useQuery(api.tasks.getNodes, { taskId });
    const edges = useQuery(api.tasks.getEdges, { taskId });
    const simulate = useMutation(api.tasks.devSimulateCompletion);

    const isDone = task?.status === "done";

    return (
        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
                <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${isDone ? "bg-emerald-500" : "bg-amber-400 animate-pulse"}`} />
                    <span className="text-sm font-medium text-zinc-800">
                        {isDone ? "Analysis complete" : "Processing image…"}
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    {isDone && (
                        <span className="text-xs text-zinc-400">
                            {nodes?.length ?? 0} nodes · {edges?.length ?? 0} edges
                        </span>
                    )}
                    <button onClick={onReset} className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors">
                        ← New task
                    </button>
                </div>
            </div>

            {/* Canvas area */}
            <div className="w-full h-[600px] bg-zinc-50 flex items-center justify-center">
                {!isDone ? (
                    <div className="flex flex-col items-center gap-4 text-zinc-400">
                        <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        <span className="text-sm">Waiting for results</span>
                        <button
                            onClick={() => simulate({ taskId })}
                            className="mt-2 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-800 transition-colors"
                        >
                            [dev] simulate completion
                        </button>
                    </div>
                ) : nodes && edges ? (
                    <GraphCanvas nodes={nodes} edges={edges} />
                ) : null}
            </div>
        </div>
    );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export default function Home() {
    const [taskId, setTaskId] = useState<Id<"tasks"> | null>(null);

    return (
        <main className="min-h-screen bg-zinc-50 flex items-start justify-center py-16 px-4">
            {taskId ? (
                <ResultsView taskId={taskId} onReset={() => setTaskId(null)} />
            ) : (
                <UploadView onTaskCreated={setTaskId} />
            )}
        </main>
    );
}

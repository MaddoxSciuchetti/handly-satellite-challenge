"use client";

import { useRef, useState } from "react";
import { GraphCanvas } from "./GraphCanvas";

// ── Mock data (mimics what the Python backend will produce) ──────────────────

function generateMockGraph() {
  type Node = { _id: string; x: number; y: number };
  type Edge = { _id: string; fromNodeId: string; toNodeId: string };

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // A loose grid with some noise — realistic for road/field network extraction
  const cols = 8, rows = 6;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({
        _id: `n-${r}-${c}`,
        x: 80 + c * 100 + (Math.random() - 0.5) * 40,
        y: 80 + r * 90 + (Math.random() - 0.5) * 30,
      });
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1) edges.push({ _id: `e-h-${r}-${c}`, fromNodeId: `n-${r}-${c}`, toNodeId: `n-${r}-${c + 1}` });
      if (r < rows - 1) edges.push({ _id: `e-v-${r}-${c}`, fromNodeId: `n-${r}-${c}`, toNodeId: `n-${r + 1}-${c}` });
    }
  }

  return { nodes, edges };
}

const MOCK = generateMockGraph();

// ── Upload view ──────────────────────────────────────────────────────────────

function UploadView({ onSubmit }: { onSubmit: (file: File) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [taskName, setTaskName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (files?.[0]) setFile(files[0]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !taskName) return;
    onSubmit(file);
  }

  return (
    <div className="w-full max-w-xl bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">New Task</h1>
      <p className="text-sm text-zinc-500 mb-6">Upload a satellite image for analysis.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700" htmlFor="task-name">Task name</label>
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
          {file ? (
            <p className="text-sm text-zinc-700 font-medium">{file.name}</p>
          ) : (
            <>
              <p className="text-sm text-zinc-600 font-medium">Click or drag image here</p>
              <p className="text-xs text-zinc-400">PNG, JPG, TIFF, WebP</p>
            </>
          )}
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        </div>

        <button
          type="submit"
          disabled={!file || !taskName}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Submit task
        </button>
      </form>
    </div>
  );
}

// ── Canvas view ──────────────────────────────────────────────────────────────

function CanvasView({ file, onReset }: { file: File; onReset: () => void }) {
  const { nodes, edges } = MOCK;

  return (
    <div className="w-full max-w-5xl bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-zinc-800">Analysis complete</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-zinc-400">{nodes.length} nodes · {edges.length} edges</span>
          <span className="text-xs text-zinc-400">{file.name}</span>
          <button onClick={onReset} className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors">
            ← New task
          </button>
        </div>
      </div>

      <div className="w-full h-[600px]">
        <GraphCanvas nodes={nodes} edges={edges} imageFile={file} />
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <main className="min-h-screen bg-zinc-50 flex items-start justify-center py-16 px-4">
      {file ? (
        <CanvasView file={file} onReset={() => setFile(null)} />
      ) : (
        <UploadView onSubmit={setFile} />
      )}
    </main>
  );
}

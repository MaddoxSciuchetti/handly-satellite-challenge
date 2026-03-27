"use client";

import { useState, useRef } from "react";

export default function Home() {
  const [images, setImages] = useState<File[]>([]);
  const [taskName, setTaskName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const valid = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setImages((prev) => [...prev, ...valid]);
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: wire up to Convex once schema is ready
    alert(`Task "${taskName}" submitted with ${images.length} image(s).`);
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-start justify-center py-16 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
        <h1 className="text-2xl font-semibold text-zinc-900 mb-1">New Task</h1>
        <p className="text-sm text-zinc-500 mb-6">Upload satellite images for analysis.</p>

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

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 py-10 cursor-pointer hover:border-zinc-500 hover:bg-zinc-100 transition-colors"
          >
            <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm text-zinc-600 font-medium">Click or drag images here</p>
            <p className="text-xs text-zinc-400">PNG, JPG, TIFF, WebP</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {/* Previews */}
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {images.map((file, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden border border-zinc-200 aspect-square">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                  <p className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-xs px-1 py-0.5 truncate">
                    {file.name}
                  </p>
                </div>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={images.length === 0 || !taskName}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Submit task
          </button>
        </form>
      </div>
    </main>
  );
}

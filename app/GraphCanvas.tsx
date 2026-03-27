"use client";

import { useEffect, useRef, useState } from "react";

type Node = { _id: string; x: number; y: number };
type Edge = { _id: string; fromNodeId: string; toNodeId: string };

export type { Node, Edge };

interface Props {
  nodes: Node[];
  edges: Edge[];
  mainImage?: File;
  flaggedImages?: File[];
  onNodeSelect?: (node: Node | null) => void;
  onNodesChange?: (nodes: Node[]) => void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const NODE_HIT_RADIUS = 9; // px in screen space

export function GraphCanvas({ nodes, edges, mainImage, flaggedImages = [], onNodeSelect, onNodesChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });

  // Lock state — true when the main image is "active" for node editing
  const [isLocked, setIsLocked] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  const panDrag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const nodeDrag = useRef<{ nodeId: string; startX: number; startY: number } | null>(null);
  const touchRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const [localNodes, setLocalNodes] = useState<Node[]>(nodes);
  useEffect(() => { setLocalNodes(nodes); }, [nodes]);

  const mainImgRef = useRef<HTMLImageElement | null>(null);
  const flaggedImgsRef = useRef<HTMLImageElement[]>([]);
  const [imgsLoaded, setImgsLoaded] = useState(0);

  // ── Image loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mainImage) return;
    const url = URL.createObjectURL(mainImage);
    const img = new Image();
    img.onload = () => { mainImgRef.current = img; setImgsLoaded((n) => n + 1); };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [mainImage]);

  useEffect(() => {
    if (flaggedImages.length === 0) return;
    const urls = flaggedImages.map((f) => URL.createObjectURL(f));
    flaggedImgsRef.current = [];
    let loaded = 0;
    urls.forEach((url, i) => {
      const img = new Image();
      img.onload = () => {
        flaggedImgsRef.current[i] = img;
        if (++loaded === urls.length) setImgsLoaded((n) => n + 1);
      };
      img.src = url;
    });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [flaggedImages]);

  // ── Touch (passive:false for preventDefault) ─────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mid = (t: typeof touchRef.current) => ({ x: (t!.x0 + t!.x1) / 2, y: (t!.y0 + t!.y1) / 2 });
    const dist = (t: typeof touchRef.current) => Math.hypot(t!.x1 - t!.x0, t!.y1 - t!.y0);

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      touchRef.current = {
        x0: e.touches[0].clientX - r.left, y0: e.touches[0].clientY - r.top,
        x1: e.touches[1].clientX - r.left, y1: e.touches[1].clientY - r.top,
      };
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2 || !touchRef.current) return;
      e.preventDefault();
      const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const next = {
        x0: e.touches[0].clientX - r.left, y0: e.touches[0].clientY - r.top,
        x1: e.touches[1].clientX - r.left, y1: e.touches[1].clientY - r.top,
      };
      const pm = mid(touchRef.current), nm = mid(next);
      const factor = dist(touchRef.current) > 0 ? dist(next) / dist(touchRef.current) : 1;
      setScale((s) => {
        const ns = Math.min(Math.max(s * factor, MIN_SCALE), MAX_SCALE);
        setOffset((o) => ({ x: nm.x - (pm.x - o.x) * (ns / s), y: nm.y - (pm.y - o.y) * (ns / s) }));
        return ns;
      });
      touchRef.current = next;
    }

    function onTouchEnd(e: TouchEvent) { if (e.touches.length < 2) touchRef.current = null; }

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // ── Resize ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Fit on first load ────────────────────────────────────────────────────────

  useEffect(() => {
    if (localNodes.length === 0) return;
    const { w, h } = canvasSize;
    const xs = localNodes.map((n) => n.x), ys = localNodes.map((n) => n.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const [gw, gh] = [maxX - minX || 1, maxY - minY || 1];
    const pad = 80;
    const s = Math.min((w - pad * 2) / gw, (h - pad * 2) / gh, 4);
    setScale(s);
    setOffset({ x: w / 2 - (minX + gw / 2) * s, y: h / 2 - (minY + gh / 2) * s });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.w, canvasSize.h]);

  // ── Draw ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = canvasSize;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    const mainImg = mainImgRef.current;
    const mainW = mainImg ? mainImg.naturalWidth : 800;
    const mainH = mainImg ? mainImg.naturalHeight : 600;
    const gap = 40;

    // ── Main image
    if (mainImg) {
      ctx.globalAlpha = isLocked ? 0.92 : 0.6;
      ctx.drawImage(mainImg, 0, 0, mainW, mainH);
      ctx.globalAlpha = 1;
    }

    // Locked: blue border + subtle inner glow
    if (isLocked) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 3 / scale;
      ctx.shadowColor = "#3b82f6";
      ctx.shadowBlur = 10 / scale;
      ctx.strokeRect(0, 0, mainW, mainH);
      ctx.shadowBlur = 0;

      // "Editing" badge
      const bh = 20 / scale, fs = 10 / scale, bw = 60 / scale;
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(0, 0, bw, bh);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText("EDITING", 4 / scale, bh / 2);
    }

    // ── Flagged images — faded when locked
    const flagged = flaggedImgsRef.current;
    let fy = 0;
    const fx = mainW + gap;
    for (let i = 0; i < flagged.length; i++) {
      const fi = flagged[i];
      if (!fi) continue;
      ctx.globalAlpha = isLocked ? 0.15 : 0.45;
      ctx.drawImage(fi, fx, fy, fi.naturalWidth, fi.naturalHeight);
      ctx.globalAlpha = 1;

      if (!isLocked) {
        ctx.fillStyle = "rgba(251,191,36,0.18)";
        ctx.fillRect(fx, fy, fi.naturalWidth, fi.naturalHeight);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2 / scale;
        ctx.setLineDash([6 / scale, 4 / scale]);
        ctx.strokeRect(fx, fy, fi.naturalWidth, fi.naturalHeight);
        ctx.setLineDash([]);
        const bh = 22 / scale, fs = 11 / scale;
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(fx, fy, 72 / scale, bh);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText("FLAGGED", fx + 5 / scale, fy + bh / 2);
      }

      fy += fi.naturalHeight + gap;
    }

    // ── Edges
    const nodeById: Record<string, Node> = {};
    for (const n of localNodes) nodeById[n._id] = n;
    ctx.strokeStyle = isLocked ? "#3f3f46" : "#71717a";
    ctx.lineWidth = (isLocked ? 1.5 : 1) / scale;
    for (const edge of edges) {
      const from = nodeById[edge.fromNodeId], to = nodeById[edge.toNodeId];
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    // ── Nodes
    const r = (isLocked ? 5 : 4) / scale;
    for (const node of localNodes) {
      const isSelected = node._id === selectedId;
      const isHovered = node._id === hoveredId;

      // Hover ring
      if (isHovered && isLocked && !isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 5 / scale, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(59,130,246,0.15)";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? "#2563eb" : isLocked ? "#18181b" : "#52525b";
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = "#93c5fd";
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4 / scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [localNodes, edges, offset, scale, selectedId, hoveredId, isLocked, imgsLoaded, canvasSize]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toGraph(screenX: number, screenY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (screenX - rect.left - offset.x) / scale, y: (screenY - rect.top - offset.y) / scale };
  }

  function hitNode(gx: number, gy: number): Node | null {
    const threshold = NODE_HIT_RADIUS / scale;
    for (const n of localNodes) {
      if (Math.hypot(n.x - gx, n.y - gy) < threshold) return n;
    }
    return null;
  }

  function inMainImage(gx: number, gy: number): boolean {
    const img = mainImgRef.current;
    const w = img ? img.naturalWidth : 800;
    const h = img ? img.naturalHeight : 600;
    return gx >= 0 && gx <= w && gy >= 0 && gy <= h;
  }

  // ── Mouse events ─────────────────────────────────────────────────────────────

  function onMouseDown(e: React.MouseEvent) {
    const g = toGraph(e.clientX, e.clientY);

    if (!isLocked) {
      if (inMainImage(g.x, g.y)) {
        // Click on main image → lock it
        setIsLocked(true);
        const hit = hitNode(g.x, g.y);
        if (hit) {
          setSelectedId(hit._id);
          onNodeSelect?.(hit);
          nodeDrag.current = { nodeId: hit._id, startX: e.clientX, startY: e.clientY };
        }
      } else {
        // Outside → pan
        panDrag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
      }
      return;
    }

    // Already locked
    if (inMainImage(g.x, g.y)) {
      const hit = hitNode(g.x, g.y);
      if (hit) {
        setSelectedId(hit._id);
        onNodeSelect?.(hit);
        nodeDrag.current = { nodeId: hit._id, startX: e.clientX, startY: e.clientY };
      } else {
        setSelectedId(null);
        onNodeSelect?.(null);
      }
    } else {
      // Click outside main image → unlock
      setIsLocked(false);
      setSelectedId(null);
      setHoveredId(null);
      onNodeSelect?.(null);
      panDrag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    const g = toGraph(e.clientX, e.clientY);
    setCursor({ x: Math.round(g.x), y: Math.round(g.y) });

    // Pan
    if (panDrag.current) {
      setOffset({
        x: panDrag.current.ox + (e.clientX - panDrag.current.startX),
        y: panDrag.current.oy + (e.clientY - panDrag.current.startY),
      });
    }

    // Node drag (locked mode)
    if (nodeDrag.current) {
      const dx = (e.clientX - nodeDrag.current.startX) / scale;
      const dy = (e.clientY - nodeDrag.current.startY) / scale;
      nodeDrag.current.startX = e.clientX;
      nodeDrag.current.startY = e.clientY;
      setLocalNodes((prev) => {
        const updated = prev.map((n) =>
          n._id === nodeDrag.current!.nodeId ? { ...n, x: n.x + dx, y: n.y + dy } : n
        );
        onNodesChange?.(updated);
        return updated;
      });
    }

    // Hover highlight while locked
    if (isLocked && !nodeDrag.current) {
      const hit = hitNode(g.x, g.y);
      setHoveredId(hit ? hit._id : null);
    }
  }

  function onMouseUp() {
    panDrag.current = null;
    nodeDrag.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const next = Math.min(Math.max(scale * factor, MIN_SCALE), MAX_SCALE);
    setOffset({ x: mx - (mx - offset.x) * (next / scale), y: my - (my - offset.y) * (next / scale) });
    setScale(next);
  }

  function zoom(factor: number) {
    const { w, h } = canvasSize;
    const [cx, cy] = [w / 2, h / 2];
    const next = Math.min(Math.max(scale * factor, MIN_SCALE), MAX_SCALE);
    setOffset({ x: cx - (cx - offset.x) * (next / scale), y: cy - (cy - offset.y) * (next / scale) });
    setScale(next);
  }

  function fitView() {
    if (localNodes.length === 0) return;
    const { w, h } = canvasSize;
    const xs = localNodes.map((n) => n.x), ys = localNodes.map((n) => n.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const [gw, gh] = [maxX - minX || 1, maxY - minY || 1];
    const pad = 80;
    const s = Math.min((w - pad * 2) / gw, (h - pad * 2) / gh, 4);
    setScale(s);
    setOffset({ x: w / 2 - (minX + gw / 2) * s, y: h / 2 - (minY + gh / 2) * s });
    setIsLocked(false);
    setSelectedId(null);
  }

  // ── Cursor style ─────────────────────────────────────────────────────────────

  let cursorClass = "cursor-grab";
  if (panDrag.current) cursorClass = "cursor-grabbing";
  else if (isLocked && hoveredId) cursorClass = "cursor-move";
  else if (isLocked) cursorClass = "cursor-crosshair";

  const selected = localNodes.find((n) => n._id === selectedId) ?? null;

  return (
    <div className="flex flex-col h-full">

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-200 bg-white flex-shrink-0 flex-wrap">

        {/* Lock state indicator */}
        {isLocked ? (
          <div className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs text-blue-700 font-medium">
            <IconLock />
            Editing main image
            <button
              onClick={() => { setIsLocked(false); setSelectedId(null); setHoveredId(null); onNodeSelect?.(null); }}
              className="ml-1 text-blue-400 hover:text-blue-700"
              title="Exit edit mode"
            >
              ✕
            </button>
          </div>
        ) : (
          <span className="text-xs text-zinc-400 px-1">Click image to edit nodes</span>
        )}

        <div className="w-px h-4 bg-zinc-200 mx-1" />

        {/* Zoom */}
        <div className="flex items-center gap-0.5">
          <ToolBtn onClick={() => zoom(0.8)} title="Zoom out"><IconMinus /></ToolBtn>
          <span className="w-14 text-center text-xs text-zinc-600 tabular-nums">{Math.round(scale * 100)}%</span>
          <ToolBtn onClick={() => zoom(1.25)} title="Zoom in"><IconPlus /></ToolBtn>
          <ToolBtn onClick={fitView} title="Fit view"><span className="text-xs font-medium">Fit</span></ToolBtn>
        </div>

        <div className="w-px h-4 bg-zinc-200 mx-1" />

        {/* Cursor coords */}
        <div className="flex items-center gap-2 text-xs text-zinc-500 tabular-nums">
          <span className="text-zinc-400">cursor</span>
          <span>X <span className="text-zinc-700">{cursor.x}</span></span>
          <span>Y <span className="text-zinc-700">{cursor.y}</span></span>
        </div>

        {/* Selected node readout */}
        {selected && (
          <>
            <div className="w-px h-4 bg-zinc-200 mx-1" />
            <div className="flex items-center gap-2 text-xs tabular-nums">
              <span className="text-zinc-400">node</span>
              <span className="font-mono text-zinc-500">{selected._id}</span>
              <span>X <span className="text-blue-600 font-medium">{Math.round(selected.x)}</span></span>
              <span>Y <span className="text-blue-600 font-medium">{Math.round(selected.y)}</span></span>
              <button
                onClick={() => { setSelectedId(null); onNodeSelect?.(null); }}
                className="ml-1 text-zinc-400 hover:text-zinc-700"
              >✕</button>
            </div>
          </>
        )}
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-zinc-100">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          className={`absolute inset-0 ${cursorClass}`}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        />
      </div>
    </div>
  );
}

// ── Toolbar primitives ────────────────────────────────────────────────────────

function ToolBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center w-7 h-7 rounded text-zinc-600 hover:bg-zinc-100 transition-colors"
    >
      {children}
    </button>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconLock() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function IconMinus() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M5 12h14" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

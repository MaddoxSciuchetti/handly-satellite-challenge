"use client";

import { useEffect, useRef, useState } from "react";

type Node = { _id: string; x: number; y: number };
type Edge = { _id: string; fromNodeId: string; toNodeId: string };
type Tool = "pan" | "select";

interface Props {
  nodes: Node[];
  edges: Edge[];
  imageFile?: File;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const NODE_RADIUS = 5;

export function GraphCanvas({ nodes, edges, imageFile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<Tool>("pan");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 }); // graph-space coords
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });

  // mutable refs so draw loop doesn't go stale
  const offsetRef = useRef(offset);
  const scaleRef = useRef(scale);
  const nodesRef = useRef(nodes);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const panDrag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const nodeDrag = useRef<{ nodeId: string; startX: number; startY: number } | null>(null);

  // Two-finger touch state
  const touchRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Attach touch listeners with passive:false so preventDefault works
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function midpoint(t: { x0: number; y0: number; x1: number; y1: number }) {
      return { x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2 };
    }
    function dist(t: { x0: number; y0: number; x1: number; y1: number }) {
      return Math.hypot(t.x1 - t.x0, t.y1 - t.y0);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
        touchRef.current = {
          x0: e.touches[0].clientX - rect.left,
          y0: e.touches[0].clientY - rect.top,
          x1: e.touches[1].clientX - rect.left,
          y1: e.touches[1].clientY - rect.top,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2 || !touchRef.current) return;
      e.preventDefault();

      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const next = {
        x0: e.touches[0].clientX - rect.left,
        y0: e.touches[0].clientY - rect.top,
        x1: e.touches[1].clientX - rect.left,
        y1: e.touches[1].clientY - rect.top,
      };

      const prevMid = midpoint(touchRef.current);
      const nextMid = midpoint(next);
      const prevDist = dist(touchRef.current);
      const nextDist = dist(next);
      const zoomFactor = prevDist > 0 ? nextDist / prevDist : 1;

      setScale((s) => {
        const newScale = Math.min(Math.max(s * zoomFactor, MIN_SCALE), MAX_SCALE);
        setOffset((o) => ({
          x: nextMid.x - (prevMid.x - o.x) * (newScale / s),
          y: nextMid.y - (prevMid.y - o.y) * (newScale / s),
        }));
        return newScale;
      });

      touchRef.current = next;
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) touchRef.current = null;
    }

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, []);
  const [localNodes, setLocalNodes] = useState<Node[]>(nodes);
  useEffect(() => { setLocalNodes(nodes); }, [nodes]);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Load image
  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgLoaded(true); };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Resize canvas to container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit on first load
  useEffect(() => {
    if (localNodes.length === 0) return;
    const { w, h } = canvasSize;
    const xs = localNodes.map((n) => n.x);
    const ys = localNodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const gw = maxX - minX || 1;
    const gh = maxY - minY || 1;
    const pad = 80;
    const fitScale = Math.min((w - pad * 2) / gw, (h - pad * 2) / gh, 4);
    setScale(fitScale);
    setOffset({ x: w / 2 - (minX + gw / 2) * fitScale, y: h / 2 - (minY + gh / 2) * fitScale });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.w, canvasSize.h]);

  // Draw
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

    // Image background
    const img = imgRef.current;
    if (img && imgLoaded) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
      ctx.globalAlpha = 1;
    }

    // Edges
    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 1.5 / scale;
    const nodeById: Record<string, Node> = {};
    for (const n of localNodes) nodeById[n._id] = n;
    for (const edge of edges) {
      const from = nodeById[edge.fromNodeId];
      const to = nodeById[edge.toNodeId];
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    // Nodes
    const r = NODE_RADIUS / scale;
    for (const node of localNodes) {
      const isSelected = node._id === selectedId;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? "#2563eb" : "#18181b";
      ctx.fill();
      if (isSelected) {
        ctx.strokeStyle = "#93c5fd";
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3 / scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [localNodes, edges, offset, scale, selectedId, imgLoaded, canvasSize]);

  // Screen → graph coords
  function toGraph(screenX: number, screenY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (screenX - rect.left - offset.x) / scale,
      y: (screenY - rect.top - offset.y) / scale,
    };
  }

  function hitNode(gx: number, gy: number): Node | null {
    const threshold = (NODE_RADIUS + 4) / scale;
    for (const n of localNodes) {
      const dx = n.x - gx, dy = n.y - gy;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return n;
    }
    return null;
  }

  function onMouseDown(e: React.MouseEvent) {
    const g = toGraph(e.clientX, e.clientY);
    if (tool === "select") {
      const hit = hitNode(g.x, g.y);
      if (hit) {
        setSelectedId(hit._id);
        nodeDrag.current = { nodeId: hit._id, startX: e.clientX, startY: e.clientY };
      } else {
        setSelectedId(null);
      }
    } else {
      panDrag.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y };
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    const g = toGraph(e.clientX, e.clientY);
    setCursor({ x: Math.round(g.x), y: Math.round(g.y) });

    if (tool === "pan" && panDrag.current) {
      setOffset({
        x: panDrag.current.originX + (e.clientX - panDrag.current.startX),
        y: panDrag.current.originY + (e.clientY - panDrag.current.startY),
      });
    }

    if (tool === "select" && nodeDrag.current) {
      const dx = (e.clientX - nodeDrag.current.startX) / scale;
      const dy = (e.clientY - nodeDrag.current.startY) / scale;
      nodeDrag.current.startX = e.clientX;
      nodeDrag.current.startY = e.clientY;
      setLocalNodes((prev) =>
        prev.map((n) =>
          n._id === nodeDrag.current!.nodeId
            ? { ...n, x: n.x + dx, y: n.y + dy }
            : n
        )
      );
    }
  }

  function onMouseUp() {
    panDrag.current = null;
    nodeDrag.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const next = Math.min(Math.max(scale * factor, MIN_SCALE), MAX_SCALE);
    setOffset({ x: mx - (mx - offset.x) * (next / scale), y: my - (my - offset.y) * (next / scale) });
    setScale(next);
  }

  function zoom(factor: number) {
    const { w, h } = canvasSize;
    const cx = w / 2, cy = h / 2;
    const next = Math.min(Math.max(scale * factor, MIN_SCALE), MAX_SCALE);
    setOffset({ x: cx - (cx - offset.x) * (next / scale), y: cy - (cy - offset.y) * (next / scale) });
    setScale(next);
  }

  function fitView() {
    if (localNodes.length === 0) return;
    const { w, h } = canvasSize;
    const xs = localNodes.map((n) => n.x);
    const ys = localNodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const gw = maxX - minX || 1, gh = maxY - minY || 1;
    const pad = 80;
    const next = Math.min((w - pad * 2) / gw, (h - pad * 2) / gh, 4);
    setScale(next);
    setOffset({ x: w / 2 - (minX + gw / 2) * next, y: h / 2 - (minY + gh / 2) * next });
  }

  const selected = localNodes.find((n) => n._id === selectedId) ?? null;
  const cursorStyle = tool === "pan" ? (panDrag.current ? "cursor-grabbing" : "cursor-grab") : "cursor-crosshair";

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-200 bg-white flex-shrink-0 flex-wrap">

        {/* Tools */}
        <ToolGroup>
          <ToolBtn active={tool === "pan"} onClick={() => setTool("pan")} title="Pan (drag to move)">
            <IconHand />
          </ToolBtn>
          <ToolBtn active={tool === "select"} onClick={() => setTool("select")} title="Select / move node">
            <IconCursor />
          </ToolBtn>
        </ToolGroup>

        <Divider />

        {/* Zoom */}
        <ToolGroup>
          <ToolBtn onClick={() => zoom(0.8)} title="Zoom out"><IconMinus /></ToolBtn>
          <span className="w-14 text-center text-xs text-zinc-600 tabular-nums">{Math.round(scale * 100)}%</span>
          <ToolBtn onClick={() => zoom(1.25)} title="Zoom in"><IconPlus /></ToolBtn>
          <ToolBtn onClick={fitView} title="Fit view">
            <span className="text-xs font-medium">Fit</span>
          </ToolBtn>
        </ToolGroup>

        <Divider />

        {/* Cursor coords */}
        <div className="flex items-center gap-2 text-xs text-zinc-500 tabular-nums">
          <span className="text-zinc-400">cursor</span>
          <span>X <span className="text-zinc-700">{cursor.x}</span></span>
          <span>Y <span className="text-zinc-700">{cursor.y}</span></span>
        </div>

        {/* Selected node info */}
        {selected && (
          <>
            <Divider />
            <div className="flex items-center gap-2 text-xs tabular-nums">
              <span className="text-zinc-400">node</span>
              <span className="font-mono text-zinc-500">{selected._id}</span>
              <span>X <span className="text-blue-600 font-medium">{Math.round(selected.x)}</span></span>
              <span>Y <span className="text-blue-600 font-medium">{Math.round(selected.y)}</span></span>
              <button onClick={() => setSelectedId(null)} className="ml-1 text-zinc-400 hover:text-zinc-700">✕</button>
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
          className={`absolute inset-0 ${cursorStyle}`}
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

function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <div className="w-px h-4 bg-zinc-200 mx-1" />;
}

function ToolBtn({ children, active, onClick, title }: { children: React.ReactNode; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center w-7 h-7 rounded text-zinc-600 hover:bg-zinc-100 transition-colors ${active ? "bg-zinc-900 text-white hover:bg-zinc-800" : ""}`}
    >
      {children}
    </button>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconHand() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V6a1 1 0 012 0v3m0-3V4a1 1 0 012 0v4m0-4V4a1 1 0 012 0v4m0-3a1 1 0 012 0v6.5M5 15.5a4 4 0 004 4h4a4 4 0 004-4v-4" />
    </svg>
  );
}

function IconCursor() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7 18 3-7 7-3L3 3z" />
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

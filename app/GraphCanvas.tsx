"use client";

import { useEffect, useRef, useState } from "react";

type Node = { _id: string; x: number; y: number };
type Edge = { _id: string; fromNodeId: string; toNodeId: string };

interface Props {
  nodes: Node[];
  edges: Edge[];
}

export function GraphCanvas({ nodes, edges }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Build a lookup so edges can find node positions
  const nodeById = Object.fromEntries(nodes.map((n) => [n._id, n]));

  // Fit graph into view on first load
  useEffect(() => {
    if (nodes.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const gw = maxX - minX || 1;
    const gh = maxY - minY || 1;

    const padding = 60;
    const scaleX = (canvas.width - padding * 2) / gw;
    const scaleY = (canvas.height - padding * 2) / gh;
    const fitScale = Math.min(scaleX, scaleY, 4);

    setScale(fitScale);
    setOffset({
      x: canvas.width / 2 - (minX + gw / 2) * fitScale,
      y: canvas.height / 2 - (minY + gh / 2) * fitScale,
    });
  }, [nodes]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    // Edges
    ctx.strokeStyle = "#d4d4d8";
    ctx.lineWidth = 1 / scale;
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
    const r = Math.max(3 / scale, 1);
    ctx.fillStyle = "#18181b";
    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [nodes, edges, offset, scale, nodeById]);

  function onMouseDown(e: React.MouseEvent) {
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drag.current) return;
    setOffset({
      x: drag.current.originX + (e.clientX - drag.current.startX),
      y: drag.current.originY + (e.clientY - drag.current.startY),
    });
  }

  function onMouseUp() {
    drag.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const next = Math.min(Math.max(scale * delta, 0.05), 20);
    setOffset({
      x: mouseX - (mouseX - offset.x) * (next / scale),
      y: mouseY - (mouseY - offset.y) * (next / scale),
    });
    setScale(next);
  }

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={600}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    />
  );
}

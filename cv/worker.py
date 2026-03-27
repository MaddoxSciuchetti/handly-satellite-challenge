#!/usr/bin/env python3
"""
Convex worker: subscribe to pending tasks, run the roof pipeline, save results.

Usage:
    python worker.py                    # subscribe and process tasks as they arrive
    python worker.py --model vit_b      # use a lighter SAM model
    python worker.py --threshold 0.97   # line-detection confidence threshold
    python worker.py --mask-margin 50   # distance tolerance around roof mask
"""

import os
import sys
import argparse
import tempfile
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

from convex import ConvexClient

# ── pipeline imports (reuse everything from pipeline.py) ──────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cv2
import numpy as np
from pipeline import (
    segment_center_roof,
    predict_lines,
    _lines_to_graph,
    _filter_nodes_by_mask,
    _compact_graph,
    DEFAULT_LINE_THRESHOLD,
)

# ─────────────────────────────────────────────────────────────────────────────

CONVEX_URL = os.environ.get("CONVEX_URL") or os.environ["PUBLIC_CONVEX_URL"]
print(f"[config] CONVEX_URL={CONVEX_URL}")
client = ConvexClient(CONVEX_URL)

# Track which task IDs are already being processed to avoid duplicates
_in_flight: set = set()


def download_image(url: str) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        urllib.request.urlretrieve(url, f.name)
        tmp = Path(f.name)
    bgr = cv2.imread(str(tmp))
    tmp.unlink(missing_ok=True)
    if bgr is None:
        raise ValueError(f"Could not decode image from {url}")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def process_task(task: dict, args: argparse.Namespace) -> None:
    task_id = task["taskId"]
    image_url = task["imageUrl"]
    print(f"\n[task] {task_id}")
    print(f"  imageUrl: {image_url}")

    # ── download ──────────────────────────────────────────────────────────────
    print("  [download] fetching image …")
    rgb = download_image(image_url)
    h, w = rgb.shape[:2]
    print(f"  size: {w}×{h}")

    # ── segmentation ──────────────────────────────────────────────────────────
    print("  [segmentation] …")
    mask = segment_center_roof(rgb, model_type=args.model, text=args.text)
    print(f"  roof area: {mask.astype(bool).mean() * 100:.1f}%")

    # ── line extraction ───────────────────────────────────────────────────────
    print("  [lines] …")
    lines, scores = predict_lines(rgb)
    nodes, edges, scores = _lines_to_graph(lines, scores)
    n_above = int((scores >= args.threshold).sum())
    print(f"  {len(edges)} edges, {len(nodes)} nodes, "
          f"{n_above} above threshold {args.threshold}")

    # ── mask filter ───────────────────────────────────────────────────────────
    if args.mask_margin > 0:
        node_keep = _filter_nodes_by_mask(nodes, mask, args.mask_margin)
        edge_keep = node_keep[edges[:, 0]] & node_keep[edges[:, 1]]
        final_edge_keep = edge_keep & (scores >= args.threshold)
        used_nodes = np.zeros(len(nodes), dtype=bool)
        used_nodes[edges[final_edge_keep].ravel()] = True
        kept_nodes, kept_edges, _ = _compact_graph(
            nodes, edges, scores, used_nodes, final_edge_keep
        )
    else:
        mask_all = scores >= args.threshold
        used_nodes = np.zeros(len(nodes), dtype=bool)
        used_nodes[edges[mask_all].ravel()] = True
        remap = np.full(len(nodes), -1, dtype=np.int64)
        remap[np.where(used_nodes)[0]] = np.arange(used_nodes.sum(), dtype=np.int64)
        kept_nodes = nodes[used_nodes]
        kept_edges = remap[edges[mask_all]]

    print(f"  final graph: {len(kept_nodes)} nodes, {len(kept_edges)} edges")

    # ── normalise to [0,1] ────────────────────────────────────────────────────
    norm_nodes = kept_nodes / np.array([h, w], dtype=np.float32)  # [row,col] → [y,x]

    convex_nodes = [
        {"x": float(n[1]), "y": float(n[0])}   # col → x, row → y
        for n in norm_nodes
    ]
    convex_edges = [
        {"from": float(e[0]), "to": float(e[1])}
        for e in kept_edges
    ]

    # ── save to Convex ────────────────────────────────────────────────────────
    print("  [convex] saving results …")
    client.mutation("tasks:saveGraph", {
        "taskId": task_id,
        "nodes": convex_nodes,
        "edges": convex_edges,
    })
    print(f"  [✓] task {task_id} marked done "
          f"({len(convex_nodes)} nodes, {len(convex_edges)} edges)")


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--model", default="vit_h",
                    choices=["vit_h", "vit_l", "vit_b"],
                    help="SAM model variant (default: vit_h)")
    ap.add_argument("--text",
                    default="Roof in the center. Overlaps behind trees also should be segmented",
                    metavar="PROMPT",
                    help="Text prompt for Grounding DINO")
    ap.add_argument("--threshold", type=float, default=DEFAULT_LINE_THRESHOLD,
                    metavar="T",
                    help=f"Line score threshold (default: {DEFAULT_LINE_THRESHOLD})")
    ap.add_argument("--mask-margin", type=float, default=50.0, metavar="PX",
                    help="Keep lines within this many px of the mask (default: 50; 0=disable)")
    args = ap.parse_args()

    print("[worker] subscribing to tasks:getPendingTasks — Ctrl-C to stop")
    try:
        for tasks in client.subscribe("tasks:getPendingTasks"):
            if not tasks:
                print("[worker] (no pending tasks)")
                continue
            for task in tasks:
                task_id = task["taskId"]
                if task_id in _in_flight:
                    continue
                _in_flight.add(task_id)
                try:
                    process_task(task, args)
                except Exception as exc:
                    print(f"  [!] task {task_id} failed: {exc}", file=sys.stderr)
                finally:
                    # Remove so a retry is possible if the task comes back in_progress
                    _in_flight.discard(task_id)
    except KeyboardInterrupt:
        print("\n[worker] stopped")


if __name__ == "__main__":
    main()

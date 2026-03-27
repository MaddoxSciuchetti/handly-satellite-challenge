#!/usr/bin/env python3
"""
Combined roof pipeline: SAM segmentation + L-CNN line extraction in one pass.

For each input image, outputs go to output/<stem>/:
  sam_roof_mask.png           — binary mask  (0 / 255)
  sam_roof_overlay.png        — green overlay on original
  sam_roof_transparent.png    — RGBA cutout  (roof pixels fully opaque)
  lines.png                   — all edges overlaid on original
  lines_masked.png            — edges filtered by distance to SAM mask
  nodes.npy                   — junction coords [M, 2] row/col  (--save-raw)
  edges.npy                   — edge node-index pairs [N, 2]    (--save-raw)
  scores.npy                  — confidence scores [N]            (--save-raw)
  nodes_masked.npy            — filtered & re-indexed nodes      (--save-raw)
  edges_masked.npy            — filtered & re-indexed edges      (--save-raw)
  scores_masked.npy           — filtered scores                  (--save-raw)

Usage:
    python pipeline.py
    python pipeline.py --images input/roof.jpg
    python pipeline.py --model vit_b --threshold 0.97 --save-raw
    python pipeline.py --mask-margin 80   # wider endpoint tolerance around mask
    python pipeline.py --mask-margin 0    # disable mask filtering
    python pipeline.py --no-lines    # segmentation only
    python pipeline.py --no-segment  # line extraction only
"""

import os
from dotenv import load_dotenv
load_dotenv()

import argparse
import sys
import subprocess
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import skimage.transform
import matplotlib
matplotlib.use("Agg")
from PIL import Image
import torch

# ─── Paths ────────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).resolve().parent
INPUT_DIR  = ROOT / "input"
OUTPUT_DIR = ROOT / "output"
MODELS     = ROOT / "models"
LCNN_DIR   = ROOT / "third_party" / "lcnn"
LCNN_CKPT  = MODELS / "lcnn_pretrained.pth"
LCNN_CFG   = LCNN_DIR / "config" / "wireframe.yaml"

for _d in (INPUT_DIR, OUTPUT_DIR, MODELS):
    _d.mkdir(exist_ok=True)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
DEFAULT_LINE_THRESHOLD = 0.97

# ─── Device ───────────────────────────────────────────────────────────────────
def _device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"

DEVICE = _device()
print(f"[config] device={DEVICE}")


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

def _pip(*pkgs: str) -> None:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", *pkgs])


def _download(url: str, dest: Path, label: str = "") -> None:
    if dest.exists():
        return
    label = label or dest.name
    print(f"[setup] downloading {label} …", flush=True)

    def _hook(blocks, block_size, total):
        if total > 0:
            pct = min(blocks * block_size / total * 100, 100)
            print(f"\r  {pct:5.1f}%", end="", flush=True)

    urllib.request.urlretrieve(url, dest, reporthook=_hook)
    print()


# ══════════════════════════════════════════════════════════════════════════════
# Segmentation  (segment.py)
# ══════════════════════════════════════════════════════════════════════════════

SAM_MODELS = {
    "vit_h": (
        MODELS / "sam_vit_h_4b8939.pth",
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth",
        "SAM ViT-H (~2.4 GB)",
    ),
    "vit_l": (
        MODELS / "sam_vit_l_0b3195.pth",
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth",
        "SAM ViT-L (~1.2 GB)",
    ),
    "vit_b": (
        MODELS / "sam_vit_b_01ec64.pth",
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
        "SAM ViT-B (~375 MB)",
    ),
}

_gdino_proc  = None
_gdino_model = None
GDINO_MODEL_ID = "IDEA-Research/grounding-dino-base"


def _get_gdino():
    global _gdino_proc, _gdino_model
    if _gdino_model is None:
        try:
            from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        except ImportError:
            _pip("transformers", "accelerate")
            from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        print(f"[setup] loading {GDINO_MODEL_ID} …")
        _gdino_proc  = AutoProcessor.from_pretrained(GDINO_MODEL_ID)
        _gdino_model = AutoModelForZeroShotObjectDetection.from_pretrained(
            GDINO_MODEL_ID
        ).to(DEVICE).eval()
    return _gdino_proc, _gdino_model


def _box_from_text(image_pil: Image.Image, text: str, threshold: float = 0.25):
    proc, model = _get_gdino()
    w, h = image_pil.size
    cx, cy = w / 2, h / 2

    if not text.strip().endswith("."):
        text = text.strip() + "."

    inputs = proc(images=image_pil, text=text, return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        outputs = model(**inputs)

    results = proc.post_process_grounded_object_detection(
        outputs,
        inputs["input_ids"],
        box_threshold=threshold,
        text_threshold=threshold,
        target_sizes=[(h, w)],
    )[0]

    boxes  = results["boxes"].cpu().numpy()
    scores = results["scores"].cpu().numpy()

    if len(boxes) == 0:
        return None

    box_cx = (boxes[:, 0] + boxes[:, 2]) / 2
    box_cy = (boxes[:, 1] + boxes[:, 3]) / 2
    dists  = np.hypot(box_cx - cx, box_cy - cy)
    best   = int(np.argmin(dists))
    print(f"  [DINO] '{text.rstrip('.')}' → {len(boxes)} detection(s), "
          f"score={scores[best]:.2f}, centre-dist={dists[best]:.0f}px")
    return boxes[best]


_predictor_cache: dict = {}


def _get_predictor(model_type: str):
    if model_type not in _predictor_cache:
        ckpt_path, url, label = SAM_MODELS[model_type]
        _download(url, ckpt_path, label)
        try:
            import segment_anything  # noqa
        except ImportError:
            print("[setup] installing segment-anything …")
            _pip("git+https://github.com/facebookresearch/segment-anything.git")
        from segment_anything import sam_model_registry, SamPredictor
        sam = sam_model_registry[model_type](checkpoint=str(ckpt_path))
        sam.to(DEVICE)
        _predictor_cache[model_type] = SamPredictor(sam)
        print(f"[SAM] loaded {model_type} on {DEVICE}")
    return _predictor_cache[model_type]


def _postprocess_mask(mask: np.ndarray) -> np.ndarray:
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n_labels <= 1:
        return mask
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = np.where(labels == largest, np.uint8(255), np.uint8(0))

    filled = mask.copy()
    h, w   = mask.shape
    flood_seed = np.zeros((h + 2, w + 2), dtype=np.uint8)
    cv2.floodFill(filled, flood_seed, (0, 0), 255)
    mask[filled == 0] = 255
    return mask


def segment_center_roof(
    image_rgb: np.ndarray,
    model_type: str = "vit_h",
    text: str = "Roof in the center. Overlaps behind trees also should be segmented",
    min_area_frac: float = 0.01,
    max_area_frac: float = 0.80,
) -> np.ndarray:
    predictor = _get_predictor(model_type)
    predictor.set_image(image_rgb)

    h, w = image_rgb.shape[:2]
    cx, cy = w // 2, h // 2
    total_px = h * w

    fg_pts = np.array([[cx, cy]], dtype=float)
    fg_lbl = np.array([1])
    bg_pts = np.array([
        [0,     0    ], [w - 1, 0    ], [0,     h - 1], [w - 1, h - 1],
        [cx,    0    ], [cx,    h - 1], [0,     cy   ], [w - 1, cy   ],
    ], dtype=float)
    bg_lbl = np.zeros(len(bg_pts), dtype=int)

    point_coords = np.concatenate([fg_pts, bg_pts], axis=0)
    point_labels = np.concatenate([fg_lbl, bg_lbl], axis=0)

    box = _box_from_text(Image.fromarray(image_rgb), text)
    if box is None:
        print(f"  [DINO] no detection — falling back to centre-crop box")
        bx0 = int(cx * 0.40); by0 = int(cy * 0.40)
        bx1 = int(cx * 1.60); by1 = int(cy * 1.60)
        box = np.array([bx0, by0, bx1, by1], dtype=float)

    masks, scores, _ = predictor.predict(
        point_coords=point_coords,
        point_labels=point_labels,
        box=box,
        multimask_output=True,
    )

    best_mask, best_score = None, -1.0
    for mask, score in zip(masks, scores):
        if not mask[cy, cx]:
            continue
        area_frac = mask.sum() / total_px
        if area_frac < min_area_frac or area_frac > max_area_frac:
            continue
        adjusted = score - area_frac * 0.3
        if adjusted > best_score:
            best_score, best_mask = adjusted, mask

    if best_mask is None:
        for mask, score in zip(masks, scores):
            if mask[cy, cx] and score > best_score:
                best_score, best_mask = score, mask

    if best_mask is None:
        print("  [!] No mask contained the centre pixel — returning empty mask.")
        return np.zeros((h, w), dtype=np.uint8)

    return _postprocess_mask(best_mask.astype(np.uint8) * 255)


_GREEN = (34, 197, 94)


def _make_overlay(image_rgb: np.ndarray, mask: np.ndarray, alpha: float = 0.45) -> np.ndarray:
    out = image_rgb.astype(np.float32).copy()
    out[mask > 127] = (1 - alpha) * out[mask > 127] + alpha * np.array(_GREEN, dtype=np.float32)
    return np.clip(out, 0, 255).astype(np.uint8)


def _make_transparent(image_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    rgba = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2RGBA)
    rgba[:, :, 3] = mask
    return rgba


# ══════════════════════════════════════════════════════════════════════════════
# Line extraction  (extract_lines.py)
# ══════════════════════════════════════════════════════════════════════════════

_lcnn_model   = None
_image_mean   = None
_image_stddev = None


def _get_lcnn():
    global _lcnn_model, _image_mean, _image_stddev
    if _lcnn_model is not None:
        return _lcnn_model

    if str(LCNN_DIR) not in sys.path:
        sys.path.insert(0, str(LCNN_DIR))

    import lcnn
    from lcnn.config import C, M
    from lcnn.models.line_vectorizer import LineVectorizer
    from lcnn.models.multitask_learner import MultitaskHead, MultitaskLearner

    C.update(C.from_yaml(filename=str(LCNN_CFG)))
    M.update(C.model)

    _image_mean   = np.array(M.image.mean,   dtype=np.float32)
    _image_stddev = np.array(M.image.stddev, dtype=np.float32)

    checkpoint = torch.load(str(LCNN_CKPT), map_location=DEVICE)
    model = lcnn.models.hg(
        depth=M.depth,
        head=lambda c_in, c_out: MultitaskHead(c_in, c_out),
        num_stacks=M.num_stacks,
        num_blocks=M.num_blocks,
        num_classes=sum(sum(M.head_size, [])),
    )
    model = MultitaskLearner(model)
    model = LineVectorizer(model)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(DEVICE).eval()
    _lcnn_model = model
    print(f"[model] LCNN loaded on {DEVICE}")
    return _lcnn_model


def predict_lines(image_rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    model = _get_lcnn()
    h0, w0 = image_rgb.shape[:2]
    device = torch.device(DEVICE)

    im_resized = skimage.transform.resize(image_rgb, (512, 512)) * 255
    image = (im_resized - _image_mean) / _image_stddev
    image_t = torch.from_numpy(np.rollaxis(image, 2)[None].copy()).float()

    with torch.no_grad():
        input_dict = {
            "image": image_t.to(device),
            "meta": [{
                "junc": torch.zeros(1, 2).to(device),
                "jtyp": torch.zeros(1, dtype=torch.uint8).to(device),
                "Lpos": torch.zeros(2, 2, dtype=torch.uint8).to(device),
                "Lneg": torch.zeros(2, 2, dtype=torch.uint8).to(device),
            }],
            "target": {
                "jmap": torch.zeros([1, 1, 128, 128]).to(device),
                "joff": torch.zeros([1, 1, 2, 128, 128]).to(device),
            },
            "mode": "testing",
        }
        H = model(input_dict)["preds"]

    lines  = H["lines"][0].cpu().numpy() / 128 * np.array([h0, w0])
    scores = H["score"][0].cpu().numpy()

    for i in range(1, len(lines)):
        if (lines[i] == lines[0]).all():
            lines  = lines[:i]
            scores = scores[:i]
            break

    from lcnn.postprocess import postprocess
    diag = (h0 ** 2 + w0 ** 2) ** 0.5
    lines, scores = postprocess(lines, scores, diag * 0.01, 0, False)
    return lines.astype(np.float32), scores.astype(np.float32)


def _score_to_colour(score: float, vmin: float = 0.9, vmax: float = 1.0):
    t = np.clip((score - vmin) / (vmax - vmin), 0.0, 1.0)
    r = np.clip(1.5 - abs(t * 4 - 3), 0, 1)
    g = np.clip(1.5 - abs(t * 4 - 2), 0, 1)
    b = np.clip(1.5 - abs(t * 4 - 1), 0, 1)
    return (int(b * 255), int(g * 255), int(r * 255))


# ══════════════════════════════════════════════════════════════════════════════
# Graph representation and mask-based filtering
# ══════════════════════════════════════════════════════════════════════════════

def _lines_to_graph(
    lines: np.ndarray,
    scores: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Convert raw line array to a graph with deduplicated nodes.

    Args:
        lines:  [N, 2, 2] float32 — N lines, each with 2 endpoints [row, col]
        scores: [N] float32

    Returns:
        nodes:  [M, 2] float32 — unique junction coordinates [row, col]
        edges:  [N, 2] int64   — pairs of node indices
        scores: [N] float32    — one score per edge (unchanged)
    """
    all_pts = lines.reshape(-1, 2)                            # [2N, 2]
    # Round sub-pixel to merge near-identical junctions from the detector
    pts_key = np.round(all_pts, decimals=1)
    nodes, inverse = np.unique(pts_key, axis=0, return_inverse=True)
    edges = inverse.reshape(-1, 2)                            # [N, 2]
    return nodes.astype(np.float32), edges.astype(np.int64), scores


def _filter_nodes_by_mask(
    nodes: np.ndarray,
    mask: np.ndarray,
    margin_px: float,
) -> np.ndarray:
    """Return bool array [M]: True for nodes within margin_px of the mask.

    Edges are then kept only when both their nodes pass this test, so a long
    line that merely grazes the mask boundary is removed entirely.
    """
    inv  = np.where(mask > 0, np.uint8(0), np.uint8(255))
    dist = cv2.distanceTransform(inv, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    h, w = mask.shape
    keep = np.zeros(len(nodes), dtype=bool)
    for i, pt in enumerate(nodes):
        r = int(np.clip(pt[0], 0, h - 1))
        c = int(np.clip(pt[1], 0, w - 1))
        keep[i] = dist[r, c] <= margin_px
    return keep


def _overlay_graph(
    image_rgb: np.ndarray,
    nodes: np.ndarray,
    edges: np.ndarray,
    scores: np.ndarray,
    threshold: float,
    edge_keep: np.ndarray | None = None,
) -> np.ndarray:
    """Draw graph edges (and their endpoint nodes) on the image.

    Args:
        edge_keep: optional bool [N] — if given, only draw edges where True.
                   Nodes are drawn only when connected to at least one drawn edge.
    """
    out_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    node_used = np.zeros(len(nodes), dtype=bool)

    for idx, ((i, j), s) in enumerate(zip(edges, scores)):
        if s < threshold:
            continue
        if edge_keep is not None and not edge_keep[idx]:
            continue
        colour = _score_to_colour(s)
        a, b = nodes[i], nodes[j]
        p1 = (int(a[1]), int(a[0]))
        p2 = (int(b[1]), int(b[0]))
        cv2.line(out_bgr, p1, p2, colour, 2, cv2.LINE_AA)
        node_used[i] = True
        node_used[j] = True

    for k, pt in enumerate(nodes):
        if not node_used[k]:
            continue
        cv2.circle(out_bgr, (int(pt[1]), int(pt[0])), 3, (51, 255, 255), -1, cv2.LINE_AA)

    return out_bgr


# ══════════════════════════════════════════════════════════════════════════════
# Graph helpers
# ══════════════════════════════════════════════════════════════════════════════

def _compact_graph(
    nodes: np.ndarray,
    edges: np.ndarray,
    scores: np.ndarray,
    node_keep: np.ndarray,
    edge_keep: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return a self-contained filtered graph with re-indexed nodes."""
    kept_idx = np.where(node_keep)[0]
    remap = np.full(len(nodes), -1, dtype=np.int64)
    remap[kept_idx] = np.arange(len(kept_idx), dtype=np.int64)
    return (
        nodes[kept_idx].copy(),
        remap[edges[edge_keep]].copy(),
        scores[edge_keep].copy(),
    )


def _draw_labeled_graph(
    image_rgb: np.ndarray,
    nodes: np.ndarray,
    edges: np.ndarray | None = None,
) -> np.ndarray:
    """Draw nodes with numeric IDs and optionally edges on the image. Returns BGR."""
    out = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)

    if edges is not None and len(edges) > 0:
        for i, j in edges:
            a, b = nodes[i], nodes[j]
            p1 = (int(a[1]), int(a[0]))
            p2 = (int(b[1]), int(b[0]))
            cv2.line(out, p1, p2, (0, 165, 255), 2, cv2.LINE_AA)

    for node_id, pt in enumerate(nodes):
        cx, cy = int(pt[1]), int(pt[0])
        cv2.circle(out, (cx, cy), 6, (0, 255, 255), -1, cv2.LINE_AA)
        cv2.circle(out, (cx, cy), 6, (0, 0, 0), 1, cv2.LINE_AA)
        label = str(node_id)
        cv2.putText(out, label, (cx + 7, cy - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(out, label, (cx + 7, cy - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1, cv2.LINE_AA)

    return out


def _call_claude_finalize_graph(
    image_bgr: np.ndarray,
    nodes: np.ndarray,
    edges: np.ndarray,
) -> dict:
    """Single AI call: given image with numbered nodes+edges, return the final graph.

    Returns a dict with:
      remove_nodes   — list[int]                   node IDs to drop
      add_edges      — list[[int,int]]              new edges between existing nodes
      add_nodes      — list[{"col":int,"row":int}]  new junction coords to append
      add_node_edges — list[[int,int]]              edges referencing new nodes
                       (ID len(nodes)+k maps to add_nodes[k])
    """
    import anthropic
    import base64
    import json
    import re

    _, buf = cv2.imencode(".png", image_bgr)
    b64 = base64.standard_b64encode(buf).decode()
    h, w = image_bgr.shape[:2]
    n_nodes = len(nodes)

    client = anthropic.Anthropic(api_key=os.environ["CLAUDE_KEY"])
    msg = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": b64},
                },
                {
                    "type": "text",
                    "text": (
                        f"This is a {w}×{h} satellite image of a building roof viewed from above.\n"
                        f"Yellow circles with white numbers (0–{n_nodes - 1}) are detected roof "
                        f"junction nodes. Orange lines are detected roof edges.\n\n"
                        f"Your task is to produce the FINAL clean roof graph. Return a single JSON "
                        f"object with these keys:\n\n"
                        f"  \"remove_nodes\": list of node IDs to remove because they are NOT "
                        f"part of this roof (on ground, vegetation, adjacent building, or noise).\n\n"
                        f"  \"add_edges\": list of [i, j] pairs (using existing node IDs 0–{n_nodes - 1}) "
                        f"for missing edges that connect visible roof ridges or boundaries. "
                        f"Do NOT repeat edges already drawn as orange lines.\n\n"
                        f"  \"add_nodes\": list of {{\"col\": X, \"row\": Y}} objects for roof junction "
                        f"points that are clearly missing but can be inferred from the geometry of "
                        f"surrounding nodes (e.g. a corner implied by two converging ridges, or a "
                        f"symmetric counterpart). Only add nodes you are confident about. "
                        f"Coordinates are in image pixels (col=x from left, row=y from top).\n\n"
                        f"  \"add_node_edges\": list of [i, j] pairs connecting new nodes (ID "
                        f"{n_nodes} for the first add_nodes entry, {n_nodes + 1} for the second, "
                        f"etc.) to existing or other new nodes.\n\n"
                        f"Return ONLY the JSON object, no other text.\n"
                        f"Example: {{\"remove_nodes\": [3], \"add_edges\": [[0, 4]], "
                        f"\"add_nodes\": [], \"add_node_edges\": []}}"
                    ),
                },
            ],
        }],
    )

    text = msg.content[0].text.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    return {"remove_nodes": [], "add_edges": [], "add_nodes": [], "add_node_edges": []}


# ══════════════════════════════════════════════════════════════════════════════
# Per-image pipeline
# ══════════════════════════════════════════════════════════════════════════════

def process_image(img_path: Path, args: argparse.Namespace) -> None:
    print(f"\n{'═'*60}")
    print(f"  {img_path.name}")
    print(f"{'═'*60}")

    bgr = cv2.imread(str(img_path))
    if bgr is None:
        print(f"  [!] cannot read — skipped")
        return

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    print(f"  size: {w}×{h}")

    out_dir = OUTPUT_DIR / img_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── Segmentation ──────────────────────────────────────────────────────────
    print("\n  [segmentation]")
    mask = segment_center_roof(rgb, model_type=args.model, text=args.text)

    print(f"  roof area: {mask.astype(bool).mean() * 100:.1f}% of image")

    cv2.imwrite(str(out_dir / "sam_roof_mask.png"), mask)
    print(f"  [✓] mask        → {(out_dir / 'sam_roof_mask.png').relative_to(ROOT)}")

    ov_bgr = cv2.cvtColor(_make_overlay(rgb, mask), cv2.COLOR_RGB2BGR)
    cv2.imwrite(str(out_dir / "sam_roof_overlay.png"), ov_bgr)
    print(f"  [✓] overlay     → {(out_dir / 'sam_roof_overlay.png').relative_to(ROOT)}")

    rgba = _make_transparent(rgb, mask)
    Image.fromarray(rgba, "RGBA").save(str(out_dir / "sam_roof_transparent.png"))
    print(f"  [✓] transparent → {(out_dir / 'sam_roof_transparent.png').relative_to(ROOT)}")

    # ── Line extraction ───────────────────────────────────────────────────────
    print("\n  [line extraction]")
    lines, scores = predict_lines(rgb)
    nodes, edges, scores = _lines_to_graph(lines, scores)
    n_above = int((scores >= args.threshold).sum())
    print(f"  {len(edges)} edges, {len(nodes)} nodes, "
            f"{n_above} edges above threshold {args.threshold}")

    # Unfiltered output
    vis_all = _overlay_graph(rgb, nodes, edges, scores, args.threshold)
    cv2.imwrite(str(out_dir / "lines.png"), vis_all)
    print(f"  [✓] lines (all)    → {(out_dir / 'lines.png').relative_to(ROOT)}")

    # Mask-filtered output
    edge_keep = None
    if mask is not None and args.mask_margin > 0:
        node_keep = _filter_nodes_by_mask(nodes, mask, args.mask_margin)
        edge_keep = node_keep[edges[:, 0]] & node_keep[edges[:, 1]]
        n_kept    = int((scores[edge_keep] >= args.threshold).sum())
        n_removed = n_above - n_kept
        print(f"  mask filter (margin={args.mask_margin}px): "
                f"kept {n_kept}, removed {n_removed} above-threshold edges "
                f"({node_keep.sum()}/{len(nodes)} nodes kept)")
        vis_f = _overlay_graph(rgb, nodes, edges, scores, args.threshold, edge_keep)
        cv2.imwrite(str(out_dir / "lines_masked.png"), vis_f)
        print(f"  [✓] lines (masked) → {(out_dir / 'lines_masked.png').relative_to(ROOT)}")
    elif mask is None and args.mask_margin > 0:
        print("  [!] no mask available — skipping mask filter")

    import json
    if edge_keep is not None:
        final_edge_keep = edge_keep & (scores >= args.threshold)
        # Only include nodes that are actually connected to a kept edge
        # (matches what is drawn on lines_masked.png)
        used_nodes = np.zeros(len(nodes), dtype=bool)
        used_nodes[edges[final_edge_keep].ravel()] = True
        kept_nodes, kept_edges, _ = _compact_graph(
            nodes, edges, scores, used_nodes, final_edge_keep
        )
    else:
        mask_all = scores >= args.threshold
        used_nodes = np.zeros(len(nodes), dtype=bool)
        used_nodes[edges[mask_all].ravel()] = True
        kept_nodes, kept_edges = nodes[used_nodes], edges[mask_all]
        # re-index edges after filtering nodes
        remap = np.full(len(nodes), -1, dtype=np.int64)
        remap[np.where(used_nodes)[0]] = np.arange(used_nodes.sum(), dtype=np.int64)
        kept_nodes = nodes[used_nodes]
        kept_edges = remap[edges[mask_all]]

    norm_nodes = kept_nodes / np.array([h, w], dtype=np.float32)
    graph_data = {
        "nodes": norm_nodes.tolist(),
        "edges": kept_edges.tolist(),
    }
    graph_path = out_dir / "graph.json"
    with open(graph_path, "w") as f:
        json.dump(graph_data, f)
    print(f"  [✓] graph.json     → {graph_path.relative_to(ROOT)}")




# ─── CLI ──────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--images", nargs="*", metavar="PATH",
                    help="Specific image files (default: everything in input/)")
    ap.add_argument("--model", default="vit_h", choices=list(SAM_MODELS),
                    help="SAM model variant (default: vit_h)")
    ap.add_argument("--text",
                    default="Roof in the center. Overlaps behind trees also should be segmented",
                    metavar="PROMPT",
                    help="Text prompt for Grounding DINO")
    ap.add_argument("--threshold", type=float, default=DEFAULT_LINE_THRESHOLD, metavar="T",
                    help=f"Score threshold for drawing lines (default: {DEFAULT_LINE_THRESHOLD})")
    ap.add_argument("--save-raw", action="store_true",
                    help="Also save lines.npy / lines_masked.npy and scores*.npy")
    ap.add_argument("--mask-margin", type=float, default=50.0, metavar="PX",
                    help="Keep lines whose closest point to the mask is within this many "
                         "pixels (default: 50; set 0 to disable)")
    ap.add_argument("--no-segment", action="store_true", help="Skip segmentation")
    ap.add_argument("--no-lines",   action="store_true", help="Skip line extraction")
    args = ap.parse_args()

    if args.images:
        images = [Path(p) for p in args.images]
    else:
        images = sorted(p for p in INPUT_DIR.iterdir()
                        if p.suffix.lower() in IMAGE_EXTS)

    if not images:
        print(f"\n[!] No images found in {INPUT_DIR.relative_to(ROOT)}/ — "
              "add .jpg / .png files and rerun.")
        return

    print(f"\n[*] {len(images)} image(s) — SAM: {args.model}, "
          f"line threshold: {args.threshold}")
    print(f"[*] Results → {OUTPUT_DIR.relative_to(ROOT)}/<stem>/")

    for p in images:
        process_image(p, args)

    print(f"\n[✓] Done.")


if __name__ == "__main__":
    main()

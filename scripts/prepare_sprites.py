#!/usr/bin/env python3
"""Sprite preparation pipeline for the whale-girl desktop pet.

Turns the raw exported frames in
``whale_girl_all_sprite_frames_v0.2/whale_girl_sprite_frames/`` into
production-ready, per-animation sprite sheets:

* ``think`` group comes from a white-background sheet: background is removed
  with a border flood-fill over a "near white" mask (safe: it cannot eat the
  white eyes / decorations inside the character because those regions are not
  connected to the image border).
* every frame: residual low-alpha halo (alpha <= 48) is zeroed, and edge
  pixels are de-fringed (unpremultiply against the estimated baked-in
  background colour).
* frames are cropped to the per-animation union content bbox (+2 px padding)
  so every frame of an animation shares one canvas size and the character
  does not jitter; the bottom-centre anchor of the union bbox is recorded
  normalised in the manifest.
* outputs ``app/assets/sprites/<anim>/<anim>_NNN.png`` plus
  ``app/assets/sprites/manifest.json`` and a human-check contact sheet at
  ``scripts/preview_contact_sheet.png``.

Idempotent: re-running regenerates everything from the untouched source dir.
Dev-time tool only (Pillow); not a runtime dependency.

Usage:  python3 scripts/prepare_sprites.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "whale_girl_all_sprite_frames_v0.2" / "whale_girl_sprite_frames"
OUT = ROOT / "app" / "assets" / "sprites"
CONTACT_SHEET = ROOT / "scripts" / "preview_contact_sheet.png"

ALPHA_CUTOFF = 48          # residual halo: alpha <= this -> 0
PADDING = 2                # bbox padding in px
THRESH_ALPHA = 8           # "content" pixel threshold for bbox
WHITE_MIN = 242            # think keying: R,G,B all >= this ...
WHITE_SAT_MAX = 12         # ... and max-min channel spread <= this
BG_WHITE = np.array([254.0, 254.0, 254.0], dtype=np.float64)

MANIFEST_VERSION = 1
GENERATED_BY = "scripts/prepare_sprites.py (Pillow)"


def flood_fill_background(mask: np.ndarray) -> np.ndarray:
    """4-connected flood fill from every border pixel; mask is bool (h, w)."""
    h, w = mask.shape
    reach = np.zeros_like(mask, dtype=bool)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if mask[y, x] and not reach[y, x]:
                reach[y, x] = True
                stack.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if mask[y, x] and not reach[y, x]:
                reach[y, x] = True
                stack.append((y, x))
    while stack:
        y, x = stack.pop()
        if y > 0 and mask[y - 1, x] and not reach[y - 1, x]:
            reach[y - 1, x] = True
            stack.append((y - 1, x))
        if y < h - 1 and mask[y + 1, x] and not reach[y + 1, x]:
            reach[y + 1, x] = True
            stack.append((y + 1, x))
        if x > 0 and mask[y, x - 1] and not reach[y, x - 1]:
            reach[y, x - 1] = True
            stack.append((y, x - 1))
        if x < w - 1 and mask[y, x + 1] and not reach[y, x + 1]:
            reach[y, x + 1] = True
            stack.append((y, x + 1))
    return reach


def dilate(mask: np.ndarray, iterations: int = 2) -> np.ndarray:
    """Cheap 4-neighbour binary dilation via array shifts."""
    out = mask.copy()
    for _ in range(iterations):
        m = out.copy()
        m[1:, :] |= out[:-1, :]
        m[:-1, :] |= out[1:, :]
        m[:, 1:] |= out[:, :-1]
        m[:, :-1] |= out[:, 1:]
        out = m
    return out


def key_white_background(arr: np.ndarray) -> np.ndarray:
    """think frames: remove the white sheet background via border flood fill."""
    rgb = arr[..., :3].astype(np.int16)
    near_white = (rgb >= WHITE_MIN).all(axis=-1) & (
        rgb.max(axis=-1) - rgb.min(axis=-1) <= WHITE_SAT_MAX
    )
    bg = flood_fill_background(near_white)
    out = arr.copy()
    out[bg, 3] = 0
    # anti-aliased fringe ring right at the character edge: near-white pixels
    # adjacent to the removed background. Only these are keyed, so white
    # eyes / decorations enclosed inside the character are preserved.
    fringe = near_white & ~bg & dilate(bg)
    out[fringe, 3] = 0
    return out


def estimate_background(arr: np.ndarray) -> np.ndarray:
    """Estimate the baked-in background colour from faint pixels."""
    alpha = arr[..., 3]
    faint = (alpha > 0) & (alpha <= ALPHA_CUTOFF)
    if faint.sum() >= 16:
        return arr[..., :3][faint].mean(axis=0).astype(np.float64)
    # fallback: sample the four corners
    h, w = alpha.shape
    corners = np.concatenate([
        arr[:2, :2, :3].reshape(-1, 3),
        arr[:2, -2:, :3].reshape(-1, 3),
        arr[-2:, :2, :3].reshape(-1, 3),
        arr[-2:, -2:, :3].reshape(-1, 3),
    ])
    return corners.mean(axis=0).astype(np.float64)


def defringe(arr: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Unpremultiply: subtract the baked background contribution from RGB.

    rgb_premult = fg*a + bg*(1-a)  =>  fg = (rgb - bg*(1-a)) / a
    Applied to semi-transparent edge pixels; fully opaque pixels untouched.
    """
    out = arr.copy().astype(np.float64)
    alpha = out[..., 3]
    semi = (alpha > ALPHA_CUTOFF) & (alpha < 255)
    if not semi.any():
        return arr
    a = alpha[semi][:, None] / 255.0
    rgb = out[..., :3][semi]
    fg = (rgb - bg[None, :] * (1.0 - a)) / a
    out[..., :3][semi] = np.clip(fg, 0, 255)
    return out.astype(np.uint8)


def process_frame(path: Path, is_think: bool) -> tuple[np.ndarray, np.ndarray]:
    """Return (processed RGBA array, background colour used for defringe)."""
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    if is_think:
        arr = key_white_background(arr)
        bg = BG_WHITE
    else:
        bg = estimate_background(arr)
    # kill residual low-alpha halo noise (blue-grey glow, corner specks)
    arr[..., 3][arr[..., 3] <= ALPHA_CUTOFF] = 0
    arr = defringe(arr, bg)
    return arr, bg


def content_bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    rows = np.where((alpha > THRESH_ALPHA).any(axis=1))[0]
    cols = np.where((alpha > THRESH_ALPHA).any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return 0, 0, alpha.shape[1] - 1, alpha.shape[0] - 1
    return int(cols[0]), int(rows[0]), int(cols[-1]), int(rows[-1])


def make_contact_sheet(frames_by_anim: dict[str, list[Image.Image]]) -> None:
    cell = 96
    cols = max(len(f) for f in frames_by_anim.values())
    rows = len(frames_by_anim)
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (40, 44, 52, 255))
    for r, (anim, frames) in enumerate(frames_by_anim.items()):
        for c, fr in enumerate(frames):
            th = fr.copy()
            th.thumbnail((cell - 8, cell - 8))
            x = c * cell + (cell - th.width) // 2
            y = r * cell + (cell - th.height) // 2
            sheet.paste(th, (x, y), th)
    CONTACT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(CONTACT_SHEET)


def main() -> int:
    meta = json.loads((SRC / "animations.json").read_text(encoding="utf-8"))
    manifest = {
        "version": MANIFEST_VERSION,
        "generatedBy": GENERATED_BY,
        "source": "whale_girl_all_sprite_frames_v0.2/whale_girl_sprite_frames",
        "animations": {},
    }
    stats = {}
    sheet_frames: dict[str, list[Image.Image]] = {}
    total = 0

    for anim, info in meta["animations"].items():
        is_think = anim == "think"
        processed = []
        bgs = []
        for fname in info["frames"]:
            arr, bg = process_frame(SRC / anim / fname, is_think)
            processed.append(arr)
            bgs.append(bg)
        # union bbox across the whole group so every frame shares one size
        x0, y0, x1, y1 = zip(*(content_bbox(a[..., 3]) for a in processed))
        ux0 = max(0, min(x0) - PADDING)
        uy0 = max(0, min(y0) - PADDING)
        ux1 = min(processed[0].shape[1] - 1, max(x1) + PADDING)
        uy1 = min(processed[0].shape[0] - 1, max(y1) + PADDING)
        w, h = ux1 - ux0 + 1, uy1 - uy0 + 1

        out_dir = OUT / anim
        out_dir.mkdir(parents=True, exist_ok=True)
        frame_files = []
        imgs = []
        for i, arr in enumerate(processed, 1):
            crop = arr[uy0:uy1 + 1, ux0:ux1 + 1]
            img = Image.fromarray(crop, "RGBA")
            name = f"{anim}_{i:03d}.png"
            img.save(out_dir / name)
            frame_files.append(f"{anim}/{name}")
            imgs.append(img)
            total += 1

        # anchor: bottom-centre of the union content bbox on the original canvas
        anchor_x = ((min(x0) + max(x1) + 1) / 2) / processed[0].shape[1]
        anchor_y = (max(y1) + 1) / processed[0].shape[0]

        manifest["animations"][anim] = {
            "labelZh": info.get("label_zh", anim),
            "frameCount": len(processed),
            "fps": info.get("fps", meta.get("fps_default", 12)),
            "loop": bool(info.get("loop", True)),
            "width": w,
            "height": h,
            "anchorX": round(anchor_x, 4),
            "anchorY": round(anchor_y, 4),
            "frames": frame_files,
        }
        stats[anim] = {
            "frames": len(processed), "w": w, "h": h,
            "anchor": (round(anchor_x, 3), round(anchor_y, 3)),
            "bg": tuple(np.round(np.mean(bgs, axis=0), 1)),
        }
        sheet_frames[anim] = imgs

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    make_contact_sheet(sheet_frames)

    print(f"processed {total} frames -> {OUT}")
    for anim, s in stats.items():
        print(f"  {anim:<10} {s['frames']}f  {s['w']}x{s['h']}  "
              f"anchor=({s['anchor'][0]},{s['anchor'][1]})  bg={s['bg']}")
    print(f"contact sheet: {CONTACT_SHEET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

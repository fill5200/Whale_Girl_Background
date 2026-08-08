#!/usr/bin/env python3
"""切分 AI 生成的贴纸合集大图（PIL，无第三方依赖）。

用法:
  python3 scripts/slice-sheet.py <input.png> --grid 4x3 [--out assets/raw/slices] [--size 256]
  python3 scripts/slice-sheet.py <input.png> --auto [--out ...] [--size 256]
  python3 scripts/slice-sheet.py <input.png> --grid 4x3 --layout idle,working,...   # 按行优先映射状态名

- --grid ROWSxCOLS：按声明网格均分画布，每格做内容 bbox 裁切（子图需互不重叠、格间留白）。
- --auto：下采样 alpha 找空行/空列推断网格（子图互不重叠、格间留白时可靠）。
- --layout：行优先的状态名列表（数量须等于格子数），输出直接命名为 <状态>.png；
  缺省输出 slice-<r>-<c>.png。位置→状态的映射是唯一的（本机无视觉识别，按位置映射）。
- 每个子图：裁透明边距 → 居中补边成正方形 → 缩放到 --size；全透明格子跳过。
- 打印 JSON 报告（尺寸、网格、每片文件名与原 bbox）供核对。
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np  # 内容感知边界等主流程用（本机已验证可用）

from PIL import Image

ALPHA_THRESHOLD = 16


def content_bbox(img):
    """内容 bbox（alpha > 阈值的区域）；全透明返回 None。"""
    return img.getchannel('A').getbbox()


def normalize_slice(img, size):
    """裁透明边距 → 居中补边成正方形 → 缩放到 size。返回 (归一化图, 原内容 bbox)。"""
    bbox = content_bbox(img)
    if bbox is None:
        return None, None
    img = img.crop(bbox)
    w, h = img.size
    side = max(w, h)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    if canvas.size[0] != size:
        canvas = canvas.resize((size, size), Image.LANCZOS)
    return canvas, bbox


def detect_bg(img):
    """背景色估计：边框环像素中位色（贴纸大图背景通常为统一纯色/近白）。"""
    import numpy as np

    arr = np.asarray(img.convert('RGB'), dtype=np.int16)
    border = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    return np.median(border, axis=0).astype(int).tolist()


def chroma_key(img, bg_colors, lo, hi):
    """色键：距任一背景色距离 < lo 的像素置透明，> hi 全不透明，中间软过渡。
    bg_colors 为颜色列表（| 分隔的多色背景，如纯洋红缝隙 + 浅粉格底）。"""
    import numpy as np
    from PIL import ImageFilter

    arr = np.asarray(img.convert('RGB'), dtype=np.int16)
    dist = np.min(
        [np.linalg.norm(arr - np.asarray(bg, dtype=np.int16), axis=2) for bg in bg_colors],
        axis=0,
    )
    alpha = np.clip((dist - lo) / max(1, hi - lo) * 255, 0, 255).astype(np.uint8)
    out = img.convert('RGBA')
    out.putalpha(Image.fromarray(alpha, 'L').filter(ImageFilter.MedianFilter(3)))
    return out


def gray_key(img):
    """亮灰掩膜键：AI 模拟"透明棋盘格"的背景是周期性的灰/白两色（~16px 格，随位置漂移）。
    规则：像素「色彩丰富（饱和度高）**或** 深色（亮度低）」视为内容，其余（亮且灰）透明。
    软阈值会半透明化浅色皮肤（苍白）；--repair 把 alpha 硬化（半透明带→全不透明）救回皮肤，
    代价是真背景边缘的半透明过渡也变硬（贴纸风格可接受）。"""
    import numpy as np
    from PIL import ImageFilter

    arr = np.asarray(img.convert('RGB'), dtype=np.int16)
    sat = arr.max(axis=2) - arr.min(axis=2)
    lum = arr.mean(axis=2)
    a_sat = np.clip((sat - 25) / 35 * 255, 0, 255)  # 饱和 ≥60 全不透明
    a_lum = np.clip((lum - 215) / -40 * 255, 0, 255)  # 亮度 ≤175 全不透明
    alpha = np.maximum(a_sat, a_lum).astype(np.uint8)
    out = img.convert('RGBA')
    out.putalpha(Image.fromarray(alpha, 'L').filter(ImageFilter.MedianFilter(3)))
    return out


def harden_alpha(img):
    """alpha 硬化：≤16 置 0（背景），≥48 置 255（角色，救回被软阈值半透明的浅色皮肤），中间线性。"""
    import numpy as np

    a = np.asarray(img.getchannel('A'), dtype=np.float32)
    a = np.clip((a - 16) / 32 * 255, 0, 255).astype(np.uint8)
    out = img.copy()
    out.putalpha(Image.fromarray(a, 'L'))
    return out


def despill(img, bg_colors):
    """去溢色（色键残边）：对距背景色近（<120）且洋红主导（R,B≫G）的像素做溢色抑制
    （补 G、降 R/B），消除角色边缘洋红描边/光晕。
    不做反解：低 alpha 像素反解 c=(c-(1-α)bg)/α 会把噪声放大成饱和色环（实测）。"""
    import numpy as np

    arr = np.asarray(img.convert('RGBA'), dtype=np.float64)
    rgb = arr[:, :, :3]
    a = arr[:, :, 3] / 255.0
    dists = np.stack([np.linalg.norm(rgb - np.asarray(b, dtype=np.float64), axis=2) for b in bg_colors])
    dmin = np.min(dists, axis=0)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    sp = np.clip(np.minimum(r, b) - g, 0, 255)  # 洋红溢色量
    mask = (dmin < 120) & (sp > 8) & (a > 0.05)
    rgb = np.stack([
        np.where(mask, r - sp * 0.35, r),
        np.where(mask, g + sp * 0.7, g),
        np.where(mask, b - sp * 0.35, b),
    ], axis=2)
    out = img.convert('RGBA')
    data = np.asarray(out, dtype=np.uint8).copy()
    data[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(data)


def profile_bounds(mask, axis, n):
    """内容感知网格边界：沿 axis（0=行，1=列）找空白带，取中间最宽的 n-1 条中心作切分线。
    等分切分会切进相邻角色（实测截脚）；此函数对齐实际格距。返回 n+1 边界；不足时 None。"""
    total = mask.sum(axis=axis)
    length = len(total)
    blank = [i for i, v in enumerate(total) if v < 3]
    gaps = []
    if blank:
        start = prev = blank[0]
        for i in blank[1:]:
            if i - prev > 2:
                gaps.append((start, prev))
                start = i
            prev = i
        gaps.append((start, prev))
    mid = [g for g in gaps if g[0] > length * 0.05 and g[1] < length * 0.95]
    if len(mid) < n - 1:
        return None
    mid.sort(key=lambda g: g[1] - g[0], reverse=True)
    cuts = sorted((g[0] + g[1]) // 2 for g in mid[: n - 1])
    return [0] + cuts + [length]


def content_extent_bounds(mask, axis, n):
    """内容范围等分：在内容实际起止内均匀切 n 段（比整画布等分更贴角色高度）。
    供 profile 无空白带时回退。"""
    total = mask.sum(axis=axis)
    idx = np.nonzero(total > 3)[0]
    if len(idx) < 2:
        return None
    lo, hi = int(idx[0]), int(idx[-1])
    span = hi - lo
    return [lo + round(span * i / n) for i in range(n + 1)]


def detect_grid(img, max_cells=8):
    w, h = img.size
    small = img.resize((64, 64), Image.LANCZOS).getchannel('A')
    data = small.load()
    blank_rows = [all(data[x, y] < ALPHA_THRESHOLD for x in range(64)) for y in range(64)]
    blank_cols = [all(data[x, y] < ALPHA_THRESHOLD for y in range(64)) for x in range(64)]

    def segments(blank):
        runs = []
        start = None
        for i, b in enumerate(blank):
            if not b and start is None:
                start = i
            elif b and start is not None:
                runs.append((start, i - 1))
                start = None
        if start is not None:
            runs.append((start, len(blank) - 1))
        # 合并被 ≤1px 空线隔开的同格内容（抗噪）
        merged = []
        for run in runs:
            if merged and run[0] - merged[-1][1] <= 2:
                merged[-1] = (merged[-1][0], run[1])
            else:
                merged.append(run)
        return merged

    rows = segments(blank_rows)
    cols = segments(blank_cols)
    if not rows or not cols or len(rows) > max_cells or len(cols) > max_cells:
        return None
    row_bounds = [(round(lo * h / 64), round((hi + 1) * h / 64)) for lo, hi in rows]
    col_bounds = [(round(lo * w / 64), round((hi + 1) * w / 64)) for lo, hi in cols]
    return row_bounds, col_bounds


def build_state_sheet(img, row_bounds, col_bounds, row, cols, size):
    """把一行（同一状态的帧）按 union-bbox 对齐后横排拼接成 sheet。
    对齐保证各帧同尺同锚（不各自归一化导致动画抖动）；空帧跳过。"""
    frames = []
    for c in cols:
        (yt, yb), (xl, xr) = row_bounds[row], col_bounds[c]
        cell = img.crop((xl, yt, xr, yb))
        bb = content_bbox(cell)
        if bb is None:
            continue
        frames.append((cell, bb))
    if not frames:
        return None, 0
    x0 = min(bb[0] for _, bb in frames)
    y0 = min(bb[1] for _, bb in frames)
    x1 = max(bb[2] for _, bb in frames)
    y1 = max(bb[3] for _, bb in frames)
    side = max(x1 - x0, y1 - y0)
    if side <= 0:
        return None, 0
    norm = []
    for cell, _ in frames:
        f = cell.crop((x0, y0, x0 + side, y0 + side))
        if f.size[0] != size:
            f = f.resize((size, size), Image.LANCZOS)
        norm.append(f)
    sheet = Image.new('RGBA', (size * len(norm), size), (0, 0, 0, 0))
    for i, f in enumerate(norm):
        sheet.paste(f, (i * size, 0), f)
    return sheet, len(norm)


def main():
    ap = argparse.ArgumentParser(description='切分 AI 贴纸合集大图')
    ap.add_argument('input')
    ap.add_argument('--grid', help='声明网格，如 4x3')
    ap.add_argument('--auto', action='store_true', help='自动检测网格')
    ap.add_argument('--layout', help='行优先状态名列表（数量须等于格子数），如 idle,working,...')
    ap.add_argument('--sheet', help='sheet 模式：网格如 3x3（行为状态、列为帧）')
    ap.add_argument('--states', help='sheet 模式：每行状态名（逗号，数量=行数）')
    ap.add_argument('--frames', help='sheet 模式：每行帧数（逗号，数量=行数）')
    ap.add_argument('--key', metavar='BG', help='抠图：gray=亮灰掩膜；auto=取边框色；或 R,G,B（多色用 | 分隔）')
    ap.add_argument('--repair', action='store_true', help='键后硬化 alpha（救回被半透明的浅色皮肤）')
    ap.add_argument('--key-lo', type=int, default=6, help='色键阈值下界（距背景色距离，默认 6）')
    ap.add_argument('--key-hi', type=int, default=28, help='色键阈值上界（默认 28）')
    ap.add_argument('--out', default='assets/raw/slices')
    ap.add_argument('--size', type=int, default=256)
    ap.add_argument('--crop-margin', type=int, default=0, help='切分前从四边裁剪 N px（去掉 AI 加的网格外框线）')
    args = ap.parse_args()

    if not (args.grid or args.auto or args.sheet):
        ap.error('必须提供 --grid ROWSxCOLS / --auto / --sheet ROWSxCOLS 之一')
    img = Image.open(args.input).convert('RGBA')
    if args.crop_margin > 0:
        img = img.crop((args.crop_margin, args.crop_margin, img.width - args.crop_margin, img.height - args.crop_margin))
        print(f'cropped margin {args.crop_margin}px', file=sys.stderr)

    if args.key:
        if args.key == 'gray':
            img = gray_key(img)
            print('keyed: gray-mask', file=sys.stderr)
        else:
            bgs = [detect_bg(img)] if args.key == 'auto' else [[int(v) for v in c.split(',')] for c in args.key.split('|')]
            img = chroma_key(img, bgs, args.key_lo, args.key_hi)
            img = despill(img, bgs)  # 去边缘溢色（洋红描边）
            print(f'keyed: bg={bgs} lo={args.key_lo} hi={args.key_hi} +despill', file=sys.stderr)
        if args.repair:
            img = harden_alpha(img)
            print('repair: alpha hardened', file=sys.stderr)

    if args.auto:
        grid = detect_grid(img)
        if grid is None:
            print('auto grid detection failed: 未找到清晰网格（子图需互不重叠、格间留白）', file=sys.stderr)
            sys.exit(1)
        row_bounds, col_bounds = grid
    else:
        rows_s, cols_s = (args.sheet or args.grid).lower().split('x')
        rows, cols = int(rows_s), int(cols_s)
        w, h = img.size
        if args.sheet:
            # 内容感知边界：对齐实际格距（等分会切进相邻角色——实测截脚）；
            # profile 无空白带时回退内容范围等分，再回退整画布等分。
            mask = np.asarray(img.getchannel('A')) > 30
            rb = profile_bounds(mask, 0, rows) or content_extent_bounds(mask, 0, rows)
            cb = profile_bounds(mask, 1, cols) or content_extent_bounds(mask, 1, cols)
            if rb is not None and cb is not None:
                row_bounds = [(rb[i], rb[i + 1]) for i in range(rows)]
                col_bounds = [(cb[i], cb[i + 1]) for i in range(cols)]
                print(f'content-aware bounds: rows={rb} cols={cb}', file=sys.stderr)
            else:
                row_bounds = [(round(h * r / rows), round(h * (r + 1) / rows)) for r in range(rows)]
                col_bounds = [(round(w * c / cols), round(w * (c + 1) / cols)) for c in range(cols)]
                print('content bounds failed, fallback equal division', file=sys.stderr)
            # 安全内缩：剥掉相邻角色的残余（截脚），union-bbox 会重新收回到真实内容。
            inset = 12
            row_bounds = [(a + inset, b - inset) for (a, b) in row_bounds if b - a > 2 * inset]
            col_bounds = [(a + inset, b - inset) for (a, b) in col_bounds if b - a > 2 * inset]
        else:
            row_bounds = [(round(h * r / rows), round(h * (r + 1) / rows)) for r in range(rows)]
            col_bounds = [(round(w * c / cols), round(w * (c + 1) / cols)) for c in range(cols)]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # sheet 模式：行为状态、列为帧，union-bbox 对齐拼横排 sheet（多状态图 → 每状态一张）。
    if args.sheet:
        if not (args.states and args.frames):
            ap.error('--sheet 需要 --states 与 --frames')
        states = [s.strip() for s in args.states.split(',')]
        frame_counts = [int(v) for v in args.frames.split(',')]
        if len(states) != len(row_bounds) or len(frame_counts) != len(row_bounds):
            ap.error('--states/--frames 数量须等于网格行数')
        report = {'input': str(args.input), 'size': list(img.size), 'grid': [len(row_bounds), len(col_bounds)], 'sheets': []}
        for r, state in enumerate(states):
            sheet_img, n = build_state_sheet(img, row_bounds, col_bounds, r, range(frame_counts[r]), args.size)
            if sheet_img is None:
                report['sheets'].append({'state': state, 'file': None, 'frames': 0, 'skipped': 'empty'})
                continue
            fname = f'{state}.png'
            sheet_img.save(out / fname)
            report['sheets'].append({'state': state, 'file': fname, 'frames': n})
        print(json.dumps(report, ensure_ascii=False))
        return
    report = {'input': str(args.input), 'size': list(img.size), 'grid': [len(row_bounds), len(col_bounds)], 'slices': []}
    for r, (yt, yb) in enumerate(row_bounds):
        for c, (xl, xr) in enumerate(col_bounds):
            cell = img.crop((xl, yt, xr, yb))
            norm, bbox = normalize_slice(cell, args.size)
            if norm is None:
                report['slices'].append({'r': r, 'c': c, 'file': None, 'bbox': None, 'skipped': 'empty'})
                continue
            name = f'{names[r * len(col_bounds) + c]}.png' if args.layout else f'slice-{r}-{c}.png'
            norm.save(out / name)
            report['slices'].append({'r': r, 'c': c, 'file': name, 'bbox': list(bbox)})
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()

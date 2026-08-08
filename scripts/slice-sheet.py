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


def detect_grid(img, max_cells=8):
    """下采样 alpha 找空行/空列推断网格；返回 (row_bounds, col_bounds) 或 None。"""
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


def main():
    ap = argparse.ArgumentParser(description='切分 AI 贴纸合集大图')
    ap.add_argument('input')
    ap.add_argument('--grid', help='声明网格，如 4x3')
    ap.add_argument('--auto', action='store_true', help='自动检测网格')
    ap.add_argument('--layout', help='行优先状态名列表（数量须等于格子数），如 idle,working,...')
    ap.add_argument('--out', default='assets/raw/slices')
    ap.add_argument('--size', type=int, default=256)
    args = ap.parse_args()

    if not (args.grid or args.auto):
        ap.error('必须提供 --grid ROWSxCOLS 或 --auto')
    img = Image.open(args.input).convert('RGBA')

    if args.auto:
        grid = detect_grid(img)
        if grid is None:
            print('auto grid detection failed: 未找到清晰网格（子图需互不重叠、格间留白）', file=sys.stderr)
            sys.exit(1)
        row_bounds, col_bounds = grid
    else:
        rows_s, cols_s = args.grid.lower().split('x')
        rows, cols = int(rows_s), int(cols_s)
        w, h = img.size
        row_bounds = [(round(h * r / rows), round(h * (r + 1) / rows)) for r in range(rows)]
        col_bounds = [(round(w * c / cols), round(w * (c + 1) / cols)) for c in range(cols)]

    if args.layout:
        names = [s.strip() for s in args.layout.split(',')]
        if len(names) != len(row_bounds) * len(col_bounds):
            print(f'--layout 数量 {len(names)} 与格子数 {len(row_bounds)}x{len(col_bounds)} 不符', file=sys.stderr)
            sys.exit(1)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
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

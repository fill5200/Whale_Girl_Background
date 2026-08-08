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


def bg_floodfill(img, bg_colors, tol):
    """图形学去背景：背景 = 与图像边界 4-连通 的"近背景色"区域（洪泛填充）。
    关键优势：角色内部与背景同色的区域（如粉色脸 vs 粉底）因被轮廓包围而**不连通**→保留；
    颜色键做不到这一点（同色即删）。边缘抗锯齿像素（距背景色稍远）成为"墙"阻断洪泛→
    保留后在 despill 边缘带清理。"""
    import numpy as np
    from PIL import Image as _Image

    arr = np.asarray(img.convert('RGB'), dtype=np.int16)
    dists = [np.linalg.norm(arr - np.asarray(b, dtype=np.int16), axis=2) for b in bg_colors]
    dmin = np.min(np.stack(dists), axis=0)
    bg_mask = dmin < tol
    h, w = bg_mask.shape
    visited = np.zeros_like(bg_mask)
    stack = []
    for x in range(w):
        if bg_mask[0, x] and not visited[0, x]:
            visited[0, x] = True
            stack.append((0, x))
        if bg_mask[h - 1, x] and not visited[h - 1, x]:
            visited[h - 1, x] = True
            stack.append((h - 1, x))
    for y in range(h):
        if bg_mask[y, 0] and not visited[y, 0]:
            visited[y, 0] = True
            stack.append((y, 0))
        if bg_mask[y, w - 1] and not visited[y, w - 1]:
            visited[y, w - 1] = True
            stack.append((y, w - 1))
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and bg_mask[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                stack.append((ny, nx))
    alpha = np.where(visited, 0, 255).astype(np.uint8)
    out = img.convert('RGBA')
    out.putalpha(_Image.fromarray(alpha, 'L'))
    return out


def magenta_free_cleanup(img, sp_thresh=25):
    """全量洋红清除（用户确认：角色=深蓝+白，无任何粉/紫）。
    深蓝 (64,96,144) sp=-32、白 (255,255,255) sp=0——角色所有颜色 sp≤0；
    故 **任何 sp>25 的像素（含内部封闭岛、外部残边、低饱和粉调）都不是角色** → 删。
    不分内外：内部岛（轮廓间隙透出的底色）一并清除，且零误删风险。"""
    import numpy as np
    from PIL import Image as _Image

    arr = np.asarray(img.convert('RGBA'), dtype=np.int16)
    a = arr[:, :, 3]
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    sp = np.minimum(r, b) - g
    kill = (sp > sp_thresh) & (a > 0)
    new_a = np.where(kill, 0, a).astype(np.uint8)
    out = img.convert('RGBA')
    out.putalpha(_Image.fromarray(new_a, 'L'))
    return out


def exterior_magenta_cleanup(img, sp_thresh=40, erode_r=5):
    """轮廓相对分类（用户要点：角色的颜色只在内部，外部底色可辨）：
    腐蚀 alpha 得角色核心（core）；**核心外**（轮廓边缘带/外圈）的粉调像素（sp>阈值）
    = 背景污染 → 删；核心内的粉/紫 = 角色设计色 → 保留。
    比纯颜色规则（sp>120 删）安全：不误删内部设计色，且把低饱和的外部残留也清掉。"""
    import numpy as np
    from PIL import Image as _Image
    from PIL import ImageFilter as _IF

    arr = np.asarray(img.convert('RGBA'), dtype=np.int16)
    a = arr[:, :, 3]
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    sp = np.minimum(r, b) - g
    solid = _Image.fromarray((a > 100).astype(np.uint8) * 255, 'L')
    core = np.asarray(solid.filter(_IF.MinFilter(2 * erode_r + 1))) > 0  # 腐蚀 ~erode_r px
    kill = (sp > sp_thresh) & (a > 0) & (~core)
    new_a = np.where(kill, 0, a).astype(np.uint8)
    out = img.convert('RGBA')
    out.putalpha(_Image.fromarray(new_a, 'L'))
    return out


def closed_islands_cleanup(img, bg_colors):
    """封闭岛清理 + 极洋红微斑清除：
    1) 洪泛只删与图边连通的背景；被角色轮廓包围的**极饱和洋红**岛（sp>120，如 G=32 暗洋红）
       不连通而残留——按颜色删。角色哑光粉/紫内饰 sp≈30~90 且距背景色远，不受影响。
    2) 散布的极洋红微斑（sp>120 且 r,b>170,g<130）——角色按契约不含洋红，直接删。"""
    import numpy as np
    from PIL import Image as _Image

    arr = np.asarray(img.convert('RGB'), dtype=np.int16)
    a = np.asarray(img.convert('RGBA').getchannel('A'), dtype=np.int16)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    sp = np.minimum(r, b) - g
    dists = [np.linalg.norm(arr - np.asarray(bg, dtype=np.int16), axis=2) for bg in bg_colors]
    dmin = np.min(np.stack(dists), axis=0)
    kill = ((sp > 120) & (dmin < 45)) | ((sp > 120) & (r > 170) & (b > 170) & (g < 130))
    kill &= a > 0
    new_a = np.where(kill, 0, a).astype(np.uint8)
    out = img.convert('RGBA')
    out.putalpha(_Image.fromarray(new_a, 'L'))
    return out


def despill(img, bg_colors):
    """去溢色（色键残边）：**只处理空间边缘带**（距透明像素 ≤3px）内的粉调像素——
    背景混合只可能出现在轮廓处；角色内饰色（粉脸/衣服）绝不碰（全域抑制会把粉脸灰化，实测）。"""
    import numpy as np
    from PIL import Image as _Image
    from PIL import ImageFilter as _IF

    arr = np.asarray(img.convert('RGBA'), dtype=np.float64)
    rgb = arr[:, :, :3]
    a = arr[:, :, 3] / 255.0
    dists = np.stack([np.linalg.norm(rgb - np.asarray(b, dtype=np.float64), axis=2) for b in bg_colors])
    dmin = np.min(dists, axis=0)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    sp = np.clip(np.minimum(r, b) - g, 0, 255)
    trans = _Image.fromarray(((a < 0.08) * 255).astype(np.uint8), 'L')
    spatial_edge = np.asarray(trans.filter(_IF.MaxFilter(7))) > 0  # 距透明 ≤3px
    mask = spatial_edge & (dmin < 255) & (sp > 8)
    rgb = np.stack([
        np.where(mask, r - sp * 0.45, r),
        np.where(mask, g + sp * 0.9, g),
        np.where(mask, b - sp * 0.45, b),
    ], axis=2)
    out = img.convert('RGBA')
    data = np.asarray(out, dtype=np.uint8).copy()
    data[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(data)


def defringe(img, erode=1):
    """边缘侵蚀 + 羽化：剥掉含背景混合的最外层，再**强羽化**平滑像素锯齿。
    硬 alpha（洪泛/清理全是 0/255）直接输出会呈现台阶状边缘（锯齿）；
    GaussianBlur(1.5) 把边界变成 ~4px 的平滑渐变。代价：轮廓轻微软化（宠物可接受）。"""
    from PIL import ImageFilter

    a = img.getchannel('A')
    for _ in range(erode):
        a = a.filter(ImageFilter.MinFilter(3))
    a = a.filter(ImageFilter.GaussianBlur(1.5))
    out = img.copy()
    out.putalpha(a)
    return out


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


def frame_extent(cell, margin=14):
    """轮廓分组取帧范围：4-连通标注全部连通域。
    最大连通域 = 角色本体；**吸收与角色 bbox 相邻/相交的小块**（装饰如五角星、
    爱心——独立小连通域，若只取最大域会被裁掉）；邻格角色质心远离 → 排除。
    返回 (union_bbox, 角色bbox)。"""
    from collections import deque

    alpha = np.asarray(cell.getchannel('A'))
    mask = alpha > 40
    h, w = mask.shape
    visited = np.zeros_like(mask)
    comps = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or visited[y0, x0]:
                continue
            area = 0
            minx = maxx = x0
            miny = maxy = y0
            q = deque([(y0, x0)])
            visited[y0, x0] = True
            while q:
                y, x = q.popleft()
                area += 1
                minx = min(minx, x)
                maxx = max(maxx, x)
                miny = min(miny, y)
                maxy = max(maxy, y)
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        q.append((ny, nx))
            comps.append((area, (minx, miny, maxx, maxy)))
    if not comps:
        return None, None
    comps.sort(key=lambda c: -c[0])
    char_bb = comps[0][1]
    cx0, cy0, cx1, cy1 = char_bb
    # 吸收：质心在角色 bbox 外扩 margin 内的连通域（装饰件）
    keep = [char_bb]
    for area, bb in comps[1:]:
        mx, my = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
        if cx0 - margin <= mx <= cx1 + margin and cy0 - margin <= my <= cy1 + margin:
            keep.append(bb)
    ux0 = min(b[0] for b in keep)
    uy0 = min(b[1] for b in keep)
    ux1 = max(b[2] for b in keep)
    uy1 = max(b[3] for b in keep)
    return (ux0, uy0, ux1, uy1), char_bb


def build_state_sheet(img, row_bounds, col_bounds, row, cols, size, scale=0.88, expand=80):
    """把一行（同一状态的帧）做成帧 sheet（轮廓法逐对象配准）：
    先抠图（调用方完成）→ **格子四向放宽 expand px**（格子边界不再切角色）→
    每帧取**轮廓分组范围**（最大连通域=角色 + 吸收相邻装饰件；排除邻格角色）→
    统一缩放因子 → 底中对齐。"""
    frames = []
    for c in cols:
        (yt, yb), (xl, xr) = row_bounds[row], col_bounds[c]
        cx0 = max(0, xl - expand)
        cx1 = min(img.width, xr + expand)
        cy0 = max(0, yt - expand)
        cy1 = min(img.height, yb + expand)
        cell = img.crop((cx0, cy0, cx1, cy1))
        bb, char_bb = frame_extent(cell)
        if bb is None:
            continue
        frames.append((cell, bb, char_bb))
    if not frames:
        return None, 0
    # 统一缩放因子：基于各帧**角色**（非含装饰的范围）的最大高度，避免星星撑高
    hmax = max(bb[3] - bb[1] for _, _, bb in frames)
    if hmax <= 0:
        return None, 0
    s = (size * scale) / hmax
    norm = []
    for cell, bb, _ in frames:
        x0, y0, x1, y1 = bb
        if x1 <= x0 or y1 <= y0:
            continue
        f = cell.crop((x0, y0, x1, y1))
        fw = max(1, round(f.width * s))
        fh = max(1, round(f.height * s))
        if f.size != (fw, fh):
            f = f.resize((fw, fh), Image.LANCZOS)
        norm.append(f)
    if not norm:
        return None, 0
    sheet = Image.new('RGBA', (size * len(norm), size), (0, 0, 0, 0))
    for i, f in enumerate(norm):
        sheet.paste(f, (i * size + (size - f.width) // 2, size - f.height), f)  # x 居中、底对齐
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
    ap.add_argument('--regions', help='sheet 模式（更灵活）：state@row:colStart-colEnd,state@row:..., 如 walk@0:0-3,sleep@1:0-1')
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
            # 背景色 = 声明色 ∪ 图像边框实际取色（模型常把"纯洋红"画偏，如 G=32 的暗洋红）
            bgs = [detect_bg(img)] if args.key == 'auto' else [[int(v) for v in c.split(',')] for c in args.key.split('|')]
            bgs = list({tuple(b) for b in bgs} | {tuple(detect_bg(img))})
            img = bg_floodfill(img, bgs, tol=45)  # 边界洪泛去背景（连通性分割）
            img = closed_islands_cleanup(img, bgs)  # 封闭洋红岛（极饱和）
            img = magenta_free_cleanup(img)  # 全量洋红清除：角色纯蓝白，sp>25 即非角色
            img = defringe(img, erode=1)  # 侵蚀 1px + 强羽化(1.5) 平滑锯齿
            print(f'keyed: bg={bgs} floodfill+islands+magenta-free+feather', file=sys.stderr)
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
            # 4px 保守值：内缩过大会裁掉角色头顶（用户反馈"多裁"）；留白交给 build_state_sheet 的 padding。
            inset = 4
            row_bounds = [(a + inset, b - inset) for (a, b) in row_bounds if b - a > 2 * inset]
            col_bounds = [(a + inset, b - inset) for (a, b) in col_bounds if b - a > 2 * inset]
        else:
            row_bounds = [(round(h * r / rows), round(h * (r + 1) / rows)) for r in range(rows)]
            col_bounds = [(round(w * c / cols), round(w * (c + 1) / cols)) for c in range(cols)]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # sheet 模式：行为状态、列为帧，union-bbox 对齐拼横排 sheet（多状态图 → 每状态一张）。
    if args.sheet:
        report = {'input': str(args.input), 'size': list(img.size), 'grid': [len(row_bounds), len(col_bounds)], 'sheets': []}
        if args.regions:
            # regions 模式：state@row:colStart-colEnd（一行可有多个状态）
            for region in args.regions.split(','):
                state, pos = region.split('@')
                row_s, colrange = pos.split(':')
                c0, c1 = (int(v) for v in colrange.split('-'))
                sheet_img, n = build_state_sheet(img, row_bounds, col_bounds, int(row_s), range(c0, c1 + 1), args.size)
                if sheet_img is None:
                    report['sheets'].append({'state': state, 'file': None, 'frames': 0, 'skipped': 'empty'})
                    continue
                fname = f'{state}.png'
                sheet_img.save(out / fname)
                report['sheets'].append({'state': state, 'file': fname, 'frames': n})
            print(json.dumps(report, ensure_ascii=False))
            return
        if not (args.states and args.frames):
            ap.error('--sheet 需要 --states+--frames 或 --regions')
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

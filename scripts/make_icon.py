"""
生成来MarkDown的桌面图标
- 浅色主题（米白底 + 琥珀色 + 蓝灰文字）
- 不规则：圆角矩形 + 一个倾斜的"页角折角"
- 中心放一个"来"字（用字体回退用大字号无衬线）
- 输出 256x256 / 128 / 64 / 48 / 32 / 16 全套 + .ico
"""
from PIL import Image, ImageDraw, ImageFont
import os
import math

OUT_DIR = r"D:\来MD\LaiMarkDown-2.0\resources"
os.makedirs(OUT_DIR, exist_ok=True)

# 调色板（与 global.css 的浅色变量对齐）
BG = (250, 250, 250)         # --bg
ACCENT = (245, 158, 11)      # --accent (amber)
TEXT = (24, 24, 27)          # --text
SURFACE = (255, 255, 255)    # --surface
SHADOW = (0, 0, 0, 40)       # 浅阴影

# 选字体（Windows 都有）
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",   # 微软雅黑 Bold
    r"C:\Windows\Fonts\msyh.ttc",     # 微软雅黑
    r"C:\Windows\Fonts\simhei.ttf",   # 黑体
    r"C:\Windows\Fonts\segoeui.ttf",  # Segoe UI
]

def find_font(bold=False):
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            return f
    return None

FONT_PATH = find_font()

def make_icon(size: int, rounded: bool = True) -> Image.Image:
    """生成单张图标（RGBA）"""
    # 用 4x 超采样抗锯齿
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 1) 主形状：圆角矩形 + 右上角折角（"不规则"就在这里）
    margin = int(s * 0.06)
    rect = (margin, margin, s - margin, s - margin)
    radius = int(s * 0.22)
    fold_size = int(s * 0.22)  # 折角大小

    # 阴影层
    shadow_offset = int(s * 0.015)
    shadow_rect = (rect[0] + shadow_offset, rect[1] + shadow_offset + int(s*0.02),
                   rect[2] + shadow_offset, rect[3] + shadow_offset + int(s*0.02))
    if rounded:
        d.rounded_rectangle(shadow_rect, radius=radius, fill=SHADOW)

    # 折角形状：右上角裁掉一个三角形
    # 先画圆角矩形主体
    if rounded:
        d.rounded_rectangle(rect, radius=radius, fill=SURFACE, outline=ACCENT, width=int(s*0.012))
    else:
        d.rectangle(rect, fill=SURFACE, outline=ACCENT, width=int(s*0.012))

    # 画折角：右上角一块三角形，琥珀色，模拟"被翻起来的页角"
    # 折角覆盖右上角 (s-margin, margin) 区域
    fold_margin = int(s * 0.06)  # 折角距离边缘
    fold = [
        (s - margin - fold_margin - fold_size, margin),                      # 折角的水平起点（圆角矩形内部）
        (s - margin, margin + fold_margin + fold_size),                      # 折角的对角点
        (s - margin - fold_margin, margin + fold_margin),                    # 回到顶部
    ]
    # 画折角三角形（深一点的琥珀，区分主色）
    dark_accent = (217, 119, 6)  # amber-600
    d.polygon(fold, fill=dark_accent)

    # 折角下方的"纸张切线"：斜着的一条线，让折角看起来立体
    d.line([
        (s - margin - fold_margin - fold_size, margin),
        (s - margin, margin + fold_margin + fold_size)
    ], fill=(180, 83, 9), width=int(s*0.008))

    # 2) 内部装饰：底部三条"文字行"，暗示 Markdown
    line_y_start = int(s * 0.62)
    line_h = int(s * 0.045)
    line_gap = int(s * 0.08)
    line_x = int(s * 0.22)
    line_w_max = int(s * 0.56)
    for i, ratio in enumerate([0.95, 0.65, 0.85]):
        x1 = line_x
        x2 = line_x + int(line_w_max * ratio)
        y = line_y_start + i * line_gap
        d.rounded_rectangle((x1, y, x2, y + line_h), radius=int(line_h/2), fill=TEXT)

    # 3) 中心"来"字
    char_size = int(s * 0.42)
    try:
        font = ImageFont.truetype(FONT_PATH, char_size) if FONT_PATH else ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()
    # 算位置（居中，但要避开底部行）
    text = "来"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (s - tw) // 2 - bbox[0]
    ty = (s - th) // 2 - bbox[1] - int(s * 0.08)
    d.text((tx, ty), text, font=font, fill=ACCENT)

    # 缩回目标尺寸
    return img.resize((size, size), Image.LANCZOS)


def main():
    sizes = [16, 32, 48, 64, 128, 256]
    imgs = {s: make_icon(s) for s in sizes}

    # 保存 PNGs
    for s, img in imgs.items():
        png_path = os.path.join(OUT_DIR, f"icon-{s}.png")
        img.save(png_path, "PNG", optimize=True)
        print(f"saved {png_path}")

    # 保存 256 PNG（作为默认）
    main_png = os.path.join(OUT_DIR, "icon.png")
    imgs[256].save(main_png, "PNG", optimize=True)
    print(f"saved {main_png}")

    # 生成 .ico（多尺寸）
    ico_path = os.path.join(OUT_DIR, "icon.ico")
    imgs[256].save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"saved {ico_path}")

    # 生成 Windows 安装包用的 256x256 .ico（NSIS 用的就是它）
    print("done")


if __name__ == "__main__":
    main()

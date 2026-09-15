#!/usr/bin/env python3
"""重新生成 public/fonts/ 下的 Maple Mono NF CN 子集(woff2)。

依赖:本机装了 Maple Mono NF CN(默认取 C:\\Windows\\Fonts),以及
    pip install fonttools brotli

用法:
    python tools/subset_fonts.py                      # 4 个字重全部重写
    python tools/subset_fonts.py --level 1           # 只保留 GB2312 一级常用字(体积约省一半)
    python tools/subset_fonts.py --out-dir public/fonts

说明:
- 子集覆盖 = 拉丁/数字/标点/假名 + GB2312 汉字(一级 3755 + 二级 3008),
  单字重约 1.64 MiB;全量 CJK(U+4E00-9FFF)会是 5 MiB,不划算。
- 顺手丢掉 GSUB/GPOS/GDEF(代码连字在 UI 文本里只会添乱)与 hinting。
- 应用侧的 @font-face 在 src/styles.css,src 里 local() 放最前,
  所以装了完整字体的设备不会下载这些文件。
"""

from __future__ import annotations

import argparse
import os
import time

from fontTools import subset
from fontTools.ttLib import TTFont

# (源文件名字干, CSS font-weight, 输出文件名)
FACES = [
    ("Regular", 400, "maple-nf-cn-regular.woff2"),
    ("Medium", 500, "maple-nf-cn-medium.woff2"),
    ("SemiBold", 600, "maple-nf-cn-semibold.woff2"),
    ("Bold", 700, "maple-nf-cn-bold.woff2"),
]

# 拉丁、常见符号、中文标点与假名:直接给码位区间
RANGES = [
    (0x20, 0x7E),        # 基本拉丁
    (0xA0, 0xFF),        # 拉丁-1 补充(含 ·、° 等)
    (0x2000, 0x206F),    # 通用标点(引号、破折号、省略号)
    (0x2070, 0x20CF),    # 上下标与货币
    (0x2190, 0x21FF),    # 箭头
    (0x2200, 0x22FF),    # 数学符号(≈ ± ×)
    (0x25A0, 0x27BF),    # 几何/杂项符号(✕ ✓ ⚠)
    (0x2B00, 0x2BFF),    # 杂项符号与箭头
    (0x2E80, 0x2EFF),    # CJK 部首补充
    (0x3000, 0x303F),    # CJK 标点符号
    (0x3040, 0x30FF),    # 平假名/片假名
    (0x31C0, 0x31E5),    # CJK 笔画
    (0xFE10, 0xFE1F),    # 竖排标点
    (0xFF00, 0xFFEF),    # 半角/全角形式(（）)
]

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def gb2312_chars(high_bytes: list[range]) -> set[int]:
    """用 Python 自带的 gb2312 编码表反查汉字码位,省得外挂字表。"""
    cps: set[int] = set()
    for hi in high_bytes:
        for lo in range(0xA1, 0xFF):
            try:
                text = bytes([hi, lo]).decode("gb2312")
            except UnicodeDecodeError:
                continue
            cps.update(ord(ch) for ch in text)
    return cps


def build_codepoints(level: int) -> list[int]:
    cps: set[int] = set()
    for lo, hi in RANGES:
        cps.update(range(lo, hi + 1))
    cps |= gb2312_chars([range(0xA1, 0xAA)])  # GB2312 符号区
    cps |= gb2312_chars([range(0xB0, 0xD8)])  # 一级常用字 3755
    if level >= 2:
        cps |= gb2312_chars([range(0xD8, 0xF8)])  # 二级次常用字 3008
    return sorted(c for c in cps if c >= 0x20)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src-dir", default=r"C:\Windows\Fonts", help="MapleMono-NF-CN-*.ttf 所在目录")
    parser.add_argument("--out-dir", default=os.path.join(REPO, "public", "fonts"))
    parser.add_argument("--level", type=int, choices=(1, 2), default=2, help="1=一级常用字,2=GB2312 全部 6763 字")
    args = parser.parse_args()

    codepoints = build_codepoints(args.level)
    print(f"码位数:{len(codepoints)}  (level={args.level})")
    os.makedirs(args.out_dir, exist_ok=True)

    options = subset.Options()
    options.hinting = False
    options.name_IDs = [1, 2, 3, 4, 6]
    options.legacy_kern = False
    options.drop_tables = list(options.drop_tables) + [
        "DSIG", "FFTM", "META", "TSIC", "vpal", "BLOCK",
        "GSUB", "GPOS", "GDEF", "JSTF", "BASE",
    ]

    total = 0
    for face, weight, name in FACES:
        src = os.path.join(args.src_dir, f"MapleMono-NF-CN-{face}.ttf")
        if not os.path.exists(src):
            raise SystemExit(f"找不到源字体:{src}")
        started = time.time()
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=codepoints)
        font = TTFont(src)
        subsetter.subset(font)
        dst = os.path.join(args.out_dir, name)
        font.flavor = "woff2"
        font.save(dst)
        size = os.path.getsize(dst)
        total += size
        print(f"{name:32s} weight={weight:<4} {size / 1048576:5.2f} MiB  {time.time() - started:4.1f}s")
    print(f"合计:{total / 1048576:.2f} MiB -> {args.out_dir}")


if __name__ == "__main__":
    main()

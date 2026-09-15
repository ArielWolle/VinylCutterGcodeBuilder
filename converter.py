#!/usr/bin/env python3
"""Convert Z-height tool changes into M03 / M05 head commands.

This script is aimed at G-code generated for machines that use Z moves to
toggle the cutter, but your vinyl cutter expects explicit spindle/head on/off
commands instead.

By default it maps:
- Z0 -> M03
- Z5 -> M05

If a motion line contains X/Y movement plus a matching Z move, the Z token is
removed and the M-code is emitted on its own line.
"""
 
from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path


TOKEN_RE = re.compile(r"([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))")
MOTION_RE = re.compile(r"^\s*(G0|G1)\b", re.IGNORECASE)
MOTION_AXES = {"X", "Y", "A", "B", "C", "U", "V", "W", "E"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert Z-height cutter activation moves into M03/M05 commands."
    )
    parser.add_argument("input", type=Path, help="Path to the source G-code file")
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        help="Optional output file. If omitted, writes the converted G-code to stdout.",
    )
    parser.add_argument(
        "--on-height",
        type=float,
        default=0.0,
        help="Z height to treat as head on (default: 0).",
    )
    parser.add_argument(
        "--off-height",
        type=float,
        default=5.0,
        help="Z height to treat as head off (default: 5).",
    )
    parser.add_argument(
        "--on-code",
        default="M03",
        help="G-code emitted for the head-on height (default: M03).",
    )
    parser.add_argument(
        "--off-code",
        default="M05",
        help="G-code emitted for the head-off height (default: M05).",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=1e-6,
        help="Floating-point tolerance used when matching Z values.",
    )
    return parser.parse_args()


def split_comment(line: str) -> tuple[str, str]:
    code, separator, comment = line.partition(";")
    if separator:
        return code.rstrip(), f";{comment}"
    return line.rstrip(), ""


def parse_tokens(code: str) -> list[tuple[str, str]]:
    return [(match.group(1).upper(), match.group(2)) for match in TOKEN_RE.finditer(code)]


def is_target_height(value: float, target: float, tolerance: float) -> bool:
    return math.isclose(value, target, abs_tol=tolerance)


def convert_line(
    line: str,
    *,
    on_height: float,
    off_height: float,
    on_code: str,
    off_code: str,
    tolerance: float,
) -> list[str]:
    code, comment = split_comment(line.rstrip("\n"))
    if not code.strip():
        return [line.rstrip("\n")]

    if not MOTION_RE.match(code):
        return [line.rstrip("\n")]

    tokens = parse_tokens(code)
    if not tokens:
        return [line.rstrip("\n")]

    z_value = None
    for axis, raw_value in tokens:
        if axis != "Z":
            continue
        value = float(raw_value)
        if is_target_height(value, on_height, tolerance) or is_target_height(value, off_height, tolerance):
            z_value = value
            break

    if z_value is None:
        return [line.rstrip("\n")]

    mapped_code = on_code if is_target_height(z_value, on_height, tolerance) else off_code

    remaining_tokens = [f"{axis}{value}" for axis, value in tokens if not (axis == "Z" and is_target_height(float(value), z_value, tolerance))]
    remaining_line = " ".join(remaining_tokens).strip()
    has_useful_motion = any(axis in MOTION_AXES for axis, _ in tokens if axis != "Z")

    if not has_useful_motion:
        result = mapped_code
        if comment:
            result = f"{result} {comment}"
        return [result]

    converted = [mapped_code]
    if comment:
        converted.append(f"{remaining_line} {comment}")
    else:
        converted.append(remaining_line)
    return converted


def convert_text(
    text: str,
    *,
    on_height: float,
    off_height: float,
    on_code: str,
    off_code: str,
    tolerance: float,
) -> str:
    output_lines: list[str] = []
    for line in text.splitlines():
        output_lines.extend(
            convert_line(
                line,
                on_height=on_height,
                off_height=off_height,
                on_code=on_code,
                off_code=off_code,
                tolerance=tolerance,
            )
        )
    return "\n".join(output_lines) + ("\n" if text.endswith("\n") else "")


def main() -> int:
    args = parse_args()
    source_text = args.input.read_text(encoding="utf-8-sig")
    converted_text = convert_text(
        source_text,
        on_height=args.on_height,
        off_height=args.off_height,
        on_code=args.on_code,
        off_code=args.off_code,
        tolerance=args.tolerance,
    )

    output_path = args.output
    if output_path is None:
        output_path = args.input.with_name(f"{args.input.stem}_spindle{args.input.suffix}")

    output_path.write_text(converted_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
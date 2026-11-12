#!/usr/bin/env python3
"""Post-process the raw PayGuard demo capture.

- Detect frozen stretches (network waits: PayPal redirect, AI guard latency)
  with ffmpeg freezedetect and collapse them, keeping enough time for any
  caption that starts inside the freeze.
- Remap caption timestamps onto the edited timeline.
- Burn English captions (ffmpeg drawtext, wrapped to <=2 lines, never cut off).

Usage: edit-demo.py RAW_MP4 CAPTIONS_JSON OUT_MP4
No audio track, no TTS.
"""
import json
import re
import subprocess
import sys
import textwrap

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_SIZE = 30
WRAP = 92            # DejaVu Sans Bold ~0.62em avg -> ~1720px at 30px
KEEP_MIN = 2.5       # seconds kept from every freeze
PER_CAPTION = 4.0    # seconds of reading time per caption starting in a freeze
MIN_CAPTION = 3.5


def sh(args):
    return subprocess.run(args, capture_output=True, text=True, check=True)


def duration(path):
    out = sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
    return float(out.stdout.strip())


def freezes(path, total):
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", path, "-vf", "freezedetect=n=-55dB:d=3", "-map", "0:v", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", out)]
    if len(ends) < len(starts):
        ends.append(total)
    return list(zip(starts, ends))


def esc(s):
    s = s.replace("\u2014", "-").replace("\u2192", "->")
    return (s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\u2019")
             .replace("%", "\\%").replace(",", "\\,"))


def main():
    raw, caps_path, out = sys.argv[1:4]
    total = duration(raw)
    caps = [c for c in json.load(open(caps_path)) if c.get("text")]
    cuts = []
    for fs, fe in freezes(raw, total):
        n = sum(1 for c in caps if fs <= c["start"] < fe)
        keep = max(KEEP_MIN, n * PER_CAPTION)
        if fe - fs > keep + 0.5:
            cuts.append((fs + keep, fe))
    # Trim tail: nothing after the last caption end + 3s.
    last_end = max(c["end"] for c in caps)
    if total > last_end + 3:
        cuts.append((last_end + 3, total))

    def remap(t):
        shift = 0.0
        for a, b in cuts:
            if t >= b:
                shift += b - a
            elif t > a:
                return a - shift
        return t - shift

    keeps, cur = [], 0.0
    for a, b in sorted(cuts):
        if a > cur:
            keeps.append((cur, a))
        cur = max(cur, b)
    if cur < total:
        keeps.append((cur, total))

    mapped = []
    for c in caps:
        mapped.append({"start": remap(c["start"]), "end": remap(c["end"]), "text": c["text"]})
    for i, c in enumerate(mapped):
        nxt = mapped[i + 1]["start"] if i + 1 < len(mapped) else None
        if c["end"] - c["start"] < MIN_CAPTION:
            c["end"] = c["start"] + MIN_CAPTION if nxt is None else min(c["start"] + MIN_CAPTION, max(nxt, c["end"]))
        if nxt is not None and c["end"] > nxt:
            c["end"] = nxt

    sel = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in keeps)
    vf = [
        f"select='{sel}'",
        "setpts=N/FRAME_RATE/TB",
        # Mask the buyer sandbox account label on the PayPal login password-step
        # so no full or partial email is visible on screen.
        "drawbox=x=750:y=330:w=350:h=38:color=white@1.0:t=fill:enable='between(t,47.8,54.2)'",
        f"drawtext=fontfile='{FONT}':text='sb-•••••••••••••@personal.example.com':fontcolor=0x2c2e2f:fontsize=14:x=760:y=343:enable='between(t,47.8,54.2)'",
        # Caption bar at the bottom
        "drawbox=x=0:y=968:w=1920:h=112:color=0x050811@0.93:t=fill",
        "drawbox=x=0:y=966:w=1920:h=2:color=0x38bdf8@0.9:t=fill",
    ]
    for c in mapped:
        lines = textwrap.wrap(c["text"], WRAP)[:2]
        ys = [1006] if len(lines) == 1 else [986, 1028]
        for line, y in zip(lines, ys):
            vf.append(
                f"drawtext=fontfile='{FONT}':text='{esc(line)}':fontcolor=0xf8fafc:fontsize={FONT_SIZE}"
                f":x=(w-text_w)/2:y={y}:enable='between(t,{c['start']:.2f},{c['end']:.2f})'"
            )
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-vf", ",".join(vf), "-an",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
                    "-r", "24", "-movflags", "+faststart", out], check=True)
    json.dump({"cuts": cuts, "captions": mapped}, open(out + ".edit.json", "w"), indent=2)
    print(f"raw={total:.1f}s cuts={len(cuts)} final={duration(out):.1f}s -> {out}")


if __name__ == "__main__":
    main()

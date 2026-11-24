#!/usr/bin/env python3
"""OCR Daily Working Hours Details sheets (EN/AR handwritten grids).

Primary engine: RapidOCR (ONNX / PP-OCR) — far better than Tesseract on these
phone photos for printed headers, labor IDs, dates, and denser hour columns.
Handwritten sparse multi-location cells remain unreliable → always needsReview.

stdout = JSON.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    # OCR often reads O as 0 in printed months (0ct / 0c)
    "0ct": 10, "0c": 10, "oc": 10, "no": 11, "nv": 11,
}

# Printed Daily Working Hours form: fixed 31-day grid Oct 26 → Nov 25
SHEET_START_MD = (10, 26)
SHEET_END_MD = (11, 25)
SHEET_DAY_COUNT = 31

LOC_COLS = [
    ("Scrap City", [r"scrap"]),
    ("Makkah Yard", [r"makkah", r"meca"]),
    ("Green City", [r"green", r"grgen", r"creen"]),
    ("DS-Plastic", [r"plastic"]),
    ("Al Waha - Villa", [r"villa"]),
    ("Central Workshop", [r"central", r"workshop", r"workahop"]),
    ("DS-Residence", [r"residence"]),
    ("DS-Mgmt", [r"\bmgmt\b", r"memt"]),
    ("Namma H.O", [r"namma", r"hamma"]),
    ("Guzain Yard", [r"guzain", r"gualn", r"gulaln", r"qozain"]),
]

HEADER_NOISE = re.compile(
    r"employee|month|working|daily|detail|management|scrap|makkah|green|"
    r"plastic|villa|central|namma|guzain|total|date|day|diamond|yaqeen|"
    r"advanced|international|enjaz|enjas|arabia|logo|for the|october|november|"
    r"september|hours|city|yard|workshop|residence|mgmt|plastic",
    re.I,
)

ACCURACY_NOTE = (
    "RapidOCR reads IDs/dates/headers well; handwritten location hours are "
    "approximate (dense single-column sheets better than sparse multi-site). "
    "Always review before commit."
)


def preprocess(path: Path):
    import cv2

    img = cv2.imread(str(path))
    if img is None:
        raise RuntimeError(f"Could not read image {path}")
    h, w = img.shape[:2]
    scale = max(1.0, 2000 / max(h, w))
    if scale > 1.01:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    # Light deskew via minAreaRect on ink
    thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thr > 0))
    angle = 0.0
    if len(coords) > 500:
        rect = cv2.minAreaRect(coords.astype(np.float32))
        angle = rect[-1]
        if angle < -45:
            angle = 90 + angle
        if 0.4 <= abs(angle) <= 12:
            M = cv2.getRotationMatrix2D((gray.shape[1] / 2, gray.shape[0] / 2), angle, 1.0)
            gray = cv2.warpAffine(
                gray, M, (gray.shape[1], gray.shape[0]),
                flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
            )
    return gray, float(angle)


def _center(box):
    xs = [float(p[0]) for p in box]
    ys = [float(p[1]) for p in box]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def rapid_ocr(gray) -> tuple[list, str]:
    import cv2
    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    bgr = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    result, _elapse = engine(bgr)
    items = []
    raw_lines = []
    for box, text, score in result or []:
        items.append({"box": box, "text": str(text).strip(), "score": float(score)})
        raw_lines.append(str(text).strip())
    return items, "\n".join(raw_lines)


def tesseract_ocr(gray) -> tuple[list, str]:
    """Fallback: page text only (no reliable boxes)."""
    import cv2
    import pytesseract
    from PIL import Image

    rgb = cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)
    text = pytesseract.image_to_string(Image.fromarray(rgb), lang="eng", config="--psm 6")
    return [], text


def _normalize_month_token(raw: str) -> str:
    """Repair common OCR month glitches (0ct→oct, NoV→nov)."""
    t = re.sub(r"[^A-Za-z0-9]", "", (raw or "")).lower()
    if not t:
        return t
    # Digits mistaken for letters inside month abbreviations
    t = t.replace("0", "o").replace("1", "l")
    if t.startswith("oct") or t in {"oc", "ot", "oet"}:
        return "oct"
    if t.startswith("nov") or t in {"no", "nv", "noy"}:
        return "nov"
    if t.startswith("sep") or t in {"se", "sp"}:
        return "sep"
    if t.startswith("dec") or t in {"de", "dc"}:
        return "dec"
    return t[:3]


def parse_date_token(tok: str, default_year: int = 2026):
    tok = tok.strip().replace("/", "-").replace(".", "-").replace(":", "-").replace(" ", "")
    # Allow OCR digit-letter mix in month (26-0ct-26, 29-0c-26)
    m = re.search(r"(\d{1,2})-?([A-Za-z0-9]{2,9})-?(\d{2,4})?", tok)
    if not m:
        return None
    mon = MONTHS.get(_normalize_month_token(m.group(2)))
    if not mon:
        return None
    d = int(m.group(1))
    yraw = m.group(3)
    y = int(yraw) if yraw else default_year
    if y < 100:
        y += 2000
    if not (1 <= d <= 31 and 2020 <= y <= 2035):
        return None
    return f"{y:04d}-{mon:02d}-{d:02d}"


def expected_sheet_dates(year: int = 2026) -> list[str]:
    """Fixed printed form dates: 26-Oct → 25-Nov for `year` (yy on sheet)."""
    from datetime import date, timedelta

    start = date(year, SHEET_START_MD[0], SHEET_START_MD[1])
    return [(start + timedelta(days=i)).isoformat() for i in range(SHEET_DAY_COUNT)]


def complete_date_rows(
    date_rows: list[tuple[str, float]],
    year: int | None = None,
) -> list[tuple[str, float]]:
    """Ensure every printed grid date has a Y anchor.

    Blank trailing/mid rows (e.g. 22–25 Nov, empty Fridays) are often skipped by OCR
    or have weaker detections. Hours must still align by printed date — not by
    packing only filled rows. Missing dates get Y via neighbor interpolation /
    median row pitch so earlier rows stay locked to the correct calendar day.
    """
    if not date_rows:
        return []

    by_date = {d: y for d, y in date_rows}
    years = sorted({int(d[:4]) for d in by_date})
    y0 = year or (years[0] if years else 2026)
    expected = expected_sheet_dates(y0)

    # Only complete the standard Oct26–Nov25 grid when we clearly hit that form
    hits = sum(1 for d in expected if d in by_date)
    if hits < 8:
        # Unknown period — keep detected dates only, sorted by Y
        return sorted(date_rows, key=lambda r: r[1])

    known = [(i, by_date[d]) for i, d in enumerate(expected) if d in by_date]
    if len(known) >= 2:
        pitches = [known[j][1] - known[j - 1][1] for j in range(1, len(known))]
        # Normalize by index gap
        pitches = [
            (known[j][1] - known[j - 1][1]) / max(1, known[j][0] - known[j - 1][0])
            for j in range(1, len(known))
        ]
        pitch = float(np.median(pitches)) if pitches else 20.0
    else:
        pitch = 20.0
    if pitch <= 1:
        pitch = 20.0

    ys_out: list[float | None] = [None] * len(expected)
    for i, d in enumerate(expected):
        if d in by_date:
            ys_out[i] = float(by_date[d])

    # Forward fill from known anchors
    for i in range(len(expected)):
        if ys_out[i] is not None:
            continue
        prev = next((j for j in range(i - 1, -1, -1) if ys_out[j] is not None), None)
        nxt = next((j for j in range(i + 1, len(expected)) if ys_out[j] is not None), None)
        if prev is not None and nxt is not None and nxt != prev:
            t = (i - prev) / (nxt - prev)
            ys_out[i] = float(ys_out[prev]) + t * (float(ys_out[nxt]) - float(ys_out[prev]))
        elif prev is not None:
            ys_out[i] = float(ys_out[prev]) + pitch * (i - prev)
        elif nxt is not None:
            ys_out[i] = float(ys_out[nxt]) - pitch * (nxt - i)
        else:
            ys_out[i] = float(i) * pitch

    return [(expected[i], float(ys_out[i])) for i in range(len(expected))]


def normalize_hour_token(text: str):
    t = text.strip()
    t = t.replace("O", "0").replace("o", "0").replace("I", "1").replace("l", "1").replace("|", "1")
    t = t.replace("S", "5")  # occasional
    if re.fullmatch(r"F-?2", t, re.I):
        return ("off", 2)  # Friday marked F-2 still off for work hours
    if re.fullmatch(r"F", t, re.I):
        return ("off", 0)
    # IO / 1O / etc → 10
    t2 = re.sub(r"[^\d.]", "", t)
    if t.upper() in {"IO", "1O", "I0", "LO", "L0"} or t.lower() in {"io", "lo"}:
        return ("hours", 10.0)
    m = re.fullmatch(r"(\d{1,2})(?:\.\d+)?", t2)
    if not m:
        return None
    n = float(m.group(1))
    if 1 <= n <= 20:
        return ("hours", n)
    return None


def extract_header(items: list, H: int, raw_text: str) -> dict:
    labor_id = None
    name_parts = []
    # Name/ID live between logos and the column header row (~top 15–28%)
    band = [it for it in items if H * 0.12 <= _center(it["box"])[1] < H * 0.30 and it["score"] >= 0.55]

    emp_y = None
    for it in band:
        if re.search(r"employee\s*name", it["text"], re.I):
            emp_y = _center(it["box"])[1]
            break

    id_cands = []
    for it in band:
        cx, cy = _center(it["box"])
        t = it["text"]
        # Prefer digits near the Employee Name label
        near = 0.25 if emp_y is None or abs(cy - emp_y) < H * 0.08 else 0.0
        if re.fullmatch(r"\d{3}", t):
            id_cands.append((it["score"] + 0.35 + near, t, cy))
        elif re.fullmatch(r"\d{2,4}", t) and len(t) >= 3:
            id_cands.append((it["score"] + 0.1 + near, t, cy))
        m = re.search(r"(?:id[#.\s:]*)(\d{2,4})\b", t, re.I)
        if m and len(m.group(1)) >= 3:
            id_cands.append((it["score"] + 0.4 + near, m.group(1), cy))
    if id_cands:
        id_cands.sort(key=lambda x: (-x[0], -len(x[1])))
        labor_id = id_cands[0][1]

    for it in band:
        t = it["text"]
        if HEADER_NOISE.search(t):
            continue
        if re.fullmatch(r"\d{2,4}", t):
            continue
        letters = re.sub(r"[^A-Za-z]", "", t)
        if len(letters) < 5:
            continue
        cleaned = re.sub(r"[^A-Za-z .'-]", " ", t).strip()
        if cleaned and not HEADER_NOISE.search(cleaned):
            name_parts.append(cleaned)

    name = None
    if name_parts:
        joined = re.sub(r"\s+", " ", " ".join(name_parts)).strip(" .#-")
        toks = [t for t in joined.split() if len(re.sub(r"[^A-Za-z]", "", t)) >= 3]
        if toks:
            name = " ".join(toks[:5]).title()

    if not labor_id:
        m = re.search(r"(?:ID[#.\s:]*)(\d{3,4})\b", raw_text, re.I)
        if m:
            labor_id = m.group(1)
        else:
            m2 = re.search(r"\b(\d{3})\s+[A-Z][A-Za-z]", raw_text)
            if m2:
                labor_id = m2.group(1)

    month = None
    mon_m = re.search(
        r"(October|November|September|Oct|Nov|Sep)[^\n]{0,40}(20\d{2})",
        raw_text,
        re.I,
    )
    if mon_m:
        month = f"{mon_m.group(1)}-{mon_m.group(2)}"

    return {"employeeName": name, "laborId": labor_id, "month": month}


def extract_columns(items: list, H: int) -> dict:
    buckets: dict[str, list[float]] = {}
    for it in items:
        if it["score"] < 0.4:
            continue
        cx, cy = _center(it["box"])
        if cy > H * 0.42:
            continue
        t = it["text"].lower()
        for name, pats in LOC_COLS:
            if any(re.search(p, t) for p in pats):
                buckets.setdefault(name, []).append(cx)
        if re.search(r"\btotal\b", t):
            buckets.setdefault("Total", []).append(cx)
    return {k: float(np.median(v)) for k, v in buckets.items() if v}


def extract_date_rows(items: list) -> list[tuple[str, float]]:
    found: dict[str, list[float]] = {}
    for it in items:
        if it["score"] < 0.35:
            continue
        _cx, cy = _center(it["box"])
        d = parse_date_token(it["text"])
        if not d:
            continue
        found.setdefault(d, []).append(cy)
    rows = [(d, float(np.median(ys))) for d, ys in found.items()]
    rows.sort(key=lambda x: x[1])
    # Fill blank/skipped printed dates so hour Y snaps stay on the calendar grid
    return complete_date_rows(rows)


def assign_hours(items: list, col_centers: dict, date_rows: list[tuple[str, float]], H: int, W: int):
    if not date_rows or not col_centers:
        return []

    xs = sorted(v for k, v in col_centers.items() if k != "Total")
    half_w = max(28.0, float(np.median(np.diff(xs))) * 0.48) if len(xs) > 1 else W * 0.045
    ys = [y for _, y in date_rows]
    half_h = max(14.0, float(np.median(np.diff(ys))) * 0.45) if len(ys) > 1 else H * 0.015

    # cell -> (value, score, kind)
    grid: dict[tuple[str, str], tuple[float | str, float]] = {}
    off_dates: set[str] = set()

    def nearest_date(cy: float):
        d, y = min(date_rows, key=lambda r: abs(r[1] - cy))
        if abs(y - cy) > half_h * 1.6:
            return None
        return d

    def nearest_col(cx: float):
        name, x = min(col_centers.items(), key=lambda kv: abs(kv[1] - cx))
        if abs(x - cx) > half_w * 1.35:
            return None
        return name

    for it in items:
        if it["score"] < 0.45:
            continue
        cx, cy = _center(it["box"])
        if cy < H * 0.34:  # skip header band
            continue
        parsed = normalize_hour_token(it["text"])
        if not parsed:
            continue
        kind, val = parsed
        d = nearest_date(cy)
        if not d:
            continue
        if kind == "off":
            off_dates.add(d)
            continue
        col = nearest_col(cx)
        if not col or col == "Total":
            # If only Total column hit, stash later via total-only row
            if col == "Total":
                key = (d, "__total__")
                prev = grid.get(key)
                if not prev or it["score"] > prev[1]:
                    grid[key] = (float(val), it["score"])
            continue
        key = (d, col)
        prev = grid.get(key)
        if not prev or it["score"] > prev[1]:
            grid[key] = (float(val), it["score"])

    rows_out = []
    for d, _y in date_rows:
        locs = {}
        for (dd, col), (val, _sc) in grid.items():
            if dd != d or col.startswith("__"):
                continue
            locs[col] = val
        total_cell = grid.get((d, "__total__"))
        total = float(total_cell[0]) if total_cell else sum(locs.values())
        # Friday / off mark with no hours — keep as explicit off (no invented hours)
        if d in off_dates and not locs and not total:
            rows_out.append({"date": d, "locations": {}, "total": 0, "off": True})
            continue
        # Blank mid/trailing dates (common: empty Fridays, unfilled 22–25 Nov) —
        # omit from payload; do not invent 0-hour rows or fail the sheet.
        if not locs and not total:
            continue
        # If we only got a total and one empty locations map, leave total for review
        if not locs and total:
            locs = {"__unassigned__": total}
        rows_out.append({
            "date": d,
            "locations": locs,
            "total": total,
            "off": False,
        })
    return rows_out


def build_parsed(items: list, gray, raw_text: str, engine: str) -> dict:
    H, W = gray.shape[:2]
    header = extract_header(items, H, raw_text)
    cols = extract_columns(items, H)
    date_rows = extract_date_rows(items)
    rows = assign_hours(items, cols, date_rows, H, W) if items else []

    # Text-only fallback row scrape (tesseract path / sparse boxes)
    if not rows and raw_text:
        rows = extract_rows_from_text(raw_text)

    filled = sum(1 for r in rows if r.get("locations") and not r.get("off"))
    return {
        "employeeName": header.get("employeeName"),
        "laborId": header.get("laborId"),
        "month": header.get("month"),
        "rows": rows,
        "needsReview": True,
        "note": ACCURACY_NOTE,
        "ocrMeta": {
            "engine": engine,
            "detections": len(items),
            "columnsFound": sorted(cols.keys(), key=lambda k: cols[k]),
            "dateRowsFound": len(date_rows),
            "rowsWithHours": filled,
        },
    }


def extract_rows_from_text(text: str) -> list:
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        dm = re.search(r"(\d{1,2}-[A-Za-z]{3,9}-?\d{0,4})", line)
        if not dm:
            continue
        date = parse_date_token(dm.group(1))
        if not date:
            continue
        if re.search(r"\bF\b|friday", line, re.I) and not re.search(
            r"\d", line.replace(dm.group(1), "")
        ):
            rows.append({"date": date, "locations": {}, "total": 0, "off": True})
            continue
        nums = [float(x) for x in re.findall(r"\b(\d{1,2}(?:\.\d+)?)\b", line)]
        hours = [n for n in nums if 1 <= n <= 20]
        total = hours[-1] if hours else 0
        locations = {}
        if total and len(hours) == 1:
            locations["__unassigned__"] = total
        elif len(hours) >= 2:
            locations["__split__"] = hours[:-1]
            total = hours[-1]
        rows.append({"date": date, "locations": locations, "total": total, "off": False, "rawLine": line})
    return rows


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: timesheet_ocr.py <image>", "rawText": "", "parsed": None}))
        return
    path = Path(sys.argv[1])
    if not path.exists():
        print(json.dumps({"ok": False, "error": f"missing file {path}", "rawText": "", "parsed": None}))
        return

    try:
        gray, _angle = preprocess(path)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "rawText": "", "parsed": None}))
        return

    engine = "none"
    items: list = []
    raw_text = ""
    try:
        items, raw_text = rapid_ocr(gray)
        engine = "rapidocr-onnx"
    except Exception as rapid_err:
        try:
            items, raw_text = tesseract_ocr(gray)
            engine = "tesseract+pytesseract"
            raw_text = f"[rapidocr unavailable: {rapid_err}]\n{raw_text}"
        except Exception as tess_err:
            print(json.dumps({
                "ok": False,
                "error": f"OCR failed: rapid={rapid_err}; tess={tess_err}",
                "rawText": "",
                "parsed": None,
            }))
            return

    parsed = build_parsed(items, gray, raw_text, engine)
    print(json.dumps({
        "ok": True,
        "engine": engine,
        "rawText": raw_text[:12000],
        "parsed": parsed,
    }))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fill official Job Card workbook from WH attendance JSON (stdin → stdout xlsx)."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter

TEMPLATE = Path(__file__).resolve().parent / "templates" / "Job_Card_Nov.xlsx"

# WH location name → (sheet, DSP sub-bucket or None)
# DSP sheet exposes DS-Residence and DS-Mgmt as separate subcols (timesheet
# Management section); never merge them into a single "DS Corp/DSR" bucket.
LOCATION_TO_SHEET = {
    "green city": ("GC", None),
    "green city international": ("GC", None),
    "green city international trading company": ("GC", None),
    "scrap city": ("SC", None),
    "ayat scrap city": ("SC", None),
    "central workshop": ("SC", None),
    "guzain yard": ("SC", None),
    "makkah yard": ("Makkah", None),
    "al waha - villa": ("Villa", None),
    "al waha villa": ("Villa", None),
    "villa": ("Villa", None),
    "ds-plastic": ("DSP", "DSP"),
    "ds plastic": ("DSP", "DSP"),
    "ds-residence": ("DSP", "DS-Residence"),
    "ds residence": ("DSP", "DS-Residence"),
    "ds-mgmt": ("DSP", "DS-Mgmt"),
    "ds mgmt": ("DSP", "DS-Mgmt"),
    "ds-corporate": ("DSP", "DS-Mgmt"),
    "ds corporate": ("DSP", "DS-Mgmt"),
    "ds corp": ("DSP", "DS-Mgmt"),
    "namma h.o": ("DSP", "Namma"),
    "namma ho": ("DSP", "Namma"),
    "namma": ("DSP", "Namma"),
    "al yaqeen advanced trading": ("DSP", "Namma"),
}

SHEET_TITLES = {
    "GC": "Green City International Trading Company",
    "SC": "Ayat Scrap City",
    "Villa": "Al Waha Villa",
    "Makkah": "Makkah Yard",
    "DSP": "DS-Plastic / DS-Residence / DS-Mgmt / Namma",
}

DSP_SUBS = ("DSP", "DS-Residence", "DS-Mgmt", "Namma")
DSP_SUB_COUNT = len(DSP_SUBS)
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

THIN = Border(
    left=Side(style="thin"),
    right=Side(style="thin"),
    top=Side(style="thin"),
    bottom=Side(style="thin"),
)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)


def norm(s: str) -> str:
    return " ".join(str(s or "").lower().replace("_", " ").replace("-", " ").split())


def short_name(name: str) -> str:
    """Column header from live employee name (no hardcoded nicknames)."""
    n = str(name or "").strip()
    if not n:
        return "?"
    parts = n.split()
    if len(parts) == 1:
        return parts[0]
    # First + last keeps headers compact while reflecting renames
    return f"{parts[0]} {parts[-1]}" if len(parts[-1]) > 2 else parts[0]


def _name_tokens(s: str) -> set[str]:
    raw = norm(s).replace(".", " ")
    # Collapse common spelling variants used on Job Card headers
    aliases = {
        "ikhlas": "ekhlas",
        "ekhlas": "ekhlas",
        "yousuf": "yousaf",
        "yousaf": "yousaf",
        "rambadan": "badan",
        "mo": "m",
        "md": "m",
        "mohd": "m",
        "mohammad": "m",
        "muhammad": "m",
        "shaikh": "",
        "sheikh": "",
    }
    out = set()
    for t in raw.split():
        t = aliases.get(t, t)
        if t:
            out.add(t)
    return out


def match_labor_id(header: str, employees: list[dict], used: set[str]) -> str | None:
    """Best-effort map template column title → laborId (each lid once)."""
    ht = _name_tokens(header)
    if not ht:
        return None
    best: tuple[int, str] | None = None
    for emp in employees:
        lid = emp["laborId"]
        if not lid or lid in used:
            continue
        et = _name_tokens(emp.get("name") or "")
        if not et:
            continue
        if ht == et:
            score = 100
        elif ht <= et or et <= ht:
            score = 80 + len(ht & et)
        elif ht & et:
            score = 40 + len(ht & et)
        else:
            continue
        if best is None or score > best[0]:
            best = (score, lid)
    return best[1] if best else None


def read_template_emp_headers(ws, header_row: int = 7) -> list[str]:
    """Employee name titles on the header row, left→right until Total Hours."""
    names: list[str] = []
    for c in range(4, (ws.max_column or 4) + 1):
        v = ws.cell(header_row, c).value
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        if s.lower().startswith("total"):
            break
        names.append(s)
    return names


def sheet_employees_from_template(
    template_names: list[str],
    employees: list[dict],
    lids_with_hours: set[str],
) -> list[dict]:
    """Keep every template column; map live lids; append unmatched hour-workers.

    Matched columns use the live labor-store display name (short form) so
    renames in Create Labor show up on re-export. Unmatched empty template
    columns keep their original header text.
    """
    by_lid = {e["laborId"]: e for e in employees if e.get("laborId")}
    used: set[str] = set()
    out: list[dict] = []
    for i, title in enumerate(template_names):
        lid = match_labor_id(title, employees, used)
        if lid:
            used.add(lid)
            live = by_lid.get(lid) or {}
            display = short_name(live.get("name") or "") or title
            out.append({"laborId": lid, "name": display})
        else:
            out.append({"laborId": f"__tpl__{i}_{title}", "name": title})
    for emp in employees:
        lid = emp["laborId"]
        if lid in lids_with_hours and lid not in used:
            out.append({"laborId": lid, "name": short_name(emp["name"])})
            used.add(lid)
    assert len(out) >= len(template_names)
    return out


def parse_ymd(s: str) -> datetime:
    return datetime.strptime(s[:10], "%Y-%m-%d")


def daterange(start: datetime, end: datetime) -> list[datetime]:
    if end < start:
        start, end = end, start
    out = []
    cur = start
    # Job Card grid is ~31 day rows; keep first 31 if longer
    while cur <= end and len(out) < 31:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def month_label(start: datetime, end: datetime) -> str:
    mid = start + (end - start) / 2
    return (
        f"Month Of {mid.strftime('%B-%Y')} "
        f"(Period {start.strftime('%-d %b')} to {end.strftime('%-d %b %Y')})"
    )


def map_location(location_name: str) -> tuple[str, str | None] | None:
    key = norm(location_name)
    if key.startswith("loc "):
        key = key[4:].strip()
    if key in LOCATION_TO_SHEET:
        return LOCATION_TO_SHEET[key]
    for alias, dest in LOCATION_TO_SHEET.items():
        if alias in key or key in alias:
            return dest
    return None


def employees_for_lids(
    lids: set[str], name_by_lid: dict[str, str]
) -> list[dict]:
    return sorted(
        [
            {"laborId": lid, "name": name_by_lid.get(lid) or lid}
            for lid in lids
            if lid
        ],
        key=lambda e: (e["name"].lower(), e["laborId"]),
    )


def clear_sheet_body(ws, start_row: int, end_row: int, start_col: int, end_col: int):
    """Clear data/header grid from start_row down — never touch banner rows 1–2."""
    start_row = max(3, int(start_row))
    to_unmerge = []
    for rng in list(ws.merged_cells.ranges):
        if rng.min_row >= start_row:
            to_unmerge.append(str(rng))
    for r in to_unmerge:
        try:
            ws.unmerge_cells(r)
        except Exception:
            pass
    for row in ws.iter_rows(
        min_row=start_row,
        max_row=end_row,
        min_col=start_col,
        max_col=end_col,
    ):
        for cell in row:
            cell.value = None


def style_cell(cell, *, bold=False, size=10):
    cell.font = Font(name="Calibri", size=size, bold=bold)
    cell.alignment = CENTER
    cell.border = THIN


def fill_simple_sheet(
    ws,
    *,
    title: str,
    period: str,
    employees: list[dict],
    dates: list[datetime],
    hours: dict[tuple[str, str], float],
    data_start_row: int,
    summary_hours_label: str = "Hours",
):
    """GC / SC / Villa / Makkah layout: S/N Day Date | emp... | Total."""
    ws["A3"] = "🧰 🛠 MAINTENANCE DEPARTMENT"
    ws["A4"] = "Employee Working Hours Report (Division-Wise)"
    ws["A5"] = period
    ws["A6"] = title

    # Header labels always live on row 7 (merged into 7:8 when data starts at 9)
    header_row = 7
    max_clear_col = max(ws.max_column or 16, 16 + len(employees))
    clear_sheet_body(ws, 3, data_start_row + 55, 1, max_clear_col)

    ws["A3"] = "🧰 🛠 MAINTENANCE DEPARTMENT"
    ws["A4"] = "Employee Working Hours Report (Division-Wise)"
    ws["A5"] = period
    ws["A6"] = title
    for r in (3, 4, 5, 6):
        try:
            ws.merge_cells(
                start_row=r,
                start_column=1,
                end_row=r,
                end_column=max(16, 3 + len(employees)),
            )
        except Exception:
            pass

    ws.cell(header_row, 1, "S/N")
    ws.cell(header_row, 2, "Day")
    ws.cell(header_row, 3, "Date")
    for c in range(1, 4):
        style_cell(ws.cell(header_row, c), bold=True)

    emp_cols: list[tuple[str, int]] = []
    for i, emp in enumerate(employees):
        col = 4 + i
        emp_cols.append((emp["laborId"], col))
        # Prefer template/display name as passed (already short on simple sheets)
        cell = ws.cell(header_row, col, emp["name"])
        style_cell(cell, bold=True, size=9)
    total_col = 4 + len(employees)
    style_cell(ws.cell(header_row, total_col, "Total Hours"), bold=True, size=9)

    # GC/Villa: merge header into rows 7:8 so data can start at 9
    if data_start_row == 9:
        for col in range(1, total_col + 1):
            try:
                ws.merge_cells(
                    start_row=7, start_column=col, end_row=8, end_column=col
                )
            except Exception:
                pass
    elif data_start_row != 8:
        # unexpected layout — still keep header on row 7
        pass

    col_totals = {lid: 0.0 for lid, _ in emp_cols}
    for i, dt in enumerate(dates):
        row = data_start_row + i
        ws.cell(row, 1, i + 1)
        ws.cell(row, 2, DAY_NAMES[dt.weekday()])
        ws.cell(row, 3, dt)
        ws.cell(row, 3).number_format = "DD-MMM-YYYY"
        for c in range(1, 4):
            style_cell(ws.cell(row, c))
        ymd = dt.strftime("%Y-%m-%d")
        for lid, col in emp_cols:
            h = float(hours.get((ymd, lid), 0) or 0)
            col_totals[lid] = round(col_totals[lid] + h, 2)
            # Blank (not 0) when no hours — matches official template look
            cell = ws.cell(row, col, h if h else None)
            style_cell(cell)
        # row total
        if emp_cols:
            first = get_column_letter(emp_cols[0][1])
            last = get_column_letter(emp_cols[-1][1])
            cell = ws.cell(row, total_col, f"=SUM({first}{row}:{last}{row})")
        else:
            cell = ws.cell(row, total_col, 0)
        style_cell(cell, bold=True)

    n = len(dates)
    # Template leaves one blank row after the date grid, then "Total Hours "
    total_row = data_start_row + n + 1

    ws.cell(total_row, 1, "Total Hours ")
    try:
        ws.merge_cells(
            start_row=total_row, start_column=1, end_row=total_row, end_column=3
        )
    except Exception:
        pass
    style_cell(ws.cell(total_row, 1), bold=True)
    first_data = data_start_row
    last_data = data_start_row + n - 1 if n else data_start_row
    for lid, col in emp_cols:
        letter = get_column_letter(col)
        cell = ws.cell(
            total_row, col, f"=SUM({letter}{first_data}:{letter}{last_data})"
        )
        style_cell(cell, bold=True)
    tletter = get_column_letter(total_col)
    style_cell(
        ws.cell(
            total_row,
            total_col,
            f"=SUM({tletter}{first_data}:{tletter}{last_data})",
        ),
        bold=True,
    )

    # Bottom per-employee summary
    sum_title = total_row + 2
    sum_header = total_row + 3
    ws.cell(sum_title, 1, "Summary")
    ws.cell(sum_header, 1, "Employees Name")
    ws.cell(sum_header, 4, summary_hours_label)
    style_cell(ws.cell(sum_header, 1), bold=True)
    style_cell(ws.cell(sum_header, 4), bold=True)
    try:
        ws.merge_cells(
            start_row=sum_header, start_column=1, end_row=sum_header, end_column=3
        )
    except Exception:
        pass

    for i, emp in enumerate(employees):
        r = sum_header + 1 + i
        ws.cell(r, 1, emp["name"])
        try:
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
        except Exception:
            pass
        lid, col = emp_cols[i]
        letter = get_column_letter(col)
        ws.cell(r, 4, f"={letter}{total_row}")
        style_cell(ws.cell(r, 1))
        style_cell(ws.cell(r, 4))

    foot = sum_header + 1 + len(employees)
    ws.cell(foot, 1, "Total")
    try:
        ws.merge_cells(start_row=foot, start_column=1, end_row=foot, end_column=3)
    except Exception:
        pass
    if employees:
        ws.cell(foot, 4, f"=SUM(D{sum_header + 1}:D{foot - 1})")
    style_cell(ws.cell(foot, 1), bold=True)
    style_cell(ws.cell(foot, 4), bold=True)
    ws.cell(foot, 6, "Prepared By:")
    ws.cell(foot, 10, "Verified By:")
    ws.cell(foot, 15 if total_col >= 15 else total_col, "Approved By:")

    return {emp["laborId"]: col_totals[emp["laborId"]] for emp in employees}


def fill_dsp_sheet(
    ws,
    *,
    period: str,
    employees: list[dict],
    dates: list[datetime],
    hours: dict[tuple[str, str, str], float],
):
    """DSP sheet: each employee gets DSP / DS-Residence / DS-Mgmt / Namma (+ spacer)."""
    n_sub = DSP_SUB_COUNT
    block = n_sub  # data cols per employee
    stride = n_sub + 1  # + spacer between employees

    ws["A3"] = "🧰 🛠 MAINTENANCE DEPARTMENT"
    ws["A4"] = "Employee Working Hours Report (Division-Wise)"
    ws["A5"] = period
    ws["A6"] = SHEET_TITLES["DSP"]

    max_clear_col = max(ws.max_column or 50, 4 + len(employees) * stride + 2)
    clear_sheet_body(ws, 3, 60, 1, max_clear_col)
    ws["A3"] = "🧰 🛠 MAINTENANCE DEPARTMENT"
    ws["A4"] = "Employee Working Hours Report (Division-Wise)"
    ws["A5"] = period
    ws["A6"] = SHEET_TITLES["DSP"]
    title_span = max(20, 4 + len(employees) * stride)
    for r in (3, 4, 5, 6):
        try:
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=title_span)
        except Exception:
            pass

    ws.cell(7, 1, "S/N")
    ws.cell(7, 2, "Day")
    ws.cell(7, 3, "Date")
    for c in range(1, 4):
        style_cell(ws.cell(7, c), bold=True)
        try:
            ws.merge_cells(start_row=7, start_column=c, end_row=8, end_column=c)
        except Exception:
            pass

    emp_blocks: list[tuple[str, int]] = []  # laborId, start_col
    col = 4
    for i, emp in enumerate(employees):
        emp_blocks.append((emp["laborId"], col))
        try:
            ws.merge_cells(
                start_row=7, start_column=col, end_row=7, end_column=col + n_sub - 1
            )
        except Exception:
            pass
        style_cell(ws.cell(7, col, emp["name"]), bold=True, size=9)
        for j, sub in enumerate(DSP_SUBS):
            style_cell(ws.cell(8, col + j, sub), bold=True, size=8)
        col += block
        if i < len(employees) - 1:
            col += 1  # spacer between employee blocks only (none before Total)

    total_col = col if employees else 4
    style_cell(ws.cell(7, total_col, "Total Hours"), bold=True, size=9)
    try:
        ws.merge_cells(
            start_row=7, start_column=total_col, end_row=8, end_column=total_col
        )
    except Exception:
        pass

    totals: dict[tuple[str, str], float] = {}
    for i, dt in enumerate(dates):
        row = 9 + i
        ws.cell(row, 1, i + 1)
        ws.cell(row, 2, DAY_NAMES[dt.weekday()])
        ws.cell(row, 3, dt)
        ws.cell(row, 3).number_format = "DD-MMM-YYYY"
        for c in range(1, 4):
            style_cell(ws.cell(row, c))
        ymd = dt.strftime("%Y-%m-%d")
        for lid, start in emp_blocks:
            for j, sub in enumerate(DSP_SUBS):
                h = float(hours.get((ymd, lid, sub), 0) or 0)
                totals[(lid, sub)] = round(totals.get((lid, sub), 0) + h, 2)
                style_cell(ws.cell(row, start + j, h if h else None))
        if emp_blocks:
            first = get_column_letter(emp_blocks[0][1])
            last = get_column_letter(emp_blocks[-1][1] + n_sub - 1)
            style_cell(
                ws.cell(row, total_col, f"=SUM({first}{row}:{last}{row})"), bold=True
            )
        else:
            style_cell(ws.cell(row, total_col, 0), bold=True)

    n = len(dates)
    total_row = 9 + n + 1
    ws.cell(total_row, 1, "Total Hours ")
    try:
        ws.merge_cells(
            start_row=total_row, start_column=1, end_row=total_row, end_column=3
        )
    except Exception:
        pass
    style_cell(ws.cell(total_row, 1), bold=True)
    first_data, last_data = 9, 8 + n if n else 9
    for lid, start in emp_blocks:
        for j in range(n_sub):
            letter = get_column_letter(start + j)
            style_cell(
                ws.cell(
                    total_row,
                    start + j,
                    f"=SUM({letter}{first_data}:{letter}{last_data})",
                ),
                bold=True,
            )
    tletter = get_column_letter(total_col)
    style_cell(
        ws.cell(
            total_row,
            total_col,
            f"=SUM({tletter}{first_data}:{tletter}{last_data})",
        ),
        bold=True,
    )

    # Summary block — one column per DSP sub (Residence ≠ Mgmt)
    sum_title = total_row + 2
    sum_header = total_row + 3
    sum_total_col = 4 + n_sub  # immediately after the four subcols
    ws.cell(sum_title, 1, "Summary")
    ws.cell(sum_header, 1, "Employees Name")
    for j, sub in enumerate(DSP_SUBS):
        style_cell(ws.cell(sum_header, 4 + j, sub), bold=True)
    style_cell(ws.cell(sum_header, sum_total_col, "Total"), bold=True)
    style_cell(ws.cell(sum_header, 1), bold=True)
    try:
        ws.merge_cells(
            start_row=sum_header, start_column=1, end_row=sum_header, end_column=3
        )
    except Exception:
        pass

    for i, emp in enumerate(employees):
        r = sum_header + 1 + i
        lid, start = emp_blocks[i]
        ws.cell(r, 1, emp["name"])
        try:
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
        except Exception:
            pass
        for j, sub in enumerate(DSP_SUBS):
            letter = get_column_letter(start + j)
            style_cell(ws.cell(r, 4 + j, f"={letter}{total_row}"))
        first_sum = get_column_letter(4)
        last_sum = get_column_letter(3 + n_sub)
        style_cell(
            ws.cell(r, sum_total_col, f"=SUM({first_sum}{r}:{last_sum}{r})"), bold=True
        )
        style_cell(ws.cell(r, 1))

    foot = sum_header + 1 + len(employees)
    ws.cell(foot, 1, "Total")
    try:
        ws.merge_cells(start_row=foot, start_column=1, end_row=foot, end_column=3)
    except Exception:
        pass
    if employees:
        for col_i in list(range(4, 4 + n_sub)) + [sum_total_col]:
            col_letter = get_column_letter(col_i)
            style_cell(
                ws.cell(
                    foot,
                    col_i,
                    f"=SUM({col_letter}{sum_header + 1}:{col_letter}{foot - 1})",
                ),
                bold=True,
            )
    style_cell(ws.cell(foot, 1), bold=True)
    ws.cell(foot, 10, "Prepared By:")
    ws.cell(foot, 16, "Verified By:")
    ws.cell(foot, 20, "Approved By:")

    # Aggregate per labor for Summary sheet (sum of all DSP subs)
    per_emp = {}
    for emp in employees:
        lid = emp["laborId"]
        per_emp[lid] = round(
            sum(totals.get((lid, sub), 0) for sub in DSP_SUBS), 2
        )
    return per_emp


def fill_summary(
    ws,
    *,
    period: str,
    employees: list[dict],
    by_sheet: dict[str, dict[str, float]],
):
    max_clear_col = max(ws.max_column or 8, 8)
    # Keep banner images; clear from row 3
    to_unmerge = [str(r) for r in ws.merged_cells.ranges if r.min_row >= 3]
    for r in to_unmerge:
        try:
            ws.unmerge_cells(r)
        except Exception:
            pass
    for row in ws.iter_rows(min_row=3, max_row=40, min_col=1, max_col=max_clear_col):
        for cell in row:
            cell.value = None

    ws["A3"] = "🧰 🛠 MAINTENANCE DEPARTMENT"
    ws["A4"] = "Employee Working Hours Report (Division-Wise)"
    ws["A5"] = period
    try:
        ws.merge_cells("A3:H3")
        ws.merge_cells("A4:H4")
        ws.merge_cells("A5:H5")
    except Exception:
        pass

    headers = [
        "S/No",
        "Employee Names",
        "Scrap City",
        "Makkah Yard",
        "Green City",
        "DSP-DSWR",
        "Al Waha Villa",
        "Total Hours",
    ]
    for i, h in enumerate(headers, 1):
        style_cell(ws.cell(7, i, h), bold=True)
        try:
            ws.merge_cells(start_row=7, start_column=i, end_row=8, end_column=i)
        except Exception:
            pass

    sheet_keys = ["SC", "Makkah", "GC", "DSP", "Villa"]
    for i, emp in enumerate(employees):
        r = 9 + i
        lid = emp["laborId"]
        style_cell(ws.cell(r, 1, i + 1))
        style_cell(ws.cell(r, 2, emp["name"]))
        vals = []
        for j, sk in enumerate(sheet_keys):
            v = float(by_sheet.get(sk, {}).get(lid, 0) or 0)
            vals.append(v)
            style_cell(ws.cell(r, 3 + j, v))
        style_cell(ws.cell(r, 8, round(sum(vals), 2)), bold=True)

    foot = 9 + len(employees)
    ws.cell(foot, 1, "Total Hours")
    try:
        ws.merge_cells(start_row=foot, start_column=1, end_row=foot, end_column=2)
    except Exception:
        pass
    style_cell(ws.cell(foot, 1), bold=True)
    if employees:
        for col in range(3, 9):
            letter = get_column_letter(col)
            style_cell(
                ws.cell(foot, col, f"=SUM({letter}9:{letter}{foot - 1})"),
                bold=True,
            )


def build(payload: dict) -> bytes:
    if not TEMPLATE.exists():
        raise FileNotFoundError(f"Template missing: {TEMPLATE}")

    start = parse_ymd(payload.get("from") or "2026-10-26")
    end = parse_ymd(payload.get("to") or payload.get("from") or "2026-11-25")
    dates = daterange(start, end)
    period = month_label(start, end)

    employees = payload.get("employees") or []
    # stable order by name
    employees = sorted(
        [
            {
                "laborId": str(e.get("laborId") or "").strip(),
                "name": str(e.get("name") or e.get("laborId") or "").strip(),
            }
            for e in employees
            if str(e.get("laborId") or "").strip()
        ],
        key=lambda e: (e["name"].lower(), e["laborId"]),
    )

    entries = payload.get("entries") or []
    simple_hours: dict[str, dict[tuple[str, str], float]] = {
        "GC": {},
        "SC": {},
        "Villa": {},
        "Makkah": {},
    }
    dsp_hours: dict[tuple[str, str, str], float] = {}

    name_by_lid = {e["laborId"]: e["name"] for e in employees}
    for e in entries:
        ymd = str(e.get("date") or "")[:10]
        lid = str(e.get("laborId") or "").strip()
        loc = str(e.get("locationName") or e.get("locationId") or "")
        h = float(e.get("hours") or 0)
        if not ymd or not lid or h == 0:
            continue
        if e.get("name"):
            name_by_lid.setdefault(lid, str(e.get("name")).strip())
        mapped = map_location(loc)
        if not mapped:
            continue
        sheet, sub = mapped
        if sheet == "DSP":
            key = (ymd, lid, sub or "DSP")
            dsp_hours[key] = round(dsp_hours.get(key, 0) + h, 2)
        else:
            key = (ymd, lid)
            bucket = simple_hours[sheet]
            bucket[key] = round(bucket.get(key, 0) + h, 2)

    wb = load_workbook(TEMPLATE)

    # Structural columns = template headers (names stay even with blank hours)
    gc_emps = sheet_employees_from_template(
        read_template_emp_headers(wb["GC"]),
        employees,
        {lid for _, lid in simple_hours["GC"]},
    )
    sc_emps = sheet_employees_from_template(
        read_template_emp_headers(wb["SC"]),
        employees,
        {lid for _, lid in simple_hours["SC"]},
    )
    villa_emps = sheet_employees_from_template(
        read_template_emp_headers(wb["Villa"]),
        employees,
        {lid for _, lid in simple_hours["Villa"]},
    )
    makkah_emps = sheet_employees_from_template(
        read_template_emp_headers(wb["Makkah"]),
        employees,
        {lid for _, lid in simple_hours["Makkah"]},
    )
    dsp_emps = sheet_employees_from_template(
        read_template_emp_headers(wb["DSP"]),
        employees,
        {lid for _, lid, _ in dsp_hours},
    )
    # Summary rows: template DSP order first, then any extra lids with hours
    summary_emps = sheet_employees_from_template(
        read_template_emp_headers(wb["DSP"]),
        employees,
        {
            e["laborId"]
            for e in (gc_emps + sc_emps + villa_emps + makkah_emps + dsp_emps)
            if not str(e["laborId"]).startswith("__tpl__")
        }
        | {lid for _, lid in simple_hours["GC"]}
        | {lid for _, lid in simple_hours["SC"]}
        | {lid for _, lid in simple_hours["Villa"]}
        | {lid for _, lid in simple_hours["Makkah"]}
        | {lid for _, lid, _ in dsp_hours},
    )
    if not summary_emps and employees:
        summary_emps = employees

    by_sheet: dict[str, dict[str, float]] = {}
    by_sheet["GC"] = fill_simple_sheet(
        wb["GC"],
        title=SHEET_TITLES["GC"],
        period=period,
        employees=gc_emps,
        dates=dates,
        hours=simple_hours["GC"],
        data_start_row=9,
    )
    by_sheet["SC"] = fill_simple_sheet(
        wb["SC"],
        title=SHEET_TITLES["SC"],
        period=period,
        employees=sc_emps,
        dates=dates,
        hours=simple_hours["SC"],
        data_start_row=8,
        summary_hours_label="S-C",
    )
    by_sheet["Villa"] = fill_simple_sheet(
        wb["Villa"],
        title=SHEET_TITLES["Villa"],
        period=period,
        employees=villa_emps,
        dates=dates,
        hours=simple_hours["Villa"],
        data_start_row=9,
    )
    by_sheet["Makkah"] = fill_simple_sheet(
        wb["Makkah"],
        title=SHEET_TITLES["Makkah"],
        period=period,
        employees=makkah_emps,
        dates=dates,
        hours=simple_hours["Makkah"],
        data_start_row=8,
        summary_hours_label="Makkah",
    )
    by_sheet["DSP"] = fill_dsp_sheet(
        wb["DSP"],
        period=period,
        employees=dsp_emps,
        dates=dates,
        hours=dsp_hours,
    )
    fill_summary(
        wb["Summary"], period=period, employees=summary_emps, by_sheet=by_sheet
    )

    # Ensure sheet order matches official workbook
    order = ["GC", "DSP", "SC", "Villa", "Makkah", "Summary"]
    for i, name in enumerate(order):
        wb.move_sheet(name, offset=i - wb.sheetnames.index(name))

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def main():
    raw = sys.stdin.buffer.read()
    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except Exception as e:
        sys.stderr.write(f"invalid json: {e}\n")
        sys.exit(2)
    try:
        data = build(payload)
    except Exception as e:
        sys.stderr.write(f"{type(e).__name__}: {e}\n")
        sys.exit(1)
    sys.stdout.buffer.write(data)


if __name__ == "__main__":
    main()

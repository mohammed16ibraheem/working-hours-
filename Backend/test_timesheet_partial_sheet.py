#!/usr/bin/env python3
"""Fixture: printed grid 26-Oct → 25-Nov, hours through 21-Nov, blank 22–25.

Asserts OCR date repair + Y-grid completion so blank trailing rows do not
shift earlier dates, and assign_hours omits empty trailing days (no invented hours).
"""
from __future__ import annotations

import unittest

from timesheet_ocr import (
    assign_hours,
    complete_date_rows,
    expected_sheet_dates,
    parse_date_token,
)


def _item(text: str, cx: float, cy: float, score: float = 0.9):
    # box corners around center
    return {
        "text": text,
        "score": score,
        "box": [[cx - 10, cy - 6], [cx + 10, cy - 6], [cx + 10, cy + 6], [cx - 10, cy + 6]],
    }


class PartialSheetFixture(unittest.TestCase):
    def test_parse_ocr_month_glitches(self):
        self.assertEqual(parse_date_token("26-Oct-26"), "2026-10-26")
        self.assertEqual(parse_date_token("26-0ct-26"), "2026-10-26")
        self.assertEqual(parse_date_token("29-0c-26"), "2026-10-29")
        self.assertEqual(parse_date_token("31-0ct-26"), "2026-10-31")
        self.assertEqual(parse_date_token("22-NoV-26"), "2026-11-22")
        self.assertEqual(parse_date_token("25-Nov-26"), "2026-11-25")

    def test_expected_grid_oct26_nov25(self):
        dates = expected_sheet_dates(2026)
        self.assertEqual(len(dates), 31)
        self.assertEqual(dates[0], "2026-10-26")
        self.assertEqual(dates[-1], "2026-11-25")
        self.assertIn("2026-11-21", dates)
        self.assertIn("2026-11-22", dates)

    def test_complete_date_rows_fills_blank_trailing(self):
        # Simulate OCR that found most dates but skipped blank 22–25 Nov
        # and a few mid Fridays — plus OCR-failed early Oct tokens.
        pitch = 20.0
        y0 = 400.0
        expected = expected_sheet_dates(2026)
        detected = []
        for i, d in enumerate(expected):
            # Skip trailing blanks + a Friday (13 Nov index)
            if d >= "2026-11-22":
                continue
            if d == "2026-11-13":
                continue
            # Skip a couple early Oct as if OCR failed (0ct)
            if d in {"2026-10-26", "2026-10-29"}:
                continue
            detected.append((d, y0 + i * pitch))

        completed = complete_date_rows(detected, year=2026)
        self.assertEqual(len(completed), 31)
        by = {d: y for d, y in completed}
        # Trailing blanks restored
        for d in ("2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"):
            self.assertIn(d, by)
        # Early skipped Oct restored between neighbors
        self.assertIn("2026-10-26", by)
        self.assertIn("2026-10-29", by)
        # Monotonic Y down the page
        ys = [y for _, y in completed]
        self.assertEqual(ys, sorted(ys))
        # 21 Nov still before 22 Nov
        self.assertLess(by["2026-11-21"], by["2026-11-22"])

    def test_assign_hours_aligns_by_date_not_filled_row_index(self):
        """Hours near the 21-Nov Y must map to 21-Nov even if 22–25 have no ink."""
        expected = expected_sheet_dates(2026)
        pitch = 18.0
        # Grid must sit below header band (H * 0.34) used by assign_hours
        H, W = 1600, 1000
        y0 = H * 0.36
        # Only print dates OCR actually saw (through 21 Nov); complete_ fills rest
        detected = [(d, y0 + i * pitch) for i, d in enumerate(expected) if d <= "2026-11-21"]
        date_rows = complete_date_rows(detected, year=2026)

        # Column centers: Scrap City + Central Workshop + Total
        cols = {"Scrap City": 200.0, "Central Workshop": 500.0, "Total": 900.0}

        # Sample like the attached sheet: 26-Oct = 10h, 27-Oct = 11+3, 21-Nov = 11
        items = [
            _item("10", 200.0, y0 + 0 * pitch),  # 26-Oct
            _item("10", 900.0, y0 + 0 * pitch),
            _item("11", 200.0, y0 + 1 * pitch),  # 27-Oct Scrap
            _item("3", 500.0, y0 + 1 * pitch),  # 27-Oct Workshop
            _item("14", 900.0, y0 + 1 * pitch),
            _item("11", 200.0, y0 + 26 * pitch),  # 21-Nov (index 26)
            _item("11", 900.0, y0 + 26 * pitch),
        ]
        # No hour marks near 22–25 Nov Y positions

        rows = assign_hours(items, cols, date_rows, H, W)
        by_date = {r["date"]: r for r in rows}

        self.assertIn("2026-10-26", by_date)
        self.assertEqual(by_date["2026-10-26"]["total"], 10)
        self.assertIn("2026-11-21", by_date)
        self.assertEqual(by_date["2026-11-21"]["locations"].get("Scrap City"), 11)
        # Blank trailing dates must be absent (not invented)
        for d in ("2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"):
            self.assertNotIn(d, by_date)


if __name__ == "__main__":
    unittest.main()

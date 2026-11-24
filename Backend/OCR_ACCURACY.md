# Timesheet OCR accuracy (Daily Working Hours sheets)

Engine: **RapidOCR ONNX** (`rapidocr-onnxruntime`) with OpenCV preprocess (CLAHE + light deskew). Tesseract remains a fallback only.

## What works

- Printed column headers and most **calendar dates**
- **Labor ID** when written clearly as 2–4 digits near the name (e.g. `195`, `646`)
- Employee **name** when block-capitals are reasonably neat (still OCR-noisy; backend fuzzy-matches Create Labor)
- **Dense single-location** hour columns (e.g. Villa filled with `10`) — partial recovery

## What fails / needs review

- Sparse **multi-location** blue ballpoint (hours split across Scrap/Makkah/Green/Workshop on one day)
- Messy digits (`7` with crossbar, open `4`, `10`→`19`/`IO`)
- Blank ID lines (name-only sheets)
- Friday `F` / `F-2` marks (treated as off when detected)

## Partial sheets (blank trailing / Fridays)

Printed form is always **26-Oct → 25-Nov**. Empty Fridays and unfilled trailing days (e.g. 22–25 Nov) are normal. OCR completes the date Y-grid so hours stay aligned by printed date; blank days are omitted from the commit payload (no invented hours). Re-upload of the same labor merges by date: replace overlapping days, keep earlier committed days that are absent from the new fill.

## Rule

Upload → OCR draft → **human review in Upload timesheets** → commit → Reports.

Do **not** auto-trust location hours without review.

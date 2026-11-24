"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  LoaderCircle,
  FileImage,
  CheckCircle2,
  Pencil,
  Save,
  X,
  AlertTriangle,
} from "lucide-react";
import {
  TimesheetMeta,
  TimesheetParsed,
  TimesheetRow,
  commitTimesheet,
  getTimesheet,
  listTimesheets,
  updateTimesheet,
  uploadTimesheetFiles,
} from "@/lib/timesheetsApi";

type Props = {
  refreshKey?: number;
  onCommitted?: () => void;
};

const ACCEPT =
  "image/jpeg,image/png,image/jpg,.jpg,.jpeg,.png,application/pdf,.pdf";

const LOC_COLS = [
  "Scrap City",
  "Makkah Yard",
  "Green City",
  "DS-Plastic",
  "Al Waha - Villa",
  "Central Workshop",
  "DS-Residence",
  "DS-Mgmt",
  "Namma H.O",
  "Guzain Yard",
];

function statusColor(status: string) {
  if (status === "committed") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "reviewed") return "bg-amber-50 text-amber-900 border-amber-200";
  return "bg-field text-muted border-line";
}

function isAllowedTimesheetFile(file: File) {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return true;
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/png") return true;
  if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png")) return true;
  return false;
}

export function UploadTimesheetsPanel({ refreshKey = 0, onCommitted }: Props) {
  const [items, setItems] = useState<TimesheetMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TimesheetParsed | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function reload() {
    const data = await listTimesheets();
    setItems(data.items || []);
  }

  useEffect(() => {
    let alive = true;
    setError("");
    reload().catch((err) => {
      if (alive) setError(err instanceof Error ? err.message : "Could not load.");
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function onUpload(fileList: FileList | File[] | null) {
    const raw = fileList ? Array.from(fileList) : [];
    if (!raw.length) return;
    const files = raw.filter(isAllowedTimesheetFile);
    if (!files.length) {
      setError("Only JPEG, PNG, or PDF timesheet files are accepted.");
      return;
    }
    if (files.length < raw.length) {
      setError("Skipped unsupported files — only JPEG/PNG/PDF were uploaded.");
    } else {
      setError("");
    }
    setBusy(true);
    setOk("");
    try {
      const res = await uploadTimesheetFiles(files);
      setOk(
        `Uploaded ${res.items.length} sheet(s) — review OCR before commit to Reports.`,
      );
      await reload();
      if (res.items[0]?.id) await openReview(res.items[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openReview(id: string) {
    setError("");
    setBusy(true);
    try {
      const row = await getTimesheet(id);
      setActiveId(id);
      setDraft({
        employeeName: row.parsed?.employeeName || row.employeeName || null,
        laborId: row.parsed?.laborId || row.laborId || null,
        month: row.parsed?.month || null,
        rows: (row.parsed?.rows || []).map((r) => ({
          ...r,
          locations: { ...(r.locations || {}) },
        })),
        needsReview: row.parsed?.needsReview,
        note: row.parsed?.note,
        matchedLaborId: row.parsed?.matchedLaborId,
        matchedName: row.parsed?.matchedName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open sheet.");
    } finally {
      setBusy(false);
    }
  }

  function setCell(rowIdx: number, loc: string, value: string) {
    if (!draft) return;
    const rows = draft.rows.map((r, i) => {
      if (i !== rowIdx) return r;
      const locations = { ...r.locations };
      const n = Number(value);
      if (!value.trim() || !Number.isFinite(n) || n <= 0) delete locations[loc];
      else locations[loc] = n;
      const total = Object.values(locations).reduce((a, b) => a + Number(b || 0), 0);
      return { ...r, locations, total, off: total <= 0 && r.off };
    });
    setDraft({ ...draft, rows });
  }

  function setRowMeta(rowIdx: number, patch: Partial<TimesheetRow>) {
    if (!draft) return;
    setDraft({
      ...draft,
      rows: draft.rows.map((r, i) => (i === rowIdx ? { ...r, ...patch } : r)),
    });
  }

  async function saveDraft() {
    if (!activeId || !draft) return;
    setSaving(true);
    setError("");
    try {
      await updateTimesheet(activeId, draft);
      setOk("Review saved.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function onCommit() {
    if (!activeId || !draft) return;
    const reCommit = activeMeta?.status === "committed";
    const msg = reCommit
      ? "Re-commit and merge by date? Overlapping days for this labor are replaced; other days stay."
      : "Commit these hours into Reports attendance? Only dated rows with hours are written — blank days stay empty.";
    if (!window.confirm(msg)) return;
    setSaving(true);
    setError("");
    try {
      await updateTimesheet(activeId, draft);
      const res = await commitTimesheet(activeId, { replace: reCommit });
      setOk(
        res.alreadyCommitted
          ? "Already committed."
          : `Committed ${res.records} attendance record(s)${
              res.merged ? " (merged by date for this labor)" : ""
            }.`,
      );
      await reload();
      onCommitted?.();
      const row = await getTimesheet(activeId);
      setDraft(row.parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed.");
    } finally {
      setSaving(false);
    }
  }

  const activeMeta = useMemo(
    () => items.find((i) => i.id === activeId) || null,
    [items, activeId],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold text-green-deep">Upload timesheet images</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-green-deep px-3 text-sm font-semibold text-white transition hover:bg-green disabled:opacity-60"
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Upload className="h-4 w-4" strokeWidth={1.75} />
            )}
            Upload files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              void onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop timesheet images or PDFs here"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onClick={() => {
          if (!busy) fileInputRef.current?.click();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          if (busy) return;
          void onUpload(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition ${
          dragOver
            ? "border-accent bg-accent/10 ring-[3px] ring-accent/20"
            : "border-line bg-field/50 hover:border-accent hover:bg-white"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Upload className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <p className="text-sm font-semibold text-green-deep">
          {dragOver ? "Drop files to upload" : "Drag & drop timesheet files here"}
        </p>
        <p className="max-w-md text-xs text-muted">
          JPEG, PNG, or PDF · single file or multiple at once · PDF pages become separate sheets
          for review → Commit to Reports
        </p>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          {ok}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-line">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            No timesheets yet. Upload sheet photos or PDFs to get started.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <FileImage className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-green-deep">
                    {item.employeeName || item.fileName}
                    {item.laborId ? (
                      <span className="ml-2 font-normal text-muted">#{item.laborId}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {item.fileName} · {item.engine || "ocr"}
                    {item.ocrOk === false ? " · OCR weak — review needed" : ""}
                    {item.committedRecords
                      ? ` · ${item.committedRecords} records committed`
                      : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColor(item.status)}`}
                >
                  {item.status}
                </span>
                <button
                  type="button"
                  onClick={() => void openReview(item.id)}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold text-green hover:border-accent hover:text-accent"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Review
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {activeId && draft ? (
        <div className="rounded-xl border border-line bg-field/40 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-green-deep">
                Review / edit — {activeMeta?.fileName || activeId}
              </h4>
              <p className="text-xs text-muted">
                {draft.matchedName
                  ? `Matched Create Labor: ${draft.matchedName} (${draft.matchedLaborId})`
                  : "No Create Labor match yet — set labor ID if known."}
                {draft.note ? ` · ${draft.note}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveId(null);
                  setDraft(null);
                }}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-muted"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                Close
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveDraft()}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-green hover:border-accent"
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                Save review
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onCommit()}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-green-deep px-2.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                {activeMeta?.status === "committed" ? "Re-commit (merge)" : "Commit to Reports"}
              </button>
            </div>
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <label className="text-xs font-semibold text-muted">
              Employee name
              <input
                value={draft.employeeName || ""}
                onChange={(e) => setDraft({ ...draft, employeeName: e.target.value })}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-foreground outline-none focus:border-accent"
              />
            </label>
            <label className="text-xs font-semibold text-muted">
              Labor ID
              <input
                value={draft.laborId || ""}
                onChange={(e) => setDraft({ ...draft, laborId: e.target.value })}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-foreground outline-none focus:border-accent"
              />
            </label>
            <label className="text-xs font-semibold text-muted">
              Month label
              <input
                value={draft.month || ""}
                onChange={(e) => setDraft({ ...draft, month: e.target.value })}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-foreground outline-none focus:border-accent"
              />
            </label>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="min-w-[1100px] w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-line bg-field/80 text-muted">
                  <th className="px-2 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 font-semibold">Off</th>
                  {LOC_COLS.map((c) => (
                    <th key={c} className="px-1 py-2 font-semibold whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row, idx) => (
                  <tr key={`${row.date}-${idx}`} className="border-b border-line/70">
                    <td className="px-2 py-1">
                      <input
                        value={row.date}
                        onChange={(e) => setRowMeta(idx, { date: e.target.value })}
                        className="h-8 w-[108px] rounded border border-line px-1.5"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(row.off)}
                        onChange={(e) =>
                          setRowMeta(idx, {
                            off: e.target.checked,
                            locations: e.target.checked ? {} : row.locations,
                            total: e.target.checked ? 0 : row.total,
                          })
                        }
                      />
                    </td>
                    {LOC_COLS.map((c) => (
                      <td key={c} className="px-1 py-1">
                        <input
                          disabled={Boolean(row.off)}
                          value={row.locations?.[c] != null ? String(row.locations[c]) : ""}
                          onChange={(e) => setCell(idx, c, e.target.value)}
                          className="h-8 w-12 rounded border border-line px-1 text-center disabled:bg-field"
                          inputMode="decimal"
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1 font-semibold text-green-deep">
                      {row.off
                        ? "—"
                        : Object.values(row.locations || {}).reduce(
                            (a, b) => a + Number(b || 0),
                            0,
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

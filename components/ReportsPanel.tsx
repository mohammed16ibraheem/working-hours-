"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { motion } from "framer-motion";
import {
  FileSpreadsheet,
  LoaderCircle,
  Clock3,
  Timer,
  Hash,
  Download,
  Pencil,
  Trash2,
  Save,
  X,
  Check,
} from "lucide-react";
import { listLabors, LaborRecord } from "@/lib/laborStore";
import { listLocations, LocationRecord } from "@/lib/locationStore";
import { deleteAttendance, updateAttendance } from "@/lib/attendanceApi";
import {
  AttendanceRecord,
  AttendanceReport,
  fetchAttendanceReport,
  ReportGroupBy,
} from "@/lib/reportsApi";

const NORMAL_DAY = 10;

function splitHours(hours: number) {
  const h = Math.max(0, Number(hours) || 0);
  return {
    hours: Math.round(h * 100) / 100,
    regular: Math.round(Math.min(h, NORMAL_DAY) * 100) / 100,
    ot: Math.round(Math.max(0, h - NORMAL_DAY) * 100) / 100,
  };
}

type Preset = "week" | "month" | "year" | "custom";

type Props = {
  refreshKey?: number;
  onCount?: (n: number) => void;
};

function mondayOf(d: dayjs.Dayjs) {
  return d.day() === 0 ? d.subtract(6, "day") : d.subtract(d.day() - 1, "day");
}

function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const to = dayjs();
  if (preset === "week") {
    return { from: mondayOf(to).format("YYYY-MM-DD"), to: to.format("YYYY-MM-DD") };
  }
  if (preset === "year") {
    return { from: to.startOf("year").format("YYYY-MM-DD"), to: to.format("YYYY-MM-DD") };
  }
  return { from: to.startOf("month").format("YYYY-MM-DD"), to: to.format("YYYY-MM-DD") };
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function EmployeeAvatar({
  name,
  photo,
  size = 40,
  label,
  onOpen,
}: {
  name: string;
  photo?: string;
  size?: number;
  label?: string;
  onOpen?: () => void;
}) {
  const clickable = Boolean(onOpen && photo?.startsWith("data:image/"));
  const img = photo?.startsWith("data:image/") ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo}
      alt={label ? `${name} — ${label}` : name}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-xl object-cover ring-1 ring-line ${
        clickable ? "cursor-pointer transition hover:ring-accent" : ""
      }`}
    />
  ) : (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-xl bg-accent/10 text-xs font-bold tracking-wide text-green"
      aria-hidden
    >
      {initials(name)}
    </div>
  );
  const body = !label ? (
    img
  ) : (
    <div className="flex flex-col items-center gap-0.5">
      {img}
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
    </div>
  );
  if (!clickable) return body;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
      className="cursor-pointer rounded-xl border-0 bg-transparent p-0 text-left"
      aria-label={label ? `View ${label} photo` : `View photo of ${name}`}
    >
      {body}
    </button>
  );
}

type PhotoLightboxState = {
  name: string;
  photo?: string;
};

function PhotoLightbox({
  state,
  onClose,
}: {
  state: PhotoLightboxState;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Profile photo — ${state.name}`}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{state.name}</p>
            <p className="text-xs font-semibold tracking-wide text-white/70 uppercase">
              Profile
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            aria-label="Close photo"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {state.photo?.startsWith("data:image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.photo}
              alt={`${state.name} — profile`}
              className="max-h-[75vh] max-w-full rounded-xl object-contain shadow-2xl"
            />
          ) : (
            <p className="rounded-xl bg-white/10 px-4 py-8 text-sm text-white/80">
              No profile photo available.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ThinProgress({
  value,
  max,
  colorClass,
  animateKey,
  delay = 0,
}: {
  value: number;
  max: number;
  colorClass: string;
  animateKey: string;
  delay?: number;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/50">
      <motion.div
        key={animateKey}
        className={`h-full rounded-full ${colorClass}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

export function ReportsPanel({ refreshKey = 0, onCount }: Props) {
  const [labors, setLabors] = useState<LaborRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [preset, setPreset] = useState<Preset>("month");
  const initial = presetRange("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [laborId, setLaborId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("day");
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    date: string;
    laborId: string;
    locationId: string;
    hours: string;
  }>({ date: "", laborId: "", locationId: "", hours: "0" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [lightbox, setLightbox] = useState<PhotoLightboxState | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listLabors(), listLocations()])
      .then(([ls, locs]) => {
        if (!alive) return;
        setLabors(ls);
        setLocations(locs);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const applyPreset = useCallback((p: Exclude<Preset, "custom">) => {
    const r = presetRange(p);
    setPreset(p);
    setFrom(r.from);
    setTo(r.to);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchAttendanceReport({
      from,
      to,
      laborId: laborId || undefined,
      locationId: locationId || undefined,
      groupBy,
    })
      .then((data) => {
        if (!alive) return;
        setReport(data);
        onCount?.(data.summary.records);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Could not load report.");
        setReport(null);
        onCount?.(0);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, laborId, locationId, groupBy, refreshKey, reloadTick]);

  useEffect(() => {
    if (!successMsg) return;
    const t = window.setTimeout(() => setSuccessMsg(""), 2200);
    return () => window.clearTimeout(t);
  }, [successMsg]);

  const summary = report?.summary;
  const records = report?.records || [];
  const animKey = `${from}|${to}|${laborId}|${locationId}|${groupBy}|${summary?.records ?? 0}`;

  function startEdit(rec: AttendanceRecord) {
    setRowError("");
    setEditingId(rec.id);
    setDraft({
      date: rec.date || "",
      laborId:
        rec.laborId && rec.laborId !== "_unmatched" ? rec.laborId : "",
      locationId: rec.locationId || "",
      hours: String(rec.hours ?? 0),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError("");
  }

  async function saveRecord(rec: AttendanceRecord) {
    const hoursNum = Math.max(0, Number(draft.hours));
    if (!Number.isFinite(hoursNum)) {
      setRowError("Hours must be a number.");
      return;
    }
    if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      setRowError("Date is required (YYYY-MM-DD).");
      return;
    }
    if (!draft.locationId) {
      setRowError("Location is required.");
      return;
    }
    const needsEmployee = !rec.laborId || rec.laborId === "_unmatched";
    if (needsEmployee && !draft.laborId) {
      setRowError("Assign an employee before saving.");
      return;
    }
    setBusyId(rec.id);
    setRowError("");
    try {
      const payload: {
        date: string;
        locationId: string;
        hours: number;
        laborId?: string | null;
      } = {
        date: draft.date,
        locationId: draft.locationId,
        hours: hoursNum,
      };
      if (draft.laborId) payload.laborId = draft.laborId;
      await updateAttendance(rec.id, payload);
      setEditingId(null);
      setSuccessMsg("Saved.");
      setReloadTick((n) => n + 1);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeRecord(rec: AttendanceRecord) {
    if (!window.confirm(`Delete attendance for ${rec.name} on ${rec.date}?`)) return;
    setBusyId(rec.id);
    setRowError("");
    try {
      await deleteAttendance(rec.id);
      if (editingId === rec.id) setEditingId(null);
      setSuccessMsg("Deleted.");
      setReloadTick((n) => n + 1);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  const photoByLaborId = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of labors) {
      if (l.photoDataUrl?.startsWith("data:image/")) map.set(l.laborId, l.photoDataUrl);
    }
    return map;
  }, [labors]);

  function openPhotoLightbox(rec: AttendanceRecord, profilePhoto?: string) {
    const photo = profilePhoto || photoByLaborId.get(rec.laborId);
    if (!photo?.startsWith("data:image/")) return;
    setLightbox({ name: rec.name, photo });
  }

  const laborOptions = useMemo(
    () =>
      [...labors].sort((a, b) => a.name.localeCompare(b.name) || a.laborId.localeCompare(b.laborId)),
    [labors],
  );

  async function exportExcel() {
    if (!report) return;
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (laborId) q.set("laborId", laborId);
    if (locationId) q.set("locationId", locationId);
    const apiBase = process.env.NEXT_PUBLIC_WH_API || "";
    try {
      const res = await fetch(`${apiBase}/api/reports/job-card.xlsx?${q}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Job_Card_${from}_to_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Export failed.");
    }
  }

  const fieldCls =
    "mt-1.5 h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-foreground outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent/15";
  const selectCls = `${fieldCls} cursor-pointer font-medium`;
  const segTrack =
    "mt-1.5 inline-flex h-10 w-full items-stretch rounded-lg border border-line bg-card p-0.5 sm:w-auto";
  const segBtn = (active: boolean) =>
    `h-full min-w-0 flex-1 cursor-pointer rounded-md px-3 text-xs font-semibold whitespace-nowrap transition sm:flex-none ${
      active
        ? "bg-green-deep text-white shadow-sm"
        : "text-muted hover:bg-field hover:text-green"
    }`;
  const labelCls = "text-[11px] font-semibold tracking-wide text-muted uppercase";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-field p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
            <div>
              <p className={labelCls}>Period preset</p>
              <div className={segTrack} role="group" aria-label="Period preset">
                {(
                  [
                    ["week", "This week"],
                    ["month", "This month"],
                    ["year", "This year"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    aria-pressed={preset === key}
                    className={segBtn(preset === key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className={labelCls}>Group by</p>
              <div className={segTrack} role="group" aria-label="Group by">
                {(["day", "week", "month", "year"] as ReportGroupBy[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroupBy(g)}
                    aria-pressed={groupBy === g}
                    className={`${segBtn(groupBy === g)} capitalize`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={exportExcel}
            disabled={!report || loading}
            className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 text-sm font-semibold text-green transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 sm:self-end"
          >
            <Download className="h-4 w-4" strokeWidth={1.75} />
            Export Excel
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line/80 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelCls}>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setPreset("custom");
                setFrom(e.target.value);
              }}
              className={fieldCls}
            />
          </label>
          <label className={labelCls}>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setPreset("custom");
                setTo(e.target.value);
              }}
              className={fieldCls}
            />
          </label>
          <label className={labelCls}>
            Employee
            <select
              value={laborId}
              onChange={(e) => setLaborId(e.target.value)}
              className={selectCls}
            >
              <option value="">All employees</option>
              {laborOptions.map((l) => (
                <option key={l.id} value={l.laborId}>
                  {l.name} ({l.laborId})
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Location
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={selectCls}
            >
              <option value="">All locations</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <p
          className="rounded-xl border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-sm font-medium text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Total hours",
            value: summary ? fmt(summary.totalHours) : "—",
            icon: Clock3,
            bar: summary
              ? {
                  value: summary.totalHours,
                  max: Math.max(summary.totalHours, 1),
                  color: "bg-green",
                }
              : null,
          },
          {
            label: "Regular hours",
            value: summary ? fmt(summary.regularHours) : "—",
            icon: Timer,
            bar: summary
              ? {
                  value: summary.regularHours,
                  max: Math.max(summary.totalHours, 1),
                  color: "bg-accent",
                }
              : null,
          },
          {
            label: "OT hours",
            value: summary ? fmt(summary.otHours) : "—",
            icon: Timer,
            bar: summary
              ? {
                  value: summary.otHours,
                  max: Math.max(summary.totalHours, 1),
                  color: "bg-amber-500",
                }
              : null,
          },
          {
            label: "Days / Employees",
            value: summary ? `${summary.days} / ${summary.employees}` : "—",
            icon: Hash,
            bar: null,
          },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-2xl border border-line bg-card px-4 py-3 shadow-[0_6px_20px_rgba(15,47,34,0.04)]"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <Icon className="h-3.5 w-3.5 text-green" strokeWidth={1.75} />
                {card.label}
              </div>
              <p className="mt-1 text-xl font-semibold text-green-deep">{card.value}</p>
              {card.bar ? (
                <ThinProgress
                  value={card.bar.value}
                  max={card.bar.max}
                  colorClass={card.bar.color}
                  animateKey={`${animKey}-${card.label}`}
                  delay={i * 0.05}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-field px-6 py-14 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
          Building report…
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-field px-6 py-14 text-center">
          <FileSpreadsheet className="mx-auto h-9 w-9 text-muted" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-semibold text-green-deep">No hours yet</p>
          <p className="mt-1 text-sm text-muted">
            Upload timesheet images and commit them — reports show that data only.
          </p>
        </div>
      ) : (
        <>
          {successMsg ? (
            <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-green-deep">
              <Check className="h-4 w-4 text-green" strokeWidth={2} />
              {successMsg}
            </div>
          ) : null}
          {rowError ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {rowError}
            </p>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-semibold text-green-deep">
              Timesheet records ({records.length})
            </p>
            <p className="text-xs text-muted">
              Edit date, location, hours, and employee when needed. Regular = min(hours, 10), OT =
              max(0, hours−10). Summary cards stay aggregated.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-field text-xs font-semibold tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Employee</th>
                    <th className="px-3 py-2.5">Name</th>
                    <th className="px-3 py-2.5">ID</th>
                    <th className="px-3 py-2.5">Location</th>
                    <th className="px-3 py-2.5 text-right">Hours</th>
                    <th className="px-3 py-2.5 text-right">Regular</th>
                    <th className="px-3 py-2.5 text-right">OT</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => {
                    const isEdit = editingId === rec.id;
                    const draftSplit = isEdit
                      ? splitHours(Number(draft.hours))
                      : {
                          hours: rec.hours,
                          regular: rec.regularHours,
                          ot: rec.otHours,
                        };
                    const busy = busyId === rec.id;
                    const profilePhoto = isEdit
                      ? photoByLaborId.get(draft.laborId || rec.laborId) ||
                        photoByLaborId.get(rec.laborId)
                      : photoByLaborId.get(rec.laborId);
                    const selectedLabor = isEdit
                      ? laborOptions.find((l) => l.laborId === draft.laborId)
                      : null;
                    const displayName = isEdit
                      ? selectedLabor?.name || rec.name
                      : rec.name;
                    const displayId = isEdit
                      ? draft.laborId ||
                        (rec.laborId !== "_unmatched" ? rec.laborId : "—")
                      : rec.laborId === "_unmatched"
                        ? "—"
                        : rec.laborId;
                    return (
                      <tr
                        key={rec.id}
                        className="border-t border-line bg-card align-top"
                      >
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap text-foreground">
                          {isEdit ? (
                            <input
                              type="date"
                              value={draft.date}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, date: e.target.value }))
                              }
                              className="h-9 rounded-lg border border-line bg-card px-2 text-sm outline-none focus:border-accent"
                              disabled={busy}
                            />
                          ) : (
                            rec.date
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <EmployeeAvatar
                            name={displayName}
                            photo={profilePhoto}
                            size={36}
                            onOpen={
                              profilePhoto?.startsWith("data:image/")
                                ? () => openPhotoLightbox(rec, profilePhoto)
                                : undefined
                            }
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          {isEdit ? (
                            <select
                              value={draft.laborId}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, laborId: e.target.value }))
                              }
                              className="h-9 w-full min-w-[140px] rounded-lg border border-line bg-card px-2 text-sm outline-none focus:border-accent"
                              disabled={busy}
                            >
                              <option value="">Select employee…</option>
                              {laborOptions.map((l) => (
                                <option key={l.id} value={l.laborId}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="truncate font-semibold text-green-deep">{rec.name}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted">
                          {displayId}
                        </td>
                        <td className="px-3 py-2.5">
                          {isEdit ? (
                            <select
                              value={draft.locationId}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, locationId: e.target.value }))
                              }
                              className="h-9 w-full min-w-[140px] rounded-lg border border-line bg-card px-2 text-sm outline-none focus:border-accent"
                              disabled={busy}
                            >
                              <option value="">Select location…</option>
                              {locations.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-muted">{rec.locationName}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {isEdit ? (
                            <input
                              type="number"
                              min={0}
                              step={0.25}
                              value={draft.hours}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, hours: e.target.value }))
                              }
                              className="ml-auto h-9 w-20 rounded-lg border border-line bg-card px-2 text-right text-sm tabular-nums outline-none focus:border-accent"
                              disabled={busy}
                            />
                          ) : (
                            <span className="font-medium tabular-nums">{fmt(rec.hours)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {fmt(draftSplit.regular)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-amber-600">
                          {fmt(draftSplit.ot)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {isEdit ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => saveRecord(rec)}
                                  disabled={busy}
                                  className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-green-deep px-2.5 text-xs font-semibold text-white disabled:opacity-60"
                                >
                                  {busy ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                                  )}
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  disabled={busy}
                                  className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-semibold text-muted"
                                >
                                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEdit(rec)}
                                  disabled={busyId != null}
                                  className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-semibold text-green-deep hover:bg-field disabled:opacity-60"
                                >
                                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeRecord(rec)}
                                  disabled={busyId != null}
                                  className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {records.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-8 text-center text-sm text-muted"
                      >
                        No individual records in this range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {lightbox ? (
        <PhotoLightbox state={lightbox} onClose={() => setLightbox(null)} />
      ) : null}
    </div>
  );
}

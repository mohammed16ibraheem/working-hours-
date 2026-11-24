"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { listLabors, type LaborRecord } from "@/lib/laborStore";
import { listLocations, type LocationRecord } from "@/lib/locationStore";
import {
  createAttendance,
  deleteAttendance,
  listAttendanceLogs,
  type AttendanceLogRecord,
} from "@/lib/attendanceApi";

type Props = {
  onSaved?: () => void;
};

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function todayParts() {
  const now = new Date();
  return {
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

const selectClass =
  "h-12 w-full cursor-pointer rounded-xl border border-line bg-field px-3.5 text-[15px] outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/20";

export function BatchPanel({ onSaved }: Props) {
  const today = useMemo(() => todayParts(), []);
  const [labors, setLabors] = useState<LaborRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [recent, setRecent] = useState<AttendanceLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [laborRecordId, setLaborRecordId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [hours, setHours] = useState("10");
  const [day, setDay] = useState(today.day);
  const [month, setMonth] = useState(today.month);
  const [year, setYear] = useState(today.year);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const yearOptions = useMemo(() => {
    const y = today.year;
    return [y - 1, y, y + 1];
  }, [today.year]);

  const dayOptions = useMemo(() => {
    const max = daysInMonth(year, month);
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [year, month]);

  useEffect(() => {
    if (day > dayOptions.length) setDay(dayOptions.length);
  }, [day, dayOptions.length]);

  const refreshRecent = useCallback(async () => {
    const rows = await listAttendanceLogs({ source: "batch", limit: 25 });
    setRecent(rows);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all([listLabors(), listLocations(), listAttendanceLogs({ source: "batch", limit: 25 })])
      .then(([laborRows, locationRows, batchRows]) => {
        if (!alive) return;
        setLabors(laborRows.slice().sort((a, b) => a.name.localeCompare(b.name)));
        setLocations(locationRows.slice().sort((a, b) => a.name.localeCompare(b.name)));
        setRecent(batchRows);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Could not load Batch form data.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!laborRecordId) {
      setError("Select an employee.");
      return;
    }
    if (!locationId) {
      setError("Select a location.");
      return;
    }
    const hoursNum = Number(hours);
    if (!Number.isFinite(hoursNum) || hoursNum < 0) {
      setError("Enter hours as a non-negative number.");
      return;
    }
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    setBusy(true);
    try {
      const saved = await createAttendance({
        laborRecordId,
        locationId,
        date,
        hours: hoursNum,
      });
      const emp = labors.find((r) => r.id === laborRecordId);
      setOk(
        `Saved ${saved.hours ?? hoursNum}h for ${emp?.name || saved.name || "employee"} on ${date}. Goes to Reports.`,
      );
      setHours("10");
      onSaved?.();
      await refreshRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save attendance.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setError("");
    setOk("");
    setDeletingId(id);
    try {
      await deleteAttendance(id);
      setOk("Batch entry deleted.");
      onSaved?.();
      await refreshRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete entry.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted">
        <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
        Loading Batch…
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="batch-employee" className="block text-[13px] font-semibold text-green">
            Employee
          </label>
          <select
            id="batch-employee"
            value={laborRecordId}
            onChange={(e) => setLaborRecordId(e.target.value)}
            className={selectClass}
          >
            <option value="">Select employee…</option>
            {labors.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} — {row.laborId}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="batch-location" className="block text-[13px] font-semibold text-green">
            Location
          </label>
          <select
            id="batch-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={selectClass}
          >
            <option value="">Select location…</option>
            {locations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="batch-hours" className="block text-[13px] font-semibold text-green">
            Hours
          </label>
          <input
            id="batch-hours"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 10"
            className="h-12 w-full rounded-xl border border-line bg-field px-3.5 text-[15px] outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/20"
          />
          <p className="text-xs text-muted">Over 10 hours splits into OT in Reports automatically.</p>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[13px] font-semibold text-green">Date</span>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="batch-day" className="mb-1 block text-[11px] font-medium text-muted">
                Day
              </label>
              <select
                id="batch-day"
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className={selectClass}
              >
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="batch-month" className="mb-1 block text-[11px] font-medium text-muted">
                Month
              </label>
              <select
                id="batch-month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={selectClass}
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="batch-year" className="mb-1 block text-[11px] font-medium text-muted">
                Year
              </label>
              <select
                id="batch-year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className={selectClass}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
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
        {ok ? (
          <p
            className="flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5 text-sm font-medium text-green-deep"
            role="status"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
            {ok}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || labors.length === 0 || locations.length === 0}
          className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-deep px-4 text-sm font-semibold text-white transition hover:bg-green disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
              Saving…
            </>
          ) : (
            "Save attendance"
          )}
        </button>
        {labors.length === 0 || locations.length === 0 ? (
          <p className="text-xs text-muted">
            Add employees in Create Labor and sites in Location before saving Batch entries.
          </p>
        ) : null}
      </form>

      <div className="rounded-2xl border border-line bg-field/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-green" strokeWidth={1.75} />
          <h4 className="text-sm font-semibold text-green-deep">Recent batch entries</h4>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">No batch entries yet. Save one to see it here and in Reports.</p>
        ) : (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
            {recent.map((row) => (
              <li
                key={row.id}
                className="flex items-start gap-2 rounded-xl border border-line bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {row.name || "Employee"}
                    {row.laborId ? (
                      <span className="font-normal text-muted"> · {row.laborId}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {row.locationName || "—"} · {row.date || "—"} · {row.hours ?? 0}h
                    {row.otHours != null && row.otHours > 0 ? ` (OT ${row.otHours})` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onDelete(row.id)}
                  disabled={deletingId === row.id}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                  aria-label="Delete batch entry"
                >
                  {deletingId === row.id ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

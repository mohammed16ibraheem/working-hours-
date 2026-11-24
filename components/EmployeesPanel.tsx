"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Search, Users, IdCard, MapPin, LoaderCircle } from "lucide-react";
import { deleteLabor, LaborRecord, listLabors } from "@/lib/laborStore";
import { CreateLaborForm } from "@/components/CreateLaborForm";

type Props = {
  refreshKey: number;
  onChanged: () => void;
};

export function EmployeesPanel({ refreshKey, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<LaborRecord | null>(null);
  const [rows, setRows] = useState<LaborRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    listLabors()
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Could not load labors.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.laborId.toLowerCase().includes(q) ||
        r.country.toLowerCase().includes(q),
    );
  }, [rows, query]);

  if (editing) {
    return (
      <CreateLaborForm
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Users className="h-4 w-4 text-green" strokeWidth={1.75} />
          <span>
            <span className="font-semibold text-foreground">{rows.length}</span> labor
            {rows.length === 1 ? "" : "s"} total
          </span>
        </div>
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, laborID, country"
            className="h-11 w-full rounded-xl border border-line bg-field pr-3 pl-10 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/15"
          />
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

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-field px-6 py-14 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
          Loading labor records…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-field px-6 py-14 text-center">
          <Users className="mx-auto h-9 w-9 text-muted" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-semibold text-green-deep">
            {rows.length === 0 ? "No labor records yet" : "No matching records"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {rows.length === 0
              ? "Use Create Labor to add the first worker."
              : "Try another search."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          {filtered.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-3 border-b border-line bg-card px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.photoDataUrl}
                alt={row.name}
                className="h-14 w-14 rounded-xl object-cover ring-1 ring-line"
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-[15px] font-semibold text-green-deep">{row.name}</p>
                <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
                  <IdCard className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
                  {row.laborId}
                </p>
                <p className="inline-flex items-center gap-1.5 text-sm text-muted">
                  <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {row.country}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold text-green transition hover:border-accent hover:text-accent"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                  Modify
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete ${row.name}?`)) return;
                    try {
                      await deleteLabor(row.id);
                      onChanged();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Delete failed.");
                    }
                  }}
                  className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-danger/20 bg-danger/[0.04] px-3 text-sm font-semibold text-danger transition hover:bg-danger/[0.08]"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

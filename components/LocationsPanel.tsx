"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  Pencil,
  Trash2,
  Plus,
  Search,
  LoaderCircle,
  CheckCircle2,
  Upload,
} from "lucide-react";
import {
  deleteLocation,
  fileToDataUrl,
  listLocations,
  locationLogoSrc,
  LocationRecord,
  saveLocation,
} from "@/lib/locationStore";

type Props = {
  refreshKey: number;
  onChanged: () => void;
};

export function LocationsPanel({ refreshKey, onChanged }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<LocationRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [logoName, setLogoName] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    listLocations()
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Could not load locations.");
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
        (r.address || "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setAdding(true);
    setEditing(null);
    setName("");
    setAddress("");
    setLogoName("");
    setLogoPreview(null);
    setLogoFile(null);
    setError("");
    setOk("");
  }

  function openEdit(row: LocationRecord) {
    setEditing(row);
    setAdding(false);
    setName(row.name);
    setAddress(row.address || "");
    setLogoName(row.logoName || "");
    setLogoPreview(locationLogoSrc(row));
    setLogoFile(null);
    setError("");
    setOk("");
  }

  function cancelForm() {
    setAdding(false);
    setEditing(null);
    setName("");
    setAddress("");
    setLogoName("");
    setLogoPreview(null);
    setLogoFile(null);
    setError("");
    setOk("");
  }

  function onLogoChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Logo must be an image (JPG/PNG).");
      return;
    }
    setError("");
    setLogoFile(file);
    setLogoName(file.name);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!name.trim()) {
      setError("Location name is required.");
      return;
    }
    setBusy(true);
    try {
      let logoDataUrl = editing?.logoDataUrl || "";
      let logoUrl = editing?.logoUrl || "";
      let finalLogoName = logoName || editing?.logoName || "";
      if (logoFile) {
        logoDataUrl = await fileToDataUrl(logoFile);
        finalLogoName = logoFile.name;
        logoUrl = "";
      } else if (!logoPreview) {
        logoDataUrl = "";
        logoUrl = "";
        finalLogoName = "";
      }
      await saveLocation({
        id: editing?.id,
        name: name.trim(),
        address: address.trim(),
        logoDataUrl,
        logoUrl,
        logoName: finalLogoName,
      });
      setOk(editing ? "Location updated." : "Location created.");
      cancelForm();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  if (adding || editing) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <MapPin className="h-4 w-4 text-green" strokeWidth={1.75} />
          <span className="font-semibold text-green-deep">
            {editing ? "Edit location" : "Add location"}
          </span>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-green-deep">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Branch name"
            className="h-11 w-full rounded-xl border border-line bg-field px-3 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/15"
            required
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-green-deep">Address (optional)</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Site address"
            className="h-11 w-full rounded-xl border border-line bg-field px-3 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/15"
          />
        </label>

        <div className="space-y-1.5">
          <span className="block text-sm font-semibold text-green-deep">Logo (optional)</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/*"
            className="hidden"
            onChange={(e) => onLogoChange(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-field px-4 py-4 text-left transition hover:border-accent hover:bg-white"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Upload className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-green-deep">
                {logoName || "Upload location logo"}
              </p>
              <p className="text-xs text-muted">Optional branch logo — JPG/PNG</p>
            </div>
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview}
                alt="Logo preview"
                className="h-12 w-12 rounded-lg object-cover ring-1 ring-line"
              />
            ) : null}
          </button>
          {logoPreview ? (
            <button
              type="button"
              onClick={() => {
                setLogoPreview(null);
                setLogoFile(null);
                setLogoName("");
              }}
              className="text-xs font-semibold text-muted transition hover:text-danger"
            >
              Remove logo
            </button>
          ) : null}
        </div>

        {error ? (
          <p
            className="rounded-xl border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-sm font-medium text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-deep px-4 text-sm font-semibold text-white transition hover:bg-green disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
            )}
            {editing ? "Save changes" : "Create location"}
          </button>
          <button
            type="button"
            onClick={cancelForm}
            className="inline-flex h-11 cursor-pointer items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold text-green transition hover:border-accent hover:text-accent"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <MapPin className="h-4 w-4 text-green" strokeWidth={1.75} />
          <span>
            <span className="font-semibold text-foreground">{rows.length}</span> location
            {rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
              strokeWidth={1.75}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search locations"
              className="h-11 w-full rounded-xl border border-line bg-field pr-3 pl-10 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/15"
            />
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-deep px-4 text-sm font-semibold text-white transition hover:bg-green"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Add location
          </button>
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
        <p className="rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5 text-sm font-medium text-green-deep">
          {ok}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-field px-6 py-14 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
          Loading locations…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-field px-6 py-14 text-center">
          <MapPin className="mx-auto h-9 w-9 text-muted" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-semibold text-green-deep">
            {rows.length === 0 ? "No locations yet" : "No matching locations"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {rows.length === 0 ? "Add the first branch site." : "Try another search."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          {filtered.map((row) => {
            const logoSrc = locationLogoSrc(row);
            return (
            <div
              key={row.id}
              className="flex flex-col gap-3 border-b border-line bg-card px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-center"
            >
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoSrc}
                  alt={row.name}
                  className="h-11 w-11 rounded-xl object-cover ring-1 ring-line"
                />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <MapPin className="h-5 w-5" strokeWidth={1.75} />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-[15px] font-semibold text-green-deep">{row.name}</p>
                {row.address ? (
                  <p className="truncate text-sm text-muted">{row.address}</p>
                ) : (
                  <p className="text-sm text-muted">Branch site</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(row)}
                  className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold text-green transition hover:border-accent hover:text-accent"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete ${row.name}?`)) return;
                    try {
                      await deleteLocation(row.id);
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
            );
          })}
        </div>
      )}
    </div>
  );
}

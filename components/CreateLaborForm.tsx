"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  IdCard,
  MapPin,
  UserRound,
  Upload,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";
import { fileToDataUrl, LaborRecord, saveLabor } from "@/lib/laborStore";

type Props = {
  onCancel: () => void;
  onSaved?: () => void;
  initial?: LaborRecord | null;
};

export function CreateLaborForm({ onCancel, onSaved, initial = null }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial?.name || "");
  const [laborId, setLaborId] = useState(initial?.laborId || "");
  const [country, setCountry] = useState(initial?.country || "");
  const [photoName, setPhotoName] = useState(initial?.photoName || "");
  const [photoPreview, setPhotoPreview] = useState<string | null>(initial?.photoDataUrl || null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    setName(initial?.name || "");
    setLaborId(initial?.laborId || "");
    setCountry(initial?.country || "");
    setPhotoName(initial?.photoName || "");
    setPhotoPreview(initial?.photoDataUrl || null);
    setPhotoFile(null);
    setError("");
    setOk("");
  }, [initial]);

  function onPhotoChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Photo must be an image file.");
      return;
    }
    setError("");
    setPhotoFile(file);
    setPhotoName(file.name);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!name.trim() || !laborId.trim() || !country.trim()) {
      setError("Name, laborID, and country are required.");
      return;
    }
    setBusy(true);
    try {
      let photoDataUrl = initial?.photoDataUrl || "";
      let finalPhotoName = photoName || initial?.photoName || "";
      if (photoFile) {
        photoDataUrl = await fileToDataUrl(photoFile);
        finalPhotoName = photoFile.name;
      }
      saveLabor({
        id: initial?.id,
        name: name.trim(),
        laborId: laborId.trim(),
        country: country.trim(),
        photoDataUrl,
        photoName: finalPhotoName || "photo.jpg",
      });
      setOk(initial ? "Labor record updated." : "Labor record saved.");
      onSaved?.();
      if (!initial) {
        setName("");
        setLaborId("");
        setCountry("");
        setPhotoName("");
        setPhotoPreview(null);
        setPhotoFile(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save labor record.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-xl space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="labor-name" className="block text-[13px] font-semibold text-green">
          Name
        </label>
        <div className="relative">
          <UserRound
            className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-muted"
            strokeWidth={1.75}
          />
          <input
            id="labor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="h-12 w-full rounded-xl border border-line bg-field pr-3.5 pl-11 text-[15px] outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="labor-id" className="block text-[13px] font-semibold text-green">
          laborID
        </label>
        <div className="relative">
          <IdCard
            className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-muted"
            strokeWidth={1.75}
          />
          <input
            id="labor-id"
            value={laborId}
            onChange={(e) => setLaborId(e.target.value)}
            placeholder="Labor ID"
            className="h-12 w-full rounded-xl border border-line bg-field pr-3.5 pl-11 text-[15px] outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="labor-country" className="block text-[13px] font-semibold text-green">
          Country
        </label>
        <div className="relative">
          <MapPin
            className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-muted"
            strokeWidth={1.75}
          />
          <input
            id="labor-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Country"
            className="h-12 w-full rounded-xl border border-line bg-field pr-3.5 pl-11 text-[15px] outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[13px] font-semibold text-green">
          Profile photo <span className="font-medium text-muted">(optional)</span>
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPhotoChange(e.target.files?.[0] || null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-field px-4 py-4 text-left transition hover:border-accent hover:bg-white"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
            {photoPreview ? (
              <Camera className="h-5 w-5" strokeWidth={1.75} />
            ) : (
              <Upload className="h-5 w-5" strokeWidth={1.75} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-green-deep">
              {photoName || "Upload profile photo"}
            </p>
            <p className="text-xs text-muted">Optional thumbnail for Reports — JPG/PNG</p>
          </div>
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreview}
              alt="Preview"
              className="h-12 w-12 rounded-lg object-cover ring-1 ring-line"
            />
          ) : null}
        </button>
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
          <CheckCircle2 className="h-4 w-4 text-accent" strokeWidth={1.75} />
          {ok}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 cursor-pointer rounded-xl border border-line px-4 text-sm font-semibold text-green transition hover:border-accent hover:text-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-deep px-4 text-sm font-semibold text-white transition hover:bg-green disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:min-w-[160px]"
        >
          {busy ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
              Saving…
            </>
          ) : initial ? (
            "Update labor"
          ) : (
            "Save labor"
          )}
        </button>
      </div>
    </form>
  );
}

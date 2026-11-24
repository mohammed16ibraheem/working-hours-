"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Camera,
  SwitchCamera,
  ScanFace,
  CheckCircle2,
  XCircle,
  LoaderCircle,
  Clock3,
  MapPin,
} from "lucide-react";
import {
  AttendancePublic,
  AttendanceSubmitResult,
  formatCountdown,
  getAttendanceLink,
  isLinkExpired,
  submitAttendance,
} from "@/lib/attendanceApi";

const PUBLIC_BASE = (process.env.NEXT_PUBLIC_WH_PUBLIC_BASE || "").replace(/\/$/, "");

function secureAttendHref(token: string) {
  if (!PUBLIC_BASE) return "";
  return `${PUBLIC_BASE}/attend/${token}`;
}

export function AttendClient({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [info, setInfo] = useState<AttendancePublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [camBusy, setCamBusy] = useState(false);
  const [error, setError] = useState("");
  const [camBlocked, setCamBlocked] = useState(false);
  const [camHintOpen, setCamHintOpen] = useState(true);
  const [insecureContext, setInsecureContext] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [preview, setPreview] = useState<string | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [result, setResult] = useState<AttendanceSubmitResult | null>(null);
  const [thanksOpen, setThanksOpen] = useState(false);
  const [thanksMismatch, setThanksMismatch] = useState(false);
  const thanksTimerRef = useRef<number | null>(null);
  const [remaining, setRemaining] = useState("");
  const [linkExpired, setLinkExpired] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [workingHours, setWorkingHours] = useState("");
  const formLocked = thanksOpen;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }, []);

  /** Call only from a user gesture (button click) so the browser Allow popup can appear. */
  const startCameraFromGesture = useCallback(
    (mode: "user" | "environment") => {
      setCamBusy(true);
      setError("");

      if (typeof window !== "undefined" && !window.isSecureContext) {
        setInsecureContext(true);
        setCamBlocked(true);
        setCamReady(false);
        setCamBusy(false);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCamBlocked(true);
        setCamReady(false);
        setCamBusy(false);
        return;
      }

      // Stop old tracks synchronously, then call getUserMedia in the same click turn
      // (before any await) so Chrome keeps the user-activation for the permission prompt.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      const gumPromise = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      void gumPromise
        .then(async (stream) => {
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
          }
          setCamReady(true);
          setCamBlocked(false);
          setInsecureContext(false);
          setCamHintOpen(false);
        })
        .catch(() => {
          setCamBlocked(true);
          setCamReady(false);
          setCamHintOpen(true);
        })
        .finally(() => {
          setCamBusy(false);
        });
    },
    [],
  );

  useEffect(() => {
    setInsecureContext(typeof window !== "undefined" && !window.isSecureContext);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    getAttendanceLink(token)
      .then((data) => {
        if (!alive) return;
        setInfo(data);
        const locs = data.locations || [];
        if (locs.length === 1) setLocationId(locs[0].id);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Invalid link.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      stopCamera();
    };
  }, [token, stopCamera]);

  useEffect(() => {
    if (!info?.expiresAt) return;
    const tick = () => {
      const expired = isLinkExpired(info.expiresAt);
      setRemaining(formatCountdown(info.expiresAt));
      if (expired) {
        setLinkExpired(true);
        stopCamera();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [info, stopCamera]);

  const resetFormForNext = useCallback(() => {
    setThanksOpen(false);
    setThanksMismatch(false);
    setPreview(null);
    setWorkingHours("");
    setResult(null);
    setError("");
    setBusy(false);
    if (!linkExpired) {
      setCamHintOpen(false);
      startCameraFromGesture(facing);
    }
  }, [facing, linkExpired, startCameraFromGesture]);

  const resetFormForNextRef = useRef(resetFormForNext);
  resetFormForNextRef.current = resetFormForNext;

  useEffect(() => {
    if (!thanksOpen) return;
    thanksTimerRef.current = window.setTimeout(() => {
      thanksTimerRef.current = null;
      resetFormForNextRef.current();
    }, 10_000);
    return () => {
      if (thanksTimerRef.current != null) {
        window.clearTimeout(thanksTimerRef.current);
        thanksTimerRef.current = null;
      }
    };
  }, [thanksOpen]);

  function flipCamera() {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    setPreview(null);
    setResult(null);
    startCameraFromGesture(next);
  }

  function captureSelfie() {
    const video = videoRef.current;
    if (!video || !camReady) {
      setCamBlocked(true);
      setCamHintOpen(true);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setPreview(dataUrl);
    setResult(null);
    setError("");
  }

  async function onSubmit() {
    setError("");
    setResult(null);
    if (info && isLinkExpired(info.expiresAt)) {
      setLinkExpired(true);
      setRemaining("Expired");
      stopCamera();
      setError("This attendance link has expired.");
      return;
    }
    if (!preview) {
      setError("Take a live selfie first (enable camera when ready).");
      setCamHintOpen(true);
      return;
    }
    if (!locationId) {
      setError("Select a location.");
      return;
    }
    if (!workingHours.trim()) {
      setError("Enter working hours.");
      return;
    }
    setBusy(true);
    try {
      const out = await submitAttendance(token, {
        photoDataUrl: preview,
        locationId,
        workingHours: workingHours.trim(),
      });
      setResult(out);
      if (out.accepted || out.matched) {
        stopCamera();
        setThanksMismatch(Boolean(out.faceMismatch));
        setThanksOpen(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Attendance submit failed.";
      setError(msg);
      setResult({ accepted: false, matched: false, message: msg, error: msg });
    } finally {
      setBusy(false);
    }
  }

  const locations = info?.locations || [];
  const selectedLocation = locations.find((l) => l.id === locationId) || null;
  const httpsLink = secureAttendHref(token);
  const showCamCard =
    !!info && !linkExpired && !camReady && !preview && camHintOpen && !formLocked;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line/80 bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Image
            src="/ds-logo.png"
            alt="Diamond Star"
            width={100}
            height={48}
            className="h-8 w-auto object-contain"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-[0.18em] text-green uppercase">
              Work Hours
            </p>
            <p className="text-sm font-semibold text-green-deep">Attendance check-in</p>
          </div>
          {remaining ? (
            <span
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${
                linkExpired || remaining === "Expired"
                  ? "border-danger/20 bg-danger/[0.06] text-danger"
                  : "border-line bg-field text-muted"
              }`}
            >
              <Clock3 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {remaining}
            </span>
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6">
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
            Opening link…
          </div>
        ) : error && !info ? (
          <div className="rounded-2xl border border-danger/20 bg-danger/[0.06] px-5 py-8 text-center">
            <XCircle className="mx-auto h-8 w-8 text-danger" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-semibold text-danger">{error}</p>
          </div>
        ) : info ? (
          <div className="space-y-4">
            {showCamCard ? (
              <div className="rounded-2xl border border-line bg-card p-4 shadow-[0_12px_40px_rgba(15,47,34,0.06)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <Camera className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-green-deep">
                      {insecureContext ? "Open the secure link" : "Camera for selfie"}
                    </h2>
                    {insecureContext ? (
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        Phone browsers only show the Allow camera popup on HTTPS (not plain
                        http://IP). Open the secure link, then tap Enable camera.
                      </p>
                    ) : camBlocked ? (
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        Camera blocked or unavailable. Tap Enable camera and choose{" "}
                        <strong className="text-foreground">Allow</strong>. You can still pick
                        location and hours, then retry the selfie.
                      </p>
                    ) : (
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        Optional for now — tap below so the phone can ask{" "}
                        <strong className="text-foreground">Allow</strong>. Location and hours
                        stay usable if you skip.
                      </p>
                    )}
                    {insecureContext && httpsLink ? (
                      <a
                        href={httpsLink}
                        className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-green-deep px-3 text-sm font-semibold text-white transition hover:bg-green"
                      >
                        Open secure link
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled={camBusy || insecureContext}
                        onClick={() => startCameraFromGesture(facing)}
                        className="mt-3 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-deep px-3 text-sm font-semibold text-white transition hover:bg-green disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {camBusy ? (
                          <>
                            <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
                            Opening camera…
                          </>
                        ) : (
                          <>
                            <Camera className="h-4 w-4" strokeWidth={1.75} />
                            Enable camera
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {linkExpired ? (
              <div className="rounded-2xl border border-danger/20 bg-danger/[0.06] px-5 py-6 text-center">
                <XCircle className="mx-auto h-8 w-8 text-danger" strokeWidth={1.5} />
                <p className="mt-3 text-sm font-semibold text-danger">
                  This attendance link has expired.
                </p>
                <p className="mt-1 text-sm text-muted">Ask admin to generate a new 30-minute link.</p>
              </div>
            ) : (
              <>
                <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="Selfie" className="aspect-[3/4] w-full object-cover" />
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        autoPlay
                        className={`aspect-[3/4] w-full object-cover ${
                          camReady ? (facing === "user" ? "scale-x-[-1]" : "") : "invisible absolute inset-0 h-full w-full"
                        }`}
                      />
                      {!camReady ? (
                        <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 bg-green-deep/90 px-6 text-center text-white/90">
                          <Camera className="h-8 w-8 opacity-80" strokeWidth={1.5} />
                          <p className="text-sm">Camera off — enable when ready for selfie</p>
                          {!camHintOpen ? (
                            <button
                              type="button"
                              disabled={camBusy || insecureContext}
                              onClick={() => startCameraFromGesture(facing)}
                              className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold text-white transition hover:bg-white/25 disabled:opacity-50"
                            >
                              Enable camera
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={camBusy || !!preview || !camReady}
                    onClick={flipCamera}
                    className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-green transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <SwitchCamera className="h-4 w-4" strokeWidth={1.75} />
                    {facing === "user" ? "Rear camera" : "Front camera"}
                  </button>
                  {preview ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPreview(null);
                        setResult(null);
                        startCameraFromGesture(facing);
                      }}
                      className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-green transition hover:border-accent hover:text-accent"
                    >
                      Retake
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!camReady || camBusy}
                      onClick={captureSelfie}
                      className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-deep px-3 text-sm font-semibold text-white transition hover:bg-green disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Camera className="h-4 w-4" strokeWidth={1.75} />
                      Take selfie
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-deep">
                    <MapPin className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
                    Location
                  </span>
                  {(selectedLocation?.logoDataUrl?.startsWith("data:image/") ||
                    selectedLocation?.logoUrl?.startsWith("/")) ? (
                    <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={
                          selectedLocation.logoDataUrl?.startsWith("data:image/")
                            ? selectedLocation.logoDataUrl
                            : selectedLocation.logoUrl!
                        }
                        alt={selectedLocation.name}
                        className="h-14 w-14 rounded-xl object-cover ring-1 ring-line"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-green-deep">
                          {selectedLocation.name}
                        </p>
                        <p className="text-xs text-muted">Selected branch</p>
                      </div>
                    </div>
                  ) : null}
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    disabled={formLocked}
                    className="h-11 w-full rounded-xl border border-line bg-field px-3 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60"
                    required
                  >
                    <option value="">Select branch location</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold text-green-deep">Working hours</span>
                  <input
                    value={workingHours}
                    onChange={(e) => setWorkingHours(e.target.value)}
                    disabled={formLocked}
                    placeholder="8 hours"
                    className="h-11 w-full rounded-xl border border-line bg-field px-3 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60"
                    required
                  />
                </label>

                {error ? (
                  <p
                    className="rounded-xl border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-sm font-medium text-danger"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}

                {result && !(result.accepted || result.matched) ? (
                  <div
                    className="rounded-xl border border-danger/20 bg-danger/[0.06] px-3 py-3 text-sm text-danger"
                    role="status"
                  >
                    <p className="flex items-center gap-2 font-semibold">
                      <XCircle className="h-4 w-4" strokeWidth={1.75} />
                      {result.message || result.error || "Rejected"}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={
                    busy ||
                    linkExpired ||
                    !preview ||
                    !locationId ||
                    !workingHours.trim() ||
                    formLocked
                  }
                  onClick={onSubmit}
                  className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-deep px-4 text-sm font-semibold text-white transition hover:bg-green disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
                      Verifying face…
                    </>
                  ) : (
                    <>
                      <ScanFace className="h-4 w-4" strokeWidth={1.75} />
                      Submit attendance
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        ) : null}

        <p className="mt-auto pt-8 text-center text-xs text-muted">
          Powered by{" "}
          <a
            href="https://mdbc.co"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-green hover:text-accent"
          >
            mdbc.co
          </a>
        </p>
      </main>

      {thanksOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-green-deep/55 p-6 backdrop-blur-[3px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="thanks-submit-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-card px-6 py-10 text-center shadow-[0_24px_60px_rgba(15,47,34,0.28)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent">
              <CheckCircle2 className="h-8 w-8" strokeWidth={1.75} />
            </div>
            <h2
              id="thanks-submit-title"
              className="mt-5 text-3xl font-semibold tracking-tight text-green-deep sm:text-4xl"
            >
              Thanks for submit
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {thanksMismatch
                ? "Attendance recorded. An administrator will review the face match."
                : "Attendance recorded successfully."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

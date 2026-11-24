export type AttendanceLink = {
  token: string;
  scope?: string;
  workerCount?: number;
  laborRecordId?: string;
  laborId: string;
  name: string;
  country?: string;
  createdAt: number;
  expiresAt: number;
  usedCount: number;
  lastStatus: string;
  path?: string;
  url?: string;
  ttlMinutes?: number;
};

export type AttendanceLocationOption = {
  id: string;
  name: string;
  address?: string;
  logoDataUrl?: string;
  logoUrl?: string;
};

export type AttendancePublic = {
  token: string;
  scope?: string;
  name: string;
  workerCount?: number;
  laborId?: string;
  country?: string;
  expiresAt: number;
  remainingMs?: number;
  locations?: AttendanceLocationOption[];
};

export type LivenessResult = {
  isReal: boolean;
  label: string;
  realScore: number;
  fakeScore: number;
  engine?: string;
  models?: string[];
};

export type AttendanceSubmitResult = {
  accepted?: boolean;
  matched: boolean;
  faceMismatch?: boolean;
  spoofRejected?: boolean;
  liveness?: LivenessResult | null;
  confidence?: number;
  distance?: number;
  threshold?: number;
  engine?: string;
  name?: string | null;
  laborId?: string | null;
  country?: string;
  locationId?: string;
  locationName?: string;
  workingHours?: string;
  hours?: number;
  regularHours?: number;
  otHours?: number;
  date?: string;
  message?: string;
  error?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_WH_API || "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export function listAttendanceLinks() {
  return api<AttendanceLink[]>("/api/attendance/links");
}

export function createAttendanceLink() {
  return api<AttendanceLink>("/api/attendance/links", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function deleteAttendanceLink(token: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/attendance/links/${encodeURIComponent(token)}`, {
    method: "DELETE",
  });
}

/** Link stops working in the last 10 seconds of its 30-min TTL. */
export const LINK_CUTOFF_MS = 10_000;

export function linkRemainingMs(expiresAt: number) {
  return Math.max(0, expiresAt - Date.now());
}

export function isLinkExpired(expiresAt: number) {
  return linkRemainingMs(expiresAt) <= LINK_CUTOFF_MS;
}

export function formatCountdown(expiresAt: number) {
  if (isLinkExpired(expiresAt)) return "Expired";
  const left = linkRemainingMs(expiresAt);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function getAttendanceLink(token: string) {
  return api<AttendancePublic>(`/api/attendance/links/${encodeURIComponent(token)}`);
}

export async function submitAttendance(
  token: string,
  payload: { photoDataUrl: string; locationId: string; workingHours: string },
) {
  const res = await fetch(
    `${API_BASE}/api/attendance/links/${encodeURIComponent(token)}/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const data = (await res.json().catch(() => ({}))) as AttendanceSubmitResult;
  if (!res.ok && data && (data.liveness || data.message || data.error || data.spoofRejected)) {
    return {
      accepted: false,
      matched: false,
      faceMismatch: false,
      spoofRejected: Boolean(data.spoofRejected),
      liveness: data.liveness ?? null,
      confidence: data.confidence,
      engine: data.engine,
      name: data.name,
      laborId: data.laborId,
      message: data.message || data.error || "Attendance rejected.",
      error: data.error,
    };
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return {
    ...data,
    accepted: data.accepted !== false,
    faceMismatch: Boolean(data.faceMismatch),
  };
}

const PUBLIC_BASE = (process.env.NEXT_PUBLIC_WH_PUBLIC_BASE || "").replace(/\/$/, "");

/** Prefer HTTPS public base so generated attend links work with camera permission. */
export function absoluteAttendUrl(pathOrUrl: string) {
  if (pathOrUrl.startsWith("http")) {
    // Upgrade accidental http://IP links when a secure public base is configured.
    if (PUBLIC_BASE && pathOrUrl.startsWith("http://")) {
      try {
        const u = new URL(pathOrUrl);
        if (u.pathname.startsWith("/attend/")) return `${PUBLIC_BASE}${u.pathname}`;
      } catch {
        /* keep original */
      }
    }
    return pathOrUrl;
  }
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  if (PUBLIC_BASE) return `${PUBLIC_BASE}${path}`;
  if (typeof window === "undefined") return pathOrUrl;
  return `${window.location.origin}${path}`;
}

export function whatsappShareUrl(link: string) {
  const text =
    `Diamond Star attendance check-in\n` +
    `Open this link within 30 minutes — live selfie, location, and working hours:\n${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export async function copyTextSafe(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  return ok;
}

export type AttendanceLogRecord = {
  id: string;
  date?: string;
  createdAt?: number;
  laborId?: string | null;
  name?: string | null;
  laborRecordId?: string | null;
  locationId?: string;
  locationName?: string;
  hours?: number;
  regularHours?: number;
  otHours?: number;
  workingHours?: string;
  matched?: boolean;
  faceMismatch?: boolean;
  slug?: string;
  source?: string;
  engine?: string;
};

export type AttendanceUpdatePayload = {
  locationId?: string;
  locationName?: string;
  hours?: number;
  workingHours?: string;
  laborId?: string | null;
  laborRecordId?: string | null;
  date?: string;
};

export type AttendanceCreatePayload = {
  laborId?: string;
  laborRecordId?: string;
  locationId: string;
  date: string;
  hours: number;
};

export function createAttendance(payload: AttendanceCreatePayload) {
  return api<AttendanceLogRecord>("/api/attendance", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listAttendanceLogs(opts?: {
  laborId?: string;
  locationId?: string;
  source?: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (opts?.laborId) q.set("laborId", opts.laborId);
  if (opts?.locationId) q.set("locationId", opts.locationId);
  if (opts?.source) q.set("source", opts.source);
  if (opts?.from) q.set("from", opts.from);
  if (opts?.to) q.set("to", opts.to);
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return api<AttendanceLogRecord[]>(`/api/attendance/logs${qs ? `?${qs}` : ""}`);
}

export function updateAttendance(id: string, payload: AttendanceUpdatePayload) {
  return api<AttendanceLogRecord>(`/api/attendance/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteAttendance(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/attendance/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

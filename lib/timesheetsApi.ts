const API_BASE = process.env.NEXT_PUBLIC_WH_API || "";

export type TimesheetRow = {
  date: string;
  locations: Record<string, number>;
  total: number;
  off?: boolean;
  rawLine?: string;
};

export type TimesheetParsed = {
  employeeName: string | null;
  laborId: string | null;
  month?: string | null;
  rows: TimesheetRow[];
  needsReview?: boolean;
  note?: string | null;
  matchedLaborId?: string | null;
  matchedName?: string | null;
  matchedRecordId?: string | null;
};

export type TimesheetMeta = {
  id: string;
  fileName: string;
  imageName?: string;
  imageRel?: string;
  status: string;
  engine?: string;
  ocrOk?: boolean;
  ocrError?: string | null;
  employeeName?: string | null;
  laborId?: string | null;
  seedKey?: string | null;
  createdAt: number;
  updatedAt?: number;
  committedAt?: number | null;
  committedRecords?: number;
  parsed?: TimesheetParsed;
};

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export async function listTimesheets() {
  return api<{ sheetLocations: string[]; items: TimesheetMeta[] }>("/api/timesheets");
}

export async function getTimesheet(id: string) {
  return api<TimesheetMeta & { parsed: TimesheetParsed }>(
    `/api/timesheets/${encodeURIComponent(id)}`,
  );
}

export async function uploadTimesheetFiles(files: File[]) {
  const payload = [];
  for (const file of files) {
    payload.push({
      fileName: file.name,
      dataUrl: await fileToDataUrl(file),
    });
  }
  return api<{ ok: boolean; items: TimesheetMeta[] }>("/api/timesheets/upload", {
    method: "POST",
    body: JSON.stringify({ files: payload }),
  });
}

export async function updateTimesheet(id: string, parsed: Partial<TimesheetParsed>) {
  return api<TimesheetMeta>(`/api/timesheets/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(parsed),
  });
}

export async function commitTimesheet(id: string, opts?: { replace?: boolean }) {
  return api<{
    ok: boolean;
    records: number;
    alreadyCommitted?: boolean;
    replacedDates?: string[];
    merged?: boolean;
  }>(`/api/timesheets/${encodeURIComponent(id)}/commit`, {
    method: "POST",
    body: JSON.stringify({ replace: Boolean(opts?.replace) }),
  });
}

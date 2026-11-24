export type LaborRecord = {
  id: string;
  name: string;
  laborId: string;
  country: string;
  photoDataUrl: string;
  photoName: string;
  updatedAt: number;
};

/** Same-origin via Next rewrite → Backend (avoids browser 127.0.0.1 failures). */
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

export async function listLabors(): Promise<LaborRecord[]> {
  return api<LaborRecord[]>("/api/labors");
}

export async function getLabor(id: string): Promise<LaborRecord | null> {
  try {
    return await api<LaborRecord>(`/api/labors/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function saveLabor(
  input: Omit<LaborRecord, "id" | "updatedAt"> & { id?: string },
): Promise<LaborRecord> {
  const body = {
    name: input.name,
    laborId: input.laborId,
    country: input.country,
    photoDataUrl: input.photoDataUrl,
    photoName: input.photoName,
  };
  if (input.id) {
    return api<LaborRecord>(`/api/labors/${encodeURIComponent(input.id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }
  return api<LaborRecord>("/api/labors", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteLabor(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/labors/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read photo"));
    reader.readAsDataURL(file);
  });
}

export type LocationRecord = {
  id: string;
  name: string;
  address: string;
  logoDataUrl?: string;
  logoUrl?: string;
  logoName?: string;
  updatedAt: number;
};

/** Prefer uploaded data URL; fall back to public /locations/ path. */
export function locationLogoSrc(row: {
  logoDataUrl?: string;
  logoUrl?: string;
}): string | null {
  if (row.logoDataUrl?.startsWith("data:image/")) return row.logoDataUrl;
  if (row.logoUrl?.startsWith("/")) return row.logoUrl;
  return null;
}

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

export function listLocations() {
  return api<LocationRecord[]>("/api/locations");
}

export function saveLocation(input: {
  name: string;
  address?: string;
  logoDataUrl?: string;
  logoUrl?: string;
  logoName?: string;
  id?: string;
}): Promise<LocationRecord> {
  const body = {
    name: input.name,
    address: input.address || "",
    logoDataUrl: input.logoDataUrl || "",
    logoUrl: input.logoUrl || "",
    logoName: input.logoName || "",
  };
  if (input.id) {
    return api<LocationRecord>(`/api/locations/${encodeURIComponent(input.id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }
  return api<LocationRecord>("/api/locations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteLocation(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/locations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read logo"));
    reader.readAsDataURL(file);
  });
}

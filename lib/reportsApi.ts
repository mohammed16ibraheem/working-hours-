export type ReportGroupBy = "day" | "week" | "month" | "year";

export type AttendanceReportRow = {
  period: string;
  laborId: string;
  name: string;
  locationId: string;
  locationName: string;
  days: number;
  hours: number;
  regular: number;
  ot: number;
  records: number;
  faceMismatch?: boolean;
  mismatchRecords?: number;
};

export type AttendanceRecord = {
  id: string;
  date: string;
  createdAt: number;
  laborId: string;
  name: string;
  laborRecordId?: string | null;
  locationId: string;
  locationName: string;
  hours: number;
  regularHours: number;
  otHours: number;
  workingHours?: string;
  matched?: boolean;
  faceMismatch?: boolean;
  slug?: string | null;
  /** Selfie captured at check-in */
  photoDataUrl?: string;
  treePath?: string | null;
};

export type AttendanceEmployeeRollup = {
  laborId: string;
  name: string;
  days: number;
  hours: number;
  regular: number;
  ot: number;
  records: number;
  faceMismatch?: boolean;
  mismatchRecords?: number;
};

export type AttendanceReportSummary = {
  totalHours: number;
  regularHours: number;
  otHours: number;
  totalRegular?: number;
  totalOt?: number;
  records: number;
  mismatchRecords?: number;
  days: number;
  employees: number;
  rows: number;
};

export type AttendanceReport = {
  groupBy: ReportGroupBy;
  normalDayHours: number;
  from: number | null;
  to: number | null;
  filters: { laborId: string | null; locationId: string | null };
  summary: AttendanceReportSummary;
  byEmployee: AttendanceEmployeeRollup[];
  rows: AttendanceReportRow[];
  records: AttendanceRecord[];
};

const API_BASE = process.env.NEXT_PUBLIC_WH_API || "";

export async function fetchAttendanceReport(params: {
  from?: string;
  to?: string;
  laborId?: string;
  locationId?: string;
  groupBy?: ReportGroupBy;
}): Promise<AttendanceReport> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.laborId) q.set("laborId", params.laborId);
  if (params.locationId) q.set("locationId", params.locationId);
  if (params.groupBy) q.set("groupBy", params.groupBy);
  const res = await fetch(`${API_BASE}/api/reports/attendance?${q}`);
  const data = (await res.json().catch(() => ({}))) as AttendanceReport & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data?.error || `Report failed (${res.status})`);
  }
  const s = data.summary || ({} as AttendanceReportSummary);
  data.summary = {
    ...s,
    regularHours: s.regularHours ?? s.totalRegular ?? 0,
    otHours: s.otHours ?? s.totalOt ?? 0,
    totalHours: s.totalHours ?? 0,
    records: s.records ?? 0,
    mismatchRecords: s.mismatchRecords ?? 0,
    days: s.days ?? 0,
    employees: s.employees ?? 0,
    rows: s.rows ?? 0,
  };
  data.byEmployee = Array.isArray(data.byEmployee) ? data.byEmployee : [];
  data.rows = Array.isArray(data.rows) ? data.rows : [];
  data.records = Array.isArray(data.records) ? data.records : [];
  return data;
}

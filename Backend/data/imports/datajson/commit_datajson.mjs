#!/usr/bin/env node
/**
 * Import /home/data.json (Claude timesheet extract) into WH attendance.
 * Date-merge commit: replace overlapping dates only.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.WH_API || "http://127.0.0.1:3001";
const DATA_JSON = process.env.DATA_JSON || "/home/data.json";
const ROOT = __dirname;

/** Claude name/id → WH laborId when OCR id missing or nicknames differ */
const LABOR_MAP = {
  "299": { laborId: "299", employeeName: "Salman Majeed" },
  "646": { laborId: "646", employeeName: "Mo Tahir" },
  "195": { laborId: "195", employeeName: "Iqbal Karigar" },
  "478": { laborId: "478", employeeName: "MD Mujeeb" },
  "312": { laborId: "312", employeeName: "Ishtiaq A.Aziz" },
  "317": { laborId: "317", employeeName: "MD Limon" },
  "575": { laborId: "575", employeeName: "Ram Badan" },
  "572": { laborId: "572", employeeName: "Shakir Ali" },
  "424": { laborId: "424", employeeName: "Sanjay Kumar" },
  "316": { laborId: "316", employeeName: "Ekhlas Hashem" },
  "196": { laborId: "196", employeeName: "Mohd Yousaf" },
  "193": { laborId: "193", employeeName: "Shaikh Sadruddin" },
};

const NAME_FALLBACK = [
  { re: /sadruddin/i, laborId: "193" },
  { re: /iqbal|karigar/i, laborId: "195" },
  { re: /yousuf|yousaf/i, laborId: "196" },
  { re: /salman/i, laborId: "299" },
  { re: /ishtiy|ishtiaq/i, laborId: "312" },
  { re: /eklash|ekhlas/i, laborId: "316" },
  { re: /limon/i, laborId: "317" },
  { re: /sanjay/i, laborId: "424" },
  { re: /mujeeb/i, laborId: "478" },
  { re: /shakir/i, laborId: "572" },
  { re: /rambadan|ram badan/i, laborId: "575" },
  { re: /tahir/i, laborId: "646" },
];

async function api(pathname, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `${method} ${pathname} → ${res.status}`);
  return data;
}

function decodeAt(raw, idx) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  const start = idx;
  for (let i = idx; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value: JSON.parse(raw.slice(start, i + 1)), end: i + 1 };
      }
    }
  }
  throw new Error(`Unterminated JSON starting at ${idx}`);
}

function parseMultiJson(raw) {
  let idx = 0;
  const chunks = [];
  while (idx < raw.length) {
    while (idx < raw.length && /\s/.test(raw[idx])) idx += 1;
    if (idx >= raw.length) break;
    const { value, end } = decodeAt(raw, idx);
    chunks.push(value);
    idx = end;
  }
  return chunks;
}

function resolveLabor(emp) {
  const id = String(emp.employeeId || "").trim();
  if (id && LABOR_MAP[id]) return LABOR_MAP[id];
  const name = String(emp.employeeName || "");
  for (const row of NAME_FALLBACK) {
    if (row.re.test(name) && LABOR_MAP[row.laborId]) {
      return LABOR_MAP[row.laborId];
    }
  }
  return null;
}

function hoursMapToLocations(hours) {
  const out = {};
  if (!hours || typeof hours !== "object") return out;
  for (const [k, v] of Object.entries(hours)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    out[k] = n;
  }
  return out;
}

function employeeToSheet(emp, labor) {
  const rows = [];
  for (const day of emp.days || []) {
    const date = String(day.date || "").slice(0, 10);
    if (!date) continue;
    const locations = hoursMapToLocations(day.hours);
    const total = Number(day.total);
    const hasHours = Object.keys(locations).length > 0;
    if (!hasHours) {
      rows.push({
        date,
        locations: {},
        total: 0,
        off: true,
        note: day.note || undefined,
      });
      continue;
    }
    rows.push({
      date,
      locations,
      total: Number.isFinite(total) && total > 0 ? total : Object.values(locations).reduce((a, b) => a + b, 0),
      note: day.note || undefined,
    });
  }
  const unc = emp.uncertainCells || [];
  const riskParts = unc.map(
    (u) =>
      `${u.date} ${u.location}: ${u.reason || "uncertain"}${u.guess != null ? ` (used ${u.guess})` : ""}`,
  );
  return {
    employeeName: labor.employeeName,
    laborId: labor.laborId,
    month: emp.monthLabel || "October-November 2026",
    rows,
    risk: riskParts.length ? riskParts.join("; ") : "data.json Claude extract — today chunk",
    uncertainCells: unc,
  };
}

function pickEmployees(chunks) {
  /** Prefer richer sheet per labor (later chunk wins ties). */
  const byLabor = new Map();
  const skipped = [];
  chunks.forEach((chunk, ci) => {
    if (!Array.isArray(chunk)) return;
    for (const emp of chunk) {
      const labor = resolveLabor(emp);
      if (!labor) {
        skipped.push({
          reason: "unmapped labor",
          employeeName: emp.employeeName,
          employeeId: emp.employeeId,
          chunk: ci,
        });
        continue;
      }
      const sheet = employeeToSheet(emp, labor);
      const workDays = sheet.rows.filter((r) => !r.off && Object.keys(r.locations).length).length;
      const hours = sheet.rows.reduce(
        (s, r) => s + Object.values(r.locations || {}).reduce((a, b) => a + Number(b || 0), 0),
        0,
      );
      const score = { workDays, hours, chunk: ci };
      const prev = byLabor.get(labor.laborId);
      const better =
        !prev ||
        score.workDays > prev.score.workDays ||
        (score.workDays === prev.score.workDays && score.hours > prev.score.hours) ||
        (score.workDays === prev.score.workDays &&
          score.hours === prev.score.hours &&
          score.chunk > prev.score.chunk);
      if (better) {
        byLabor.set(labor.laborId, { sheet, score, chunk: ci, sourceName: emp.employeeName });
      }
    }
  });
  return { byLabor, skipped };
}

async function fileToDataUrl(filePath) {
  const buf = await fs.readFile(filePath);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function main() {
  const raw = await fs.readFile(DATA_JSON, "utf8");
  if (!raw.trim()) throw new Error(`${DATA_JSON} is empty`);
  const chunks = parseMultiJson(raw);
  console.log(`Parsed ${chunks.length} top-level JSON value(s) from ${DATA_JSON}`);

  const { byLabor, skipped } = pickEmployees(chunks);
  console.log(`Employees selected: ${byLabor.size}; skipped: ${skipped.length}`);

  const placeholder = path.join(ROOT, "placeholder.jpg");
  const dataUrl = await fileToDataUrl(placeholder);
  const report = [];

  for (const [laborId, { sheet, chunk, sourceName }] of byLabor) {
    console.log(`\n=== ${sheet.employeeName} (${laborId}) from chunk ${chunk} [${sourceName}] ===`);
    const uploaded = await api("/api/timesheets/upload", {
      method: "POST",
      body: { fileName: `datajson-${laborId}.jpg`, dataUrl },
    });
    const id = uploaded.id || uploaded.items?.[0]?.id;
    if (!id) throw new Error("Upload returned no timesheet id");

    const put = await api(`/api/timesheets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: {
        employeeName: sheet.employeeName,
        laborId: sheet.laborId,
        month: sheet.month,
        rows: sheet.rows,
        needsReview: false,
        note: sheet.risk,
      },
    });
    console.log(
      `  Reviewed match=${put.parsed?.matchedLaborId || put.laborId} name=${put.parsed?.matchedName || put.employeeName}`,
    );

    const committed = await api(`/api/timesheets/${encodeURIComponent(id)}/commit`, {
      method: "POST",
      body: { replace: true },
    });
    console.log(
      `  Committed records=${committed.records} replacedDates=${(committed.replacedDates || []).length}`,
    );

    const hourRows = sheet.rows.filter((r) => !r.off && Object.keys(r.locations || {}).length);
    const hourTotal = hourRows.reduce(
      (s, r) => s + Object.values(r.locations || {}).reduce((a, b) => a + Number(b || 0), 0),
      0,
    );
    const locs = new Set(hourRows.flatMap((r) => Object.keys(r.locations || {})));
    const dates = hourRows.map((r) => r.date).sort();
    report.push({
      timesheetId: id,
      employeeName: sheet.employeeName,
      laborId,
      sourceName,
      chunk,
      workDays: hourRows.length,
      hourTotal,
      committed: committed.records,
      replacedDates: committed.replacedDates || [],
      risk: sheet.risk,
      uncertainCount: (sheet.uncertainCells || []).length,
      locations: [...locs].sort(),
      dateRange: dates.length ? `${dates[0]} … ${dates[dates.length - 1]}` : null,
    });
  }

  const proof = await api("/api/reports/attendance?from=2026-10-26&to=2026-11-25");
  const rows = proof.rows || proof.records || [];
  const by = {};
  for (const r of rows) {
    const lid = String(r.laborId || "?");
    if (!by[lid]) by[lid] = { name: r.name, rows: 0, hours: 0 };
    by[lid].rows += 1;
    by[lid].hours += Number(r.hours || r.workingHours || 0);
  }

  const out = {
    at: new Date().toISOString(),
    source: DATA_JSON,
    chunks: chunks.length,
    employeesImported: report.length,
    totalHoursImported: report.reduce((s, r) => s + r.hourTotal, 0),
    skipped,
    report,
    reportsProof: {
      summary: proof.summary || null,
      byLabor: by,
      rowCount: rows.length,
    },
  };
  const outPath = path.join(ROOT, "commit_report.json");
  await fs.writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nImported ${report.length} employees, ${out.totalHoursImported} hours`);
  console.log(`Reports rows ${rows.length}; summary hours ${proof.summary?.totalHours}`);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

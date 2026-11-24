#!/usr/bin/env node
/**
 * Upload reviewed attiness timesheets → PUT corrections → replace prior
 * timesheet attendance for same labor → commit.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.WH_API || "http://127.0.0.1:3001";
const ROOT = __dirname;

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

async function fileToDataUrl(filePath) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function listAttendance() {
  return api("/api/attendance/logs?limit=5000");
}

async function deleteAttendance(id) {
  const res = await fetch(`${API}/api/attendance/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `DELETE attendance ${id} → ${res.status}`);
  }
  return true;
}

function workDates(sheet) {
  return new Set(
    (sheet.rows || [])
      .filter((r) => !r.off && r.date && Object.keys(r.locations || {}).length)
      .map((r) => r.date),
  );
}

async function main() {
  const reviewed = JSON.parse(
    await fs.readFile(path.join(ROOT, "reviewed_sheets.json"), "utf8"),
  );
  const sheets = reviewed.sheets || [];

  // Pull current attendance once
  let all = await listAttendance();
  if (!Array.isArray(all)) all = all.items || all.attendance || [];
  console.log(`Attendance before: ${all.length}`);

  const report = [];

  for (const sheet of sheets) {
    const filePath = path.join(ROOT, sheet.file);
    const base = path.basename(sheet.file);
    console.log(`\n=== ${base} → ${sheet.employeeName} (${sheet.laborId}) ===`);

    // Replace: delete existing attendance for this labor on covered dates
    const dates = workDates(sheet);
    const toDelete = all.filter(
      (r) =>
        String(r.laborId) === String(sheet.laborId) &&
        dates.has(String(r.date || "").slice(0, 10)),
    );
    for (const row of toDelete) {
      await deleteAttendance(row.id);
    }
    if (toDelete.length) {
      console.log(`  Removed ${toDelete.length} prior rows for labor ${sheet.laborId}`);
      const delIds = new Set(toDelete.map((r) => r.id));
      all = all.filter((r) => !delIds.has(r.id));
    }

    const dataUrl = await fileToDataUrl(filePath);
    const uploaded = await api("/api/timesheets/upload", {
      method: "POST",
      body: { fileName: base, dataUrl },
    });
    const id = uploaded.id;
    console.log(`  Uploaded ${id} (ocrOk=${uploaded.ocrOk})`);

    const put = await api(`/api/timesheets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: {
        employeeName: sheet.employeeName,
        laborId: sheet.laborId,
        month: sheet.month,
        rows: sheet.rows,
        needsReview: false,
        note: sheet.risk || "attiness import — hand reviewed",
      },
    });
    console.log(
      `  Reviewed match=${put.parsed?.matchedLaborId || put.laborId} name=${put.parsed?.matchedName || put.employeeName}`,
    );

    const committed = await api(`/api/timesheets/${encodeURIComponent(id)}/commit`, {
      method: "POST",
      body: { replace: true },
    });
    console.log(`  Committed records=${committed.records}`);

    const hourRows = sheet.rows.filter(
      (r) => !r.off && Object.keys(r.locations || {}).length,
    );
    report.push({
      file: base,
      timesheetId: id,
      employeeName: sheet.employeeName,
      laborId: sheet.laborId,
      workDays: hourRows.length,
      committed: committed.records,
      replaced: toDelete.length,
      risk: sheet.risk || null,
      locations: [
        ...new Set(hourRows.flatMap((r) => Object.keys(r.locations || {}))),
      ].sort(),
      dateRange: hourRows.length
        ? `${hourRows[0].date} … ${hourRows[hourRows.length - 1].date}`
        : null,
    });
  }

  // Refresh attendance count
  let after = await listAttendance();
  if (!Array.isArray(after)) after = after.items || after.attendance || [];
  console.log(`\nAttendance after: ${after.length}`);

  const outPath = path.join(ROOT, "commit_report.json");
  await fs.writeFile(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), attendanceCount: after.length, report }, null, 2),
  );
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

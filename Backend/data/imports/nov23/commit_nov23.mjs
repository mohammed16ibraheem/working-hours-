#!/usr/bin/env node
/**
 * Upload Nov 23 WhatsApp timesheets → PUT corrections → replace prior
 * attendance for same labor+dates → commit into Reports.
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
  return api("/api/attendance/logs?limit=8000");
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

  let all = await listAttendance();
  if (!Array.isArray(all)) all = all.items || all.attendance || [];
  console.log(`Attendance before: ${all.length}`);

  const report = [];

  for (const sheet of sheets) {
    const filePath = path.join(ROOT, sheet.file);
    const base = path.basename(sheet.file);
    console.log(`\n=== ${base} → ${sheet.employeeName} (${sheet.laborId}) ===`);

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
    const id = uploaded.id || uploaded.items?.[0]?.id;
    if (!id) throw new Error("Upload returned no timesheet id");
    console.log(`  Uploaded ${id} (ocrOk=${uploaded.ocrOk})`);

    const put = await api(`/api/timesheets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: {
        employeeName: sheet.employeeName,
        laborId: sheet.laborId,
        month: sheet.month,
        rows: sheet.rows,
        needsReview: false,
        note: sheet.risk || "nov23 WhatsApp import — hand reviewed",
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
    const locs = new Set();
    for (const r of hourRows) {
      for (const k of Object.keys(r.locations || {})) locs.add(k);
    }
    const sortedDates = [...dates].sort();
    report.push({
      file: base,
      timesheetId: id,
      employeeName: sheet.employeeName,
      laborId: sheet.laborId,
      workDays: hourRows.length,
      committed: committed.records,
      replaced: toDelete.length,
      risk: sheet.risk || null,
      locations: [...locs].sort(),
      dateRange: sortedDates.length
        ? `${sortedDates[0]} … ${sortedDates[sortedDates.length - 1]}`
        : null,
    });

    // Refresh local attendance cache with new rows
    all = await listAttendance();
    if (!Array.isArray(all)) all = all.items || all.attendance || [];
  }

  const after = await listAttendance();
  const afterCount = Array.isArray(after)
    ? after.length
    : (after.items || after.attendance || []).length;

  const out = {
    at: new Date().toISOString(),
    attendanceCount: afterCount,
    report,
  };
  await fs.writeFile(path.join(ROOT, "commit_report.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nDone. Attendance after: ${afterCount}`);
  console.log(`Wrote ${path.join(ROOT, "commit_report.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

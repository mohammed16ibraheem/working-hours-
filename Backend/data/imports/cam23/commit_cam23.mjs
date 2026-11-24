#!/usr/bin/env node
/**
 * PUT hand-reviewed CamScanner_23 sheets onto uploaded timesheet IDs,
 * then commit with replace:true (date-merge: replace overlapping dates only).
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

async function main() {
  const reviewed = JSON.parse(
    await fs.readFile(path.join(ROOT, "reviewed_sheets.json"), "utf8"),
  );
  const sheets = reviewed.sheets || [];
  const report = [];

  for (const sheet of sheets) {
    const id = sheet.timesheetId;
    console.log(`\n=== ${path.basename(sheet.file)} → ${sheet.employeeName} (${sheet.laborId}) id=${id} ===`);

    const put = await api(`/api/timesheets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: {
        employeeName: sheet.employeeName,
        laborId: sheet.laborId,
        month: sheet.month,
        rows: sheet.rows,
        needsReview: false,
        note: sheet.risk || "cam23 CamScanner import — hand reviewed",
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

    const hourRows = sheet.rows.filter(
      (r) => !r.off && Object.keys(r.locations || {}).length,
    );
    report.push({
      file: path.basename(sheet.file),
      timesheetId: id,
      employeeName: sheet.employeeName,
      laborId: sheet.laborId,
      workDays: hourRows.length,
      committed: committed.records,
      replacedDates: committed.replacedDates || [],
      risk: sheet.risk || null,
      locations: [
        ...new Set(hourRows.flatMap((r) => Object.keys(r.locations || {}))),
      ].sort(),
      dateRange: hourRows.length
        ? `${hourRows[0].date} … ${hourRows[hourRows.length - 1].date}`
        : null,
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
    source: "CamScanner_23-11-2026_11.30.pdf",
    attendanceCount: rows.length,
    report,
    reportsByLabor: by,
  };
  const outPath = path.join(ROOT, "commit_report.json");
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`\nAttendance rows in Reports range: ${rows.length}`);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

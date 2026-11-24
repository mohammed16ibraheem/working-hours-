#!/usr/bin/env node
/**
 * Hand-audited WhatsApp sheets (2026-11-24) → date-merge commit for 5 labors.
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
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

function sheetHours(sheet) {
  let h = 0;
  for (const r of sheet.rows || []) {
    if (r.off) continue;
    for (const v of Object.values(r.locations || {})) h += Number(v) || 0;
  }
  return h;
}

async function main() {
  const reviewed = JSON.parse(
    await fs.readFile(path.join(ROOT, "reviewed_sheets.json"), "utf8"),
  );
  const before = await api("/api/reports/attendance?from=2026-10-26&to=2026-11-25");
  const beforeBy = Object.fromEntries(
    (before.byEmployee || []).map((e) => [String(e.laborId), e.hours]),
  );

  const report = [];
  for (const sheet of reviewed.sheets || []) {
    const filePath = path.join(ROOT, sheet.file);
    console.log(`\n=== ${sheet.employeeName} (${sheet.laborId}) sheet=${sheetHours(sheet)}h ===`);

    const dataUrl = await fileToDataUrl(filePath);
    const uploaded = await api("/api/timesheets/upload", {
      method: "POST",
      body: { fileName: `${sheet.laborId}-whatsapp24.jpg`, dataUrl },
    });
    const id = uploaded.id || uploaded.items?.[0]?.id;
    if (!id) throw new Error("Upload returned no timesheet id");

    await api(`/api/timesheets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: {
        employeeName: sheet.employeeName,
        laborId: sheet.laborId,
        month: sheet.month,
        rows: sheet.rows,
        needsReview: false,
        note: sheet.risk || "whatsapp24 hand audit",
      },
    });

    const committed = await api(`/api/timesheets/${encodeURIComponent(id)}/commit`, {
      method: "POST",
      body: { replace: true },
    });
    console.log(
      `  committed=${committed.records} replaced=${(committed.replacedDates || []).length}`,
    );

    report.push({
      laborId: sheet.laborId,
      employeeName: sheet.employeeName,
      sheetHours: sheetHours(sheet),
      beforeHours: beforeBy[String(sheet.laborId)] ?? null,
      committed: committed.records,
      replacedDates: committed.replacedDates || [],
      risk: sheet.risk || null,
      timesheetId: id,
    });
  }

  const after = await api("/api/reports/attendance?from=2026-10-26&to=2026-11-25");
  const afterBy = Object.fromEntries(
    (after.byEmployee || []).map((e) => [String(e.laborId), e]),
  );
  for (const row of report) {
    row.afterHours = afterBy[row.laborId]?.hours ?? null;
    row.matchSheet = row.afterHours === row.sheetHours;
  }

  const out = {
    at: new Date().toISOString(),
    source: reviewed.source,
    report,
    summaryBefore: before.summary,
    summaryAfter: after.summary,
  };
  await fs.writeFile(path.join(ROOT, "commit_report.json"), JSON.stringify(out, null, 2));
  console.log("\nPer-employee:");
  for (const r of report) {
    console.log(
      `  ${r.laborId} ${r.employeeName}: before=${r.beforeHours} sheet=${r.sheetHours} after=${r.afterHours} match=${r.matchSheet}`,
    );
  }
  console.log(`Reports totalHours ${before.summary.totalHours} → ${after.summary.totalHours}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

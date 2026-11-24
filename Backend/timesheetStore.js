import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  DATA_DIR,
  appendAttendance,
  appendUnmatchedAttendance,
  clearTimesheetAttendanceForDates,
  getUserByLaborId,
  listUsers,
} from "./userStore.js";
import { ALL_SEEDS } from "./timesheetSeeds.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TIMESHEETS_DIR = path.join(DATA_DIR, "timesheets");
const INDEX_FILE = path.join(TIMESHEETS_DIR, "index.json");
const PYTHON = path.join(__dirname, ".venv", "bin", "python");
const OCR_SCRIPT = path.join(__dirname, "timesheet_ocr.py");
const LOCATIONS_FILE = path.join(DATA_DIR, "locations.json");

const SHEET_LOCATIONS = [
  "Scrap City",
  "Makkah Yard",
  "Green City",
  "DS-Plastic",
  "Al Waha - Villa",
  "Central Workshop",
  "DS-Residence",
  "DS-Mgmt",
  "Namma H.O",
  "Guzain Yard",
];

const LOCATION_ALIASES = {
  "scrap city": "Scrap City",
  "makkah yard": "Makkah Yard",
  "green city": "Green City",
  "green city international": "Green City",
  "ds-plastic": "DS-Plastic",
  "ds plastic": "DS-Plastic",
  villa: "Al Waha - Villa",
  "al waha - villa": "Al Waha - Villa",
  "al waha villa": "Al Waha - Villa",
  "central workshop": "Central Workshop",
  "ds-residence": "DS-Residence",
  "ds residence": "DS-Residence",
  "ds-mgmt": "DS-Mgmt",
  "ds mgmt": "DS-Mgmt",
  "namma h.o": "Namma H.O",
  "namma ho": "Namma H.O",
  "namma h.o.": "Namma H.O",
  "guzain yard": "Guzain Yard",
};

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return typeof fallback === "function" ? fallback() : fallback;
  }
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function loadIndex() {
  await ensureDir(TIMESHEETS_DIR);
  const rows = await readJson(INDEX_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function saveIndex(rows) {
  await writeJson(INDEX_FILE, rows);
}

function normalizeLocName(name) {
  const key = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return LOCATION_ALIASES[key] || String(name || "").trim();
}

function normalizeLocationsMap(locs) {
  const out = {};
  if (!locs || typeof locs !== "object") return out;
  if (Array.isArray(locs.__split__)) {
    // OCR placeholder — leave empty for review
    return out;
  }
  for (const [k, v] of Object.entries(locs)) {
    if (k.startsWith("__")) continue;
    const hours = Number(v);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const name = normalizeLocName(k);
    if (!name) continue;
    out[name] = Math.round(hours * 100) / 100;
  }
  return out;
}

export async function resolveLocation(name) {
  const want = normalizeLocName(name);
  const locations = await readJson(LOCATIONS_FILE, []);
  const list = Array.isArray(locations) ? locations : [];
  let hit = list.find((l) => String(l.name).toLowerCase() === want.toLowerCase());
  if (hit) return hit;
  hit = list.find(
    (l) =>
      normalizeLocName(l.name).toLowerCase() === want.toLowerCase() ||
      String(l.name).toLowerCase().includes(want.toLowerCase()),
  );
  return hit || null;
}

export async function matchLabor({ laborId, employeeName }) {
  const lid = String(laborId || "").trim();
  if (lid) {
    const byId = await getUserByLaborId(lid);
    if (byId) return byId;
  }
  const name = String(employeeName || "")
    .trim()
    .toLowerCase();
  if (!name) return null;
  const users = await listUsers();
  const exact = users.find((u) => String(u.name).toLowerCase() === name);
  if (exact) return exact;
  // Fuzzy: all tokens of shorter name appear in longer
  const tokens = name.split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return null;
  return (
    users.find((u) => {
      const un = String(u.name).toLowerCase();
      return tokens.every((t) => un.includes(t)) || tokens.some((t) => un.includes(t) && t.length > 4);
    }) || null
  );
}

function runOcr(imagePath) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [OCR_SCRIPT, imagePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", (e) => {
      resolve({ ok: false, error: e.message, rawText: "", parsed: null });
    });
    child.on("close", () => {
      try {
        resolve(JSON.parse(out || "{}"));
      } catch {
        resolve({ ok: false, error: err || out || "OCR parse failed", rawText: "", parsed: null });
      }
    });
  });
}

function extFromMime(mime) {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("pdf")) return ".pdf";
  return ".jpg";
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(
    /^data:((?:image|application)\/[a-zA-Z0-9.+-]+);base64,(.+)$/,
  );
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!mime.startsWith("image/") && mime !== "application/pdf") return null;
  return { mime, buf: Buffer.from(m[2], "base64") };
}

function runCmd(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code) =>
      resolve({ ok: code === 0, error: code === 0 ? null : err || `exit ${code}` }),
    );
  });
}

/** Rasterize PDF pages to JPEG files via pdftoppm (poppler-utils). */
async function rasterizePdfToJpegs(pdfBuf, outDir, { dpi = 200 } = {}) {
  await ensureDir(outDir);
  const pdfPath = path.join(outDir, "source.pdf");
  await fs.writeFile(pdfPath, pdfBuf);
  const prefix = path.join(outDir, "page");
  const ran = await runCmd("pdftoppm", ["-jpeg", "-r", String(dpi), pdfPath, prefix]);
  if (!ran.ok) {
    throw new Error(
      ran.error
        ? `PDF convert failed: ${ran.error}`
        : "PDF convert failed — install poppler-utils (pdftoppm).",
    );
  }
  const names = (await fs.readdir(outDir))
    .filter((n) => /^page-\d+\.jpg$/i.test(n))
    .sort((a, b) => {
      const na = Number((a.match(/(\d+)/) || [])[1] || 0);
      const nb = Number((b.match(/(\d+)/) || [])[1] || 0);
      return na - nb;
    });
  if (!names.length) throw new Error("PDF had no pages to OCR.");
  return names.map((n) => path.join(outDir, n));
}

/**
 * Accept one image or a multi-page PDF. PDFs expand to one timesheet per page.
 * Always returns an array of timesheet metas.
 */
export async function uploadTimesheetInput({ fileName, dataUrl, seedKey }) {
  const parsedUrl = parseDataUrl(dataUrl);
  if (!parsedUrl) throw new Error("Image or PDF dataUrl required.");

  if (parsedUrl.mime === "application/pdf") {
    const batchId = `pdf-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
    const workDir = path.join(TIMESHEETS_DIR, "_pdf", batchId);
    const pages = await rasterizePdfToJpegs(parsedUrl.buf, workDir);
    const base = String(fileName || "timesheet.pdf")
      .replace(/\.pdf$/i, "")
      .trim() || "timesheet";
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      const buf = await fs.readFile(pages[i]);
      const pageDataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
      const pageName =
        pages.length === 1 ? `${base}.jpg` : `${base}-p${String(i + 1).padStart(2, "0")}.jpg`;
      out.push(
        await uploadTimesheet({
          fileName: pageName,
          dataUrl: pageDataUrl,
          seedKey: seedKey || null,
        }),
      );
    }
    // Best-effort cleanup of temp raster files
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return out;
  }

  return [await uploadTimesheet({ fileName, dataUrl, seedKey })];
}

function emptyParsed(extra = {}) {
  return {
    employeeName: null,
    laborId: null,
    month: null,
    rows: [],
    needsReview: true,
    ...extra,
  };
}

function cleanParsed(parsed) {
  const p = parsed && typeof parsed === "object" ? parsed : emptyParsed();
  return {
    employeeName: p.employeeName ? String(p.employeeName).trim() : null,
    laborId: p.laborId != null && String(p.laborId).trim() ? String(p.laborId).trim() : null,
    month: p.month || null,
    rows: Array.isArray(p.rows)
      ? p.rows.map((r) => ({
          date: String(r.date || "").trim(),
          locations: normalizeLocationsMap(r.locations),
          total: Number(r.total) || 0,
          off: Boolean(r.off),
          rawLine: r.rawLine || undefined,
        }))
      : [],
    needsReview: p.needsReview !== false,
    note: p.note || null,
  };
}

async function enrichMatch(parsed) {
  const labor = await matchLabor(parsed);
  return {
    ...parsed,
    matchedLaborId: labor?.laborId || null,
    matchedName: labor?.name || null,
    matchedRecordId: labor?.id || null,
  };
}

export async function listTimesheets() {
  const rows = await loadIndex();
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function getTimesheet(id) {
  const rows = await loadIndex();
  const meta = rows.find((r) => r.id === id);
  if (!meta) return null;
  const detail = await readJson(path.join(TIMESHEETS_DIR, id, "parsed.json"), null);
  return { ...meta, parsed: detail?.parsed || meta.parsed || emptyParsed(), ocr: detail?.ocr || null };
}

export async function updateTimesheetParsed(id, patch) {
  const rows = await loadIndex();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("Timesheet not found.");
  const detailPath = path.join(TIMESHEETS_DIR, id, "parsed.json");
  const detail = await readJson(detailPath, { parsed: emptyParsed() });
  const next = await enrichMatch(
    cleanParsed({
      ...detail.parsed,
      ...(patch || {}),
      rows: patch?.rows != null ? patch.rows : detail.parsed?.rows,
    }),
  );
  detail.parsed = next;
  await writeJson(detailPath, detail);
  rows[idx] = {
    ...rows[idx],
    employeeName: next.employeeName,
    laborId: next.matchedLaborId || next.laborId,
    status: rows[idx].status === "committed" ? "committed" : "reviewed",
    updatedAt: Date.now(),
  };
  await saveIndex(rows);
  return { ...rows[idx], parsed: next, ocr: detail.ocr || null };
}

export async function uploadTimesheet({ fileName, dataUrl, seedKey }) {
  const parsedUrl = parseDataUrl(dataUrl);
  if (!parsedUrl) throw new Error("Image dataUrl required.");
  if (parsedUrl.mime === "application/pdf") {
    throw new Error("Use uploadTimesheetInput for PDF uploads.");
  }
  const id = `ts-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const dir = path.join(TIMESHEETS_DIR, id);
  await ensureDir(dir);
  const ext = extFromMime(parsedUrl.mime);
  const imageName = `original${ext}`;
  const imagePath = path.join(dir, imageName);
  await fs.writeFile(imagePath, parsedUrl.buf);

  const ocr = await runOcr(imagePath);
  let parsed = cleanParsed(ocr.parsed || emptyParsed({ note: ocr.error || null }));
  parsed = await enrichMatch(parsed);

  const meta = {
    id,
    fileName: String(fileName || `timesheet${ext}`).trim() || `timesheet${ext}`,
    imageName,
    imageRel: path.relative(DATA_DIR, imagePath).replace(/\\/g, "/"),
    status: "parsed",
    engine: ocr.engine || (ocr.ok ? "rapidocr-onnx" : "none"),
    ocrOk: Boolean(ocr.ok),
    ocrError: ocr.error || null,
    employeeName: parsed.employeeName,
    laborId: parsed.matchedLaborId || parsed.laborId,
    seedKey: seedKey || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    committedAt: null,
    committedRecords: 0,
  };
  await writeJson(path.join(dir, "parsed.json"), { ocr, parsed });
  const index = await loadIndex();
  index.push(meta);
  await saveIndex(index);
  return { ...meta, parsed, ocr };
}

export async function commitTimesheet(id, { replace = false } = {}) {
  const detail = await getTimesheet(id);
  if (!detail) throw new Error("Timesheet not found.");
  if (detail.status === "committed" && !replace) {
    return { ok: true, alreadyCommitted: true, records: detail.committedRecords || 0 };
  }
  const parsed = cleanParsed(detail.parsed);
  const labor =
    (await matchLabor({
      laborId: parsed.matchedLaborId || parsed.laborId,
      employeeName: parsed.matchedName || parsed.employeeName,
    })) || null;

  // Dates present in this commit payload (with hours, or explicit off).
  // Only these days are replaced for the employee — earlier committed days that
  // are absent here (e.g. blank 22–25 Nov on a partial fill) are kept so a
  // later re-upload can continue missing dates without wiping good prior days.
  const payloadDates = new Set();
  const workRows = [];
  for (const row of parsed.rows) {
    if (!row.date) continue;
    if (row.off) {
      payloadDates.add(row.date);
      continue;
    }
    const locs = normalizeLocationsMap(row.locations);
    const entries = Object.entries(locs);
    if (!entries.length) continue;
    payloadDates.add(row.date);
    workRows.push({ date: row.date, entries });
  }

  const laborId = labor?.laborId || parsed.laborId || null;
  const laborName = labor?.name || parsed.employeeName || null;
  if (payloadDates.size && laborId) {
    await clearTimesheetAttendanceForDates({
      laborId,
      name: laborName,
      dates: [...payloadDates],
    });
  } else if (payloadDates.size && !laborId) {
    await clearTimesheetAttendanceForDates({
      laborId: "_unmatched",
      name: laborName || "Unknown worker",
      dates: [...payloadDates],
    });
  }

  const created = [];
  let seq = 0;
  for (const row of workRows) {
    for (const [locName, hours] of row.entries) {
      const loc = await resolveLocation(locName);
      if (!loc) {
        throw new Error(`Unknown location "${locName}" — add it under Location first.`);
      }
      seq += 1;
      const createdAt = new Date(`${row.date}T12:00:00`).getTime() + seq;
      const entry = {
        id: `att-ts-${id.slice(3, 12)}-${seq.toString(36)}`,
        token: `timesheet:${id}`,
        locationId: loc.id,
        locationName: loc.name,
        workingHours: String(hours),
        hours,
        matched: Boolean(labor),
        faceMismatch: false,
        confidence: null,
        distance: null,
        engine: "timesheet-ocr",
        laborId: laborId,
        name: laborName,
        laborRecordId: labor?.id || null,
        photoDataUrl: "",
        createdAt,
        date: row.date,
        source: "timesheet",
        timesheetId: id,
      };
      const saved = labor
        ? await appendAttendance(labor, entry)
        : await appendUnmatchedAttendance(entry);
      created.push(saved);
    }
  }

  const index = await loadIndex();
  const idx = index.findIndex((r) => r.id === id);
  if (idx >= 0) {
    index[idx] = {
      ...index[idx],
      status: "committed",
      committedAt: Date.now(),
      committedRecords: created.length,
      updatedAt: Date.now(),
      laborId: laborId,
      employeeName: laborName,
    };
    await saveIndex(index);
  }
  return {
    ok: true,
    records: created.length,
    laborId: laborId,
    replacedDates: [...payloadDates].sort(),
    merged: true,
  };
}

async function fileToDataUrl(filePath) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function seedSampleTimesheets({ commit = true } = {}) {
  const results = [];
  for (const seed of ALL_SEEDS) {
    const samplePath = path.join(TIMESHEETS_DIR, seed.samplePath);
    let dataUrl;
    try {
      dataUrl = await fileToDataUrl(samplePath);
    } catch {
      results.push({ key: seed.key, error: `Sample image missing: ${seed.samplePath}` });
      continue;
    }
    // Skip if already seeded & committed
    const existing = (await loadIndex()).find((r) => r.seedKey === seed.key && r.status === "committed");
    if (existing) {
      results.push({
        key: seed.key,
        id: existing.id,
        skipped: true,
        records: existing.committedRecords || 0,
      });
      continue;
    }

    const uploaded = await uploadTimesheet({
      fileName: seed.fileName,
      dataUrl,
      seedKey: seed.key,
    });
    // Overlay carefully transcribed rows (OCR still stored under ocr)
    const parsed = await enrichMatch(
      cleanParsed({
        employeeName: seed.employeeName,
        laborId: seed.laborId,
        month: seed.month,
        rows: seed.rows,
        needsReview: false,
        note: "Seeded from handwritten sheet transcription.",
      }),
    );
    await writeJson(path.join(TIMESHEETS_DIR, uploaded.id, "parsed.json"), {
      ocr: uploaded.ocr,
      parsed,
      seed: true,
    });
    const index = await loadIndex();
    const idx = index.findIndex((r) => r.id === uploaded.id);
    if (idx >= 0) {
      index[idx] = {
        ...index[idx],
        employeeName: parsed.employeeName,
        laborId: parsed.matchedLaborId || parsed.laborId,
        status: "reviewed",
        updatedAt: Date.now(),
        note: "seed-transcription",
      };
      await saveIndex(index);
    }
    let commitResult = null;
    if (commit) {
      commitResult = await commitTimesheet(uploaded.id);
    }
    results.push({
      key: seed.key,
      id: uploaded.id,
      employeeName: parsed.employeeName,
      laborId: parsed.matchedLaborId || parsed.laborId,
      rows: parsed.rows.filter((r) => !r.off).length,
      committed: commitResult?.records ?? 0,
      ocrOk: uploaded.ocrOk,
    });
  }
  return { ok: true, sheetLocations: SHEET_LOCATIONS, results };
}

export { SHEET_LOCATIONS };

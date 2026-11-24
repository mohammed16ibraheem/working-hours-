import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  DATA_DIR,
  NORMAL_DAY_HOURS,
  appendAttendance,
  appendReject,
  appendUnmatchedAttendance,
  deleteAttendance,
  deleteUser,
  getUserById,
  getUserByLaborId,
  listAllAttendance,
  listUsers,
  migrateAttendanceToTree,
  migrateFlatToUsers,
  parseWorkingHours,
  round2,
  saveUser,
  updateAttendance,
  ymdLocal,
} from "./userStore.js";
import {
  SHEET_LOCATIONS,
  commitTimesheet,
  getTimesheet,
  listTimesheets,
  seedSampleTimesheets,
  updateTimesheetParsed,
  uploadTimesheet,
  uploadTimesheetInput,
} from "./timesheetStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCATIONS_FILE = path.join(DATA_DIR, "locations.json");
const LINKS_FILE = path.join(DATA_DIR, "attendance_links.json");
const PYTHON = path.join(__dirname, ".venv", "bin", "python");
const FACE_SCRIPT = path.join(__dirname, "face_match.py");
const JOB_CARD_SCRIPT = path.join(__dirname, "job_card_export.py");
const PORT = Number(process.env.PORT || 3001);
const PUBLIC_BASE = process.env.WH_PUBLIC_BASE || "";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "40mb" }));
const LINK_TTL_MS = 30 * 60 * 1000; // 30 minutes
const LINK_CUTOFF_MS = 10 * 1000; // unusable in last 10 seconds

function linkRemainingMs(link) {
  return Math.max(0, Number(link?.expiresAt || 0) - Date.now());
}

function isLinkExpired(link) {
  return linkRemainingMs(link) <= LINK_CUTOFF_MS;
}

function isSharedLink(link) {
  return link?.scope === "everyone" || link?.laborId === "*";
}

async function ensureJson(file, fallback = "[]\n") {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, fallback, "utf8");
  }
}

async function readJson(file) {
  await ensureJson(file);
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeJson(file, rows) {
  await ensureJson(file);
  await fs.writeFile(file, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

function requireFields(body) {
  const name = String(body?.name || "").trim();
  const laborId = String(body?.laborId || "").trim();
  const country = String(body?.country || "").trim();
  const rawPhoto = String(body?.photoDataUrl || "");
  const photoDataUrl = rawPhoto.startsWith("data:image/") ? rawPhoto : "";
  const photoName = photoDataUrl
    ? String(body?.photoName || "photo.jpg").trim() || "photo.jpg"
    : "";
  if (!name || !laborId || !country) {
    return { error: "Name, laborID, and country are required." };
  }
  return { name, laborId, country, photoDataUrl, photoName };
}

function runFace(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [FACE_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const parsed = JSON.parse(out || "{}");
        if (parsed.error && !parsed.matched) {
          resolve(parsed);
          return;
        }
        if (code !== 0 && !parsed.matched) {
          resolve({ matched: false, error: parsed.error || err || "Face match failed." });
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error(err || out || "Face match failed."));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "wh-backend",
    pipeline: "timesheet-ocr → attendance tree → reports",
    storage: "data/user/*/profile.json + data/attendance/",
  });
});


app.get("/api/labors", async (_req, res) => {
  const rows = await listUsers();
  res.json(rows);
});

app.get("/api/labors/:id", async (req, res) => {
  const row = await getUserById(req.params.id);
  if (!row) return res.status(404).json({ error: "Labor not found." });
  res.json(row);
});

app.post("/api/labors", async (req, res) => {
  const parsed = requireFields(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const created = await saveUser(parsed);
  res.status(201).json(created);
});

app.put("/api/labors/:id", async (req, res) => {
  const parsed = requireFields(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const existing = await getUserById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Labor not found." });
  // Keep prior profile photo when update omits one
  const photoDataUrl = parsed.photoDataUrl || existing.photoDataUrl || "";
  const photoName = parsed.photoDataUrl
    ? parsed.photoName
    : existing.photoName || parsed.photoName || "";
  const next = await saveUser({
    ...parsed,
    photoDataUrl,
    photoName,
    id: existing.id,
  });
  res.json(next);
});

app.delete("/api/labors/:id", async (req, res) => {
  const ok = await deleteUser(req.params.id);
  if (!ok) return res.status(404).json({ error: "Labor not found." });
  res.json({ ok: true });
});

function requireLocationFields(body) {
  const name = String(body?.name || "").trim();
  const address = String(body?.address || "").trim();
  const logoDataUrl = String(body?.logoDataUrl || "");
  const logoName = String(body?.logoName || "").trim();
  const logoUrlRaw = String(body?.logoUrl || "").trim();
  const logoUrl = logoUrlRaw.startsWith("/locations/") ? logoUrlRaw : "";
  if (!name) return { error: "Location name is required." };
  if (logoDataUrl && !logoDataUrl.startsWith("data:image/")) {
    return { error: "Logo must be a valid image." };
  }
  const hasData = logoDataUrl.startsWith("data:image/");
  return {
    name,
    address,
    logoDataUrl: hasData ? logoDataUrl : "",
    logoName: hasData || logoUrl ? logoName || (hasData ? "logo.jpg" : "") : "",
    logoUrl: hasData ? "" : logoUrl,
  };
}

app.get("/api/locations", async (_req, res) => {
  const rows = await readJson(LOCATIONS_FILE);
  rows.sort(
    (a, b) =>
      (a.updatedAt || 0) - (b.updatedAt || 0) ||
      String(a.name || "").localeCompare(String(b.name || "")),
  );
  res.json(rows);
});

app.post("/api/locations", async (req, res) => {
  const parsed = requireLocationFields(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const now = Date.now();
  const created = {
    id: `loc-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: parsed.name,
    address: parsed.address,
    logoDataUrl: parsed.logoDataUrl,
    logoName: parsed.logoName,
    updatedAt: now,
  };
  if (parsed.logoUrl) created.logoUrl = parsed.logoUrl;
  const rows = await readJson(LOCATIONS_FILE);
  rows.push(created);
  await writeJson(LOCATIONS_FILE, rows);
  res.status(201).json(created);
});

app.put("/api/locations/:id", async (req, res) => {
  const parsed = requireLocationFields(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const rows = await readJson(LOCATIONS_FILE);
  const idx = rows.findIndex((r) => r.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Location not found." });
  const next = {
    ...rows[idx],
    name: parsed.name,
    address: parsed.address,
    logoDataUrl: parsed.logoDataUrl,
    logoName: parsed.logoName,
    updatedAt: Date.now(),
  };
  if (parsed.logoUrl) next.logoUrl = parsed.logoUrl;
  else delete next.logoUrl;
  rows[idx] = next;
  await writeJson(LOCATIONS_FILE, rows);
  res.json(next);
});

app.delete("/api/locations/:id", async (req, res) => {
  const rows = await readJson(LOCATIONS_FILE);
  const next = rows.filter((r) => r.id !== req.params.id);
  if (next.length === rows.length) {
    return res.status(404).json({ error: "Location not found." });
  }
  await writeJson(LOCATIONS_FILE, next);
  res.json({ ok: true });
});

app.get("/api/attendance/links", async (_req, res) => {
  const links = await readJson(LINKS_FILE);
  const shared = links.filter(isSharedLink);
  shared.sort((a, b) => b.createdAt - a.createdAt);
  res.json(shared);
});

app.delete("/api/attendance/links/:token", async (req, res) => {
  const links = await readJson(LINKS_FILE);
  const next = links.filter((l) => l.token !== req.params.token);
  if (next.length === links.length) {
    return res.status(404).json({ error: "Attendance link not found." });
  }
  await writeJson(LINKS_FILE, next);
  res.json({ ok: true });
});

app.post("/api/attendance/links", async (_req, res) => {
  const labors = await listUsers();
  const withFaces = labors.filter((r) => r.photoDataUrl?.startsWith("data:image/"));
  if (withFaces.length === 0) {
    return res.status(400).json({
      error: "Add Create Labor face photos first — link is for all enrolled workers.",
    });
  }
  const token = crypto.randomBytes(18).toString("hex");
  const now = Date.now();
  const link = {
    token,
    scope: "everyone",
    workerCount: withFaces.length,
    name: "All workers",
    laborId: "*",
    country: "",
    createdAt: now,
    expiresAt: now + LINK_TTL_MS,
    usedCount: 0,
    lastStatus: "active",
  };
  const links = await readJson(LINKS_FILE);
  links.push(link);
  await writeJson(LINKS_FILE, links);
  const pathUrl = `/attend/${token}`;
  res.status(201).json({
    ...link,
    path: pathUrl,
    url: PUBLIC_BASE ? `${PUBLIC_BASE.replace(/\/$/, "")}${pathUrl}` : pathUrl,
    ttlMinutes: 30,
  });
});

app.get("/api/attendance/links/:token", async (req, res) => {
  const links = await readJson(LINKS_FILE);
  const link = links.find((l) => l.token === req.params.token);
  if (!link) return res.status(404).json({ error: "Attendance link not found." });
  const remainingMs = linkRemainingMs(link);
  if (isLinkExpired(link)) {
    return res.status(410).json({
      error: "This attendance link has expired (30 minutes).",
      remainingMs,
      expired: true,
    });
  }
  const locations = await readJson(LOCATIONS_FILE);
  locations.sort(
    (a, b) =>
      (a.updatedAt || 0) - (b.updatedAt || 0) ||
      String(a.name || "").localeCompare(String(b.name || "")),
  );
  res.json({
    token: link.token,
    scope: link.scope || "everyone",
    name: link.name || "All workers",
    workerCount: link.workerCount || 0,
    expiresAt: link.expiresAt,
    remainingMs,
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address || "",
      logoDataUrl: l.logoDataUrl?.startsWith("data:image/") ? l.logoDataUrl : "",
      logoUrl: typeof l.logoUrl === "string" && l.logoUrl.startsWith("/") ? l.logoUrl : "",
    })),
  });
});

app.post("/api/attendance/links/:token/submit", async (req, res) => {
  const photoDataUrl = String(req.body?.photoDataUrl || "");
  const locationId = String(req.body?.locationId || "").trim();
  const workingHours = String(req.body?.workingHours ?? "").trim();
  if (!photoDataUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "Take a live selfie with the camera." });
  }
  if (!locationId) {
    return res.status(400).json({ error: "Location is required." });
  }
  if (!workingHours) {
    return res.status(400).json({ error: "Working hours are required." });
  }
  const locations = await readJson(LOCATIONS_FILE);
  const location = locations.find((l) => l.id === locationId);
  if (!location) {
    return res.status(400).json({ error: "Selected location was not found." });
  }
  const links = await readJson(LINKS_FILE);
  const idx = links.findIndex((l) => l.token === req.params.token);
  if (idx < 0) return res.status(404).json({ error: "Attendance link not found." });
  const link = links[idx];
  if (isLinkExpired(link)) {
    return res.status(410).json({
      error: "This attendance link has expired (30 minutes).",
      remainingMs: linkRemainingMs(link),
      expired: true,
    });
  }
  const labors = await listUsers();
  const references = labors
    .filter((r) => {
      const p = String(r.photoDataUrl || "");
      if (!p.startsWith("data:image/")) return false;
      const head = p.slice(0, p.indexOf(",") >= 0 ? p.indexOf(",") : 64).toLowerCase();
      return !head.includes("svg");
    })
    .map((r) => ({
      id: r.id,
      name: r.name,
      laborId: r.laborId,
      country: r.country,
      photoDataUrl: r.photoDataUrl,
    }));

  // Best-effort InsightFace identity — mismatch / no-face / errors still accept.
  let match = { matched: false, spoofRejected: false, liveness: null };
  try {
    if (references.length > 0) {
      match = await runFace({ mode: "identify", probe: photoDataUrl, references });
    } else {
      match = {
        matched: false,
        message: "No enrolled worker face photos.",
        engine: "insightface/buffalo_l",
      };
    }
  } catch (err) {
    match = {
      matched: false,
      spoofRejected: false,
      liveness: null,
      engine: "insightface/buffalo_l",
      error: err instanceof Error ? err.message : "Face recognition failed.",
      message: "Face check failed — attendance saved anyway.",
    };
  }


  const matched = Boolean(match.matched);
  const createdAt = Date.now();
  let closestLaborId = match.laborId != null ? String(match.laborId) : null;
  let closestName = match.name != null ? String(match.name) : null;
  let closestRecordId = match.laborRecordId || null;
  const faceMismatch = !matched;

  links[idx] = {
    ...link,
    usedCount: (link.usedCount || 0) + 1,
    lastStatus: matched ? "matched" : "face_mismatch",
    lastUsedAt: createdAt,
  };
  await writeJson(LINKS_FILE, links);

  // Resolve enrolled Create Labor profile — Reports need real laborId (e.g. 625).
  let user =
    (closestRecordId && (await getUserById(closestRecordId))) ||
    (closestLaborId && (await getUserByLaborId(closestLaborId))) ||
    null;

  if (matched && user) {
    // Source of truth: enrolled profile fields (workers never type ID).
    closestLaborId = String(user.laborId);
    closestName = String(user.name);
    closestRecordId = user.id;
  }

  const entryBase = {
    id: `att-${createdAt.toString(36)}`,
    token: link.token,
    locationId: location.id,
    locationName: location.name,
    workingHours,
    matched,
    faceMismatch,
    confidence: match.confidence ?? null,
    distance: match.distance ?? null,
    engine: match.engine || "insightface/buffalo_l",
    laborId: closestLaborId,
    name: closestName,
    laborRecordId: closestRecordId,
    photoDataUrl,
    createdAt,
  };

  let saved;
  if (user && (matched || closestLaborId)) {
    // Matched → user folder with matched:true + laborId.
    // Closest-but-mismatch → still under that folder with faceMismatch (ID visible in Reports).
    saved = await appendAttendance(user, {
      ...entryBase,
      laborId: matched ? user.laborId : closestLaborId || user.laborId,
      name: matched ? user.name : closestName || user.name,
      laborRecordId: matched ? user.id : closestRecordId || user.id,
      matched,
      faceMismatch,
    });
  } else {
    saved = await appendUnmatchedAttendance(entryBase);
  }

  res.json({
    accepted: true,
    matched,
    faceMismatch,
    spoofRejected: false,
    liveness: null,
    confidence: match.confidence ?? null,
    distance: match.distance ?? null,
    threshold: match.threshold ?? 0.55,
    engine: match.engine || null,
    name: (matched ? user?.name : null) || closestName || saved.name || null,
    laborId: (matched ? user?.laborId : null) || closestLaborId || saved.laborId || null,
    country: match.country || user?.country || null,
    locationId: location.id,
    locationName: location.name,
    workingHours,
    hours: saved.hours,
    regularHours: saved.regularHours,
    otHours: saved.otHours,
    date: saved.date,
    message: matched
      ? match.message ||
        `Attendance recorded for ${user?.name || closestName} (ID ${user?.laborId || closestLaborId}) at ${location.name} (${workingHours}).`
      : match.message ||
        "Attendance saved. Face did not match an enrolled worker.",
  });
});

app.get("/api/attendance/logs", async (req, res) => {
  const laborIdFilter = String(req.query.laborId || "").trim();
  const locationIdFilter = String(req.query.locationId || "").trim();
  const fromMs = parseBoundMs(req.query.from, false);
  const toMs = parseBoundMs(req.query.to, true);
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(5000, limitRaw) : 500;
  const logs = await listAllAttendance();
  const filtered = logs.filter((log) => {
    const ts = Number(log.createdAt) || 0;
    if (fromMs != null && ts < fromMs) return false;
    if (toMs != null && ts > toMs) return false;
    const lid = String(log.laborId || "_unmatched");
    if (laborIdFilter && lid !== laborIdFilter) return false;
    if (locationIdFilter && String(log.locationId) !== locationIdFilter) return false;
    return true;
  });
  res.json(filtered.slice(0, limit));
});

async function applyAttendancePatch(req, res) {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "Attendance id is required." });
  const body = req.body || {};
  let locationId =
    body.locationId != null ? String(body.locationId).trim() : undefined;
  let locationName =
    body.locationName != null ? String(body.locationName).trim() : undefined;
  if (locationId) {
    const locations = await readJson(LOCATIONS_FILE);
    const loc = locations.find((l) => l.id === locationId);
    if (!loc) return res.status(400).json({ error: "Location not found." });
    locationName = loc.name;
  }
  if (body.date != null && String(body.date).trim()) {
    const dateStr = String(body.date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD." });
    }
  }
  const patch = {
    locationId,
    locationName,
    hours: body.hours,
    workingHours: body.workingHours,
    date: body.date,
  };
  const laborTouched =
    Object.prototype.hasOwnProperty.call(body, "laborId") ||
    Object.prototype.hasOwnProperty.call(body, "laborRecordId");
  if (laborTouched) {
    let laborRecordId =
      body.laborRecordId != null ? String(body.laborRecordId).trim() : "";
    let laborId = body.laborId != null ? String(body.laborId).trim() : "";
    if (
      body.laborId === null ||
      body.laborRecordId === null ||
      laborId === "" ||
      laborId === "_unmatched"
    ) {
      patch.laborId = null;
      patch.laborRecordId = null;
    } else {
      const user =
        (laborRecordId && (await getUserById(laborRecordId))) ||
        (laborId && (await getUserByLaborId(laborId))) ||
        null;
      if (!user) return res.status(400).json({ error: "Employee not found." });
      patch.laborRecordId = user.id;
      patch.laborId = user.laborId;
    }
  }
  let updated;
  try {
    updated = await updateAttendance(id, patch);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "Update failed.",
    });
  }
  if (!updated) return res.status(404).json({ error: "Attendance record not found." });
  res.json(updated);
}

app.put("/api/attendance/:id", applyAttendancePatch);
app.patch("/api/attendance/:id", applyAttendancePatch);

app.delete("/api/attendance/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "Attendance id is required." });
  const ok = await deleteAttendance(id);
  if (!ok) return res.status(404).json({ error: "Attendance record not found." });
  res.json({ ok: true, id });
});

function isoWeekKey(ts) {
  const d = new Date(Number(ts) || 0);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodKeyFor(ts, groupBy) {
  const d = new Date(Number(ts) || 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  if (groupBy === "year") return String(y);
  if (groupBy === "month") return `${y}-${m}`;
  if (groupBy === "week") return isoWeekKey(ts);
  return ymdLocal(ts);
}

function parseBoundMs(value, endOfDay) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    if (endOfDay) return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// GET /api/reports/attendance — scans data/attendance/<y>/<m>/<Ww>/<d>/<slug>/
app.get("/api/reports/attendance", async (req, res) => {
  const groupByRaw = String(req.query.groupBy || "day").toLowerCase();
  const groupBy = ["day", "week", "month", "year"].includes(groupByRaw)
    ? groupByRaw
    : "day";
  const laborIdFilter = String(req.query.laborId || "").trim();
  const locationIdFilter = String(req.query.locationId || "").trim();
  const fromMs = parseBoundMs(req.query.from, false);
  const toMs = parseBoundMs(req.query.to, true);

  const logs = await listAllAttendance();
  const filtered = logs.filter((log) => {
    const ts = Number(log.createdAt) || 0;
    if (fromMs != null && ts < fromMs) return false;
    if (toMs != null && ts > toMs) return false;
    const lid = String(log.laborId || "_unmatched");
    if (laborIdFilter && lid !== laborIdFilter) return false;
    if (locationIdFilter && String(log.locationId) !== locationIdFilter) return false;
    return true;
  });

  const dayMap = new Map();
  for (const log of filtered) {
    const date = log.date || ymdLocal(log.createdAt);
    const lid = String(log.laborId || "_unmatched");
    const key = `${lid}|${date}`;
    let day = dayMap.get(key);
    if (!day) {
      day = {
        laborId: lid,
        name: String(log.name || (lid === "_unmatched" ? "Unknown worker" : lid)),
        date,
        createdAt: Number(log.createdAt) || 0,
        hours: 0,
        records: 0,
        mismatchRecords: 0,
        byLoc: new Map(),
      };
      dayMap.set(key, day);
    }
    const hrs =
      log.hours != null ? Number(log.hours) : parseWorkingHours(log.workingHours);
    day.hours += hrs;
    day.records += 1;
    if (log.faceMismatch || log.matched === false) day.mismatchRecords += 1;
    if (log.name) day.name = String(log.name);
    const locId = String(log.locationId || "unknown");
    let loc = day.byLoc.get(locId);
    if (!loc) {
      loc = {
        locationId: locId,
        locationName: String(log.locationName || locId),
        hours: 0,
        records: 0,
        mismatchRecords: 0,
      };
      day.byLoc.set(locId, loc);
    }
    loc.hours += hrs;
    loc.records += 1;
    if (log.faceMismatch || log.matched === false) loc.mismatchRecords += 1;
    if (log.locationName) loc.locationName = String(log.locationName);
  }

  const slices = [];
  for (const day of dayMap.values()) {
    const total = day.hours;
    const regular = Math.min(total, NORMAL_DAY_HOURS);
    const ot = Math.max(0, total - NORMAL_DAY_HOURS);
    for (const loc of day.byLoc.values()) {
      const share = total > 0 ? loc.hours / total : 0;
      slices.push({
        date: day.date,
        createdAt: day.createdAt,
        laborId: day.laborId,
        name: day.name,
        locationId: loc.locationId,
        locationName: loc.locationName,
        days: 1,
        hours: round2(loc.hours),
        regular: round2(regular * share),
        ot: round2(ot * share),
        records: loc.records,
        faceMismatch: loc.mismatchRecords > 0,
        mismatchRecords: loc.mismatchRecords,
      });
    }
  }

  const rowMap = new Map();
  for (const s of slices) {
    const period = periodKeyFor(new Date(`${s.date}T12:00:00`).getTime(), groupBy);
    const key = `${period}|${s.laborId}|${s.locationId}`;
    let row = rowMap.get(key);
    if (!row) {
      row = {
        period,
        laborId: s.laborId,
        name: s.name,
        locationId: s.locationId,
        locationName: s.locationName,
        days: 0,
        hours: 0,
        regular: 0,
        ot: 0,
        records: 0,
        faceMismatch: false,
        mismatchRecords: 0,
      };
      rowMap.set(key, row);
    }
    row.days += s.days;
    row.hours = round2(row.hours + s.hours);
    row.regular = round2(row.regular + s.regular);
    row.ot = round2(row.ot + s.ot);
    row.records += s.records;
    row.mismatchRecords += s.mismatchRecords || 0;
    row.faceMismatch = row.mismatchRecords > 0;
    if (s.name) row.name = s.name;
  }

  const rows = [...rowMap.values()].sort((a, b) => {
    if (a.period !== b.period) return a.period < b.period ? 1 : -1;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.locationName.localeCompare(b.locationName);
  });

  let totalHours = 0;
  let regularHours = 0;
  let otHours = 0;
  let mismatchRecords = 0;
  const byEmployeeMap = new Map();
  for (const day of dayMap.values()) {
    const reg = Math.min(day.hours, NORMAL_DAY_HOURS);
    const ot = Math.max(0, day.hours - NORMAL_DAY_HOURS);
    totalHours += day.hours;
    regularHours += reg;
    otHours += ot;
    mismatchRecords += day.mismatchRecords || 0;
    let emp = byEmployeeMap.get(day.laborId);
    if (!emp) {
      emp = {
        laborId: day.laborId,
        name: day.name,
        days: 0,
        hours: 0,
        regular: 0,
        ot: 0,
        records: 0,
        faceMismatch: false,
        mismatchRecords: 0,
      };
      byEmployeeMap.set(day.laborId, emp);
    }
    emp.days += 1;
    emp.hours = round2(emp.hours + day.hours);
    emp.regular = round2(emp.regular + reg);
    emp.ot = round2(emp.ot + ot);
    emp.records += day.records;
    emp.mismatchRecords += day.mismatchRecords || 0;
    emp.faceMismatch = emp.mismatchRecords > 0;
    if (day.name) emp.name = day.name;
  }
  const byEmployee = [...byEmployeeMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const records = filtered
    .map((log) => {
      const hours =
        log.hours != null ? Number(log.hours) : parseWorkingHours(log.workingHours);
      const h = Math.max(0, Number(hours) || 0);
      return {
        id: log.id,
        date: log.date || ymdLocal(log.createdAt),
        createdAt: Number(log.createdAt) || 0,
        laborId: String(log.laborId || "_unmatched"),
        name: String(
          log.name ||
            (String(log.laborId || "") === "_unmatched" || !log.laborId
              ? "Unknown worker"
              : log.laborId),
        ),
        laborRecordId: log.laborRecordId || null,
        locationId: String(log.locationId || ""),
        locationName: String(log.locationName || log.locationId || ""),
        hours: round2(h),
        regularHours: round2(log.regularHours != null ? Number(log.regularHours) : Math.min(h, NORMAL_DAY_HOURS)),
        otHours: round2(log.otHours != null ? Number(log.otHours) : Math.max(0, h - NORMAL_DAY_HOURS)),
        workingHours: String(log.workingHours ?? ""),
        matched: log.matched !== false && !log.faceMismatch,
        faceMismatch: Boolean(log.faceMismatch || log.matched === false),
        slug: log.slug || null,
        photoDataUrl:
          typeof log.photoDataUrl === "string" && log.photoDataUrl.startsWith("data:image/")
            ? log.photoDataUrl
            : "",
        treePath: log.treePath || null,
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  res.json({
    groupBy,
    normalDayHours: NORMAL_DAY_HOURS,
    from: fromMs,
    to: toMs,
    filters: {
      laborId: laborIdFilter || null,
      locationId: locationIdFilter || null,
    },
    summary: {
      totalHours: round2(totalHours),
      regularHours: round2(regularHours),
      otHours: round2(otHours),
      totalRegular: round2(regularHours),
      totalOt: round2(otHours),
      records: filtered.length,
      mismatchRecords,
      days: dayMap.size,
      employees: byEmployee.length,
      rows: rows.length,
    },
    byEmployee,
    rows,
    records,
  });
});

function runJobCardExport(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [JOB_CARD_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    let err = "";
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `Job Card export failed (${code})`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// GET /api/reports/job-card.xlsx — official Job Card workbook from attendance
app.get("/api/reports/job-card.xlsx", async (req, res) => {
  try {
    const laborIdFilter = String(req.query.laborId || "").trim();
    const locationIdFilter = String(req.query.locationId || "").trim();
    const fromYmd =
      String(req.query.from || "").trim().slice(0, 10) || ymdLocal(Date.now());
    const toYmd = String(req.query.to || "").trim().slice(0, 10) || fromYmd;

    const logs = await listAllAttendance();
    // Job Card range is work dates (log.date), not submit/createdAt timestamps.
    const filtered = logs.filter((log) => {
      const date = String(log.date || ymdLocal(log.createdAt) || "").slice(0, 10);
      if (fromYmd && date && date < fromYmd) return false;
      if (toYmd && date && date > toYmd) return false;
      const lid = String(log.laborId || "_unmatched");
      if (laborIdFilter && lid !== laborIdFilter) return false;
      if (locationIdFilter && String(log.locationId) !== locationIdFilter) return false;
      return true;
    });

    const users = await listUsers();
    const empMap = new Map();
    for (const u of users) {
      const lid = String(u.laborId || "").trim();
      if (!lid) continue;
      if (laborIdFilter && lid !== laborIdFilter) continue;
      empMap.set(lid, { laborId: lid, name: String(u.name || lid) });
    }
    for (const log of filtered) {
      const lid = String(log.laborId || "").trim();
      if (!lid || lid === "_unmatched") continue;
      if (!empMap.has(lid)) {
        empMap.set(lid, {
          laborId: lid,
          name: String(log.name || lid),
        });
      }
    }

    // Aggregate hours per date|labor|location (same day+loc sums)
    const agg = new Map();
    for (const log of filtered) {
      const lid = String(log.laborId || "").trim();
      if (!lid || lid === "_unmatched") continue;
      const date = String(log.date || ymdLocal(log.createdAt) || "").slice(0, 10);
      const locName = String(log.locationName || log.locationId || "").trim();
      const hrs =
        log.hours != null ? Number(log.hours) : parseWorkingHours(log.workingHours);
      if (!Number.isFinite(hrs) || hrs === 0) continue;
      const key = `${date}|${lid}|${locName}`;
      const prev = agg.get(key);
      if (prev) prev.hours = round2(prev.hours + hrs);
      else {
        agg.set(key, {
          date,
          laborId: lid,
          // Prefer labor-store name so employee renames show on re-export
          name: String(empMap.get(lid)?.name || log.name || lid),
          locationName: locName,
          hours: round2(hrs),
        });
      }
    }

    // Full labor roster for name→column matching; sheets keep template headers
    // even when a worker has no hours in the period.
    const employees = [...empMap.values()];

    const buf = await runJobCardExport({
      from: fromYmd,
      to: toYmd,
      employees,
      entries: [...agg.values()],
    });

    const fname = `Job_Card_${fromYmd}_to_${toYmd}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Job Card export failed.",
    });
  }
});

// --- Timesheet image upload + OCR ---
app.get("/api/timesheets", async (_req, res) => {
  try {
    res.json({ sheetLocations: SHEET_LOCATIONS, items: await listTimesheets() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "List failed." });
  }
});

app.get("/api/timesheets/:id", async (req, res) => {
  try {
    const row = await getTimesheet(req.params.id);
    if (!row) return res.status(404).json({ error: "Timesheet not found." });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Load failed." });
  }
});

app.post("/api/timesheets/upload", async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : null;
    if (files?.length) {
      const out = [];
      for (const f of files) {
        const expanded = await uploadTimesheetInput({
          fileName: f.fileName || f.name,
          dataUrl: f.dataUrl || f.photoDataUrl,
        });
        out.push(...expanded);
      }
      return res.json({ ok: true, items: out });
    }
    const dataUrl = req.body?.dataUrl || req.body?.photoDataUrl;
    const fileName = req.body?.fileName || req.body?.name;
    if (!dataUrl) {
      return res.status(400).json({ error: "dataUrl (JPEG/PNG/PDF) is required." });
    }
    const items = await uploadTimesheetInput({ fileName, dataUrl });
    // Single-file callers historically expected one object; keep that when one page.
    if (items.length === 1) return res.json(items[0]);
    res.json({ ok: true, items });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
  }
});

app.put("/api/timesheets/:id", async (req, res) => {
  try {
    const updated = await updateTimesheetParsed(req.params.id, req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Update failed." });
  }
});

app.post("/api/timesheets/:id/commit", async (req, res) => {
  try {
    const result = await commitTimesheet(req.params.id, {
      replace: Boolean(req.body?.replace),
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Commit failed." });
  }
});

app.post("/api/timesheets/seed", async (req, res) => {
  try {
    const commit = req.body?.commit !== false;
    const result = await seedSampleTimesheets({ commit });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Seed failed." });
  }
});

await ensureJson(LOCATIONS_FILE);
await ensureJson(LINKS_FILE);
const migrated = await migrateFlatToUsers();
const treeMig = await migrateAttendanceToTree();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`WH backend listening on http://0.0.0.0:${PORT}`);
  console.log(`Face engine: InsightFace buffalo_l (ArcFace)`);
  console.log(`Timesheet OCR: easyocr (fallback tesseract) — review before commit`);
  console.log(`Users migrated/loaded: ${migrated.users} under data/user/`);
  console.log(
    `Attendance tree: ${treeMig.treeRecords} records (moved ${treeMig.moved}) under data/attendance/`,
  );
});

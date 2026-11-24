/** Carefully transcribed sample sheets (Oct 26 – Nov 21 2026). */

function d(ymd, locations, total) {
  const locs = { ...locations };
  const sum = Object.values(locs).reduce((a, b) => a + Number(b || 0), 0);
  return {
    date: ymd,
    locations: locs,
    total: total != null ? total : sum,
    off: false,
  };
}

function off(ymd) {
  return { date: ymd, locations: {}, total: 0, off: true };
}

/** SADRUDDIN → labor 193 Shaikh Sadruddin — Scrap City + Central Workshop */
export const SEED_SADRUDDIN = {
  key: "sadruddin",
  fileName: "sadruddin.jpg",
  samplePath: "samples/sadruddin.jpg",
  employeeName: "Shaikh Sadruddin",
  laborId: "193",
  month: "October-November-2026",
  rows: [
    d("2026-10-26", { "Scrap City": 7, "Central Workshop": 3 }, 10),
    d("2026-10-27", { "Scrap City": 8, "Central Workshop": 2 }, 10),
    d("2026-10-28", { "Scrap City": 4, "Central Workshop": 6 }, 10),
    d("2026-10-29", { "Scrap City": 4, "Central Workshop": 6 }, 10),
    off("2026-10-30"),
    d("2026-10-31", { "Scrap City": 2, "Central Workshop": 8 }, 10),
    d("2026-11-01", { "Scrap City": 4, "Central Workshop": 6 }, 10),
    d("2026-11-02", { "Scrap City": 6, "Central Workshop": 4 }, 10),
    d("2026-11-03", { "Scrap City": 6, "Central Workshop": 4 }, 10),
    d("2026-11-04", { "Scrap City": 5, "Central Workshop": 5 }, 10),
    d("2026-11-05", { "Scrap City": 6, "Central Workshop": 4 }, 10),
    off("2026-11-06"),
    d("2026-11-07", { "Scrap City": 8, "Central Workshop": 2 }, 10),
    d("2026-11-08", { "Scrap City": 6, "Central Workshop": 4 }, 10),
    d("2026-11-09", { "Scrap City": 8, "Central Workshop": 2 }, 10),
    d("2026-11-10", { "Scrap City": 7, "Central Workshop": 3 }, 10),
    d("2026-11-11", { "Scrap City": 8, "Central Workshop": 2 }, 10),
    d("2026-11-12", { "Scrap City": 7, "Central Workshop": 3 }, 10),
    off("2026-11-13"),
    d("2026-11-14", { "Scrap City": 7, "Central Workshop": 3 }, 10),
    d("2026-11-15", { "Scrap City": 8, "Central Workshop": 2 }, 10),
    d("2026-11-16", { "Scrap City": 7, "Central Workshop": 3 }, 10),
    d("2026-11-17", { "Scrap City": 8, "Central Workshop": 2 }, 10),
    d("2026-11-18", { "Scrap City": 6, "Central Workshop": 4 }, 10),
    d("2026-11-19", { "Scrap City": 6, "Central Workshop": 4 }, 10),
    off("2026-11-20"),
    d("2026-11-21", { "Scrap City": 6, "Central Workshop": 4 }, 10),
  ],
};

/** 195 MOHAMMED IQBAL KARIGAR — Villa mostly 10h */
export const SEED_IQBAL = {
  key: "iqbal-karigar",
  fileName: "iqbal-karigar.jpg",
  samplePath: "samples/iqbal-karigar.jpg",
  employeeName: "Iqbal Karigar",
  laborId: "195",
  month: "November-2026",
  rows: [
    d("2026-10-26", { "Al Waha - Villa": 10 }, 10),
    d("2026-10-27", { "Al Waha - Villa": 10 }, 10),
    d("2026-10-28", { "Al Waha - Villa": 12 }, 12),
    d("2026-10-29", { "Al Waha - Villa": 10 }, 10),
    off("2026-10-30"),
    d("2026-10-31", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-01", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-02", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-03", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-04", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-05", { "Al Waha - Villa": 10 }, 10),
    off("2026-11-06"),
    d("2026-11-07", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-08", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-09", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-10", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-11", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-12", { "Al Waha - Villa": 10 }, 10),
    off("2026-11-13"),
    d("2026-11-14", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-15", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-16", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-17", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-18", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-19", { "Al Waha - Villa": 10 }, 10),
    d("2026-11-20", { "Al Waha - Villa": 2 }, 2), // sheet: F-2
    d("2026-11-21", { "Al Waha - Villa": 10 }, 10),
  ],
};

/** SALMAN MAJEED 299 — multi-location */
export const SEED_SALMAN = {
  key: "salman-majeed",
  fileName: "salman-majeed.jpg",
  samplePath: "samples/salman-majeed.jpg",
  employeeName: "Salman Majeed",
  laborId: "299",
  month: "October-November-2026",
  rows: [
    d("2026-10-26", { "Makkah Yard": 4, "Green City": 5, "DS-Plastic": 1 }, 10),
    d("2026-10-27", { "Scrap City": 2, "Central Workshop": 8 }, 10),
    d("2026-10-28", { "Central Workshop": 10 }, 10),
    d("2026-10-29", { "Central Workshop": 10 }, 10),
    off("2026-10-30"),
    d("2026-10-31", { "Central Workshop": 15 }, 15),
    d("2026-11-01", { "Scrap City": 6, "Makkah Yard": 5 }, 11),
    d("2026-11-02", { "Makkah Yard": 6, "Central Workshop": 5 }, 11),
    d("2026-11-03", { "Scrap City": 6, "Makkah Yard": 5, "Green City": 1, "Guzain Yard": 1 }, 13),
    d("2026-11-04", { "DS-Plastic": 8, "Central Workshop": 2 }, 10),
    d("2026-11-05", { "Central Workshop": 10 }, 10),
    off("2026-11-06"),
    d("2026-11-07", { "Scrap City": 7, "Green City": 3, "Central Workshop": 1 }, 11),
    d("2026-11-08", { "Green City": 11, "Central Workshop": 2 }, 13),
    d("2026-11-09", { "Green City": 10 }, 10),
    d("2026-11-10", { "Green City": 11 }, 11),
    d("2026-11-11", { "Green City": 11 }, 11),
    d("2026-11-12", { "Green City": 5, "Central Workshop": 15 }, 20),
    off("2026-11-13"),
    d("2026-11-14", { "Green City": 12, "Guzain Yard": 6 }, 18),
    // Sheet shows Green City 4 / Total 11 — use cell hours as written
    d("2026-11-15", { "Green City": 4 }, 4),
    d("2026-11-16", { "Green City": 11 }, 11),
    d("2026-11-17", { "Green City": 11 }, 11),
    d("2026-11-18", { "Green City": 7, "Central Workshop": 4 }, 11),
    d("2026-11-19", { "Green City": 11 }, 11),
    off("2026-11-20"),
    d("2026-11-21", { "Green City": 11 }, 11),
  ],
};

/** Mo TAHIR 646 — multi-location (labor may be unmatched) */
export const SEED_TAHIR = {
  key: "mo-tahir",
  fileName: "mo-tahir.jpg",
  samplePath: "samples/mo-tahir.jpg",
  employeeName: "Mo Tahir",
  laborId: "646",
  month: "October-November-2026",
  rows: [
    d("2026-10-26", { "Central Workshop": 10 }, 10),
    d("2026-10-27", { "Central Workshop": 10 }, 10),
    d("2026-10-28", { "DS-Plastic": 4, "Central Workshop": 6 }, 10),
    d("2026-10-29", { "Scrap City": 3, "Makkah Yard": 2, "DS-Plastic": 3, "Central Workshop": 2 }, 10),
    off("2026-10-30"),
    d("2026-10-31", { "Central Workshop": 10 }, 10),
    d("2026-11-01", { "Scrap City": 4, "Central Workshop": 6 }, 10),
    d("2026-11-02", { "Scrap City": 10 }, 10),
    d("2026-11-03", { "Scrap City": 6, "Makkah Yard": 5, "Green City": 1 }, 12),
    d("2026-11-04", { "DS-Plastic": 8, "Central Workshop": 2, "Guzain Yard": 1 }, 11),
    d("2026-11-05", { "Scrap City": 2, "Makkah Yard": 5, "Central Workshop": 3 }, 10),
    off("2026-11-06"),
    d("2026-11-07", { "Scrap City": 8, "Central Workshop": 2 }, 10),
    d("2026-11-08", { "Green City": 4, "Central Workshop": 9 }, 13),
    d("2026-11-09", { "Scrap City": 3, "Central Workshop": 7 }, 10),
    d("2026-11-10", { "Scrap City": 4, "Green City": 3, "Central Workshop": 3 }, 10),
    d("2026-11-11", { "Scrap City": 4, "Central Workshop": 6 }, 10),
    d("2026-11-12", { "Scrap City": 8, "Central Workshop": 6 }, 14),
    off("2026-11-13"),
    d("2026-11-14", { "Scrap City": 6, "Central Workshop": 4 }, 10),
    d("2026-11-15", { "Central Workshop": 10 }, 10),
    d("2026-11-16", { "Green City": 3, "Central Workshop": 7 }, 10),
    d("2026-11-17", { "Central Workshop": 10 }, 10),
    d("2026-11-18", { "Green City": 4, "Central Workshop": 6 }, 10),
    d("2026-11-19", { "Central Workshop": 10 }, 10),
    off("2026-11-20"),
    d("2026-11-21", { "Central Workshop": 10 }, 10),
  ],
};

export const ALL_SEEDS = [SEED_SADRUDDIN, SEED_IQBAL, SEED_SALMAN, SEED_TAHIR];

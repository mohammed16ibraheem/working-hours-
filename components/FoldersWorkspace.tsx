"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Folder,
  FolderOpen,
  Search,
  LogOut,
  Users,
  UserPlus,
  FileSpreadsheet,
  MapPin,
  ChevronRight,
  LayoutGrid,
  List,
} from "lucide-react";
import { clearSession, readSession } from "@/lib/auth";
import { listLabors } from "@/lib/laborStore";
import { listLocations } from "@/lib/locationStore";
import { CreateLaborForm } from "@/components/CreateLaborForm";
import { EmployeesPanel } from "@/components/EmployeesPanel";
import { LocationsPanel } from "@/components/LocationsPanel";
import { ReportsPanel } from "@/components/ReportsPanel";
import { fetchAttendanceReport } from "@/lib/reportsApi";

function folderFromUrl(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get("folder");
    // Old nav ids removed — map bookmarks away from deleted cards
    if (
      raw === "generate-attendance" ||
      raw === "upload-timesheets" ||
      raw === "archives" ||
      raw === "settings"
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

type FolderItem = {
  id: string;
  name: string;
  description: string;
  items: number;
  updated: string;
  icon: typeof Folder;
};

const FOLDERS: FolderItem[] = [
  {
    id: "create-labor",
    name: "Create Labor",
    description: "Add worker name, laborID, country, optional photo",
    items: 0,
    updated: "Today",
    icon: UserPlus,
  },
  {
    id: "employees",
    name: "Employees",
    description: "View and modify all Create Labor records",
    items: 0,
    updated: "Today",
    icon: Users,
  },
  {
    id: "location",
    name: "Location",
    description: "Branch and work site names for timesheets",
    items: 0,
    updated: "Today",
    icon: MapPin,
  },
  {
    id: "reports",
    name: "Reports",
    description: "Monthly and weekly labor reports",
    items: 0,
    updated: "Today",
    icon: FileSpreadsheet,
  },
];

export function FoldersWorkspace() {
  const router = useRouter();
  const [folderParam, setFolderParam] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState("omer");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string | null>(null);
  const [laborCount, setLaborCount] = useState(0);
  const [locationCount, setLocationCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);
  const [laborTick, setLaborTick] = useState(0);
  const [locationTick, setLocationTick] = useState(0);

  const opened = useMemo(
    () => (folderParam ? FOLDERS.find((f) => f.id === folderParam) || null : null),
    [folderParam],
  );

  function openFolder(folder: FolderItem) {
    setSelected(folder.id);
    setFolderParam(folder.id);
    router.push(`/folders?folder=${encodeURIComponent(folder.id)}`);
  }

  function closeFolder() {
    setSelected(null);
    setFolderParam(null);
    router.push("/folders");
  }

  async function refreshLabors() {
    try {
      const rows = await listLabors();
      setLaborCount(rows.length);
    } catch {
      /* keep last known count if backend briefly unreachable */
    }
    setLaborTick((n) => n + 1);
  }

  async function refreshLocations() {
    try {
      const rows = await listLocations();
      setLocationCount(rows.length);
    } catch {
      /* keep last known count if backend briefly unreachable */
    }
    setLocationTick((n) => n + 1);
  }

  async function refreshReportCount() {
    try {
      const report = await fetchAttendanceReport({ groupBy: "month" });
      setReportCount(report.summary.records);
    } catch {
      /* keep last known count if backend briefly unreachable */
    }
  }

  useEffect(() => {
    setFolderParam(folderFromUrl());
    const sync = () => setFolderParam(folderFromUrl());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    try {
      const session = readSession();
      if (!session) {
        router.replace("/");
        const t = window.setTimeout(() => {
          if (!cancelled && window.location.pathname.startsWith("/folders")) {
            window.location.replace("/");
          }
        }, 600);
        return () => {
          cancelled = true;
          window.clearTimeout(t);
        };
      }
      setUser(session.user);
      setReady(true);
      void refreshLabors();
      void refreshLocations();
      void refreshReportCount();
    } catch {
      setReady(true);
      window.location.replace("/");
    }
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (opened) setSelected(opened.id);
  }, [opened]);

  const folders = useMemo(() => {
    const withCounts = FOLDERS.map((f) => {
      if (f.id === "employees" || f.id === "create-labor") {
        return { ...f, items: laborCount };
      }
      if (f.id === "location") {
        return { ...f, items: locationCount };
      }
      if (f.id === "reports") {
        return { ...f, items: reportCount };
      }
      return f;
    });
    const q = query.trim().toLowerCase();
    if (!q) return withCounts;
    return withCounts.filter(
      (f) => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q),
    );
  }, [query, laborCount, locationCount, reportCount]);

  function logout() {
    clearSession();
    router.replace("/");
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Image src="/ds-logo.png" alt="Diamond Star" width={120} height={56} className="h-9 w-auto object-contain" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-[0.18em] text-green uppercase">Work Hours</p>
            <h1 className="truncate text-sm font-semibold text-green-deep sm:text-base">
              Diamond Star Labor Data
            </h1>
          </div>
          <div className="hidden items-center gap-2 rounded-xl border border-line bg-field px-3 py-2 text-sm text-muted sm:flex">
            <Users className="h-4 w-4 text-green" strokeWidth={1.75} />
            <span className="font-medium text-foreground">{user}</span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-green transition hover:border-accent hover:text-accent"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      <main
        className={`mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 ${
          opened?.id === "reports" ? "max-w-none" : "max-w-6xl"
        }`}
      >
        <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
          <div className="relative min-w-[220px] flex-1 sm:flex-none">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
              strokeWidth={1.75}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search folders"
              className="h-11 w-full rounded-xl border border-line bg-card pr-3 pl-10 text-sm outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent/15 sm:w-64"
            />
          </div>
          <div className="flex rounded-xl border border-line bg-card p-1">
            <button
              type="button"
              onClick={() => setView("grid")}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition ${
                view === "grid" ? "bg-green-deep text-white" : "text-muted hover:text-green"
              }`}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition ${
                view === "list" ? "bg-green-deep text-white" : "text-muted hover:text-green"
              }`}
              aria-label="List view"
            >
              <List className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {opened ? (
            <motion.div
              key="open"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="rounded-2xl border border-line bg-card p-5 shadow-[0_12px_40px_rgba(15,47,34,0.06)]"
            >
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    {opened.id === "create-labor" ? (
                      <UserPlus className="h-6 w-6" strokeWidth={1.75} />
                    ) : opened.id === "employees" ? (
                      <Users className="h-6 w-6" strokeWidth={1.75} />
                    ) : opened.id === "location" ? (
                      <MapPin className="h-6 w-6" strokeWidth={1.75} />
                    ) : opened.id === "reports" ? (
                      <FileSpreadsheet className="h-6 w-6" strokeWidth={1.75} />
                    ) : (
                      <FolderOpen className="h-6 w-6" strokeWidth={1.75} />
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-green-deep">{opened.name}</h3>
                    <p className="text-sm text-muted">{opened.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeFolder}
                  className="h-10 cursor-pointer rounded-xl border border-line px-3 text-sm font-semibold text-green transition hover:border-accent hover:text-accent"
                >
                  Back
                </button>
              </div>
              {opened.id === "create-labor" ? (
                <CreateLaborForm
                  onCancel={closeFolder}
                  onSaved={refreshLabors}
                />
              ) : opened.id === "employees" ? (
                <EmployeesPanel refreshKey={laborTick} onChanged={refreshLabors} />
              ) : opened.id === "location" ? (
                <LocationsPanel refreshKey={locationTick} onChanged={refreshLocations} />
              ) : opened.id === "reports" ? (
                <ReportsPanel
                  onCount={(n) => {
                    setReportCount(n);
                  }}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl border border-line bg-field px-3 py-3"
                    >
                      <FileSpreadsheet className="h-5 w-5 text-green" strokeWidth={1.75} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {opened.name} record {i + 1}
                        </p>
                        <p className="text-xs text-muted">Ready for review</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              {folders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-card/70 px-6 py-16 text-center">
                  <Folder className="mx-auto h-10 w-10 text-muted" strokeWidth={1.5} />
                  <p className="mt-3 text-sm font-semibold text-green-deep">No folders match your search</p>
                  <p className="mt-1 text-sm text-muted">Try another keyword.</p>
                </div>
              ) : view === "grid" ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {folders.map((folder, index) => {
                    const Icon = folder.icon;
                    const active = selected === folder.id;
                    return (
                      <motion.button
                        key={folder.id}
                        type="button"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03, duration: 0.28 }}
                        onClick={() => openFolder(folder)}
                        className={`group cursor-pointer rounded-2xl border bg-card p-4 text-left shadow-[0_8px_28px_rgba(15,47,34,0.04)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(15,47,34,0.08)] ${
                          active ? "border-accent ring-[3px] ring-accent/15" : "border-line hover:border-accent/50"
                        }`}
                      >
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent transition group-hover:bg-accent/15">
                            <Icon className="h-6 w-6" strokeWidth={1.75} />
                          </div>
                          <span className="rounded-full bg-field px-2 py-1 text-[11px] font-semibold text-muted">
                            {folder.items} items
                          </span>
                        </div>
                        <h3 className="text-[15px] font-semibold text-green-deep">{folder.name}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-muted">{folder.description}</p>
                        <div className="mt-4 flex items-center justify-between text-xs text-muted">
                          <span>Updated {folder.updated}</span>
                          <span className="inline-flex items-center gap-1 font-semibold text-green opacity-0 transition group-hover:opacity-100">
                            Open <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                          </span>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-line bg-card">
                  {folders.map((folder) => {
                    const Icon = folder.icon;
                    const active = selected === folder.id;
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => openFolder(folder)}
                        className={`flex w-full cursor-pointer items-center gap-3 border-b border-line px-4 py-3.5 text-left transition last:border-b-0 hover:bg-field ${
                          active ? "bg-accent/5" : ""
                        }`}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                          <Icon className="h-5 w-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-green-deep">{folder.name}</p>
                          <p className="truncate text-xs text-muted">{folder.description}</p>
                        </div>
                        <span className="hidden text-xs text-muted sm:inline">{folder.items} items</span>
                        <span className="hidden text-xs text-muted md:inline">{folder.updated}</span>
                        <ChevronRight className="h-4 w-4 text-muted" strokeWidth={1.75} />
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="mt-5 text-center text-xs text-muted">
                Powered by{" "}
                <a href="https://mdbc.co" target="_blank" rel="noreferrer" className="font-semibold text-green hover:text-accent">
                  mdbc.co
                </a>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

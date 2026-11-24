"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Lock, User, ArrowRight, LoaderCircle } from "lucide-react";
import { saveSession } from "@/lib/auth";

const VALID_USER = "omer";
const VALID_PASS = "123";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const u = username.trim().toLowerCase();
    if (!u || !password) {
      setError("Enter username and password.");
      return;
    }
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 400));
      if (u !== VALID_USER || password !== VALID_PASS) {
        throw new Error("Invalid username or password.");
      }
      saveSession(u);
      router.replace("/folders");
      window.setTimeout(() => {
        if (window.location.pathname !== "/folders") {
          window.location.replace("/folders");
        }
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setBusy(false);
    }
  }

  return (
    <motion.form
      onSubmit={onSubmit}
      noValidate
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      className="mt-8 space-y-4"
    >
      <div className="space-y-1.5">
        <label htmlFor="username" className="block text-[13px] font-semibold tracking-wide text-green">
          Username
        </label>
        <div className="relative">
          <User
            className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            id="username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            className="h-12 w-full rounded-xl border border-line bg-field pr-3.5 pl-11 text-[15px] text-foreground outline-none transition duration-200 placeholder:text-muted/70 focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[13px] font-semibold tracking-wide text-green">
          Password
        </label>
        <div className="relative">
          <Lock
            className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-12 w-full rounded-xl border border-line bg-field pr-12 pl-11 text-[15px] text-foreground outline-none transition duration-200 placeholder:text-muted/70 focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-background hover:text-green"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key="err"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-sm font-medium text-danger"
            role="alert"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <button
        type="submit"
        disabled={busy}
        className="group mt-1 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-green-deep text-[15px] font-semibold text-white shadow-[0_10px_24px_rgba(15,47,34,0.22)] transition duration-200 hover:bg-green hover:shadow-[0_12px_28px_rgba(15,47,34,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
            Logging in…
          </>
        ) : (
          <>
            Login
            <ArrowRight className="h-4 w-4 transition duration-200 group-hover:translate-x-0.5" strokeWidth={2} />
          </>
        )}
      </button>
    </motion.form>
  );
}

"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Building2, Globe2, Shield } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";

export default function Home() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.28]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(15,47,34,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(15,47,34,0.045) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse at center, black 35%, transparent 80%)",
        }}
      />

      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[460px] rounded-[28px] border border-white/90 bg-card p-7 shadow-[0_24px_60px_rgba(15,47,34,0.10)] sm:p-9"
      >
        <div className="flex flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.05 }}
          >
            <Image
              src="/ds-logo.png"
              alt="Diamond Star"
              width={220}
              height={120}
              priority
              className="h-auto w-[170px] object-contain sm:w-[196px]"
            />
          </motion.div>

          <p className="mt-5 text-[11px] font-bold tracking-[0.24em] text-green uppercase">
            Work Hours
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-[1.9rem] leading-[1.15] font-semibold tracking-tight text-green-deep sm:text-[2.15rem]">
            Diamond Star Labor Data
          </h1>
        </div>

        <LoginForm />

        <div className="mt-7 grid grid-cols-3 gap-2 border-t border-line/80 pt-5">
          {[
            { icon: Building2, label: "Enterprise" },
            { icon: Globe2, label: "Multi-site" },
            { icon: Shield, label: "Secure login" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-1 text-center"
            >
              <Icon className="h-4 w-4 text-green" strokeWidth={1.75} aria-hidden />
              <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                {label}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-5 text-center text-xs text-muted">
          Powered by{" "}
          <a
            href="https://mdbc.co"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-green transition hover:text-accent"
          >
            mdbc.co
          </a>
        </p>
      </motion.section>
    </main>
  );
}

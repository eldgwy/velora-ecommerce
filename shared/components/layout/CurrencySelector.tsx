"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DISPLAY_CURRENCY_COOKIE } from "@/shared/lib/currency-display";

/**
 * Display-currency selector (T-5.5, D23). Appears ONLY when the operator
 * configured conversion rates (server passes the available codes); the
 * preference is a first-party cookie + a router refresh so every listing
 * re-renders in the chosen display currency. This never touches the
 * settlement currency — carts and checkout always charge USD.
 */
export function CurrencySelector({
  availableCodes,
  current,
}: {
  availableCodes: string[];
  current: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);

  if (availableCodes.length === 0) return null;
  const codes = ["USD", ...availableCodes].filter(
    (code, index, all) => all.indexOf(code) === index,
  );

  const change = (next: string) => {
    setValue(next);
    startTransition(() => {
      // One-year first-party preference cookie (Not a session value).
      document.cookie = `${DISPLAY_CURRENCY_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
      router.refresh();
    });
  };

  return (
    <label
      className="relative inline-flex items-center rounded-full border border-border/70 bg-white/50 backdrop-blur-md"
      aria-label="Display currency"
    >
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className="h-10 rounded-full bg-transparent px-3 text-[13px] font-medium tracking-[0.08em] text-foreground outline-none"
      >
        {codes.map((code) => (
          <option key={code} value={code} className="text-foreground">
            {code}
          </option>
        ))}
      </select>
    </label>
  );
}

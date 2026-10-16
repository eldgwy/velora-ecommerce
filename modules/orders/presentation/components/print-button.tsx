"use client";

import { Button } from "@/shared/components/ui/button";

/** Print trigger (client-only: window.print). */
export function PrintButton() {
  return (
    <Button size="sm" type="button" onClick={() => window.print()}>
      Print
    </Button>
  );
}

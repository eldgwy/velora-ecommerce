import Navbar from "@/shared/components/layout/Navbar";
import Footer from "@/shared/components/layout/Footer";
import { CurrencySelectorMount } from "@/shared/components/layout/CurrencySelectorMount";
import type { ReactNode } from "react";

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <Navbar currencySelector={<CurrencySelectorMount />} />
      {children}
      <Footer />
    </div>
  );
}

"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  console.log("[auth] rendering SessionProvider");
  return <SessionProvider>{children}</SessionProvider>;
}

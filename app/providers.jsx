"use client";

import { SessionProvider } from "next-auth/react";

export default function Providers({ children }) {
  console.log("[auth] rendering SessionProvider");
  return <SessionProvider>{children}</SessionProvider>;
}

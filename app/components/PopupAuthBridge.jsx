"use client";

import { useEffect } from "react";

export default function PopupAuthBridge() {
  useEffect(() => {
    const isPopup = window.name === "googleAuthPopup" && !!window.opener && !window.opener.closed;
    if (!isPopup) {
      return;
    }

    console.log("[auth-popup-bridge] Popup detected on /, checking session before auto-close.");

    let cancelled = false;

    const closeIfAuthenticated = async () => {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "include",
        });

        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("application/json")) {
          console.log("[auth-popup-bridge] Session endpoint unavailable in popup.");
          return;
        }

        const session = await response.json();
        if (!session?.user || cancelled) {
          return;
        }

        console.log("[auth-popup-bridge] Session confirmed. Posting auth-success and closing popup.");

        try {
          window.opener.postMessage({ type: "auth-success" }, window.location.origin);
        } catch (error) {
          console.log("[auth-popup-bridge] Failed to post auth-success message:", error);
        }

        window.close();
      } catch (error) {
        console.log("[auth-popup-bridge] Session check failed:", error);
      }
    };

    closeIfAuthenticated();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

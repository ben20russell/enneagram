"use client";

import { useEffect } from "react";

export default function PopupDonePage() {
  useEffect(() => {
    console.log("[auth-popup] OAuth callback landed. Notifying opener and closing popup.");

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({ type: "auth-success" }, window.location.origin);
      } catch (error) {
        console.log("[auth-popup] Failed to post auth-success message:", error);
      }
    }

    const closeTimer = window.setTimeout(() => {
      window.close();
    }, 150);

    const fallbackTimer = window.setTimeout(() => {
      window.location.replace("/dashboard");
    }, 1400);

    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        padding: "24px",
      }}
    >
      <p style={{ margin: 0, color: "#36506f" }}>Sign-in successful. Closing popup...</p>
    </main>
  );
}

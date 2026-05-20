"use client";

import { useEffect, useMemo, useState } from "react";

function getInitials(nameOrEmail) {
  const value = String(nameOrEmail || "").trim();
  if (!value) return "?";

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return value.slice(0, 2).toUpperCase();
}

export default function DashboardUserHeader({
  userName,
  userEmail,
  userImage,
  showReportActiveFlash,
}) {
  const [isFlashMounted, setIsFlashMounted] = useState(Boolean(showReportActiveFlash));
  const [isFlashVisible, setIsFlashVisible] = useState(false);
  const displayName = userName || userEmail || "User";
  const avatarFallback = useMemo(
    () => getInitials(userName || userEmail),
    [userName, userEmail],
  );

  useEffect(() => {
    console.log("[dashboard-user-header] report active flash state", {
      showReportActiveFlash,
    });

    if (!showReportActiveFlash) {
      setIsFlashMounted(false);
      setIsFlashVisible(false);
      return undefined;
    }

    setIsFlashMounted(true);
    const fadeInFrame = window.requestAnimationFrame(() => {
      setIsFlashVisible(true);
    });

    const fadeOutTimer = window.setTimeout(() => {
      setIsFlashVisible(false);
    }, 2600);

    const unmountTimer = window.setTimeout(() => {
      console.log("[dashboard-user-header] report active flash hidden after timeout");
      setIsFlashMounted(false);
    }, 3000);

    return () => {
      window.cancelAnimationFrame(fadeInFrame);
      window.clearTimeout(fadeOutTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [showReportActiveFlash]);

  return (
    <div
      data-testid="dashboard-user-header"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        marginTop: "6px",
      }}
    >
      <p data-testid="dashboard-user-name" style={{ margin: 0, color: "#36506f" }}>
        Signed in as {displayName}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {isFlashMounted ? (
          <span
            data-testid="report-active-flash"
            style={{
              background: "#dcfce7",
              color: "#166534",
              border: "1px solid #86efac",
              borderRadius: "999px",
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: 700,
              lineHeight: 1.2,
              opacity: isFlashVisible ? 1 : 0,
              transition: "opacity 350ms ease",
            }}
          >
            Report Active
          </span>
        ) : null}

        {userImage ? (
          <img
            data-testid="dashboard-user-avatar-image"
            src={userImage}
            alt={`${displayName} profile`}
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "999px",
              border: "1px solid #d6e2ef",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            data-testid="dashboard-user-avatar-fallback"
            aria-label="User avatar fallback"
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "999px",
              border: "1px solid #d6e2ef",
              background: "#0a66d8",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {avatarFallback}
          </div>
        )}
      </div>
    </div>
  );
}

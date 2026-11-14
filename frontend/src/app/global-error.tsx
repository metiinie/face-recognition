"use client";

import React, { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Faceo root error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          backgroundColor: "#F6F7F9",
          color: "#0F172A",
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "440px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #E5E7EB",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
            Faceo Workspace Error
          </h1>
          <p style={{ margin: "6px 0 14px", fontSize: "13px", color: "#475569" }}>
            {error?.message || "A root application error occurred."}
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: "36px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#4F46E5",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload application
            </button>
            <a
              href="/kiosk"
              style={{
                height: "36px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "1px solid #E5E7EB",
                backgroundColor: "#FFFFFF",
                color: "#334155",
                fontSize: "13px",
                fontWeight: 500,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Open Kiosk
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}

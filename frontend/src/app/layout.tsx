import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "EIPC Face Attendance System | Dire Dawa",
  description:
    "Face Recognition-Based Attendance Management System for Ethio-Italy Polytechnic College, Dire Dawa (Version 1).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-blue-500 selection:text-white">
        <Navbar />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="mt-auto border-t border-slate-200/80 bg-white/60 py-4 text-center text-xs text-slate-500">
          <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              © 2026 Ethio-Italy Polytechnic College (EIPC), Dire Dawa, Ethiopia.
            </span>
            <span className="font-mono text-[11px] text-slate-400">
              UltraFace &amp; SFace ONNX (128-D) • OpenCV • MySQL 8 • EER &lt; 0.9%
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}


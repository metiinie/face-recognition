import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Faceo | EIPC Attendance System",
  description:
    "Face Recognition-Based Attendance Management System for Ethio-Italy Polytechnic College, Dire Dawa.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F6F7F9] text-slate-900 antialiased selection:bg-[#4F46E5] selection:text-white">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

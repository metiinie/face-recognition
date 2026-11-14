import nextConstants from "next/constants.js";

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  output: "standalone",
  // Separate dev build artifacts from production `.next` so stale cache cannot break `next dev`.
  distDir: phase === nextConstants.PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: process.env.BACKEND_API_URL
          ? `${process.env.BACKEND_API_URL}/api/:path*`
          : "http://127.0.0.1:5000/api/:path*",
      },
      {
        source: "/socket.io/:path*",
        destination: process.env.BACKEND_API_URL
          ? `${process.env.BACKEND_API_URL}/socket.io/:path*`
          : "http://127.0.0.1:5000/socket.io/:path*",
      },
    ];
  },
});

export default nextConfig;


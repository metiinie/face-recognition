/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

export default nextConfig;


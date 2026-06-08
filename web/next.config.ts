import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Add your tunnel/LAN dev origin(s) here, or via NEXT_PUBLIC_DEV_ORIGIN.
  allowedDevOrigins: [process.env.NEXT_PUBLIC_DEV_ORIGIN || 'localhost'],
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:3001/api/:path*',
      },
      {
        source: '/socket.io/:path*',
        destination: 'http://127.0.0.1:3001/socket.io/:path*',
      },
    ];
  },
};

export default nextConfig;

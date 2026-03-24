import type { NextConfig } from "next";


const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3000/api/:path*",
      },
      {
        source: "/health/:path*",
        destination: "http://localhost:3000/health/:path*",
      },
      {
        source: "/health",
        destination: "http://localhost:3000/health",
      },
    ];
  },
  webpack(config) {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['@'] = require('path').resolve(__dirname, 'src');
    return config;
  },
};

export default nextConfig;

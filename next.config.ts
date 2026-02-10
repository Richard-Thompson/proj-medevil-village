import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/data.bin.br',
        headers: [
          {
            key: 'Content-Encoding',
            value: 'br',
          },
          {
            key: 'Content-Type',
            value: 'application/octet-stream',
          },
        ],
      },
    ];
  },
};

export default nextConfig;

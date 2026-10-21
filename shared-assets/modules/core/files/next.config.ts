import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    // Vercel Hobby allows 5K transformations/month. Every unique
    // (image, width, quality, format) combo is a transformation, and each
    // cache expiry re-transforms, so keep the allowlists tight and cache long.
    minimumCacheTTL: 2678400, // 31 days
    formats: ["image/webp"],
    qualities: [75],
    deviceSizes: [640, 828, 1200, 1920],
    imageSizes: [64, 128, 256, 384],
    remotePatterns: [
      {
        protocol: "http",
        hostname: "example.com",
      },
      {
        protocol: "https",
        hostname: "example.com",
      },
      {
        protocol: "https",
        hostname: "YOUR_PROJECT_REF.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);

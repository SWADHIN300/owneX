import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker images.
  output: "standalone",
  // This app lives inside a monorepo whose root also has a lockfile (Hardhat).
  // Pinning the root stops Turbopack guessing and warning on every build.
  turbopack: {
    root: __dirname,
  },
  // Asset images are served from Supabase Storage.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
};

export default nextConfig;

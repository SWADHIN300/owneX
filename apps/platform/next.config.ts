import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle, used only by the Docker images (see
  // apps/platform/Dockerfile). It must stay off on Vercel, whose build hooks
  // expect the default output and fail on the missing *.nft.json trace files.
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
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

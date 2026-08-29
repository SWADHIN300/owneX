export function getPlatformOrigin(): string {
  if (process.env.PLATFORM_ORIGIN) return process.env.PLATFORM_ORIGIN;
  if (process.env.VERCEL_URL || process.env.NODE_ENV === "production") {
    return "https://ownex-platform.vercel.app";
  }
  return "http://localhost:3000";
}

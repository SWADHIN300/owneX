import type {NextConfig} from "next";
// `output: "standalone"` is only for the Docker image build. On Vercel it breaks
// the build, because Vercel's onBuildComplete hook expects the default output.
const config: NextConfig = {
  ...(process.env.DOCKER_BUILD === "1" ? {output: "standalone" as const} : {}),
  turbopack: {root: __dirname},
};
export default config;

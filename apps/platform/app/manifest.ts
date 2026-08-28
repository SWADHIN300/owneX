import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OwneX",
    short_name: "OwneX",
    description: "Verifiable identity, access, and ownership on Sepolia testnet.",
    start_url: "/",
    display: "standalone",
    background_color: "#def6c6",
    theme_color: "#00614f",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}

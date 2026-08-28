import { ImageResponse } from "next/og";

export const alt = "OwneX - Own it. Prove it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#def6c6",
          color: "#052e29",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "72px",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>
          owneX
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 800 }}>
            Own it. Prove it.
          </div>
          <div style={{ display: "flex", fontSize: 34, lineHeight: 1.25, maxWidth: 930 }}>
            Wallet-bound identity, organization access, and asset custody on
            Sepolia testnet.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 26, fontWeight: 600 }}>
          3 contracts | 93 contract tests | Testnet only
        </div>
      </div>
    ),
    size,
  );
}

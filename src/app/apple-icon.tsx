import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #191a20 0%, #121215 100%)",
          position: "relative",
        }}
      >
        <div
          style={{
            width: 156,
            height: 156,
            borderRadius: 36,
            border: "3px solid #2a2a32",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(18, 18, 21, 0.65)",
          }}
        >
          <svg
            width="124"
            height="124"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 8V6a2 2 0 0 1 2-2h2"
              stroke="#f5f2eb"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 16v2a2 2 0 0 0 2 2h2"
              stroke="#f5f2eb"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M16 4h2a2 2 0 0 1 2 2v2"
              stroke="#f5f2eb"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M16 20h2a2 2 0 0 0 2-2v-2"
              stroke="#f5f2eb"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="4" fill="rgba(245, 158, 11, 0.18)" />
            <circle cx="12" cy="12" r="2.6" fill="#fbbf24" />
          </svg>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

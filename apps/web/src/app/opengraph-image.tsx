import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { wordmarkPaths } from "@/components/wordmarkPaths";

export const alt = "Teak - A personal knowledge hub for creative minds";

export const size = {
  width: 1200 * 1.25,
  height: 630 * 1.25,
};

export const contentType = "image/png";

const backgroundImage =
  "https://images.unsplash.com/photo-1697566948377-5660892e9130?auto=format&fit=crop&w=2400&q=80";

const taglineLineOne = "Personal knowledge hub";
const taglineLineTwo = "for creative minds.";

const snPro = readFile(
  path.join(process.cwd(), "src/app/assets/SNPro-ExtraBold.ttf")
).then(
  (font) =>
    font.buffer.slice(
      font.byteOffset,
      font.byteOffset + font.byteLength
    ) as ArrayBuffer
);

export default async function Image() {
  const snProData = await snPro;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#000000",
      }}
    >
      <img
        alt=""
        height={size.height}
        src={backgroundImage}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
        }}
        width={size.width}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          fontFamily: "SN Pro",
          fontSize: 80,
          fontWeight: 800,
          letterSpacing: "-0.035em",
          lineHeight: 1.2,
          color: "#ffffff",
        }}
      >
        <span>{taglineLineOne}</span>
        <span>{taglineLineTwo}</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 48,
          display: "flex",
          justifyContent: "center",
          color: "rgba(255, 255, 255, 1)",
        }}
      >
        <svg
          fill="currentColor"
          height="42"
          viewBox="0 0 260 92"
          width="120"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Teak</title>
          {wordmarkPaths()}
        </svg>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "SN Pro",
          data: snProData,
          style: "normal",
          weight: 800,
        },
      ],
    }
  );
}

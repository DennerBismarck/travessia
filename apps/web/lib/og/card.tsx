import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

async function loadFonts() {
  const dir = join(process.cwd(), "assets/fonts");
  const [regular, semibold] = await Promise.all([
    readFile(join(dir, "instrument-sans-latin-400-normal.woff")),
    readFile(join(dir, "instrument-sans-latin-600-normal.woff")),
  ]);
  return [
    { name: "Instrument Sans", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Instrument Sans", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
}

export async function renderCard(input: { eyebrow: string; title: string; lines: string[]; footer: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#F6F7F5",
          color: "#1B2433",
          fontFamily: "Instrument Sans",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 26, color: "#6A7178" }}>{input.eyebrow}</div>
          <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -1.5 }}>{input.title}</div>
          {input.lines.map((line) => (
            <div key={line} style={{ fontSize: 38 }}>
              {line}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <svg width="1056" height="26" viewBox="0 0 1056 26">
            <line x1="0" y1="5" x2="1056" y2="5" stroke="#0E8C7F" strokeWidth="4" strokeDasharray="14 10" />
            <line x1="0" y1="21" x2="1056" y2="21" stroke="#0052FF" strokeWidth="4" />
          </svg>
          <div style={{ fontSize: 24, color: "#6A7178" }}>{input.footer}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: await loadFonts() },
  );
}

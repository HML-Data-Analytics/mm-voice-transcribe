import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Burmese Voice → Text · Whisper Large V3",
  description:
    "Record or upload voice and transcribe Burmese speech with the open-source Whisper Large V3 (Chonlasitk) model.",
};

export const viewport: Viewport = {
  themeColor: "#0b0b16",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

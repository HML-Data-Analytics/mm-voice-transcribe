import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight diagnostics endpoint. Reports whether the server env is wired up
// WITHOUT ever exposing the token value (only its presence + length).
export async function GET() {
  const token = process.env.HF_TOKEN || "";
  return NextResponse.json({
    ok: true,
    hasToken: token.length > 0,
    tokenLength: token.length,
    tokenLooksValid: /^hf_[A-Za-z0-9]{20,}$/.test(token),
    model: process.env.HF_MODEL || "openai/whisper-large-v3",
    hasCustomEndpoint: Boolean(process.env.HF_ENDPOINT_URL),
    node: process.version,
    time: new Date().toISOString(),
  });
}

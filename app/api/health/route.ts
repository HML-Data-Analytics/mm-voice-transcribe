import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Minimal valid 16 kHz mono WAV (0.1s of silence) for probing HF.
function tinyWav(): Buffer {
  const sampleRate = 16000;
  const data = Buffer.alloc(1600 * 2); // silence
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Lightweight diagnostics endpoint. Reports whether the server env is wired up
// WITHOUT ever exposing the token value (only its presence + length).
// Add ?probe=1 to make a quick, non-blocking call to the HF router and report
// the raw status/body so we can see if the model is served / warming / cold.
export async function GET(req: Request) {
  const token = process.env.HF_TOKEN || "";
  const model = process.env.HF_MODEL || "openai/whisper-large-v3";
  const base = {
    ok: true,
    hasToken: token.length > 0,
    tokenLength: token.length,
    tokenLooksValid: /^hf_[A-Za-z0-9]{20,}$/.test(token),
    model,
    hasCustomEndpoint: Boolean(process.env.HF_ENDPOINT_URL),
    node: process.version,
    time: new Date().toISOString(),
  };

  const url = new URL(req.url);
  if (!url.searchParams.get("probe") || !token) {
    return NextResponse.json(base);
  }

  const probeModel = url.searchParams.get("model") || model;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 22_000);
  let probe: Record<string, unknown>;
  try {
    const started = Date.now();
    const r = await fetch(
      `https://router.huggingface.co/hf-inference/models/${probeModel}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "audio/wav",
          Accept: "application/json",
        },
        body: tinyWav(),
        signal: ctrl.signal,
      }
    );
    const body = await r.text().catch(() => "");
    probe = {
      probeModel,
      status: r.status,
      ms: Date.now() - started,
      body: body.slice(0, 400),
    };
  } catch (err) {
    probe = {
      probeModel,
      status: (err as any)?.name === "AbortError" ? "timeout(22s)" : "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }

  return NextResponse.json({ ...base, probe });
}

import { NextResponse } from "next/server";

// Run on the Node.js runtime (streaming binary bodies to HF).
export const runtime = "nodejs";
// Never cache transcription responses.
export const dynamic = "force-dynamic";
// Give the request room to breathe while the model warms up / transcribes.
export const maxDuration = 60;

const MODEL = process.env.HF_MODEL || "Chonlasitk/whisper-burmese";
const HF_URL = `https://api-inference.huggingface.co/models/${MODEL}`;

// Max audio size accepted by the route. Vercel serverless bodies are capped
// (~4.5 MB on Hobby), so we reject early with a friendly message.
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

export async function POST(req: Request) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Server is missing HF_TOKEN. Add it in your environment (.env.local) or Vercel project settings.",
      },
      { status: 500 }
    );
  }

  let bytes: ArrayBuffer;
  let contentType = "application/octet-stream";

  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No audio file was provided in the 'audio' field." },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "The audio file is empty." },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            "Audio is too large (limit ~4 MB on this deployment). Record a shorter clip or upload a smaller/compressed file.",
        },
        { status: 413 }
      );
    }
    if (file.type) contentType = file.type;
    bytes = await file.arrayBuffer();
  } catch {
    return NextResponse.json(
      { error: "Could not read the uploaded audio." },
      { status: 400 }
    );
  }

  // The HF model can be cold. Retry a few times while it loads (503 + estimated_time).
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let hfRes: Response;
    try {
      hfRes = await fetch(HF_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
          Accept: "application/json",
          "x-wait-for-model": "true",
        },
        body: bytes,
      });
    } catch {
      return NextResponse.json(
        { error: "Could not reach the Hugging Face Inference API." },
        { status: 502 }
      );
    }

    if (hfRes.ok) {
      const data = await hfRes.json().catch(() => null);
      const text =
        (data && (data.text ?? data?.[0]?.text)) ?? "";
      if (typeof text !== "string") {
        return NextResponse.json(
          { error: "Unexpected response from the model." },
          { status: 502 }
        );
      }
      return NextResponse.json({ text: text.trim(), model: MODEL });
    }

    // Model still loading — wait and retry.
    if (hfRes.status === 503 && attempt < maxAttempts) {
      const info = await hfRes.json().catch(() => null);
      const waitMs = Math.min(
        Math.round(((info?.estimated_time as number) || 8) * 1000),
        20000
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    // Other errors — surface a clean message.
    const detail = await hfRes.text().catch(() => "");
    if (hfRes.status === 401 || hfRes.status === 403) {
      return NextResponse.json(
        { error: "Hugging Face rejected the token (401/403). Check HF_TOKEN." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      {
        error: `Transcription failed (HF status ${hfRes.status}).`,
        detail: detail?.slice(0, 300),
      },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { error: "The model is still warming up. Please try again in a moment." },
    { status: 503 }
  );
}

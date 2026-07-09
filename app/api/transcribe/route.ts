import { NextResponse } from "next/server";

// Run on the Node.js runtime (streaming binary bodies to HF).
export const runtime = "nodejs";
// Never cache transcription responses.
export const dynamic = "force-dynamic";
// Give the request room to breathe while the model warms up / transcribes.
export const maxDuration = 60;

// Default model for the "cloud" mode. This must be a model that is actually
// served by an HF inference provider. The Chonlasitk Burmese fine-tune is NOT
// hosted by any provider, so use it via the "custom endpoint" mode instead.
const DEFAULT_MODEL = process.env.HF_MODEL || "openai/whisper-large-v3";

// Hugging Face migrated the classic serverless endpoint
// (api-inference.huggingface.co, now decommissioned) to the Inference
// Providers router. `hf-inference` is HF's own first-party provider.
const routerUrl = (model: string) =>
  `https://router.huggingface.co/hf-inference/models/${model}`;

// Max audio size accepted by the route. Vercel serverless bodies are capped
// (~4.5 MB on Hobby), so we reject early with a friendly message.
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

function pickText(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === "string") return data;
  const d = data as Record<string, unknown> & { data?: unknown[] };
  if (typeof d.text === "string") return d.text;
  if (Array.isArray(data) && typeof (data[0] as any)?.text === "string") {
    return (data[0] as any).text;
  }
  // Gradio-style { data: [ "..." ] } responses.
  if (Array.isArray(d.data) && typeof d.data[0] === "string") return d.data[0];
  return null;
}

export async function POST(req: Request) {
  const token = process.env.HF_TOKEN;

  let bytes: ArrayBuffer;
  let contentType = "application/octet-stream";
  let mode = "cloud";
  let model = DEFAULT_MODEL;
  let endpoint = process.env.HF_ENDPOINT_URL || "";

  try {
    const form = await req.formData();
    const file = form.get("audio");
    mode = (form.get("mode") as string) || "cloud";
    model = (form.get("model") as string) || DEFAULT_MODEL;
    endpoint = (form.get("endpoint") as string) || endpoint;

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No audio file was provided in the 'audio' field." },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The audio file is empty." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            "Audio is too large (limit ~4 MB on this deployment). Record a shorter clip, upload a smaller file, or switch to On-device mode which has no size limit.",
        },
        { status: 413 }
      );
    }
    if (file.type) contentType = file.type;
    bytes = await file.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded audio." }, { status: 400 });
  }

  // Resolve the target endpoint + headers for the selected mode.
  let targetUrl: string;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    Accept: "application/json",
  };

  if (mode === "custom") {
    if (!endpoint) {
      return NextResponse.json(
        { error: "Custom endpoint mode needs an endpoint URL." },
        { status: 400 }
      );
    }
    try {
      new URL(endpoint);
    } catch {
      return NextResponse.json({ error: "The custom endpoint URL is invalid." }, { status: 400 });
    }
    targetUrl = endpoint;
    // Token is optional for custom endpoints; attach it if present.
    if (token) headers.Authorization = `Bearer ${token}`;
  } else {
    if (!token) {
      return NextResponse.json(
        {
          error:
            "Server is missing HF_TOKEN. Add it in .env.local or your Vercel project settings, or switch to On-device mode.",
        },
        { status: 500 }
      );
    }
    targetUrl = routerUrl(model);
    headers.Authorization = `Bearer ${token}`;
    headers["x-wait-for-model"] = "true";
  }

  // The model can be cold. Retry while it loads (503 + estimated_time), but
  // stay under the function time limit so we always return clean JSON instead
  // of letting the platform kill the request with an HTML error page.
  const maxAttempts = 4;
  const deadline = Date.now() + 45_000; // leave headroom under maxDuration (60s)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let hfRes: Response;
    try {
      hfRes = await fetch(targetUrl, { method: "POST", headers, body: bytes });
    } catch {
      return NextResponse.json(
        {
          error:
            mode === "custom"
              ? "Could not reach the custom endpoint. Check the URL is live and reachable."
              : "Could not reach the Hugging Face inference router.",
        },
        { status: 502 }
      );
    }

    if (hfRes.ok) {
      const ct = hfRes.headers.get("content-type") || "";
      const data = ct.includes("application/json")
        ? await hfRes.json().catch(() => null)
        : await hfRes.text().catch(() => null);
      const text = pickText(data);
      if (typeof text !== "string") {
        return NextResponse.json(
          { error: "Unexpected response from the model." },
          { status: 502 }
        );
      }
      return NextResponse.json({ text: text.trim(), model: mode === "custom" ? endpoint : model });
    }

    // Model still loading — wait and retry, but only if there's time left.
    if (hfRes.status === 503 && attempt < maxAttempts) {
      const info = await hfRes.json().catch(() => null);
      const waitMs = Math.min(
        Math.round((((info as any)?.estimated_time as number) || 8) * 1000),
        10000
      );
      if (Date.now() + waitMs < deadline) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      // No time left — bail out cleanly instead of risking a platform timeout.
      return NextResponse.json(
        {
          error:
            "The model is warming up on Hugging Face. Wait ~20s and try again — the first request after idle loads the model. (Or use On-device mode, which has no cold start.)",
        },
        { status: 503 }
      );
    }

    // Other errors — surface a clean message.
    const detail = await hfRes.text().catch(() => "");
    if (hfRes.status === 401 || hfRes.status === 403) {
      return NextResponse.json(
        {
          error:
            mode === "custom"
              ? "The custom endpoint rejected the request (401/403). It may need a token."
              : "Hugging Face rejected the token (401/403). The token likely lacks Inference permission — create a token with \"Make calls to Inference Providers\" enabled (or a classic Read token), and make sure it's set in the server env and redeployed.",
          detail: detail?.slice(0, 300),
        },
        { status: 502 }
      );
    }
    if (hfRes.status === 404) {
      return NextResponse.json(
        {
          error:
            mode === "custom"
              ? `Endpoint returned 404. Double-check the URL: ${endpoint}`
              : `Model "${model}" is not served by the hf-inference provider (404). Pick a hosted model, or use Custom endpoint / On-device mode.`,
          detail: detail?.slice(0, 300),
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: `Transcription failed (status ${hfRes.status}).`, detail: detail?.slice(0, 300) },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { error: "The model is still warming up. Please try again in a moment." },
    { status: 503 }
  );
}

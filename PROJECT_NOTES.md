# Project Notes — mm-voice-transcribe

Personal orientation notes on this repo, written after reading the source. For the official docs (setup, deploy, config table), see [README.md](README.md).

## What it is

A single-page Next.js 14 app called "Burmese Voice → Text". You record audio in
the browser (or upload a file) and get back a Burmese transcript. There's no
database, no auth, no backend state — it's a thin UI + one API route in front
of Whisper, plus a fully client-side inference path.

## The three modes, and why they exist

The interesting design decision in this repo is that there's no single "right"
way to run Whisper for Burmese, so the app supports three, switchable at
runtime:

| Mode | Runs where | Why it exists |
|---|---|---|
| **Cloud** | `app/api/transcribe/route.ts` → Hugging Face Inference Providers router | Fastest to try, no setup beyond an `HF_TOKEN` |
| **On-device** | Browser, via `@huggingface/transformers` in a Web Worker (WebGPU→WASM) | No token, no size limit, audio never leaves the device |
| **Custom** | Any URL you paste in | Route to your own hosted `Chonlasitk/whisper-burmese` fine-tune (the best Burmese-specific model), since HF's free serverless tier won't serve it directly |

The `Chonlasitk/whisper-burmese` fine-tune is the whole reason Custom mode
exists — HF's shared inference API only serves models a provider has deployed,
and community fine-tunes without a provider mapping can't be called through
it. So "best accuracy" requires self-hosting (HF Space / Inference Endpoint /
Modal / Runpod) and pointing Custom mode at it.

## `app/api/transcribe/route.ts` — the one server route

This file is small but has clearly been hardened by trial and error against
real Vercel/HF failure modes. Worth knowing before touching it:

- **Model choice is load-bearing.** `openai/whisper-large-v3-turbo` is used
  instead of plain `whisper-large-v3` because the non-turbo model cold-starts
  slower than Vercel's function limit and always 504s. There's an automatic
  swap (`resolveModel`) so a stale `HF_MODEL` env var can't silently break
  things.
- **No `x-wait-for-model` header.** That HF header blocks until a cold model
  loads, which can outlast the serverless timeout and return an HTML 504 page
  instead of JSON. Instead the route lets HF return `503` immediately and
  does its own bounded retry loop (up to 5 attempts, 45s internal deadline,
  under the 60s `maxDuration`), always returning clean JSON.
- **4 MB body cap**, because Vercel Hobby caps request bodies around ~4.5 MB.
  This is the reason On-device mode exists as more than a nice-to-have — it's
  the only path with no size limit.
- **Response shape is untrusted and normalized** (`pickText`) — handles plain
  string, `{ text }`, `[{ text }]`, and Gradio-style `{ data: [...] }` shapes,
  since Cloud and Custom targets can differ.

## `app/page.tsx` — everything else

One large client component (~590 lines) holding all UI state: MediaRecorder-based
recording with a timer, file upload with MIME validation, Web Audio
decode/resample to 16kHz mono PCM (Whisper's expected input), mode/model/
endpoint preferences persisted to `localStorage`, and a Web Worker for
on-device inference. The worker script is loaded from a CDN string at
runtime rather than bundled — there's a comment noting this avoids needing
any bundler/worker config.

There's also `app/api/health/route.ts` (GET, checks `HF_TOKEN` presence and
optionally live-probes the HF router with `?probe=1`) — useful for debugging
Cloud-mode setup, not mentioned in the README.

## Stack

Next.js 14 (App Router) · React 18 · TypeScript (strict) · `@huggingface/transformers`
(client-only, via CDN) · Hugging Face Inference Providers router · deploys to Vercel.
No database, no server-side ML deps — `package.json` only lists `next`/`react`/`react-dom`.

## Quick start

```bash
npm install
cp .env.example .env.local   # set HF_TOKEN for Cloud mode (skip it to just try On-device)
npm run dev                  # http://localhost:3000
```

## If I were extending this

- Adding a new Cloud model: must be checked against hf-inference's "served +
  warm" constraint first, or it'll silently 504/400 the way plain
  `large-v3` did.
- Adding persistence (saved transcripts, history) would be new territory —
  currently everything is ephemeral except UI preferences in `localStorage`.
- The health route (`/api/health`) is worth surfacing in the UI or docs if
  Cloud-mode setup issues come up often.

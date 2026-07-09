# 🎙️ Burmese Voice → Text

A clean, colorful web app that **records voice on the fly** or **accepts uploaded audio** and transcribes **Burmese (Myanmar) speech** with Whisper. Pick how it runs — in the **cloud**, fully **on your device**, or on your **own model endpoint** (e.g. the [`Chonlasitk/whisper-burmese`](https://huggingface.co/Chonlasitk/whisper-burmese) Large V3 fine-tune).

Built with **Next.js (App Router)** and ready to **deploy on Vercel**.

![stack](https://img.shields.io/badge/Next.js-14-black) ![vercel](https://img.shields.io/badge/Deploy-Vercel-black)

---

## ✨ Features

- 🎤 **Live recording** in the browser (MediaRecorder) with a timer
- 📁 **Upload** any audio file (`.webm`, `.wav`, `.mp3`, `.m4a`, …)
- ▶️ **Audio preview** before transcribing
- 🔀 **Three transcription modes** you switch between in the UI
- 📋 One-tap **copy** of the transcript
- 🌈 Colorful, animated AI-style controls with a clean glass UI
- 📱 Fully **responsive** — mobile, tablet, laptop, desktop
- ♿ Respects `prefers-reduced-motion`

---

## 🔀 The three modes

| Mode | Where it runs | Model | Needs token? | Best for |
| ---- | ------------- | ----- | ------------ | -------- |
| ☁️ **Cloud** | Hugging Face router (server route) | `openai/whisper-large-v3-turbo` (configurable) | ✅ `HF_TOKEN` | Works instantly, no download |
| 🖥️ **On-device** | 100% in the browser via [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) (WebGPU → WASM) | `whisper-base` / `small` / `large-v3-turbo` | ❌ none | Real offline, private — audio never leaves the device |
| 🔗 **Custom** | Your own endpoint | Anything, e.g. `Chonlasitk/whisper-burmese` | optional | Best Burmese accuracy with the fine-tune |

> **Why not host the Chonlasitk fine-tune directly?** Hugging Face's free serverless hosting only serves models a provider has deployed, and that community fine-tune has **no provider mapping** — so it can't be called through the shared API. Run it yourself (an HF Space, an Inference Endpoint, or a small FastAPI on Modal/Runpod) and paste the URL into **Custom** mode. On-device mode gives you a real offline path today using the standard multilingual Whisper weights.

---

## 🚀 Quick start (local)

```bash
# 1. Install dependencies
npm install

# 2. (For Cloud mode) add your Hugging Face token
cp .env.example .env.local
#   then edit .env.local and set HF_TOKEN=hf_xxx
#   (create a free "Read" token at https://huggingface.co/settings/tokens)
#   On-device mode needs no token.

# 3. Run the dev server
npm run dev
```

Open http://localhost:3000

> **Cloud:** the first request after idle may take ~10–20s while the model warms up — the app retries automatically.
> **On-device:** the first run downloads the model (cached afterward); a WebGPU-capable browser (recent Chrome/Edge) is much faster than the WASM fallback.

---

## ☁️ Deploy to Vercel

1. Push this folder to a GitHub repo (see **Git** below).
2. Go to [vercel.com/new](https://vercel.com/new) and **import** the repo.
3. In **Project Settings → Environment Variables**, add (only needed for Cloud mode):
   | Name       | Value                        |
   | ---------- | ---------------------------- |
   | `HF_TOKEN` | your Hugging Face token      |
   | `HF_MODEL` | `openai/whisper-large-v3-turbo` (optional) |
4. Click **Deploy**. Vercel auto-detects Next.js — no extra config needed.

Or with the CLI:

```bash
npm i -g vercel
vercel        # preview
vercel --prod # production
```

---

## 🧩 Git (push-ready)

```bash
git init
git add .
git commit -m "Burmese voice transcription app"
git branch -M main
git remote add origin https://github.com/<you>/mm-voice-transcribe.git
git push -u origin main
```

`.env*` files are already git-ignored, so your token never gets committed.

---

## ⚙️ Configuration

| Variable         | Required | Default                    | Description                                             |
| ---------------- | -------- | -------------------------- | ------------------------------------------------------- |
| `HF_TOKEN`       | Cloud only | —                        | Hugging Face access token (Read scope).                 |
| `HF_MODEL`       | no       | `openai/whisper-large-v3-turbo`  | Cloud-mode model — must be **served + warm** on hf-inference (turbo works; plain large-v3 cold-starts and times out). |
| `HF_ENDPOINT_URL`| no       | —                          | Default URL for Custom mode (overridable in the UI).    |

---

## 📝 Notes & limits

- **Body size (Cloud & Custom):** Vercel serverless requests are capped (~4.5 MB on Hobby). The API route rejects audio over **4 MB** — record shorter clips, compress, or use **On-device** mode which has **no size limit**.
- **On-device requirements:** loads `@huggingface/transformers` and the model from a CDN on first use, then caches. WebGPU (Chrome/Edge) gives near-real-time speed; other browsers fall back to slower WASM.
- **HTTPS required** for microphone access (Vercel provides this automatically; `localhost` is also allowed).

---

## 🗂️ Project structure

```
app/
  api/transcribe/route.ts   # serverless route → HF router (Cloud) or your endpoint (Custom)
  globals.css               # colorful, responsive styles
  layout.tsx                # root layout + metadata
  page.tsx                  # record / upload UI + mode switch + on-device worker
.env.example                # HF_TOKEN / HF_MODEL / HF_ENDPOINT_URL template
```

---

## 📄 License

MIT. Models © their respective authors — see the [Chonlasitk model card](https://huggingface.co/Chonlasitk/whisper-burmese).

# 🎙️ Burmese Voice → Text

A clean, colorful web app that **records voice on the fly** or **accepts uploaded audio** and transcribes **Burmese (Myanmar) speech** using the open-source **Whisper Large V3** fine-tune [`Chonlasitk/whisper-burmese`](https://huggingface.co/Chonlasitk/whisper-burmese), served through the Hugging Face Inference API.

Built with **Next.js (App Router)** and ready to **deploy on Vercel**.

![stack](https://img.shields.io/badge/Next.js-14-black) ![vercel](https://img.shields.io/badge/Deploy-Vercel-black)

---

## ✨ Features

- 🎤 **Live recording** in the browser (MediaRecorder) with a timer
- 📁 **Upload** any audio file (`.webm`, `.wav`, `.mp3`, `.m4a`, …)
- ▶️ **Audio preview** before transcribing
- 🧠 **Whisper Large V3 Burmese** transcription via Hugging Face
- 📋 One-tap **copy** of the transcript
- 🌈 Colorful, animated AI-style controls with a clean glass UI
- 📱 Fully **responsive** — mobile, tablet, laptop, desktop
- ♿ Respects `prefers-reduced-motion`

---

## 🚀 Quick start (local)

```bash
# 1. Install dependencies
npm install

# 2. Add your Hugging Face token
cp .env.example .env.local
#   then edit .env.local and set HF_TOKEN=hf_xxx
#   (create a free "Read" token at https://huggingface.co/settings/tokens)

# 3. Run the dev server
npm run dev
```

Open http://localhost:3000

> The **first** transcription after idle may take ~10–20s while the model warms up on Hugging Face — the app retries automatically.

---

## ☁️ Deploy to Vercel

1. Push this folder to a GitHub repo (see **Git** below).
2. Go to [vercel.com/new](https://vercel.com/new) and **import** the repo.
3. In **Project Settings → Environment Variables**, add:
   | Name       | Value                        |
   | ---------- | ---------------------------- |
   | `HF_TOKEN` | your Hugging Face token      |
   | `HF_MODEL` | `Chonlasitk/whisper-burmese` (optional) |
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

| Variable   | Required | Default                     | Description                                   |
| ---------- | -------- | --------------------------- | --------------------------------------------- |
| `HF_TOKEN` | ✅ yes   | —                           | Hugging Face access token (Read scope).       |
| `HF_MODEL` | no       | `Chonlasitk/whisper-burmese`| Any HF automatic-speech-recognition model.    |

---

## 📝 Notes & limits

- **Body size:** Vercel serverless requests are capped (~4.5 MB on Hobby). The API route rejects audio over **4 MB** with a friendly message — record shorter clips or upload a compressed file. For long audio, host the frontend on Vercel and point it at a dedicated GPU backend (HF Space / Modal / Runpod).
- **Not literally offline:** the model *is* open source, but here it runs on Hugging Face's servers (chosen for a lightweight, Vercel-friendly deploy). For a fully offline/in-browser variant, swap the API route for `@huggingface/transformers` running in the client.
- **HTTPS required** for microphone access (Vercel provides this automatically; `localhost` is also allowed).

---

## 🗂️ Project structure

```
app/
  api/transcribe/route.ts   # serverless route → Hugging Face Inference API
  globals.css               # colorful, responsive styles
  layout.tsx                # root layout + metadata
  page.tsx                  # record / upload / transcribe UI
.env.example                # HF_TOKEN + HF_MODEL template
```

---

## 📄 License

MIT. Model © its respective authors — see the [model card](https://huggingface.co/Chonlasitk/whisper-burmese).

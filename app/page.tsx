"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "recording" | "ready" | "transcribing" | "error";
type Mode = "cloud" | "browser" | "custom";

const BROWSER_MODELS = [
  { id: "onnx-community/whisper-base", label: "Base · fast (~150 MB)" },
  { id: "onnx-community/whisper-small", label: "Small · balanced (~250 MB)" },
  { id: "onnx-community/whisper-large-v3-turbo", label: "Large v3 Turbo · best (~800 MB)" },
];

// On-device transcriber. Runs @huggingface/transformers inside a module Web
// Worker loaded from a CDN, so there's no bundler/worker config to maintain.
// Everything runs in the browser — audio never leaves the device.
const WORKER_SOURCE = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
env.allowLocalModels = false;
env.useBrowserCache = true;
let transcriber = null;
let currentKey = null;
self.onmessage = async (e) => {
  const d = e.data || {};
  try {
    const useGpu = (typeof self.navigator !== 'undefined') && !!self.navigator && ('gpu' in self.navigator);
    const key = d.model + '|' + (useGpu ? 'webgpu' : 'wasm');
    if (!transcriber || currentKey !== key) {
      self.postMessage({ status: 'loading' });
      const opts = {
        device: useGpu ? 'webgpu' : 'wasm',
        progress_callback: (p) => self.postMessage({ status: 'progress', data: p }),
      };
      if (d.model.indexOf('large') !== -1) opts.dtype = 'q4';
      transcriber = await pipeline('automatic-speech-recognition', d.model, opts);
      currentKey = key;
    }
    self.postMessage({ status: 'transcribing' });
    const runOpts = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: false };
    if (d.language && d.language !== 'auto') runOpts.language = d.language;
    const out = await transcriber(d.audio, runOpts);
    const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
    self.postMessage({ status: 'done', text: (text || '').trim() });
  } catch (err) {
    self.postMessage({ status: 'error', message: (err && err.message) ? err.message : String(err) });
  }
};
`;

// Decode any audio Blob to mono Float32 PCM at 16 kHz (what Whisper expects).
async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  let ctx: AudioContext;
  try {
    ctx = new AC({ sampleRate: 16000 });
  } catch {
    ctx = new AC();
  }
  const audioBuffer = await ctx.decodeAudioData(buf.slice(0));
  let data: Float32Array;
  if (audioBuffer.numberOfChannels > 1) {
    const a = audioBuffer.getChannelData(0);
    const b = audioBuffer.getChannelData(1);
    data = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) data[i] = (a[i] + b[i]) / 2;
  } else {
    data = audioBuffer.getChannelData(0).slice();
  }
  const sr = audioBuffer.sampleRate;
  await ctx.close();
  if (sr === 16000) return data;
  // Linear resample fallback (used when the browser ignores the requested rate).
  const ratio = sr / 16000;
  const newLen = Math.round(data.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, data.length - 1);
    const frac = idx - i0;
    out[i] = data[i0] * (1 - frac) + data[i1] * frac;
  }
  return out;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [transcript, setTranscript] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  // Mode + per-mode settings.
  const [mode, setMode] = useState<Mode>("cloud");
  const [browserModel, setBrowserModel] = useState(BROWSER_MODELS[0].id);
  const [endpoint, setEndpoint] = useState("");
  const [language, setLanguage] = useState("my"); // Whisper code for Burmese
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerUrlRef = useRef<string | null>(null);

  // Restore saved preferences.
  useEffect(() => {
    try {
      const m = localStorage.getItem("mm.mode") as Mode | null;
      if (m) setMode(m);
      const ep = localStorage.getItem("mm.endpoint");
      if (ep) setEndpoint(ep);
      const bm = localStorage.getItem("mm.browserModel");
      if (bm) setBrowserModel(bm);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("mm.mode", mode);
      localStorage.setItem("mm.endpoint", endpoint);
      localStorage.setItem("mm.browserModel", browserModel);
    } catch {
      /* ignore */
    }
  }, [mode, endpoint, browserModel]);

  // Clean up object URLs, streams and worker on unmount.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      workerRef.current?.terminate();
      if (workerUrlRef.current) URL.revokeObjectURL(workerUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAudio = useCallback(
    (blob: Blob | null, name: string) => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setTranscript("");
      setError("");
      setCopied(false);
      setProgress(null);
      if (blob) {
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setFileName(name);
        setStatus("ready");
      } else {
        setAudioBlob(null);
        setAudioUrl(null);
        setFileName("");
        setStatus("idle");
      }
    },
    [audioUrl]
  );

  const startRecording = useCallback(async () => {
    setError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Your browser does not support microphone recording.");
      setStatus("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        resetAudio(blob, "recording.webm");
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setStatus("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setError("Microphone access was denied or unavailable.");
      setStatus("error");
    }
  }, [resetAudio]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
        setError("Please choose an audio file.");
        setStatus("error");
        return;
      }
      resetAudio(file, file.name);
      e.target.value = "";
    },
    [resetAudio]
  );

  const getWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    workerUrlRef.current = url;
    const w = new Worker(url, { type: "module" });
    workerRef.current = w;
    return w;
  }, []);

  const transcribeBrowser = useCallback(async () => {
    if (!audioBlob) return;
    setProgress({ pct: 0, label: "Preparing audio…" });
    const audio = await decodeTo16kMono(audioBlob);
    const worker = getWorker();
    await new Promise<void>((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        const m = e.data || {};
        if (m.status === "loading") {
          setProgress({ pct: 0, label: "Loading model…" });
        } else if (m.status === "progress") {
          const d = m.data || {};
          if (d.status === "progress" && typeof d.progress === "number") {
            setProgress({
              pct: Math.round(d.progress),
              label: `Downloading model… ${d.file ? d.file.split("/").pop() : ""}`,
            });
          }
        } else if (m.status === "transcribing") {
          setProgress({ pct: 100, label: "Transcribing on device…" });
        } else if (m.status === "done") {
          worker.removeEventListener("message", onMessage);
          setProgress(null);
          setTranscript(m.text || "(no speech detected)");
          resolve();
        } else if (m.status === "error") {
          worker.removeEventListener("message", onMessage);
          setProgress(null);
          reject(new Error(m.message || "On-device transcription failed."));
        }
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ model: browserModel, audio, language }, [audio.buffer]);
    });
  }, [audioBlob, browserModel, language, getWorker]);

  const transcribeServer = useCallback(async () => {
    if (!audioBlob) return;
    const form = new FormData();
    form.append("audio", audioBlob, fileName || "audio.webm");
    form.append("mode", mode);
    if (mode === "custom") form.append("endpoint", endpoint.trim());
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    // The response may not be JSON (e.g. a Vercel platform error page when the
    // function times out or crashes), so parse defensively.
    const raw = await res.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok || !data) {
      if (data?.error) throw new Error(data.error);
      if (res.status === 504 || /timed out|timeout/i.test(raw)) {
        throw new Error(
          "The cloud function timed out while the model warmed up. Try again in ~20s (the model is loading), use a shorter clip, or switch to On-device mode."
        );
      }
      throw new Error(
        `Transcription failed (HTTP ${res.status}). ${raw.slice(0, 120).replace(/\s+/g, " ").trim()}`
      );
    }
    setTranscript(data.text || "(no speech detected)");
  }, [audioBlob, fileName, mode, endpoint]);

  const transcribe = useCallback(async () => {
    if (!audioBlob) return;
    if (mode === "custom" && !endpoint.trim()) {
      setError("Enter your custom endpoint URL first.");
      setStatus("error");
      return;
    }
    setStatus("transcribing");
    setError("");
    setTranscript("");
    try {
      if (mode === "browser") await transcribeBrowser();
      else await transcribeServer();
      setStatus("ready");
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
      setStatus("error");
      setProgress(null);
    }
  }, [audioBlob, mode, endpoint, transcribeBrowser, transcribeServer]);

  const copyText = useCallback(async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [transcript]);

  const mmss = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const busy = status === "transcribing";
  const recording = status === "recording";

  return (
    <main className="page">
      <div className="bg-orbs" aria-hidden />

      <section className="card">
        <header className="head">
          <span className="badge">
            <span className="badge-dot" /> Whisper · Burmese speech-to-text
          </span>
          <h1 className="title">
            Speak Burmese.<br />
            <span className="grad-text">Get instant text.</span>
          </h1>
          <p className="subtitle">
            Record on the fly or upload audio. Choose how it runs: in the cloud,
            fully on your device, or on your own model endpoint.
          </p>
        </header>

        {/* Mode selector */}
        <div className="modes" role="tablist" aria-label="Transcription mode">
          {(
            [
              { id: "cloud", label: "Cloud", icon: "☁️" },
              { id: "browser", label: "On-device", icon: "🖥️" },
              { id: "custom", label: "Custom", icon: "🔗" },
            ] as { id: Mode; label: string; icon: string }[]
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={`mode ${mode === m.id ? "is-active" : ""}`}
              onClick={() => {
                setMode(m.id);
                setError("");
              }}
              disabled={busy}
            >
              <span className="mode-icon" aria-hidden>{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>

        {/* Per-mode config */}
        <div className="mode-config">
          {mode === "cloud" && (
            <p className="hint">
              Uses <code>openai/whisper-large-v3</code> via the Hugging Face
              router (needs <code>HF_TOKEN</code> on the server). Multilingual —
              handles Burmese out of the box.
            </p>
          )}
          {mode === "browser" && (
            <div className="config-row">
              <label className="field">
                <span>On-device model</span>
                <select
                  value={browserModel}
                  onChange={(e) => setBrowserModel(e.target.value)}
                  disabled={busy}
                >
                  {BROWSER_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Runs 100% in your browser (WebGPU, falls back to WASM). Audio
                never leaves your device. First run downloads the model, then
                it&apos;s cached offline.
              </p>
            </div>
          )}
          {mode === "custom" && (
            <div className="config-row">
              <label className="field">
                <span>Model endpoint URL</span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://your-space.hf.space/… or your Inference Endpoint"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  disabled={busy}
                />
              </label>
              <p className="hint">
                Point at your own endpoint running{" "}
                <a
                  href="https://huggingface.co/Chonlasitk/whisper-burmese"
                  target="_blank"
                  rel="noreferrer"
                >
                  Chonlasitk/whisper-burmese
                </a>
                . It should accept a raw audio POST and return{" "}
                <code>{`{ "text": "…" }`}</code>.
              </p>
            </div>
          )}
        </div>

        {/* Mic control */}
        <div className="mic-zone">
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={busy}
            className={`mic-btn ${recording ? "is-recording" : ""}`}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            <span className="mic-glow" aria-hidden />
            <span className="mic-icon" aria-hidden>
              {recording ? (
                <svg viewBox="0 0 24 24" width="34" height="34">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="34" height="34" fill="none">
                  <path
                    d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
                    fill="currentColor"
                  />
                  <path
                    d="M19 11a7 7 0 0 1-14 0M12 18v3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </span>
          </button>

          <div className="mic-caption">
            {recording ? (
              <span className="rec-label">
                <span className="rec-pulse" /> Recording · {mmss(elapsed)}
              </span>
            ) : (
              <span>{status === "ready" ? "Tap to re-record" : "Tap to record"}</span>
            )}
          </div>

          <div className="divider">
            <span>or</span>
          </div>

          <label className={`upload ${busy ? "disabled" : ""}`}>
            <input type="file" accept="audio/*" onChange={onFile} disabled={busy} hidden />
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path
                d="M12 16V4m0 0 4 4m-4-4L8 8M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Upload audio file
          </label>
        </div>

        {/* Audio preview + action */}
        {audioUrl && (
          <div className="preview">
            <div className="preview-name" title={fileName}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                <path
                  d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {fileName || "audio"}
            </div>
            <audio controls src={audioUrl} className="player" />
            <button type="button" className="cta" onClick={transcribe} disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" /> {progress ? progress.label : "Transcribing…"}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                    <path
                      d="M5 12h14M13 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Transcribe
                </>
              )}
            </button>
            {busy && progress && progress.pct > 0 && progress.pct < 100 && (
              <div className="bar" aria-hidden>
                <span style={{ width: `${progress.pct}%` }} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        {transcript && (
          <div className="result">
            <div className="result-head">
              <span>Transcript</span>
              <button type="button" className="copy" onClick={copyText}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="result-text" lang="my">
              {transcript}
            </p>
          </div>
        )}

        <footer className="foot">
          Built on{" "}
          <a href="https://github.com/openai/whisper" target="_blank" rel="noreferrer">
            Whisper
          </a>{" "}
          ·{" "}
          <a
            href="https://huggingface.co/Chonlasitk/whisper-burmese"
            target="_blank"
            rel="noreferrer"
          >
            Chonlasitk Burmese fine-tune
          </a>
        </footer>
      </section>
    </main>
  );
}

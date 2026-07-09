"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "recording" | "ready" | "transcribing" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [transcript, setTranscript] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up object URLs and streams on unmount.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAudio = useCallback(
    (blob: Blob | null, name: string) => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setTranscript("");
      setError("");
      setCopied(false);
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
        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
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
      if (!file.type.startsWith("audio/")) {
        setError("Please choose an audio file.");
        setStatus("error");
        return;
      }
      resetAudio(file, file.name);
      e.target.value = "";
    },
    [resetAudio]
  );

  const transcribe = useCallback(async () => {
    if (!audioBlob) return;
    setStatus("transcribing");
    setError("");
    setTranscript("");
    try {
      const form = new FormData();
      form.append("audio", audioBlob, fileName || "audio.webm");
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Transcription failed.");
      }
      setTranscript(data.text || "(no speech detected)");
      setStatus("ready");
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
      setStatus("error");
    }
  }, [audioBlob, fileName]);

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
            <span className="badge-dot" /> Whisper Large V3 · Burmese
          </span>
          <h1 className="title">
            Speak Burmese.<br />
            <span className="grad-text">Get instant text.</span>
          </h1>
          <p className="subtitle">
            Record on the fly or upload an audio file. Transcribed with the
            open-source Chonlasitk Whisper Large V3 model.
          </p>
        </header>

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
            <input
              type="file"
              accept="audio/*"
              onChange={onFile}
              disabled={busy}
              hidden
            />
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
            <button
              type="button"
              className="cta"
              onClick={transcribe}
              disabled={busy}
            >
              {busy ? (
                <>
                  <span className="spinner" /> Transcribing…
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
          Powered by{" "}
          <a
            href="https://huggingface.co/Chonlasitk/whisper-burmese"
            target="_blank"
            rel="noreferrer"
          >
            Chonlasitk/whisper-burmese
          </a>{" "}
          via Hugging Face Inference API
        </footer>
      </section>
    </main>
  );
}

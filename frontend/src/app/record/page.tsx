"use client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Circle,
  CircleCheck,
  Clock3,
  Headphones,
  Mic2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Square,
  Waves,
} from "lucide-react";
import { api, clock, LABELS, type Category, type Recording } from "@/lib/api";

function chooseMime() {
  return (
    [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((x) => MediaRecorder.isTypeSupported(x)) || ""
  );
}
function mimeToExt(type: string) {
  return type.includes("mp4")
    ? ".m4a"
    : type.includes("ogg")
      ? ".ogg"
      : ".webm";
}
export default function RecordPage() {
  const router = useRouter();
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    start = useRef(0),
    held = useRef(0),
    mounted = useRef(false);
  const [stage, setStage] = useState<
    | "idle"
    | "starting"
    | "recording"
    | "paused"
    | "stopping"
    | "ready"
    | "uploading"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("behavioral");
  const [language, setLanguage] = useState("en");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!blob) return;
    const local = URL.createObjectURL(blob);
    setUrl(local);
    return () => URL.revokeObjectURL(local);
  }, [blob]);
  function elapsed() {
    return held.current + (performance.now() - start.current) / 1000;
  }
  function tick() {
    setSeconds(elapsed());
  }
  async function begin() {
    if (stage !== "idle") return;
    setStage("starting");
    setError("");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Recording is not supported in this browser or requires HTTPS.",
        );
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!mounted.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = mic;
      chunks.current = [];
      held.current = 0;
      setSeconds(0);
      setBlob(null);
      const mime = chooseMime();
      const media = new MediaRecorder(
        mic,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = media;
      media.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      media.onstop = () => {
        mic.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        if (timer.current) clearInterval(timer.current);
        const recorded = new Blob(chunks.current, {
          type: media.mimeType || "audio/webm",
        });
        if (recorded.size) {
          setBlob(recorded);
          setStage("ready");
        } else {
          setError("No audio captured. Please try again.");
          setStage("idle");
        }
        mic.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
      };
      media.onerror = () =>
        setError("Recording interrupted. Stop and check the captured audio.");
      media.start(2000);
      start.current = performance.now();
      timer.current = setInterval(tick, 400);
      setStage("recording");
    } catch (e) {
      if (!mounted.current) return;
      setStage("idle");
      setError(e instanceof Error ? e.message : "Microphone unavailable");
      stream.current?.getTracks().forEach((t) => t.stop());
    }
  }
  function pause() {
    if (recorder.current?.state === "recording") {
      recorder.current.pause();
      held.current = elapsed();
      setSeconds(held.current);
      if (timer.current) clearInterval(timer.current);
      setStage("paused");
    }
  }
  function resume() {
    if (recorder.current?.state === "paused") {
      recorder.current.resume();
      start.current = performance.now();
      timer.current = setInterval(tick, 400);
      setStage("recording");
    }
  }
  function stop() {
    if (recorder.current && recorder.current.state !== "inactive") {
      if (stage === "recording") {
        held.current = elapsed();
        setSeconds(held.current);
      }
      if (timer.current) clearInterval(timer.current);
      setStage("stopping");
      recorder.current.stop();
    }
  }
  function reset() {
    setBlob(null);
    setUrl("");
    setSeconds(0);
    setStage("idle");
    setError("");
  }
  async function save() {
    if (!blob) return;
    setStage("uploading");
    setError("");
    try {
      const form = new FormData();
      form.append("file", blob, `practice${mimeToExt(blob.type)}`);
      form.append(
        "title",
        title.trim() || `Practice · ${new Date().toLocaleDateString()}`,
      );
      form.append("category", category);
      form.append("language", language);
      form.append("tags", tags);
      form.append("notes", notes);
      form.append("duration_seconds", String(seconds));
      const rec = await api<Recording>("/recordings", {
        method: "POST",
        body: form,
      });
      router.push(`/recordings/${rec.id}`);
    } catch (e) {
      setStage("ready");
      setError(
        e instanceof Error
          ? e.message
          : "Upload failed. Your recording is still here; retry Save.",
      );
    }
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    if (stage !== "idle") window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage]);
  useEffect(() => {
    function guard(e: MouseEvent) {
      if (stage === "idle" || stage === "uploading") return;
      const anchor = (e.target as HTMLElement).closest("a");
      if (
        anchor &&
        !window.confirm("Leave this page and discard the unsaved recording?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [stage]);
  async function importAudio(file?: File) {
    if (!file) return;
    setError("");
    setBlob(file);
    setSeconds(0);
    setStage("ready");
  }
  const live = stage === "recording" || stage === "paused";
  return (
    <>
      <Link href="/" className="back-link">
        <ArrowLeft size={16} /> Back to overview
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> PRACTICE STUDIO
          </div>
          <h1>
            Make this session <em>count.</em>
          </h1>
          <p>Set your focus, take a breath, and record your best answer.</p>
        </div>
        <span className="soft-chip">
          <Headphones size={15} /> Private recording
        </span>
      </div>
      <div className="record-layout">
        <div className="glass-panel recorder-panel">
          <div className="recorder-status">
            <span className={`live-light ${live ? "on" : ""}`} />
            {stage === "recording"
              ? "RECORDING IN PROGRESS"
              : stage === "paused"
                ? "RECORDING PAUSED"
                : stage === "ready"
                  ? "RECORDING CAPTURED"
                  : stage === "uploading"
                    ? "SAVING SESSION"
                    : "READY WHEN YOU ARE"}
          </div>
          <div className={`record-stage ${live ? "record-stage-active" : ""}`}>
            <div className="sound-rings ring-one" />
            <div className="sound-rings ring-two" />
            <div className="sound-rings ring-three" />
            <div className="record-center">
              <Mic2 size={43} strokeWidth={1.4} />
            </div>
          </div>
          <div className="record-time">{clock(seconds)}</div>
          <p className="recorder-hint">
            {stage === "idle"
              ? "Your next breakthrough begins with one recording."
              : stage === "recording"
                ? "Speak naturally. Take your time."
                : stage === "paused"
                  ? "Resume whenever you are ready."
                  : stage === "ready"
                    ? "Great work. Listen back or save your session."
                    : "Uploading your recording securely..."}
          </p>
          <div className="recorder-buttons">
            {stage === "starting" || stage === "stopping" ? (
              <Button disabled className="button secondary">
                {stage === "starting" ? "Opening microphone…" : "Finishing…"}
              </Button>
            ) : null}
            {stage === "idle" ? (
              <Button className="button primary" onClick={begin}>
                <Circle size={16} fill="currentColor" /> Start recording
              </Button>
            ) : null}
            {stage === "recording" ? (
              <>
                <Button onClick={pause} className="button secondary">
                  <Pause size={16} /> Pause
                </Button>
                <Button onClick={stop} className="button danger">
                  <Square size={15} fill="currentColor" /> Finish recording
                </Button>
              </>
            ) : null}
            {stage === "paused" ? (
              <>
                <Button onClick={resume} className="button secondary">
                  <Play size={16} /> Resume
                </Button>
                <Button onClick={stop} className="button danger">
                  <Square size={15} fill="currentColor" /> Finish
                </Button>
              </>
            ) : null}
            {stage === "ready" ? (
              <>
                <Button onClick={reset} className="button secondary">
                  <RotateCcw size={16} /> Record again
                </Button>
                <Button
                  onClick={save}
                  disabled={!blob?.size}
                  className="button primary"
                >
                  <Save size={16} /> Save recording
                </Button>
              </>
            ) : null}
            {stage === "uploading" ? (
              <Button className="button secondary" disabled>
                Saving…
              </Button>
            ) : null}
          </div>
          {stage === "idle" && (
            <label className="text-link mt-6 cursor-pointer">
              Or upload existing audio
              <Input
                className="sr-only"
                type="file"
                accept="audio/*"
                aria-label="Upload existing audio"
                onChange={(e) => importAudio(e.target.files?.[0])}
              />
            </label>
          )}
          {stage === "ready" && url ? (
            <div className="playback-inline">
              <div className="playback-label">
                <Waves size={16} /> Preview your recording
              </div>
              <audio
                src={url}
                controls
                preload="metadata"
                style={{ width: "100%" }}
              />
            </div>
          ) : null}
          {error && (
            <div role="alert" className="error-banner">
              {error}
            </div>
          )}
        </div>
        <aside className="glass-panel session-panel">
          <div className="eyebrow tiny">SESSION DETAILS</div>
          <h3>Set your intention</h3>
          <p className="form-intro">
            A little context makes every recording easier to revisit.
          </p>
          <label className="field-label" htmlFor="session-title">
            Session title
          </label>
          <Input
            id="session-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Tell me about yourself"
            maxLength={160}
          />
          <label className="field-label" htmlFor="session-category">
            Practice category
          </label>
          <select
            id="session-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {Object.entries(LABELS).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="session-lang">
            Spoken language
          </label>
          <select
            id="session-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
            <option value="auto">Auto-detect</option>
          </select>
          <label className="field-label" htmlFor="session-tags">
            Tags <span>(comma separated)</span>
          </label>
          <Input
            id="session-tags"
            maxLength={300}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="STAR, system design, leadership"
          />
          <label className="field-label" htmlFor="session-notes">
            Your notes
          </label>
          <textarea
            id="session-notes"
            rows={4}
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What do you want to improve?"
          />
          <div className="note-tip">
            <CircleCheck size={16} /> Your recording can be transcribed
            automatically when the optional transcription worker is enabled.
          </div>
        </aside>
      </div>
    </>
  );
}

"use client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Check,
  Clock3,
  Download,
  FileText,
  Mic2,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import {
  api,
  clock,
  dateText,
  LABELS,
  type Category,
  type Recording,
} from "@/lib/api";
export default function RecordingDetail() {
  const { id } = useParams<{ id: string }>(),
    router = useRouter();
  const player = useRef<HTMLAudioElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [rec, setRec] = useState<Recording | null>(null),
    [title, setTitle] = useState(""),
    [notes, setNotes] = useState(""),
    [tags, setTags] = useState(""),
    [category, setCategory] = useState<Category>("behavioral"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [language, setLanguage] = useState("en"),
    [position, setPosition] = useState(0),
    [worker, setWorker] = useState("offline");
  async function load(form = false) {
    try {
      const x = await api<Recording>(`/recordings/${id}`);
      setRec(x);
      if (form) {
        setTitle(x.title);
        setNotes(x.notes);
        setTags(x.tags.join(", "));
        setCategory(x.category);
        setLanguage(x.language);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    let alive = true;
    api<Recording>(`/recordings/${id}`)
      .then((x) => {
        if (alive) {
          setRec(x);
          setTitle(x.title);
          setNotes(x.notes);
          setTags(x.tags.join(", "));
          setCategory(x.category);
          setLanguage(x.language);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const health = await api<{ transcription_worker: string }>("/health");
        if (alive) setWorker(health.transcription_worker);
        if (
          rec?.transcription_status === "pending" ||
          rec?.transcription_status === "processing"
        ) {
          const x = await api<Recording>(`/recordings/${id}`);
          if (alive) setRec(x);
        }
      } catch {
        /* Keep audio available during temporary connection failures. */
      }
    }
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, rec?.transcription_status]);
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/recordings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, notes, tags, category, language }),
      });
      setMessage("Changes saved");
      await load(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/recordings/${id}`, { method: "DELETE" });
      router.push("/library");
    } catch (e) {
      setError(String(e));
      setBusy(false);
      deleteDialog.current?.close();
    }
  }
  async function retry() {
    setBusy(true);
    setError("");
    try {
      await api(`/recordings/${id}/retry-transcription`, { method: "POST" });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function updateSegment(segmentId: number, content: string) {
    try {
      await api(`/recordings/${id}/segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      setMessage("Transcript updated");
      setRec((old) =>
        old
          ? {
              ...old,
              segments: old.segments?.map((s) =>
                s.id === segmentId ? { ...s, text: content } : s,
              ),
            }
          : old,
      );
    } catch (e) {
      setError(String(e));
    }
  }
  if (error && !rec)
    return (
      <div className="error-banner">
        {error} <Link href="/library">Back to library</Link>
      </div>
    );
  if (!rec) return <div className="page-head">Loading recording…</div>;
  return (
    <>
      <Link href="/library" className="back-link">
        <ArrowLeft size={16} /> Back to library
      </Link>
      <div className="page-head detail-head">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> SESSION DETAILS
          </div>
          <h1>{rec.title}</h1>
          <p>
            {LABELS[rec.category]} · {dateText(rec.created_at)} ·{" "}
            {clock(rec.duration_seconds)}
          </p>
        </div>
        <a className="button secondary" href={rec.audio_url} download>
          <Download size={16} /> Download audio
        </a>
      </div>
      <div className="detail-layout">
        <div className="detail-main">
          <section className="glass-panel detail-player">
            <div className="detail-player-icon">
              <AudioLines size={38} />
            </div>
            <div className="player-title">Your original voice, preserved.</div>
            <div className="player-subtitle">
              Listen back, reflect, and notice how far you have come.
            </div>
            <audio
              ref={player}
              controls
              preload="metadata"
              src={rec.audio_url}
              className="main-audio"
              onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
              onError={() =>
                setError(
                  "Audio playback failed. Try downloading the recording.",
                )
              }
            />
            <div className="audio-details">
              <span>
                <Mic2 size={15} /> {rec.language.toUpperCase()}
              </span>
              <span>
                <Clock3 size={15} /> {clock(rec.duration_seconds)}
              </span>
            </div>
          </section>
          <section className="glass-panel transcript-card">
            <div className="panel-header">
              <div>
                <div className="eyebrow tiny">VOICE TO TEXT</div>
                <h3>Transcript</h3>
              </div>
              <span
                className={`transcription-pill ${rec.transcription_status}`}
              >
                {rec.transcription_status}
              </span>
            </div>
            {rec.transcription_status === "completed" &&
            rec.segments?.length ? (
              <div className="segments">
                {rec.segments.map((segment) => (
                  <div
                    key={segment.id}
                    className={`segment ${position >= segment.start && position < segment.end ? "active" : ""}`}
                  >
                    <Button
                      className="timestamp"
                      title={`Play ${clock(segment.start)}–${clock(segment.end)}`}
                      onClick={() => {
                        if (player.current) {
                          player.current.currentTime = segment.start;
                          player.current
                            .play()
                            .catch(() =>
                              setError(
                                "Playback could not start. Press play to continue.",
                              ),
                            );
                        }
                      }}
                    >
                      {clock(segment.start)}
                    </Button>
                    <textarea
                      aria-label={`Transcript at ${clock(segment.start)}`}
                      rows={Math.max(2, Math.ceil(segment.text.length / 80))}
                      defaultValue={segment.text}
                      onBlur={(e) => {
                        if (e.target.value !== segment.text)
                          updateSegment(segment.id, e.target.value);
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="transcript-empty">
                <FileText size={24} />
                <b>
                  {rec.transcription_status === "completed"
                    ? "No speech detected"
                    : rec.transcription_status === "failed"
                      ? "Transcription failed"
                      : "Transcript coming soon"}
                </b>
                <p>
                  {rec.transcription_status === "failed"
                    ? rec.transcription_error || "An error occurred"
                    : rec.transcription_status === "completed"
                      ? "No recognizable voice content was found."
                      : worker === "online"
                        ? "Audio is preserved. Automatic transcription is queued or running."
                        : "Audio is preserved. The transcription worker is currently offline."}
                </p>
                {rec.transcription_status !== "processing" && (
                  <Button
                    disabled={busy}
                    className="button secondary"
                    onClick={retry}
                  >
                    <RotateCcw size={15} /> Retry transcription
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
        <aside className="glass-panel detail-sidebar">
          <div className="eyebrow tiny">SESSION NOTES</div>
          <h3>Reflection space</h3>
          <label className="field-label" htmlFor="edit-title">
            Title
          </label>
          <Input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
          />
          <label className="field-label" htmlFor="edit-category">
            Category
          </label>
          <select
            id="edit-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {Object.entries(LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="edit-language">
            Spoken language
          </label>
          <select
            id="edit-language"
            value={language}
            disabled={rec.transcription_status === "processing"}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
            <option value="auto">Auto-detect</option>
          </select>
          <p className="form-intro">
            Changing language queues a new transcript.
          </p>
          <label className="field-label" htmlFor="edit-tags">
            Tags
          </label>
          <Input
            id="edit-tags"
            maxLength={300}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="leadership, STAR"
          />
          <label className="field-label" htmlFor="edit-notes">
            Notes & reflections
          </label>
          <textarea
            id="edit-notes"
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={7}
            placeholder="What went well? What will you improve next time?"
          />
          <Button
            className="button primary full-width"
            onClick={save}
            disabled={busy}
          >
            <Save size={16} /> Save changes
          </Button>
          {message && (
            <div className="success-text">
              <Check size={14} /> {message}
            </div>
          )}
          {error && <div className="error-text">{error}</div>}
          <div className="divider" />
          <Button
            className="delete-btn"
            disabled={busy || rec.transcription_status === "processing"}
            onClick={() => deleteDialog.current?.showModal()}
          >
            <Trash2 size={15} /> Delete recording
          </Button>
        </aside>
      </div>
      <dialog
        ref={deleteDialog}
        className="delete-dialog"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <h3 id="delete-dialog-title">Delete this recording?</h3>
        <p id="delete-dialog-description">
          “{rec.title}” and its transcript will be permanently deleted. This
          cannot be undone.
        </p>
        <div className="delete-dialog-actions">
          <Button
            className="button secondary"
            autoFocus
            disabled={busy}
            onClick={() => deleteDialog.current?.close()}
          >
            Cancel
          </Button>
          <Button className="button danger" disabled={busy} onClick={remove}>
            <Trash2 size={16} /> {busy ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </dialog>
    </>
  );
}

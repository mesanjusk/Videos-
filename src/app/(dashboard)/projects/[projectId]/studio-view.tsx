"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Pencil, Play, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProgressPhase } from "@/core/production/progress";

interface ProgressPayload {
  title: string;
  progress: {
    phase: ProgressPhase;
    title: string;
    detail?: string;
    percent: number;
    scenesDone: number;
    scenesTotal: number;
    busy: boolean;
    action?: { label: string; target: "accounts" | "project" | "retry" };
    href: string;
  };
  videoUrl: string | null;
  thumbnailUrl: string | null;
  failure: string | null;
  failedJobId: string | null;
}

/**
 * The screen a person watches while their video is being made, and downloads it from when it is.
 *
 * One number, one sentence, one button. Everything the pipeline knows — eleven job types, a scene
 * state machine, a browser automation run driving Google Flow — resolves to that, because none of
 * it is a decision the person watching has to make. What they can do is wait, or fix the one thing
 * that is actually blocking (`progress.action`), and both of those fit on one screen.
 *
 * It polls rather than streams: a video takes minutes, the payload is tiny, and a poll survives a
 * closed laptop lid and a worker restart in a way an open socket does not. Polling stops the moment
 * the work does, so a finished video is not still costing a request every four seconds.
 */
export function StudioView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProgressPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/projects/${projectId}/progress`);
        if (!res.ok) throw new Error("Could not check on your video");
        const payload: ProgressPayload = await res.json();
        if (cancelled) return;
        setData(payload);
        setError(null);
        if (payload.progress.busy) timer = setTimeout(poll, 4000);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not check on your video");
        // Keep trying. A dropped request while a ten-minute render is running should not leave the
        // page permanently stuck on an error it could recover from by itself.
        timer = setTimeout(poll, 8000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);

  if (!data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { progress } = data;
  const done = progress.phase === "ready" && data.videoUrl;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-8 py-8 text-center">
      {done ? (
        <Finished title={data.title} videoUrl={data.videoUrl!} projectId={projectId} />
      ) : (
        <Working data={data} />
      )}
      {error && !progress.busy && <p className="text-xs text-muted-foreground">{error}</p>}
    </div>
  );
}

function Finished({ title, videoUrl, projectId }: { title: string; videoUrl: string; projectId: string }) {
  return (
    <>
      <div className="space-y-2">
        <p className="text-3xl">🎉</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      </div>

      <video
        src={videoUrl}
        controls
        playsInline
        className="w-full rounded-2xl border border-border bg-black shadow-lg"
      />

      <div className="flex flex-wrap items-center justify-center gap-3">
        {/* A plain anchor with `download`, not a fetch-and-save: the file is already public on the
            storage provider, and the browser's own download is faster, resumable, and works on a
            phone. */}
        <Button asChild size="lg" className="h-14 px-8 text-base">
          <a href={videoUrl} download>
            <Download className="h-5 w-5" />
            Download
          </a>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href={`/projects/${projectId}/edit`}>
            <Pencil className="h-4 w-4" />
            Change something
          </Link>
        </Button>
      </div>
    </>
  );
}

const PHASE_ART: Record<ProgressPhase, string> = {
  writing: "✍️",
  drawing: "🎨",
  filming: "🎬",
  speaking: "🎤",
  joining: "🧩",
  ready: "🎉",
  waiting: "🙋",
  problem: "😕",
};

function Working({ data }: { data: ProgressPayload }) {
  const { progress } = data;
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const retry = async () => {
    if (!data.failedJobId) return;
    setRetrying(true);
    setRetryError(null);
    const res = await fetch(`/api/jobs/${data.failedJobId}/retry`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setRetryError(body.error ?? "That did not work.");
      setRetrying(false);
      return;
    }
    // The poll loop stopped when the run stopped; a full reload is the simplest way to restart it
    // against the new job, and there is nothing on this screen worth preserving across it.
    window.location.reload();
  };

  return (
    <>
      <p className="text-5xl" aria-hidden>
        {PHASE_ART[progress.phase]}
      </p>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{progress.title}</h1>
        {progress.detail && <p className="mx-auto max-w-md text-muted-foreground">{progress.detail}</p>}
      </div>

      <div className="w-full max-w-md space-y-3">
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${progress.percent}%` }}
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={progress.title}
          />
        </div>

        {progress.scenesTotal > 0 && (
          <SceneDots done={progress.scenesDone} total={progress.scenesTotal} />
        )}
      </div>

      {progress.action?.target === "retry" ? (
        <Button size="lg" className="h-14 px-8 text-base" onClick={retry} disabled={retrying || !data.failedJobId}>
          {retrying ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
          {progress.action.label}
        </Button>
      ) : progress.action ? (
        <Button asChild size="lg" className="h-14 px-8 text-base">
          <Link href={progress.href}>{progress.action.label}</Link>
        </Button>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          You can close this page — it keeps going without you.
        </p>
      )}

      {retryError && <p className="text-sm text-destructive">{retryError}</p>}

      {data.failure && progress.phase === "problem" && (
        <p className="max-w-md rounded-lg bg-muted px-4 py-3 text-left text-xs text-muted-foreground">{data.failure}</p>
      )}
    </>
  );
}

/**
 * One dot per scene. A bar alone cannot show that seven of eight clips are done and the eighth is
 * taking a while — which, on a pipeline whose slowest step runs once per scene, is exactly the
 * thing someone watching wants to know.
 */
function SceneDots({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label={`${done} of ${total} scenes done`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={
            i < done
              ? "h-2.5 w-2.5 rounded-full bg-primary"
              : i === done
                ? "h-2.5 w-2.5 animate-pulse rounded-full bg-primary/50"
                : "h-2.5 w-2.5 rounded-full bg-muted-foreground/20"
          }
        />
      ))}
      <span className="ml-2 text-xs text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}

/** Shown on a project that has not started yet — the one button that starts it. */
export function StartButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/story`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not start.");
      setBusy(false);
      return;
    }
    window.location.reload();
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <Button size="lg" className="h-14 px-8 text-base" onClick={start} disabled={busy}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
        Make my video
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

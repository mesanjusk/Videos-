"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Camera, Check, Copy, Loader2, Mic, MoreVertical, Smile, Sparkles, UploadCloud, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { SceneStatus } from "@/modules/scenes/models/Scene";
import { useJobPolling } from "@/hooks/use-job-polling";

export interface SceneListItem {
  id: string;
  index: number;
  visual: string;
  dialogue: string;
  camera: string;
  emotion: string;
  status: SceneStatus;
  characterIds: string[];
  backgroundId: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  voiceUrl: string | null;
  videoTaskId: string | null;
  pendingVideoPrompt: string | null;
  pendingVideoInstructions: string | null;
}

interface CharacterOption {
  id: string;
  name: string;
  coverUrl: string | null;
}

interface BackgroundOption {
  id: string;
  name: string;
}

export function ScenesManager({
  projectId,
  initialScenes,
  characterOptions,
  backgroundOptions,
}: {
  projectId: string;
  initialScenes: SceneListItem[];
  characterOptions: CharacterOption[];
  backgroundOptions: BackgroundOption[];
}) {
  void projectId;
  return (
    <div className="space-y-4">
      {initialScenes.map((scene) => (
        <SceneCard key={scene.id} scene={scene} characterOptions={characterOptions} backgroundOptions={backgroundOptions} />
      ))}
    </div>
  );
}

function SceneCard({
  scene,
  characterOptions,
  backgroundOptions,
}: {
  scene: SceneListItem;
  characterOptions: CharacterOption[];
  backgroundOptions: BackgroundOption[];
}) {
  const router = useRouter();
  const [imageJobId, setImageJobId] = useState<string | null>(null);
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const [voiceJobId, setVoiceJobId] = useState<string | null>(null);
  const imagePoll = useJobPolling(imageJobId);
  const videoPoll = useJobPolling(videoJobId);
  const voicePoll = useJobPolling(voiceJobId);

  useEffect(() => {
    if (imagePoll.isDone) router.refresh();
  }, [imagePoll.isDone, router]);
  useEffect(() => {
    if (videoPoll.isDone) router.refresh();
  }, [videoPoll.isDone, router]);
  useEffect(() => {
    if (voicePoll.isDone) router.refresh();
  }, [voicePoll.isDone, router]);

  const isGeneratingImage = (imageJobId && !imagePoll.isDone) || scene.status === "image_queued";
  const isGeneratingVoice = voiceJobId && !voicePoll.isDone;

  async function generateImage() {
    const res = await fetch(`/api/scenes/${scene.id}/image`, { method: "POST" });
    if (res.ok) {
      const { job } = await res.json();
      setImageJobId(job._id);
    }
  }

  async function generateVideo() {
    const res = await fetch(`/api/scenes/${scene.id}/video`, { method: "POST" });
    if (res.ok) {
      const { job } = await res.json();
      setVideoJobId(job._id);
    }
  }

  async function generateVoice() {
    const res = await fetch(`/api/scenes/${scene.id}/voice`, { method: "POST" });
    if (res.ok) {
      const { job } = await res.json();
      setVoiceJobId(job._id);
    }
  }

  async function toggleCharacter(characterId: string) {
    const next = scene.characterIds.includes(characterId)
      ? scene.characterIds.filter((id) => id !== characterId)
      : [...scene.characterIds, characterId];
    await fetch(`/api/scenes/${scene.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterIds: next }),
    });
    router.refresh();
  }

  async function setBackground(backgroundId: string) {
    await fetch(`/api/scenes/${scene.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backgroundId }),
    });
    router.refresh();
  }

  async function duplicate() {
    await fetch(`/api/scenes/${scene.id}/duplicate`, { method: "POST" });
    router.refresh();
  }

  async function remove() {
    await fetch(`/api/scenes/${scene.id}`, { method: "DELETE" });
    router.refresh();
  }

  const showVideoHandoff = scene.status === "video_pending_manual" && scene.pendingVideoPrompt;
  const selectedCharacters = characterOptions.filter((c) => scene.characterIds.includes(c.id));

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Scene {scene.index}</p>
            <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Camera className="h-3 w-3" />
                {scene.camera}
              </span>
              <span className="flex items-center gap-1">
                <Smile className="h-3 w-3" />
                {scene.emotion}
              </span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Scene actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={duplicate}>Duplicate</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onSelect={remove}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p className="text-sm">{scene.visual}</p>
        {scene.dialogue && <p className="text-sm italic text-muted-foreground">&ldquo;{scene.dialogue}&rdquo;</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Characters in this scene</p>
            <div className="flex flex-wrap gap-2">
              {characterOptions.length === 0 && <p className="text-xs text-muted-foreground">No characters yet.</p>}
              {characterOptions.map((c) => {
                const selected = scene.characterIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCharacter(c.id)}
                    className={
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                      (selected ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground")
                    }
                  >
                    {selected && <Check className="h-3 w-3" />}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Background</p>
            <Select value={scene.backgroundId ?? undefined} onValueChange={setBackground}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a background" />
              </SelectTrigger>
              <SelectContent>
                {backgroundOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Scene image</p>
            <div className="aspect-[4/5] w-full overflow-hidden rounded-lg bg-muted">
              {isGeneratingImage ? (
                <Skeleton className="h-full w-full rounded-none" />
              ) : scene.imageUrl ? (
                <Image src={scene.imageUrl} alt={`Scene ${scene.index}`} width={300} height={375} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Sparkles className="h-6 w-6" />
                </div>
              )}
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={generateImage} disabled={!!isGeneratingImage}>
              {isGeneratingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {scene.imageUrl ? "Regenerate image" : "Generate image"}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Scene video</p>
            {scene.videoUrl ? (
              <video src={scene.videoUrl} controls className="aspect-[4/5] w-full rounded-lg bg-black object-cover" />
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Video className="h-6 w-6" />
              </div>
            )}
            {!showVideoHandoff && (
              <Button size="sm" variant="outline" className="w-full" onClick={generateVideo} disabled={!!(videoJobId && !videoPoll.isDone)}>
                {videoJobId && !videoPoll.isDone ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                {scene.videoUrl ? "Regenerate video" : "Generate video"}
              </Button>
            )}
          </div>
        </div>

        {scene.dialogue.trim() && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Voice</p>
            {scene.voiceUrl && (
              <audio src={scene.voiceUrl} controls className="w-full">
                <track kind="captions" />
              </audio>
            )}
            <Button size="sm" variant="outline" onClick={generateVoice} disabled={!!isGeneratingVoice}>
              {isGeneratingVoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {scene.voiceUrl ? "Regenerate voice" : "Generate voice"}
            </Button>
            {voicePoll.job?.status === "failed" && <p className="text-xs text-destructive">{voicePoll.job.error}</p>}
          </div>
        )}

        {showVideoHandoff && (
          <VideoHandoffPanel
            sceneId={scene.id}
            taskId={scene.videoTaskId!}
            promptText={scene.pendingVideoPrompt!}
            instructions={scene.pendingVideoInstructions ?? ""}
            characterReferences={selectedCharacters}
          />
        )}
      </CardContent>
    </Card>
  );
}

function VideoHandoffPanel({
  sceneId,
  taskId,
  promptText,
  instructions,
  characterReferences,
}: {
  sceneId: string;
  taskId: string;
  promptText: string;
  instructions: string;
  characterReferences: CharacterOption[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function copyPrompt() {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const paramsRes = await fetch(`/api/scenes/${sceneId}/video/upload-params`);
      if (!paramsRes.ok) throw new Error("Couldn't prepare the upload");
      const { timestamp, folder, signature, apiKey, cloudName } = await paramsRes.json();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", apiKey);
      formData.append("timestamp", String(timestamp));
      formData.append("signature", signature);
      formData.append("folder", folder);

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload to storage failed");
      const uploaded = await uploadRes.json();

      const completeRes = await fetch(`/api/scenes/${sceneId}/video/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          url: uploaded.secure_url,
          publicId: uploaded.public_id,
          durationSeconds: uploaded.duration ?? 8,
          bytes: uploaded.bytes,
        }),
      });
      if (!completeRes.ok) throw new Error("Couldn't save the video");

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium">One manual step: generate this clip in Google Flow</p>
      <p className="text-xs text-muted-foreground">{instructions}</p>

      {characterReferences.length > 0 && (
        <div className="flex gap-2">
          {characterReferences.map(
            (c) =>
              c.coverUrl && (
                <Image key={c.id} src={c.coverUrl} alt={c.name} width={48} height={48} className="h-12 w-12 rounded-md object-cover" />
              ),
          )}
        </div>
      )}

      <div className="rounded-md bg-background p-3">
        <pre className="whitespace-pre-wrap text-xs">{promptText}</pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={copyPrompt}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy prompt"}
        </Button>
        <a
          href="https://labs.google/flow"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          Open Google Flow
        </a>
        <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading ? "Uploading..." : "Upload the clip"}
        </Button>
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Download, Film, Loader2, Music, Sparkles, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useJobPolling } from "@/hooks/use-job-polling";

interface EditPanelProps {
  projectId: string;
  projectStatus: string;
  musicUrl: string | null;
  watermarkImageUrl: string | null;
  finalVideoUrl: string | null;
  thumbnailUrl: string | null;
  thumbnailTitle: string | null;
  thumbnailDescription: string | null;
  thumbnailTags: string[];
}

export function EditPanel({
  projectId,
  musicUrl,
  watermarkImageUrl,
  finalVideoUrl,
  thumbnailUrl,
  thumbnailTitle,
  thumbnailDescription,
  thumbnailTags,
}: EditPanelProps) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <MusicCard projectId={projectId} musicUrl={musicUrl} />
      <WatermarkCard projectId={projectId} watermarkImageUrl={watermarkImageUrl} />
      <RenderCard projectId={projectId} finalVideoUrl={finalVideoUrl} onDone={() => router.refresh()} />
      <ThumbnailCard
        projectId={projectId}
        thumbnailUrl={thumbnailUrl}
        title={thumbnailTitle}
        description={thumbnailDescription}
        tags={thumbnailTags}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

function MusicCard({ projectId, musicUrl }: { projectId: string; musicUrl: string | null }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const paramsRes = await fetch(`/api/projects/${projectId}/music/upload-params`);
      if (!paramsRes.ok) throw new Error("Couldn't prepare the upload");
      const { timestamp, folder, signature, apiKey, cloudName } = await paramsRes.json();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", apiKey);
      formData.append("timestamp", String(timestamp));
      formData.append("signature", signature);
      formData.append("folder", folder);

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload to storage failed");
      const uploaded = await uploadRes.json();

      const saveRes = await fetch(`/api/projects/${projectId}/music/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: uploaded.secure_url,
          publicId: uploaded.public_id,
          durationSeconds: uploaded.duration,
          bytes: uploaded.bytes,
        }),
      });
      if (!saveRes.ok) throw new Error("Couldn't save the music track");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music className="h-4 w-4 text-primary" />
          Background music
        </CardTitle>
        <CardDescription>
          Optional — upload your own royalty-free track to mix under the narration. Skipped if you don&rsquo;t add one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {musicUrl && (
          <audio src={musicUrl} controls className="w-full">
            <track kind="captions" />
          </audio>
        )}
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {musicUrl ? "Replace music" : "Upload music"}
        </Button>
        <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function WatermarkCard({ projectId, watermarkImageUrl }: { projectId: string; watermarkImageUrl: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(watermarkImageUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watermarkImageUrl: value.trim() || null }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo / watermark</CardTitle>
        <CardDescription>Optional — paste an image URL to overlay in the bottom-right corner of your export.</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="watermark">Image URL</Label>
          <Input id="watermark" placeholder="https://..." value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button className="self-end" size="sm" variant="outline" onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function RenderCard({ projectId, finalVideoUrl, onDone }: { projectId: string; finalVideoUrl: string | null; onDone: () => void }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const { job, isDone } = useJobPolling(jobId, 4000);

  useEffect(() => {
    if (isDone && job?.status === "completed") onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone, job?.status]);

  const isRendering = jobId && !isDone;

  async function render() {
    const res = await fetch(`/api/projects/${projectId}/render`, { method: "POST" });
    if (res.ok) {
      const { job: created } = await res.json();
      setJobId(created._id);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Film className="h-4 w-4 text-primary" />
          Final video
        </CardTitle>
        <CardDescription>Joins every scene, mixes voice and music, burns captions, exports 1080×1920 at 30fps.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {finalVideoUrl && (
          <video src={finalVideoUrl} controls className="aspect-[9/16] w-full max-w-xs rounded-lg bg-black" />
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={render} disabled={!!isRendering}>
            {isRendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isRendering ? "Rendering..." : finalVideoUrl ? "Re-render" : "Render final video"}
          </Button>
          {finalVideoUrl && (
            <Button asChild variant="outline">
              <a href={finalVideoUrl} download>
                <Download className="h-4 w-4" />
                Download
              </a>
            </Button>
          )}
        </div>
        {job?.status === "failed" && <p className="text-sm text-destructive">{job.error}</p>}
      </CardContent>
    </Card>
  );
}

function ThumbnailCard({
  projectId,
  thumbnailUrl,
  title,
  description,
  tags,
  onDone,
}: {
  projectId: string;
  thumbnailUrl: string | null;
  title: string | null;
  description: string | null;
  tags: string[];
  onDone: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const { job, isDone } = useJobPolling(jobId);

  useEffect(() => {
    if (isDone && job?.status === "completed") onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone, job?.status]);

  const isGenerating = jobId && !isDone;

  async function generate() {
    const res = await fetch(`/api/projects/${projectId}/thumbnail`, { method: "POST" });
    if (res.ok) {
      const { job: created } = await res.json();
      setJobId(created._id);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thumbnail</CardTitle>
        <CardDescription>An eye-catching image plus a title, description, and tags — ready to paste when you upload.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {thumbnailUrl && (
          <Image src={thumbnailUrl} alt="Thumbnail" width={320} height={180} className="aspect-video w-full max-w-sm rounded-lg object-cover" />
        )}
        {title && (
          <div className="space-y-1 text-sm">
            <p className="font-medium">{title}</p>
            {description && <p className="text-muted-foreground">{description}</p>}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
        <Button onClick={generate} disabled={!!isGenerating}>
          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {isGenerating ? "Generating..." : thumbnailUrl ? "Regenerate thumbnail" : "Generate thumbnail"}
        </Button>
        {job?.status === "failed" && <p className="text-sm text-destructive">{job.error}</p>}
      </CardContent>
    </Card>
  );
}

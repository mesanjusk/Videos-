"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { createProjectSchema, type CreateProjectInput } from "@/modules/projects/schema";
import { VIDEO_STYLES } from "@/modules/projects/constants";
import { Stepper } from "@/components/shared/stepper";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface WizardLibraryCharacter {
  id: string;
  name: string;
  role?: string;
  coverUrl: string | null;
}

const STEPS = [
  { label: "Basics", description: "Name, language, platform" },
  { label: "Style", description: "How it should look" },
  { label: "Story", description: "Your idea or script" },
  { label: "Cast", description: "Reuse existing characters" },
  { label: "Generate", description: "Review & create" },
];

const STEP_FIELDS: (keyof CreateProjectInput)[][] = [
  ["title", "language", "videoType", "durationSeconds", "targetPlatform"],
  ["style", "customStyleDescription"],
  ["storyInputMode", "premise", "pastedScript"],
  [],
  [],
];

export function ProjectWizard({ libraryCharacters }: { libraryCharacters: WizardLibraryCharacter[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);

  function toggleCharacter(id: string) {
    setSelectedCharacterIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      title: "",
      language: "en",
      videoType: "short",
      durationSeconds: 60,
      targetPlatform: "youtube",
      style: "Pixar",
      storyInputMode: "idea",
      premise: "",
      pastedScript: "",
    },
    mode: "onChange",
  });

  const { register, watch, setValue, trigger, handleSubmit, formState } = form;
  const style = watch("style");
  const storyInputMode = watch("storyInputMode");

  async function goNext() {
    const valid = await trigger(STEP_FIELDS[step]);
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onSubmit(values: CreateProjectInput) {
    setSubmitError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      setSubmitError("Something went wrong creating your project. Please try again.");
      return;
    }
    const { project } = await res.json();

    if (selectedCharacterIds.length > 0) {
      // Best-effort: the project already exists at this point, so a failed assignment here isn't
      // worth blocking on — the user can still assign from the Characters page or Character Library.
      await Promise.all(
        selectedCharacterIds.map((characterId) =>
          fetch(`/api/characters/${characterId}/clone`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetProjectId: project._id }),
          }).catch(() => {}),
        ),
      );
    }

    router.push(`/projects/${project._id}`);
  }

  const values = watch();

  return (
    <div className="space-y-8">
      <Stepper steps={STEPS} currentIndex={step} />

      <form onSubmit={handleSubmit(onSubmit)}>
        <Card>
          <CardContent className="p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18 }}
                className="space-y-5"
              >
                {step === 0 && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="title">Project name</Label>
                      <Input id="title" placeholder="e.g. Ravi's Big Ice Cream Adventure" {...register("title")} />
                      {formState.errors.title && <p className="text-xs text-destructive">{formState.errors.title.message}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Language</Label>
                        <Select value={values.language} onValueChange={(v) => setValue("language", v, { shouldValidate: true })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en">English</SelectItem>
                            <SelectItem value="hi">Hindi</SelectItem>
                            <SelectItem value="es">Spanish</SelectItem>
                            <SelectItem value="fr">French</SelectItem>
                            <SelectItem value="pt">Portuguese</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Video type</Label>
                        <Select value={values.videoType} onValueChange={(v) => setValue("videoType", v, { shouldValidate: true })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="short">Short (single episode)</SelectItem>
                            <SelectItem value="series-episode">Series episode</SelectItem>
                            <SelectItem value="explainer">Explainer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Duration</Label>
                        <Select
                          value={String(values.durationSeconds)}
                          onValueChange={(v) => setValue("durationSeconds", Number(v), { shouldValidate: true })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="30">30 seconds</SelectItem>
                            <SelectItem value="60">1 minute</SelectItem>
                            <SelectItem value="120">2 minutes</SelectItem>
                            <SelectItem value="180">3 minutes</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Platform</Label>
                        <Select
                          value={values.targetPlatform}
                          onValueChange={(v) => setValue("targetPlatform", v as CreateProjectInput["targetPlatform"], { shouldValidate: true })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="youtube">YouTube</SelectItem>
                            <SelectItem value="instagram">Instagram</SelectItem>
                            <SelectItem value="tiktok">TikTok</SelectItem>
                            <SelectItem value="facebook">Facebook</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    <Label>Choose a style</Label>
                    <RadioGroup
                      value={values.style}
                      onValueChange={(v) => setValue("style", v as CreateProjectInput["style"], { shouldValidate: true })}
                      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
                    >
                      {VIDEO_STYLES.map((s) => (
                        <Label
                          key={s}
                          htmlFor={`style-${s}`}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border border-input p-3 text-sm transition-colors",
                            style === s && "border-primary bg-primary/5 text-primary",
                          )}
                        >
                          <RadioGroupItem value={s} id={`style-${s}`} />
                          {s}
                        </Label>
                      ))}
                    </RadioGroup>
                    {style === "Custom" && (
                      <div className="space-y-2">
                        <Label htmlFor="customStyleDescription">Describe your style</Label>
                        <Textarea
                          id="customStyleDescription"
                          placeholder="e.g. Watercolor storybook illustration, soft pastel colors"
                          {...register("customStyleDescription")}
                        />
                        {formState.errors.customStyleDescription && (
                          <p className="text-xs text-destructive">{formState.errors.customStyleDescription.message}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <Label>How do you want to start?</Label>
                    <Tabs
                      value={storyInputMode}
                      onValueChange={(v) => setValue("storyInputMode", v as CreateProjectInput["storyInputMode"], { shouldValidate: true })}
                    >
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="idea">I have an idea</TabsTrigger>
                        <TabsTrigger value="script">I have a script</TabsTrigger>
                      </TabsList>
                      <TabsContent value="idea" className="space-y-2">
                        <Textarea
                          rows={6}
                          placeholder="e.g. A curious boy and his robot dog discover a hidden garden in their city and have to protect it from a grumpy landlord."
                          {...register("premise")}
                        />
                        <p className="text-xs text-muted-foreground">
                          Just describe the idea in your own words — we&rsquo;ll turn it into a full 8-scene script.
                        </p>
                        {formState.errors.premise && <p className="text-xs text-destructive">{formState.errors.premise.message}</p>}
                      </TabsContent>
                      <TabsContent value="script" className="space-y-2">
                        <Textarea rows={8} placeholder="Paste your full script here..." {...register("pastedScript")} />
                        {formState.errors.pastedScript && (
                          <p className="text-xs text-destructive">{formState.errors.pastedScript.message}</p>
                        )}
                      </TabsContent>
                    </Tabs>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4">
                    <Label>Reuse characters from your library (optional)</Label>
                    <p className="text-xs text-muted-foreground">
                      Already have a cast from another project? Assign them here instead of recreating them — you can
                      also add new characters and reuse more later from the project&rsquo;s Characters page.
                    </p>
                    {libraryCharacters.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                        No characters in your library yet — you&rsquo;ll create them fresh for this project.
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {libraryCharacters.map((c) => {
                          const selected = selectedCharacterIds.includes(c.id);
                          return (
                            <button
                              type="button"
                              key={c.id}
                              onClick={() => toggleCharacter(c.id)}
                              className={cn(
                                "flex items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
                                selected ? "border-primary bg-primary/5" : "border-input hover:bg-accent",
                              )}
                            >
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                                {c.coverUrl ? (
                                  <Image src={c.coverUrl} alt={c.name} width={40} height={40} className="h-full w-full object-cover" />
                                ) : (
                                  <Avatar className="h-8 w-8">
                                    <AvatarFallback>{c.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                                  </Avatar>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{c.name}</p>
                                {c.role && <p className="truncate text-xs text-muted-foreground">{c.role}</p>}
                              </div>
                              {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-primary">
                      <Sparkles className="h-5 w-5" />
                      <p className="font-medium">Ready to create</p>
                    </div>
                    <dl className="grid grid-cols-2 gap-y-2 rounded-lg border border-border p-4 text-sm">
                      <dt className="text-muted-foreground">Name</dt>
                      <dd className="text-right">{values.title || "—"}</dd>
                      <dt className="text-muted-foreground">Style</dt>
                      <dd className="text-right">{values.style}</dd>
                      <dt className="text-muted-foreground">Platform</dt>
                      <dd className="text-right capitalize">{values.targetPlatform}</dd>
                      <dt className="text-muted-foreground">Duration</dt>
                      <dd className="text-right">{values.durationSeconds}s</dd>
                      <dt className="text-muted-foreground">Cast</dt>
                      <dd className="text-right">
                        {selectedCharacterIds.length > 0 ? `${selectedCharacterIds.length} from library` : "None yet"}
                      </dd>
                    </dl>
                    <p className="text-sm text-muted-foreground">
                      We&rsquo;ll save this project and take you straight to story generation.
                    </p>
                    {submitError && <p className="text-sm text-destructive">{submitError}</p>}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={goBack} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={goNext}>
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create project
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

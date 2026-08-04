import { HelpButton } from "@/components/shared/help-button";
import { ProjectWizard } from "./project-wizard";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Create a project</h1>
            <HelpButton text="Four quick steps: basics, style, your story idea, then generate. Nothing here requires writing a prompt — just describe your idea in plain words." />
          </div>
          <p className="text-sm text-muted-foreground">A few quick questions, then we take it from here.</p>
        </div>
      </div>
      <ProjectWizard />
    </div>
  );
}

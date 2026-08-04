import { ProjectWizard } from "./project-wizard";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Create a project</h1>
        <p className="text-sm text-muted-foreground">A few quick questions, then we take it from here.</p>
      </div>
      <ProjectWizard />
    </div>
  );
}

import { requireUserId } from "@/core/auth/session";
import { listStylePacks } from "@/modules/style-packs/service";
import { HelpButton } from "@/components/shared/help-button";
import { StylePacksManager, type StylePackItem } from "./style-packs-manager";

export default async function StylePacksPage() {
  const userId = await requireUserId();
  const packs = await listStylePacks(userId);

  const items: StylePackItem[] = packs.map((p) => ({
    id: p._id.toString(),
    name: p.name,
    category: p.category,
    lighting: p.lighting ?? undefined,
    colorGrading: p.colorGrading ?? undefined,
    cameraStyle: p.cameraStyle ?? undefined,
    composition: p.composition ?? undefined,
    motionStyle: p.motionStyle ?? undefined,
    renderStyle: p.renderStyle ?? undefined,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Style Packs</h1>
        <HelpButton text="A reusable, named visual style — lighting, color grading, camera style, composition, motion, and render style. Production Profiles reference a style pack instead of retyping style details for every project." />
      </div>
      <p className="text-sm text-muted-foreground">Reusable visual styles for Production Profiles.</p>
      <StylePacksManager packs={items} />
    </div>
  );
}

/**
 * Import-for-side-effects barrel: guarantees every Mongoose model is registered before any
 * `populate()`/`ref` resolution runs, regardless of which module's service function executes first
 * in a given serverless invocation. Import this once at the top of `core/db/mongoose.ts` consumers
 * that use cross-model `populate` (queue processors especially).
 */
import "@/modules/accounts/models/GoogleAccount";
import "@/modules/settings/models/Settings";
import "@/modules/projects/models/Project";
import "@/modules/characters/models/Character";
import "@/modules/backgrounds/models/Background";
import "@/modules/scenes/models/Scene";
import "@/modules/jobs/models/Job";
import "@/modules/assets/models/Asset";
import "@/modules/prompt-templates/models/PromptTemplate";

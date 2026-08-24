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
import "@/modules/production-profiles/models/ProductionProfile";
import "@/modules/production-runs/models/ProductionRun";
import "@/modules/style-packs/models/StylePack";
import "@/modules/voice-packs/models/VoicePack";
import "@/modules/browser-automation/models/BrowserSession";
import "@/modules/browser-automation/models/BrowserTaskRun";
// Added by the Browser Automation OS merge. Registering these matters for the same reason as
// everything above: an AutomationTask populate() resolves refs to Automation/Workflow, and whether
// those models happen to have been imported already depends on which service ran first in a given
// invocation. The barrel removes that ordering dependency.
import "@/modules/automation/models/Workflow";
import "@/modules/automation/models/Automation";
import "@/modules/automation/models/AutomationTask";
import "@/modules/automation/models/Schedule";
import "@/modules/automation/models/Webhook";
import "@/modules/automation/models/HumanIntervention";
import "@/modules/automation/models/Credential";
import "@/modules/automation/models/StoredFile";
import "@/modules/automation/models/AuditLog";
import "@/modules/production-plans/models/ProductionPlan";

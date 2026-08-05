/**
 * Deliberately has zero imports — importing anything from `mongoose` here (even transitively, e.g.
 * from `./models/ProductionProfile`) would pull server-only/Node-only code into every client bundle
 * that needs this value (the production-profiles-manager.tsx form), which silently breaks at
 * runtime rather than failing at build time. Same pattern as modules/projects/constants.ts.
 */
export const PRODUCTION_PROFILE_STATUSES = ["draft", "active", "archived"] as const;
export type ProductionProfileStatus = (typeof PRODUCTION_PROFILE_STATUSES)[number];

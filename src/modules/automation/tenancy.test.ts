import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Tenancy is the property that has to hold across the whole merge, not in one place.
 *
 * Project B's models carried `createdBy` for attribution but nothing filtered on it — it was
 * effectively single-tenant. Every collection in this application is scoped by `userId`. Porting a
 * model without that field would let any user read another user's credentials, browser sessions and
 * workflow runs, which was the highest-severity risk in the merge.
 *
 * A code review catches that once. This catches it every time someone adds a model.
 */
const MODEL_DIRS = [
  "src/modules/automation/models",
  "src/modules/production-plans/models",
  "src/modules/browser-automation/models",
];

function modelFiles(): { file: string; source: string }[] {
  return MODEL_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({ file: path.join(dir, name), source: readFileSync(path.join(dir, name), "utf8") })),
  );
}

describe("every collection is tenant-scoped", () => {
  it("finds the models it is supposed to be checking", () => {
    // Guards against the check silently passing because a directory moved.
    expect(modelFiles().length).toBeGreaterThanOrEqual(12);
  });

  it("declares userId as required and indexed on every schema", () => {
    for (const { file, source } of modelFiles()) {
      // One file may declare several schemas (Workflow + WorkflowVersion, Task + Execution + Step).
      const schemaCount = (source.match(/new Schema\(/g) ?? []).length;
      const userIdCount = (source.match(/userId:\s*\{\s*type:\s*String,\s*required:\s*true,\s*index:\s*true\s*\}/g) ?? []).length;
      expect(userIdCount, `${file} declares ${schemaCount} schema(s) but ${userIdCount} required indexed userId field(s)`).toBe(
        schemaCount,
      );
    }
  });

  it("does not carry Project B's createdBy, which nothing ever filtered on", () => {
    for (const { file, source } of modelFiles()) {
      // Comments are stripped first: several of these files legitimately explain in prose why
      // createdBy was replaced, and matching that would be a false positive.
      expect(stripComments(source), `${file} still declares createdBy`).not.toMatch(/createdBy/);
    }
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("secret-bearing fields are not loaded by default", () => {
  const SECRET_FIELDS = ["valueEnc", "secretEnc", "storageStateEnc"];

  it("marks every encrypted field select: false", () => {
    for (const { file, source } of modelFiles()) {
      for (const field of SECRET_FIELDS) {
        // Match the field declaration and confirm select:false appears before its closing brace —
        // without it a careless .lean() or res.json(doc) can serialise the ciphertext.
        const declaration = source.match(new RegExp(`${field}:\\s*\\{[^}]*\\}`));
        if (!declaration) continue;
        expect(declaration[0], `${file}: ${field} is not select:false`).toMatch(/select:\s*false/);
      }
    }
  });
});

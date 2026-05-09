// Disk-validation test, gated behind RUN_REAL_DISK_SCAN=1 so CI/local test
// runs don't depend on the developer's actual ~/.claude/.skill-stack state.
// Run with: RUN_REAL_DISK_SCAN=1 npx vitest run electron/services/setup.scan-real-disk.test.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { describe, it } from "vitest";
import { scanForExistingSkills } from "./setup";

const ENABLED = process.env.RUN_REAL_DISK_SCAN === "1";

describe.skipIf(!ENABLED)("scanForExistingSkills (real disk)", () => {
  for (const root of [
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".skill-stack", "skills"),
    join(homedir(), ".claude"),
  ]) {
    it(`scans ${root}`, async () => {
      let exists = true;
      try {
        await fs.stat(root);
      } catch {
        exists = false;
      }
      const result = exists ? await scanForExistingSkills(root) : [];
      console.log(`\n=== ${root}${exists ? "" : " (missing)"} ===`);
      for (const s of result) {
        const tag = s.viaContainer ? `(via ${s.viaContainer}/)` : "";
        let kind: string;
        if (s.kind === "skill") {
          kind = s.nestedCount > 0 ? `skill+${s.nestedCount}` : "skill";
        } else if (s.kind === "bundle") {
          kind = `bundle×${s.nestedCount}`;
        } else {
          kind = `package (${s.reason})`;
        }
        console.log(`  ${s.name}  [${kind}] ${tag}`);
      }
      console.log(`  total: ${result.length}`);
    });
  }
});

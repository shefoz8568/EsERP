/**
 * Writes `dist-esm/package.json` (`{"type": "module"}`) after the ESM
 * build, so the `.js` files in dist-esm are treated as ES modules.
 * Run as part of `pnpm build` in packages/shared.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-esm");
writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }) + "\n");

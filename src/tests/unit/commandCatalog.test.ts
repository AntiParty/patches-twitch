import assert from "assert";
import fs from "fs";
import path from "path";
import { COMMAND_CATALOG, getPublicCommands, findCommand } from "../../util/commandCatalog";

const commandsDir = path.resolve(__dirname, "../../commands");
const docsPath = path.resolve(__dirname, "../../../frontend-react/src/features/docs/Docs.tsx");

// Read the source rather than importing: importing every command pulls in the
// whole bot runtime (IRC, server, DB) which is far too heavy for a unit test.
function loadCommandModules(): Array<{ name: string; mod: { aliases: string[] } }> {
  return fs
    .readdirSync(commandsDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => {
      const src = fs.readFileSync(path.join(commandsDir, f), "utf8");
      const match = src.match(/export const aliases\s*=\s*\[([^\]]*)\]/);
      const aliases = match
        ? [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
        : [];
      return {
        name: path.basename(f, ".ts").toLowerCase(),
        hasExecute: /export (const execute\b|(async )?function execute\b)/.test(src),
        mod: { aliases },
      };
    })
    .filter((c) => c.hasExecute);
}

describe("command catalog", () => {
  const modules = loadCommandModules();

  it("has an entry for every command file with matching aliases", () => {
    for (const { name, mod } of modules) {
      const entry = COMMAND_CATALOG.find((c) => c.name === name);
      assert.ok(entry, `missing catalog entry for ${name}`);
      assert.deepStrictEqual(
        [...entry!.aliases].sort(),
        [...(mod.aliases ?? [])].sort(),
        `aliases mismatch for ${name}`
      );
    }
  });

  it("has no catalog entries without a command file", () => {
    const names = new Set(modules.map((m) => m.name));
    for (const c of COMMAND_CATALOG) {
      assert.ok(names.has(c.name), `catalog entry ${c.name} has no command file`);
    }
  });

  it("has no self-referential or colliding aliases", () => {
    const seen = new Map<string, string>();
    for (const c of COMMAND_CATALOG) {
      assert.ok(!seen.has(c.name), `duplicate command name ${c.name}`);
      seen.set(c.name, c.name);
    }
    for (const c of COMMAND_CATALOG) {
      for (const a of c.aliases) {
        assert.notStrictEqual(a, c.name, `${c.name} has itself as an alias`);
        assert.ok(!seen.has(a), `alias ${a} of ${c.name} collides with ${seen.get(a)}`);
        seen.set(a, c.name);
      }
    }
  });

  it("resolves names and aliases with findCommand", () => {
    assert.strictEqual(findCommand("!r")?.name, "rank");
    assert.strictEqual(findCommand("RANK")?.name, "rank");
    assert.strictEqual(findCommand("nope"), undefined);
  });

  it("lists every public command in the docs page", () => {
    const docs = fs.readFileSync(docsPath, "utf8");
    for (const c of COMMAND_CATALOG.filter((c) => !c.hidden)) {
      assert.ok(docs.includes(`'${c.name}'`), `Docs.tsx is missing '${c.name}'`);
    }
    for (const c of getPublicCommands()) {
      assert.ok(docs.includes(`'${c.name}'`), `Docs.tsx is missing public command '${c.name}'`);
    }
  });
});

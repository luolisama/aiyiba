import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pairs = [
  ["search-songs.json", "clue-search-songs.json"],
  ["hardcore-search-songs.json", "hardcore-clue-search-songs.json"],
];

for (const [sourceName, outputName] of pairs) {
  const sourcePath = path.join(root, "app", "data", sourceName);
  const outputPath = path.join(root, "app", "data", outputName);
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const output = {
    schemaVersion: 1,
    generatedAt: source.generatedAt,
    itemCount: source.items.length,
    // Keep the same title aliases as the classic search index.  The clue
    // ladder must not ship answer metadata, but aliases are intentionally
    // public search data (for example 大时代 → 大時代).
    items: source.items.map(({ bvid, name, searchAliases }) => ({
      bvid,
      name,
      ...(searchAliases?.length ? { searchAliases } : {}),
    })),
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser pages use reduced search indexes instead of answer catalogs", async () => {
  const pages = await Promise.all([
    readFile(new URL("../app/solo/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/multi/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/clues/page.tsx", import.meta.url), "utf8"),
  ]);
  const source = pages.join("\n");

  assert.match(source, /search-songs\.json/);
  assert.doesNotMatch(source, /from ["'](?:\.\/|\.\.\/)?data\/(?:hardcore-)?songs\.json/);
});

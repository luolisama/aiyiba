import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isExtendedOnlySong } from "../app/catalog-logic.mjs";

const catalog = JSON.parse(await readFile(new URL("../app/data/songs.json", import.meta.url), "utf8"));
const searchCatalog = JSON.parse(await readFile(new URL("../app/data/search-songs.json", import.meta.url), "utf8"));
const songPinyin = JSON.parse(await readFile(new URL("../app/data/song-pinyin.json", import.meta.url), "utf8"));
const extendedCatalog = JSON.parse(await readFile(new URL("../app/data/hardcore-songs.json", import.meta.url), "utf8"));
const extendedSearchCatalog = JSON.parse(await readFile(new URL("../app/data/hardcore-search-songs.json", import.meta.url), "utf8"));
const extendedPinyin = JSON.parse(await readFile(new URL("../app/data/hardcore-song-pinyin.json", import.meta.url), "utf8"));

function expectedTier(views) {
  if (views >= 10_000_000) return "神话曲";
  if (views >= 1_000_000) return "传说曲";
  if (views >= 500_000) return "专兑曲";
  if (views >= 100_000) return "殿堂曲";
  return "普通曲";
}

function bvids(data) {
  return data.items.map((song) => song.bvid);
}

test("catalogs contain unique, structurally valid songs and the extended catalog is a superset", () => {
  for (const data of [catalog, extendedCatalog]) {
    assert.equal(data.itemCount, data.items.length);
    assert.equal(new Set(bvids(data)).size, data.items.length);
    assert.ok(data.items.every((song) => (
      typeof song.name === "string" && song.name.length > 0 &&
      Array.isArray(song.vocalists) && song.vocalists.length > 0 &&
      Array.isArray(song.engines) && song.engines.length > 0 &&
      /^\d{4}-\d{2}-\d{2}$/u.test(song.publicationDate)
    )));
  }

  const extendedIds = new Set(bvids(extendedCatalog));
  assert.ok(bvids(catalog).every((bvid) => extendedIds.has(bvid)));
  assert.ok(catalog.items.every((song) => song.views >= 100_000));
  assert.ok(extendedCatalog.items.some((song) => typeof song.views === "number" && song.views < 100_000));
});

test("search indexes and pinyin maps cover each catalog with reduced search metadata", () => {
  for (const [full, reduced, pinyin] of [
    [catalog, searchCatalog, songPinyin],
    [extendedCatalog, extendedSearchCatalog, extendedPinyin],
  ]) {
    assert.deepEqual(new Set(bvids(reduced)), new Set(bvids(full)));
    assert.deepEqual(new Set(Object.keys(pinyin)), new Set(bvids(full)));
    assert.ok(Object.values(pinyin).every((value) => typeof value === "string" && value.length > 0));
    for (const song of reduced.items) {
      for (const field of ["engines", "views", "viewTier", "coverUrl", "bilibiliUrl", "bilibiliTitle"]) {
        assert.equal(song[field], undefined);
      }
    }
  }
});

test("numeric playback tiers are derived consistently and archived tiers remain valid", () => {
  const validTiers = new Set(["普通曲", "殿堂曲", "专兑曲", "传说曲", "神话曲"]);
  for (const song of extendedCatalog.items) {
    if (typeof song.views === "number") assert.equal(song.viewTier, expectedTier(song.views), song.name);
    else assert.ok(validTiers.has(song.viewTier), song.name);
  }
});

test("pure instrumentals consistently use 无 for vocalist and engine", () => {
  const instrumentals = extendedCatalog.items.filter((song) => song.workType === "纯音乐");
  assert.ok(instrumentals.length > 0);
  assert.ok(instrumentals.every((song) => song.vocalists.join("、") === "无"));
  assert.ok(instrumentals.every((song) => song.engines.join("、") === "无"));
});

test("extended-only works can be identified without labeling standard works", () => {
  const standardIds = new Set(bvids(catalog));
  const extendedOnly = extendedCatalog.items.filter((song) => !standardIds.has(song.bvid));
  assert.equal(extendedOnly.length, extendedCatalog.items.length - catalog.items.length);
  assert.ok(extendedOnly.length > 0);
  assert.ok(extendedOnly.every((song) => isExtendedOnlySong("hardcore", song.bvid, standardIds)));
  assert.ok(extendedCatalog.items.filter((song) => standardIds.has(song.bvid)).every((song) => !isExtendedOnlySong("hardcore", song.bvid, standardIds)));
  assert.ok(!isExtendedOnlySong("normal", extendedOnly[0].bvid, standardIds));
});

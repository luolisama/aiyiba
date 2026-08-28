import { expect, test } from "@playwright/test";

async function dismissGuide(page) {
  const button = page.getByRole("button", { name: /知道了，(开始(猜|游戏|挑战)|启动时光机)/ });
  await button.click({ timeout: 5_000 }).catch(() => {});
}

test("single-player modes keep working after their APIs are blocked", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());

  await page.goto("/solo");
  await dismissGuide(page);
  const soloSearch = page.getByPlaceholder("输入作品名或拼音搜索…");
  await soloSearch.fill("dalabengba");
  await page.getByText("达拉崩吧", { exact: true }).first().click();
  await page.getByRole("button", { name: /猜一下/ }).click();

  await page.goto("/clues");
  await dismissGuide(page);
  await expect(page.getByText("当前线索 · 引擎")).toBeVisible();
  await page.getByRole("button", { name: /跳过，下一条/ }).click();
  await expect(page.getByText("当前线索 · 播放等级")).toBeVisible();

  await page.goto("/timeline");
  await dismissGuide(page);
  await expect(page.getByText("本轮作品 · 日期暂时隐藏")).toBeVisible();
  await page.getByRole("button", { name: "放在最前" }).click();
  await expect(page.locator(".timeline-board article")).toHaveCount(2);
});

test("single-player analytics starts only after meaningful local gameplay", async ({ page }) => {
  const events = [];
  let failRequests = false;
  await page.route("**/api/analytics", async (route) => {
    events.push(route.request().postDataJSON());
    if (failRequests) {
      await route.abort();
      return;
    }
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ code: "accepted" }) });
  });

  await page.goto("/solo");
  await dismissGuide(page);
  await page.waitForTimeout(100);
  expect(events).toHaveLength(0);
  const soloSearch = page.getByPlaceholder("输入作品名或拼音搜索…");
  await soloSearch.fill("dalabengba");
  await page.getByText("达拉崩吧", { exact: true }).first().click();
  failRequests = true;
  await page.getByRole("button", { name: /猜一下/ }).click();
  await expect.poll(() => events.filter((event) => event.event === "game_engaged").length).toBe(1);
  await expect(page.locator(".round-meter")).toHaveAttribute("aria-label", /已经猜了 1 次/u);
  failRequests = false;

  await page.goto("/clues");
  await dismissGuide(page);
  await page.getByRole("button", { name: /跳过，下一条/ }).click();
  await expect.poll(() => events.filter((event) => event.mode === "solo_clues" && event.event === "game_engaged").length).toBe(1);

  await page.goto("/timeline");
  await dismissGuide(page);
  await page.getByRole("button", { name: "放在最前" }).click();
  await expect.poll(() => events.filter((event) => event.mode === "timeline" && event.event === "game_engaged").length).toBe(1);

  expect(events.every((event) => event.schemaVersion === 1 && event.visitorId && event.sessionId && event.roundId)).toBeTruthy();
  expect(JSON.stringify(events)).not.toMatch(/answer|bvid|nickname|roomCode|playerToken/u);

  for (const route of ["singleplayer", "clues", "timeline"]) {
    const response = await page.request.get(`/api/${route}`);
    expect(response.status()).toBe(410);
  }
});

test("local analytics endpoint enforces its write-only contract", async ({ request }) => {
  test.skip(process.env.E2E_LOCAL_SERVICES !== "1", "Do not write synthetic analytics events to a remote target");
  const payload = {
    schemaVersion: 1,
    event: "game_engaged",
    eventId: "e2e-round-12345678:game_engaged",
    visitorId: "e2e-device-12345678",
    sessionId: "e2e-session-12345678",
    roundId: "e2e-round-12345678",
    mode: "solo_classic",
    pool: "normal",
    difficulty: "normal",
  };
  const accepted = await request.post("/api/analytics", {
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
    data: payload,
  });
  expect(accepted.status()).toBe(202);

  const rejectedOrigin = await request.post("/api/analytics", { data: payload });
  expect(rejectedOrigin.status()).toBe(403);
  const invalid = await request.post("/api/analytics", {
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
    data: { ...payload, mode: "unknown" },
  });
  expect(invalid.status()).toBe(400);
  const oversized = await request.post("/api/analytics", {
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
    data: { ...payload, padding: "x".repeat(5_000) },
  });
  expect(oversized.status()).toBe(413);
  for (let index = 1; index < 30; index += 1) {
    const response = await request.post("/api/analytics", {
      headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
      data: { ...payload, eventId: `e2e-round-${String(index).padStart(8, "0")}:game_engaged`, roundId: `e2e-round-${String(index).padStart(8, "0")}` },
    });
    expect(response.status()).toBe(202);
  }
  const limited = await request.post("/api/analytics", {
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
    data: { ...payload, eventId: "e2e-round-rate-limit:game_engaged", roundId: "e2e-round-rate-limit" },
  });
  expect(limited.status()).toBe(429);
  expect((await request.get("/api/analytics")).status()).toBe(405);
});

test("metadata routes use the running site origin", async ({ page }) => {
  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.ok()).toBeTruthy();
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain("http://127.0.0.1:3000/solo");
  expect(sitemapText).not.toContain("aiyiba.getuphole.top");

  const robots = await page.request.get("/robots.txt");
  expect(robots.ok()).toBeTruthy();
  const robotsText = await robots.text();
  expect(robotsText).toContain("Sitemap: http://127.0.0.1:3000/sitemap.xml");
  expect(robotsText).toContain("Disallow: /pk/ws");

  const canonicalPaths = ["/", "/solo", "/clues", "/timeline", "/multi"];
  for (const pathname of canonicalPaths) {
    await page.goto(pathname);
    const expectedCanonical = pathname === "/" ? "http://127.0.0.1:3000" : `http://127.0.0.1:3000${pathname}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", expectedCanonical);
  }

  await page.goto("/");
  await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute("content", "test-google-verification");
  await expect(page.locator('meta[name="msvalidate.01"]')).toHaveAttribute("content", "test-bing-verification");
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "哎一把");

  const websiteData = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(websiteData).toEqual({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "哎一把",
    url: "http://127.0.0.1:3000/",
  });
});

test("classic mode switches catalogs, accepts pinyin, and exports a result image", async ({ page }) => {
  await page.goto("/solo");
  await dismissGuide(page);
  await page.getByRole("button", { name: /切换为扩展题库/ }).click();
  await expect(page).toHaveURL(/\?catalog=extended/);
  await expect(page.getByText(/从扩展题库的 \d+ 首作品中/)).toBeVisible();

  const search = page.getByPlaceholder("输入作品名或拼音搜索…");
  await search.fill("dalabengba");
  await page.getByText("达拉崩吧", { exact: true }).first().click();
  await page.getByRole("button", { name: /猜一下/ }).click();
  const surrender = page.getByRole("button", { name: "看答案并放弃本局" });
  if (await surrender.isVisible()) {
    await surrender.click();
    await page.getByRole("button", { name: "放弃并看答案" }).click();
  } else {
    // The random round can occasionally use the searched title as its answer.
    await page.getByRole("button", { name: "查看完整结果" }).click();
  }
  await page.getByRole("button", { name: "生成战绩图" }).click();
  const preview = page.getByAltText("生成的哎一把战绩图片预览");
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image) => image.naturalWidth)).toBe(1080);
});

test("two players can join a classic room and use the host-selected catalog", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await Promise.all([host.goto("/multi"), guest.goto("/multi")]);
    await Promise.all([dismissGuide(host), dismissGuide(guest)]);
    await host.getByLabel("参赛昵称").fill("浏览器房主");
    await host.getByRole("button", { name: "房间码", exact: true }).click();
    await host.getByRole("button", { name: "创建私密房间" }).click();
    const code = await host.locator(".pk-room-code strong").textContent();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await guest.getByLabel("参赛昵称").fill("浏览器访客");
    await guest.getByRole("button", { name: "房间码", exact: true }).click();
    await guest.getByLabel("输入房间码").fill(code);
    await guest.getByRole("button", { name: "加入", exact: true }).click();
    await expect(host.getByText("浏览器访客", { exact: true })).toBeVisible();
    await host.getByRole("group", { name: "选择多人题库" }).getByRole("button", { name: "扩展", exact: true }).click();
    await expect(guest.locator(".pk-room-code").getByText(/扩展题库/)).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("two players can synchronize clue ladder stages", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await Promise.all([host.goto("/multi"), guest.goto("/multi")]);
    await Promise.all([dismissGuide(host), dismissGuide(guest)]);
    await host.getByLabel("参赛昵称").fill("阶梯房主");
    await host.getByRole("button", { name: "房间码", exact: true }).click();
    await host.getByRole("button", { name: "创建私密房间" }).click();
    const code = await host.locator(".pk-room-code strong").textContent();
    await guest.getByLabel("参赛昵称").fill("阶梯访客");
    await guest.getByRole("button", { name: "房间码", exact: true }).click();
    await guest.getByLabel("输入房间码").fill(code);
    await guest.getByRole("button", { name: "加入", exact: true }).click();
    await expect(host.getByText("阶梯访客", { exact: true })).toBeVisible();
    await host.getByRole("group", { name: "选择多人玩法" }).getByRole("button", { name: "线索阶梯", exact: true }).click();
    await expect(guest.locator(".pk-room-code").getByText(/线索阶梯/)).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("mobile controls stay usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, locator] of [
    ["/solo", page.getByPlaceholder("输入作品名或拼音搜索…")],
    ["/clues", page.locator(".clue-current")],
    ["/timeline", page.getByText("本轮作品 · 日期暂时隐藏")],
    ["/multi", page.getByLabel("参赛昵称")],
  ]) {
    await page.goto(path);
    await dismissGuide(page);
    await expect(locator).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
});

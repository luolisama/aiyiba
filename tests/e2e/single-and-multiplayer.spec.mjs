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
  await page.getByRole("button", { name: "看答案并放弃本局" }).click();
  await page.getByRole("button", { name: "放弃并看答案" }).click();
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

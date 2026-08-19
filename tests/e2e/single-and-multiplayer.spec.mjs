import { expect, test } from "@playwright/test";

async function dismissGuide(page) {
  const button = page.getByRole("button", { name: /知道了，(开始(猜|游戏|挑战)|启动时光机)/ });
  await button.click({ timeout: 5_000 }).catch(() => {});
}

test("homepage exposes every mode and its rules dialog can close", async ({ page }) => {
  await page.goto("/");
  for (const [name, href] of [
    [/开始猜歌/, "/solo"],
    [/进入大厅/, "/multi"],
    [/挑战阶梯/, "/clues"],
    [/启动时光机/, "/timeline"],
  ]) {
    await expect(page.getByRole("link", { name })).toHaveAttribute("href", href);
  }

  await page.getByRole("button", { name: /查看完整收录与判定规则/ }).click();
  await expect(page.getByRole("heading", { name: "收录与判定规则" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("heading", { name: "收录与判定规则" })).toHaveCount(0);
});

test("single-player accepts pinyin and produces a downloadable result image", async ({ page }) => {
  await page.goto("/solo");
  await dismissGuide(page);
  await page.waitForTimeout(450);
  const search = page.getByPlaceholder("输入作品名或拼音搜索…");
  await search.fill("dalabengba");
  await page.getByText("达拉崩吧", { exact: true }).first().click();
  await page.getByRole("button", { name: /猜一下/ }).click();
  const surrender = page.getByRole("button", { name: "看答案并放弃本局" });
  if (await surrender.count()) {
    await surrender.click();
    await page.getByRole("button", { name: "放弃并看答案" }).click();
  }

  await page.getByRole("button", { name: "生成战绩图" }).click();
  const preview = page.getByAltText("生成的哎一把战绩图片预览");
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image) => image.naturalWidth)).toBe(1080);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存 PNG" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^哎一把-.+\.png$/u);
});

test("single-player can switch catalogs before the first guess", async ({ page }) => {
  await page.goto("/solo");
  await dismissGuide(page);
  await page.getByRole("button", { name: /切换为扩展题库/ }).click();
  await expect(page).toHaveURL(/\?catalog=extended/);
  await expect(page.getByText(/从扩展题库的 \d+ 首作品中/)).toBeVisible();
});

test("clue ladder reveals the next clue and supports pinyin search", async ({ page }) => {
  await page.goto("/clues");
  await dismissGuide(page);
  await expect(page.getByText("当前线索 · 引擎")).toBeVisible();
  await page.getByPlaceholder("输入作品名或拼音搜索…").fill("dalabengba");
  await expect(page.getByText("达拉崩吧", { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /跳过，下一条/ }).click();
  await expect(page.getByText("当前线索 · 播放等级")).toBeVisible();
});

test("time machine places a hidden-date work onto the timeline", async ({ page }) => {
  await page.goto("/timeline");
  await dismissGuide(page);
  await expect(page.getByText("本轮作品 · 日期暂时隐藏")).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "放在最前" }).click();
  await expect(page.locator(".timeline-board article")).toHaveCount(2);
  await expect(page.getByText(/放对了|差一点/)).toBeVisible();
});

test("two players can join a room and use the host-selected catalog", async ({ browser }) => {
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
    await host.getByRole("group", { name: "选择多人难度" }).getByRole("button", { name: "困难", exact: true }).click();
    await expect(guest.locator(".pk-room-code").getByText(/扩展题库 · 困难模式/)).toBeVisible();

    await host.getByRole("button", { name: "准备开始" }).click();
    await guest.getByRole("button", { name: "准备开始" }).click();
    await host.getByRole("button", { name: "开始多人游戏" }).click();
    const search = guest.getByPlaceholder("输入作品名或拼音搜索…");
    await expect(search).toBeVisible({ timeout: 8_000 });
    await search.fill("卡祖笛的悲风");
    await expect(guest.getByText("卡祖笛的悲风", { exact: true }).first()).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("two players can share clue ladder stages and skip into the next clue", async ({ browser }) => {
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
    await expect(guest.locator(".pk-room-code").getByText(/线索阶梯 · 标准题库 · 固定 6 次/)).toBeVisible();
    await host.getByRole("button", { name: "准备开始" }).click();
    await guest.getByRole("button", { name: "准备开始" }).click();
    await host.getByRole("button", { name: "开始多人游戏" }).click();

    await expect(host.getByRole("button", { name: "跳过", exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(guest.getByRole("button", { name: "跳过", exact: true })).toBeVisible({ timeout: 8_000 });
    await Promise.all([
      host.getByRole("button", { name: "跳过", exact: true }).click(),
      guest.getByRole("button", { name: "跳过", exact: true }).click(),
    ]);
    await expect(host.getByText(/第 2 \/ 6 层/)).toBeVisible({ timeout: 3_000 });
    await expect(guest.getByText(/第 2 \/ 6 层/)).toBeVisible({ timeout: 3_000 });
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

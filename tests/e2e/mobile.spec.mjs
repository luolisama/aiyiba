import { expect, test } from "@playwright/test";

async function dismissGuide(page) {
  const button = page.getByRole("button", { name: /知道了，(开始(猜|游戏|挑战)|启动时光机)/ });
  await button.click({ timeout: 5_000 }).catch(() => {});
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test("primary mode controls remain usable without horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/solo");
  await dismissGuide(page);
  const search = page.getByPlaceholder("输入作品名或拼音搜索…");
  const guess = page.getByRole("button", { name: /猜一下/ });
  await expect(search).toBeVisible();
  await expect(guess).toBeVisible();
  const searchBounds = await page.locator(".search-box").boundingBox();
  const guessBounds = await guess.boundingBox();
  expect(searchBounds).not.toBeNull();
  expect(guessBounds).not.toBeNull();
  expect(guessBounds.y).toBeGreaterThanOrEqual(searchBounds.y + searchBounds.height - 1);
  await expectNoHorizontalOverflow(page);

  for (const [path, locator] of [
    ["/clues", page.locator(".clue-current")],
    ["/timeline", page.getByText("本轮作品 · 日期暂时隐藏")],
    ["/multi", page.getByLabel("参赛昵称")],
  ]) {
    await page.goto(path);
    await dismissGuide(page);
    await expect(locator).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

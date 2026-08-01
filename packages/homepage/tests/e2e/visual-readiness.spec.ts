/**
 * Browser contracts for the semantic boundaries that make homepage captures reproducible.
 */

import { expect, type Page, test } from "playwright/test";
import sharp from "sharp";

const FIXED_TIME = new Date("2026-01-15T14:30:00.000Z");

test.use({
  reducedMotion: "reduce",
  timezoneId: "UTC",
  viewport: { width: 1280, height: 720 },
});

async function waitForTerminalChat(
  page: Page,
  renderedMessages: number,
  totalMessages = renderedMessages,
) {
  const state = page.locator("[data-phone-model]");
  await expect(state).toHaveAttribute("data-phone-model", "settled", {
    timeout: 20_000,
  });
  await expect(state).toHaveAttribute("data-chat-phase", "terminal");
  await expect(state).toHaveAttribute(
    "data-chat-rendered-messages",
    String(renderedMessages),
  );
  await expect(state).toHaveAttribute(
    "data-chat-total-messages",
    String(totalMessages),
  );
}

async function capturePhoneCanvas(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-shader-background]")).toHaveAttribute(
    "data-shader-background",
    "settled",
    { timeout: 20_000 },
  );
  await waitForTerminalChat(page, 5);

  const canvas = page.locator("[data-phone-scene] canvas");
  await expect(canvas).toBeVisible();
  await page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>("[data-phone-scene]");
    const root = scene?.closest<HTMLElement>(".theme-app");
    if (!scene || !root) throw new Error("Phone scene root is not available");
    for (const child of root.children) {
      if (!(child instanceof HTMLElement) || child.contains(scene)) continue;
      child.dataset.captureVisibility = child.style.visibility;
      child.style.visibility = "hidden";
    }
    const sceneCanvas = scene.querySelector<HTMLCanvasElement>("canvas");
    if (!sceneCanvas) throw new Error("Phone scene canvas is not available");
    sceneCanvas.dataset.captureBackground = sceneCanvas.style.backgroundColor;
    sceneCanvas.style.backgroundColor = "#fff";
  });
  const screenshot = await canvas.screenshot({ animations: "disabled" });
  await page.evaluate(() => {
    for (const child of document.querySelectorAll<HTMLElement>(
      "[data-capture-visibility]",
    )) {
      child.style.visibility = child.dataset.captureVisibility ?? "";
      delete child.dataset.captureVisibility;
    }
    const sceneCanvas = document.querySelector<HTMLCanvasElement>(
      "[data-phone-scene] canvas",
    );
    if (sceneCanvas) {
      sceneCanvas.style.backgroundColor =
        sceneCanvas.dataset.captureBackground ?? "";
      delete sceneCanvas.dataset.captureBackground;
    }
  });
  return sharp(screenshot)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
});

test("landing and leaderboard render identical terminal phone canvases", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const landing = await capturePhoneCanvas(page, "/");
  const leaderboard = await capturePhoneCanvas(page, "/leaderboard");

  expect(landing.info).toEqual(leaderboard.info);
  let differingPixels = 0;
  for (let offset = 0; offset < landing.data.length; offset += 4) {
    if (
      landing.data[offset] !== leaderboard.data[offset] ||
      landing.data[offset + 1] !== leaderboard.data[offset + 1] ||
      landing.data[offset + 2] !== leaderboard.data[offset + 2] ||
      landing.data[offset + 3] !== leaderboard.data[offset + 3]
    ) {
      differingPixels += 1;
    }
  }
  expect(differingPixels).toBe(0);
});

test("entering try mode commits the interrupted intro before readiness", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const state = page.locator("[data-phone-model]");
  await expect(state).toHaveAttribute("data-chat-phase", "animating", {
    timeout: 20_000,
  });
  await expect(state).toHaveAttribute("data-chat-rendered-messages", "1", {
    timeout: 20_000,
  });
  await expect(state).toHaveAttribute("data-chat-total-messages", "5");

  await page.getByRole("button", { name: "Try Now" }).click();
  await waitForTerminalChat(page, 5);
});

test("Telegram replay moves from loading to its six-message terminal state", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForTerminalChat(page, 5);

  await page.getByRole("button", { name: "Telegram" }).click();
  const state = page.locator("[data-phone-model]");
  await expect(state).toHaveAttribute("data-phone-model", "loading");
  await expect(state).toHaveAttribute("data-chat-phase", "animating");
  await expect(state).toHaveAttribute("data-chat-rendered-messages", "0");
  await expect(state).toHaveAttribute("data-chat-total-messages", "6");
  await waitForTerminalChat(page, 6);
});

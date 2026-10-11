import { test, expect } from "@playwright/test";

function wav(seconds = 2) {
  const samples = 16000 * seconds,
    data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(
      Math.round(5000 * Math.sin((2 * Math.PI * 440 * i) / 16000)),
      44 + 2 * i,
    );
  return data;
}

test("real MediaRecorder: record, pause, resume, upload, edit, search, playback, delete", async ({
  page,
  request,
}) => {
  let id = "";
  const title = `Browser practice ${Date.now()}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/record");
    await page.getByLabel("Session title").fill(title);
    await page.getByLabel("Practice category").selectOption("coding");
    await page.getByLabel("Spoken language").selectOption("en");
    await page.getByLabel("Tags").fill("e2e, backend");
    await page
      .getByLabel("Your notes")
      .fill("Synthetic browser microphone test");
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await expect(page.getByText("RECORDING IN PROGRESS")).toBeVisible();
    await expect
      .poll(async () => page.locator(".record-time").innerText())
      .not.toBe("00:00");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await page.locator(".record-time").innerText();
    await page.waitForTimeout(1200);
    await expect(page.locator(".record-time")).toHaveText(paused);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect
      .poll(async () => page.locator(".record-time").innerText())
      .not.toBe(paused);
    await page
      .getByRole("button", { name: "Finish recording", exact: true })
      .click();
    await expect(page.getByText("RECORDING CAPTURED")).toBeVisible();
    const uploaded = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/recordings") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save recording", exact: true })
      .click();
    const upload = await uploaded;
    expect(upload.status()).toBe(201);
    const rec = await upload.json();
    id = rec.id;
    expect(rec.duration_seconds).toBeGreaterThan(1);
    await expect(page).toHaveURL(new RegExp(`/recordings/${id}`));
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const audio = page.locator("audio");
    await expect
      .poll(() => audio.evaluate((el: HTMLAudioElement) => el.readyState))
      .toBeGreaterThanOrEqual(1);
    expect(
      await audio.evaluate((el: HTMLAudioElement) =>
        Number.isFinite(el.duration),
      ),
    ).toBe(true);
    await audio.evaluate((el: HTMLAudioElement) => el.play());
    await expect
      .poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
      .toBeGreaterThan(0.1);
    const range = await request.get(`/api/recordings/${id}/audio`, {
      headers: { Range: "bytes=0-19" },
    });
    expect(range.status()).toBe(206);
    await page.getByLabel("Title", { exact: true }).fill(`${title} revised`);
    await page.getByLabel("Spoken language").selectOption("ja");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved")).toBeVisible();
    await page.goto("/library");
    await page.getByLabel("Search recordings").fill(title);
    await expect(page.locator(".library-item")).toHaveCount(1);
    await page.getByRole("button", { name: "Behavioral", exact: true }).click();
    await expect(page.getByText("Nothing matches your filters")).toBeVisible();
    await page.getByRole("button", { name: "Coding", exact: true }).click();
    const filtered = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.url().includes("category=coding&language=ja"),
    );
    await page.getByLabel("Filter by language").selectOption("ja");
    expect((await filtered).status()).toBe(200);
    await expect(page.locator(".library-item")).toHaveCount(1);
    await page.locator(".library-item").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete recording" }).click();
    await expect(page).toHaveURL(/\/library$/);
    expect((await request.get(`/api/recordings/${id}`)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    if (id) await request.delete(`/api/recordings/${id}`);
  }
});

test("upload preview survives failed save and can be retried", async ({
  page,
  request,
}) => {
  let id = "";
  try {
    await page.goto("/record");
    await page.getByLabel("Session title").fill("Upload retry test");
    await page.getByLabel("Upload existing audio").setInputFiles({
      name: "practice.wav",
      mimeType: "audio/wav",
      buffer: wav(),
    });
    await expect(page.locator("audio")).toBeVisible();
    await page.route("**/api/recordings", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Temporary upload failure" }),
          })
        : route.continue(),
    );
    await page
      .getByRole("button", { name: "Save recording", exact: true })
      .click();
    await expect(page.locator(".error-banner[role=alert]")).toContainText(
      "Temporary upload failure",
    );
    await expect(page.locator("audio")).toBeVisible();
    await page.unroute("**/api/recordings");
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/recordings") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save recording", exact: true })
      .click();
    const result = await saved;
    id = (await result.json()).id;
    expect(result.status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(id));
  } finally {
    if (id) await request.delete(`/api/recordings/${id}`);
  }
});

test("microphone denial leaves recorder ready for retry", async ({
  page,
  context,
}) => {
  await context.clearPermissions();
  // Exercise the rejection path while keeping real MediaRecorder in the successful test.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(
        new DOMException("Microphone permission denied", "NotAllowedError"),
      );
  });
  await page.goto("/record");
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.locator(".error-banner[role=alert]")).toContainText(
    "Microphone permission denied",
  );
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeVisible();
});

test("mobile layout and live dashboard totals", async ({ page, request }) => {
  const before = await (await request.get("/api/stats")).json();
  let id = "";
  try {
    const res = await request.post("/api/recordings", {
      multipart: {
        title: "Dashboard synthetic fixture",
        category: "english",
        language: "zh",
        file: { name: "practice.wav", mimeType: "audio/wav", buffer: wav(3) },
      },
    });
    expect(res.status()).toBe(201);
    id = (await res.json()).id;
    const after = await (await request.get("/api/stats")).json();
    expect(after.total_sessions).toBe(before.total_sessions + 1);
    expect(after.total_seconds).toBe(before.total_seconds + 3);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".stat-number").first()).toHaveText(
      String(after.total_sessions).padStart(2, "0"),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const card of await page.locator(".glass-panel").all()) {
      const bounds = await card.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
    }
    await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  } finally {
    if (id) await request.delete(`/api/recordings/${id}`);
  }
});

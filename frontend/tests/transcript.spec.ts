import { test, expect } from "@playwright/test";
const id = process.env.E2E_TRANSCRIPT_ID;
test("real Whisper transcript: timestamp seek, highlight, correction and transcript search", async ({
  page,
  request,
}) => {
  test.skip(
    !id,
    "Run scripts/speech_smoke.py and supply E2E_TRANSCRIPT_ID for this opt-in real speech test",
  );
  const rec = await (await request.get(`/api/recordings/${id}`)).json();
  expect(rec.transcription_status).toBe("completed");
  expect(rec.segments.length).toBeGreaterThan(1);
  await page.goto(`/recordings/${id}`);
  await expect(page.locator(".segments .segment")).toHaveCount(
    rec.segments.length,
  );
  const second = rec.segments[1];
  await page.locator(".timestamp").nth(1).click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThanOrEqual(second.start);
  await expect(page.locator(".segment").nth(1)).toHaveClass(/active/);
  await page.locator("audio").evaluate((el: HTMLAudioElement) => el.pause());
  const text = page.locator(".segment textarea").nth(1),
    corrected = "Synthetic transcript correction searchable";
  try {
    await text.fill(corrected);
    await page.getByLabel("Title", { exact: true }).focus();
    await expect(page.getByText("Transcript updated")).toBeVisible();
    expect(
      (await (await request.get(`/api/recordings/${id}`)).json()).segments[1]
        .text,
    ).toBe(corrected);
    await page.goto("/library");
    await page.getByLabel("Search recordings").fill(corrected);
    await expect(page.locator(".library-item")).toHaveCount(1);
    await page.locator(".library-item").click();
    await page.screenshot({
      path: "test-results/transcript.png",
      fullPage: true,
    });
  } finally {
    await request.patch(`/api/recordings/${id}/segments/${second.id}`, {
      data: { text: second.text },
    });
  }
});

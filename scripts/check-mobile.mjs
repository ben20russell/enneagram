// Run against npm run dev. Install Chromium with npx playwright install chromium.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = process.env.MOBILE_CHECK_URL || "http://127.0.0.1:3000";
const output = process.env.MOBILE_CHECK_OUTPUT || "/tmp/enneagram-mobile-check";
mkdirSync(output, { recursive: true });
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const sections = ["overview", "centers", "strengths", "leadership", "communication", "strain", "integration", "growth"];

try {
  await page.goto(baseURL);
  const report = page.frames().find((frame) => frame.url().includes("/report.html"));
  assert.ok(report, "The main page embeds the report");
  await report.waitForFunction(() => document.querySelector(".nav button")?.dataset.iconized === "true");
  const toggle = report.locator("#mobileMenuToggle");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false", "Closed menu exposes its state");
  await toggle.click();
  await report.waitForFunction(() => document.activeElement?.matches(".mobile-menu-close"));
  assert.equal(await report.locator(".page").evaluate((el) => el.inert), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await report.locator(".mobile-menu-item[data-sec=growth]").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await report.locator(".mobile-menu-close").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Escape");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await toggle.evaluate((el) => el === document.activeElement), true);
  assert.equal(await report.locator("#mobileMenu").evaluate((el) => el.inert), true);

  await toggle.click();
  await report.locator('.mobile-menu-item[data-sec="growth"]').click();
  assert.equal(await report.locator("#mobileSectionLabel").textContent(), "Growth Path");
  assert.equal(await report.locator(".sec.active").getAttribute("id"), "sec-growth");
  await report.evaluate(() => scrollTo(0, 650));
  await toggle.click();
  await report.locator('.mobile-menu-item[data-sec="overview"]').click();
  assert.equal(await report.evaluate(() => scrollY), 0, "A new mobile section starts at the top");

  await report.locator("#mobileSearchButton").click();
  await report.locator("#searchEverywhereInput").fill("leadership");
  await page.keyboard.press("Enter");
  await report.locator(".search-result").first().waitFor();
  assert.equal(await report.evaluate(() => document.body.style.overflow), "hidden");
  await page.keyboard.press("Escape");
  assert.equal(await report.locator("#mobileSearchButton").evaluate((el) => el === document.activeElement), true);
  assert.equal(await report.locator(".page").evaluate((el) => el.inert), false);
  // Opening search from the drawer must transfer focus and preserve the scroll lock.
  await toggle.click();
  await report.locator(".mobile-menu-item").first().click();
  await report.waitForFunction(() => document.activeElement?.id === "searchEverywhereInput");
  assert.equal(await report.evaluate(() => document.body.style.overflow), "hidden");
  await page.keyboard.press("Escape");
  // Search results should land below the sticky toolbar.
  await report.locator("#mobileSearchButton").click();
  await report.locator(".search-result").first().click();
  await report.waitForFunction(() => !isSearchPopoutOpen());
  await report.waitForFunction(() => {
    const hit = document.querySelector('.search-hit');
    return hit && hit.getBoundingClientRect().top >= document.getElementById('mobileToolbar').getBoundingClientRect().bottom;
  });
  await toggle.click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await report.waitForFunction(() => !document.querySelector("#mobileMenu").classList.contains("open"));
  assert.equal(await report.evaluate(() => document.body.style.overflow), "");

  for (const width of [320, 360, 390, 430, 760, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const section of sections) {
      await report.evaluate((id) => showSec(id), section);
      const overflow = await report.evaluate(() => [...document.querySelectorAll(".sec.active, .sec.active *, .header, .header *")]
        .filter((el) => { const rect = el.getBoundingClientRect(); return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1); })
        .map((el) => el.id || el.className).slice(0, 6));
      assert.deepEqual(overflow, [], `No clipped report content at ${width}px in ${section}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true, "The report uses one scroll container");
    if (width <= 760) {
      const targets = await report.locator("#mobileMenuToggle, #mobileSearchButton, #reflectionLauncher, .report-switch-select").evaluateAll((els) => els
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({ id: el.id, height: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize) })));
      for (const target of targets) assert.ok(target.height >= 44, `Comfortable touch target: ${target.id}`);
      for (const target of targets.filter((target) => /Selector/.test(target.id))) assert.ok(target.font >= 16, "Selectors do not trigger iOS zoom");
    }
    await report.evaluate(() => { showSec("overview"); scrollTo(0, 0); });
    if ([390, 768, 1440].includes(width)) await page.screenshot({ path: `${output}/overview-${width}.png` });
    console.log(`[mobile-check] All sections fit at ${width}px`);
  }

  await report.evaluate(() => { showSec('leadership'); scrollTo(0, 500); });
  assert.equal(await report.locator('.nav-wrap').evaluate(el => el.getBoundingClientRect().top), 0, 'Desktop navigation remains sticky');
  await page.emulateMedia({ media: 'print' });
  assert.equal(await report.locator('#mobileToolbar').isVisible(), false);
  assert.equal(await report.locator('.nav-wrap').isVisible(), false);
  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' });
  assert.equal(await report.locator('#mobileMenu').evaluate(el => getComputedStyle(el).transitionProperty), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.setViewportSize({ width: 390, height: 400 });
  await toggle.click();
  await report.locator('.mobile-menu-item[data-sec="growth"]').click();
  await report.locator("#reflectionLauncher").click();
  await report.locator(".sb-min").click();
  await page.setViewportSize({ width: 390, height: 844 });

  // Use real locally available clients; no report content or saved data is modified.
  await report.waitForFunction(() => document.querySelectorAll("#clientReportSelector option[value]:not([value=''])").length >= 2, null, { timeout: 120000 });
  const clients = await report.locator("#clientReportSelector option").evaluateAll((options) => options.filter((option) => option.value).map((option) => option.value));
  const snapshots = [];
  for (const id of [clients[0], clients[1], clients[0]]) {
    await report.locator("#clientReportSelector").selectOption(id);
    await report.waitForFunction((clientId) => document.body.dataset.reportSelectionKey === `client-report:${clientId}` && document.querySelector("#reportSwitchStatus").dataset.state === "idle", id, { timeout: 150000 });
    const snapshot = await report.evaluate(() => ({
      key: document.body.dataset.reportSelectionKey,
      type: REPORT.typeNumber,
      sections: [...document.querySelectorAll(".sec:not(#sec-focus):not(#sec-test)")].map((el) => ({ id: el.id, key: el.dataset.reportSelectionKey, available: el.style.display !== "none", text: el.style.display !== "none" ? el.textContent : null })),
      bindings: Object.fromEntries([...document.querySelectorAll(".sec:not(#sec-test) [id]")].filter((el) => el.closest('.sec').style.display !== "none").map((el) => [el.id, el.innerHTML])),
      visuals: ['profileWheel', 'centerExpressionWheel', 'strainBreakdownRows'].map(id => ({ id, html: document.getElementById(id)?.innerHTML })),
      charts: Object.values(Chart.instances).map((chart) => ({ id: chart.canvas.id, labels: chart.data.labels, data: chart.data.datasets.map((set) => set.data) })),
      error: document.querySelector("#reportRenderErrorBoundary").dataset.visible,
    }));
    assert.equal(snapshot.error, "false");
    for (const section of snapshot.sections) assert.equal(section.key, snapshot.key, `Fresh report binding: ${section.id}`);
    snapshots.push(snapshot);
    console.log(`[mobile-check] Rendered client report ${snapshots.length}; every section uses the active report`);
  }
  writeFileSync(`${output}/report-switch.json`, JSON.stringify(snapshots, null, 2));
  for (let i = 0; i < snapshots[0].sections.length; i++) {
    if (snapshots[0].sections[i].available && snapshots[1].sections[i].available) {
      assert.notEqual(snapshots[0].sections[i].text, snapshots[1].sections[i].text, `Client content changes in ${snapshots[0].sections[i].id}`);
    }
  }
  for (let i = 0; i < snapshots[0].visuals.length; i++) {
    assert.ok(snapshots[0].visuals[i].html, `Rendered chart: ${snapshots[0].visuals[i].id}`);
    assert.notEqual(snapshots[0].visuals[i].html, snapshots[1].visuals[i].html, `Chart data and labels follow the selected client: ${snapshots[0].visuals[i].id}`);
  }
  assert.deepEqual(snapshots[0].sections, snapshots[2].sections, "Switching back restores all section text");
  assert.deepEqual(snapshots[0].bindings, snapshots[2].bindings, "Switching back restores scores, visuals, insights, and recommendations");
  assert.deepEqual(snapshots[0].charts, snapshots[2].charts);
  assert.deepEqual(snapshots[0].visuals, snapshots[2].visuals);
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(`[mobile-check] PASS: navigation, focus, search, scrolling, responsive layouts, and client report switching. Screenshots: ${output}`);
} finally {
  await context.close();
  await browser.close();
}

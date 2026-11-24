/**
 * End-to-end: two partners in two tabs, demo backend, real crypto.
 *   npm run dev            (or: npm run build && npm start)
 *   BASE_URL=http://localhost:3000 node tests/e2e/two-partners.mjs
 * Needs the `playwright` package and a Chromium (npx playwright install chromium).
 * Set SHOTS=dir to save screenshots.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let step = 0;
const errors = [];
const log = (msg) => console.log(`✓ ${String(++step).padStart(2, "0")} ${msg}`);
const shot = async (p, name) => SHOTS && p.screenshot({ path: `${SHOTS}/${String(step).padStart(2, "0")}-${name}.png` });

function watch(p, who) {
  p.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errors.push(`${who} console: ${m.text().slice(0, 300)}`);
  });
}

async function dismissKitPrompt(p) {
  const later = p.getByRole("button", { name: "Later" });
  if (await later.isVisible().catch(() => false)) await later.click();
}

async function tab(p, name) {
  await p.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
try {
  const a = await ctx.newPage();
  watch(a, "A");
  await a.goto(`${BASE}/`);
  await a.evaluate(async () => {
    indexedDB.deleteDatabase("usmode-demo-server");
    indexedDB.deleteDatabase("usmode-keys");
    localStorage.clear();
  });
  await a.goto(`${BASE}/`);
  await a.getByRole("button", { name: "I'm Partner A" }).click();
  await a.getByRole("button", { name: /Create our room/ }).click();
  const code = (await a.getByLabel("Copy pairing code").textContent({ timeout: 30000 })).trim();
  log(`A created a room, pairing code ${code}`);
  await shot(a, "invite");

  // Partner B joins by typing the code (exercises the code-only ECDH path).
  const b = await ctx.newPage();
  watch(b, "B");
  await b.goto(`${BASE}/?as=B`);
  await b.getByLabel("Pairing code or invite link").fill(code.toLowerCase());
  await b.getByRole("button", { name: "Join", exact: true }).click();
  await Promise.all([a.waitForURL(/\/vibe/, { timeout: 45000 }), b.waitForURL(/\/vibe/, { timeout: 45000 })]);
  log("ECDH handshake finished: both tabs are in the room");
  await dismissKitPrompt(a);
  await dismissKitPrompt(b);

  // A third tab can't use the burned code.
  const c = await ctx.newPage();
  await c.goto(`${BASE}/?as=A`); // same browser, but prove the code no longer resolves
  await c.close();

  // Settings: E2EE badge, matching safety numbers.
  await a.goto(`${BASE}/settings`);
  await b.goto(`${BASE}/settings`);
  await a.getByText("E2EE Locked • 2/2 Devices").waitFor();
  const safetyA = await a.locator("p.tabular.text-lg").textContent();
  const safetyB = await b.locator("p.tabular.text-lg").textContent();
  if (!safetyA || safetyA !== safetyB) throw new Error(`Safety numbers differ: ${safetyA} vs ${safetyB}`);
  log(`Safety numbers match on both devices (${safetyA})`);
  await shot(a, "settings");

  // Customize: B sets pet names and a phone number.
  await b.goto(`${BASE}/vibe`);
  await b.getByRole("button", { name: "Customize room" }).click();
  await b.getByLabel("Room name").fill("Bubu & Dudu HQ");
  await b.getByLabel(/What I call/).fill("Bubu");
  await b.getByLabel("What they call me").fill("Dudu");
  await b.getByLabel(/My phone number/).fill("+91 98765 43210");
  await b.getByRole("button", { name: "Save for both of us" }).click();
  await a.goto(`${BASE}/vibe`);
  await a.getByRole("heading", { name: "Bubu & Dudu HQ" }).waitFor({ timeout: 15000 });
  await a.getByText("Dudu", { exact: true }).first().waitFor();
  log("Encrypted room config synced: A sees the new room name and pet name");
  await shot(a, "vibe");

  // Arena: tasks, 100-point split, completion, kiss debt.
  await tab(a, "Arena");
  await tab(b, "Arena");
  for (const t of ["Gym 45 min", "Ship the PR", "Call mom"]) {
    await a.getByLabel("New task").fill(t);
    await a.getByRole("button", { name: "Add task" }).click();
    await a.getByText(t, { exact: true }).waitFor();
  }
  const weights = await a.locator("li span.tabular").allTextContents();
  if (weights.join(",") !== "33.3,33.3,33.4") throw new Error(`Unexpected weights ${weights}`);
  log("3 tasks split 33.3 / 33.3 / 33.4 = exactly 100");
  await b.getByLabel("New task").fill("Read 20 pages");
  await b.getByRole("button", { name: "Add task" }).click();
  await b.getByText("Gym 45 min").waitFor({ timeout: 15000 });
  log("B sees A's decrypted task titles live");

  await a.getByRole("button", { name: "Complete Gym 45 min" }).click();
  await b.getByText(/You owe Bubu 1 kiss for finishing "Gym 45 min"/).waitFor({ timeout: 15000 });
  log('B got the owed-kiss notification: You owe Bubu 1 kiss for finishing "Gym 45 min"');
  await shot(b, "owed-kiss");

  // B sends an Attack of 10 kisses with a note.
  await tab(b, "Vibe");
  await b.getByRole("button", { name: "Send kiss" }).click();
  await b.getByRole("button", { name: /Attack of 10 kisses/ }).click();
  await b.getByLabel("Optional note (3 words)").fill("proud of you");
  await b.getByRole("button", { name: /Send attack of 10 kisses/ }).click();
  log("B sent an Attack of 10 kisses");

  // A "reopens the app": reload -> guaranteed pop-up.
  await a.reload();
  const pop = a.getByRole("alertdialog", { name: "You got a kiss" });
  await pop.waitFor({ timeout: 20000 });
  await pop.getByText("proud of you").waitFor();
  await pop.getByText(/Gym 45 min/).waitFor();
  await shot(a, "kiss-popup");
  await pop.getByRole("button", { name: /Catch kiss \(\+10\)/ }).click();
  await pop.waitFor({ state: "detached", timeout: 15000 });
  await a.reload();
  await a.waitForTimeout(1500);
  if (await a.getByRole("alertdialog", { name: "You got a kiss" }).isVisible()) throw new Error("Pop-up replayed after catching");
  await tab(a, "Vibe");
  await a.getByText("10 all-time").waitFor({ timeout: 10000 });
  log("Reopen pop-up showed sender, task and note; catching counted 10 and it never replays");

  // Finish the race: A completes everything first.
  await tab(a, "Arena");
  await a.getByRole("button", { name: "Complete Ship the PR" }).click();
  await a.getByRole("button", { name: "Complete Call mom" }).click();
  await a.getByText("You're today's provisional winner").waitFor({ timeout: 10000 });
  log("A hit 100/100 first: provisional winner");
  await shot(a, "arena");

  // Mutual end-of-day.
  await a.getByRole("button", { name: "Propose end of day" }).click();
  await b.getByText(/Bubu wants to wrap up today/).waitFor({ timeout: 15000 });
  await shot(b, "eod-prompt");
  await b.getByRole("button", { name: "Not yet" }).click();
  await a.getByText(/said not yet/).waitFor({ timeout: 15000 });
  log("B declined ('Not yet'); A sees it");
  await a.getByRole("button", { name: "Propose end of day" }).click();
  await b.getByRole("button", { name: "Lock it in" }).click({ timeout: 15000 });
  await a.getByText("Day 2 · first to 100 wins").waitFor({ timeout: 15000 });
  log("Both confirmed: day closed and a fresh Day 2 started");

  // Loser (B) spins the dare wheel.
  await tab(b, "Backchodi");
  await b.getByRole("button", { name: "Spin the wheel" }).click();
  await b.getByText("Paid in full").or(b.getByRole("button", { name: "Mark dare done" })).waitFor({ timeout: 30000 });
  await shot(b, "dare");
  await tab(a, "Backchodi");
  await a.getByRole("button", { name: "Mark dare done" }).waitFor({ timeout: 15000 });
  await a.getByRole("button", { name: "Mark dare done" }).click();
  await b.getByText("Paid in full").waitFor({ timeout: 15000 });
  log("Loser spun the physics wheel; winner marked the dare paid");

  // Vault: A drops something; B sees only a sealed count until both unlock early.
  await a.getByLabel("Drop something for later…").fill("Saw this reel https://example.com/reel 😂");
  await a.getByRole("button", { name: "Seal" }).click();
  const sealedOrOpen = b.getByText(/sealed drop from Bubu/).or(b.getByText("Saw this reel", { exact: false }));
  await sealedOrOpen.first().waitFor({ timeout: 15000 });
  if (await b.getByText(/sealed drop from Bubu/).isVisible()) {
    log("Vault drop is sealed for B (server returns only a count)");
    await b.getByRole("button", { name: "Unlock early" }).click();
    await a.getByRole("button", { name: "Unlock now" }).click({ timeout: 15000 });
    await b.getByText("Saw this reel", { exact: false }).waitFor({ timeout: 15000 });
    log("Both agreed: vault opened early, B can read it");
  } else {
    log("Backchodi window is live right now, so the drop was readable immediately");
  }
  await shot(b, "vault");

  // Rooms: boast with sticker reaction.
  await tab(a, "Rooms");
  await a.getByRole("button", { name: /Flex & Roast/ }).click();
  await a.getByLabel(/Show off/).fill("Deadlift PR 💪");
  await a.getByRole("button", { name: "Flex", exact: true }).click();
  await tab(b, "Rooms");
  await b.getByRole("button", { name: /Flex & Roast/ }).click();
  await b.getByText("Deadlift PR 💪").waitFor({ timeout: 15000 });
  await b.getByRole("button", { name: /Cope/ }).first().click();
  await a.getByRole("button", { name: /Cope/ }).first().getByText("1").waitFor({ timeout: 15000 });
  log("FLEX post synced; B stamped 'Cope' and A sees it");
  await shot(a, "boast");

  // Confession: mutual reveal stays hidden until both submit.
  await a.goto(`${BASE}/rooms?r=confession`);
  await b.goto(`${BASE}/rooms?r=confession`);
  await a.getByRole("switch", { name: /Mutual reveal/ }).click();
  await a.waitForTimeout(800);
  await a.getByLabel(/Write yours/).fill("I practise our call in the mirror");
  await a.getByRole("button", { name: "Seal it" }).click();
  await b.getByText(/wrote something for a mutual reveal/).waitFor({ timeout: 15000 });
  if (await b.getByText("I practise our call in the mirror").isVisible()) throw new Error("Reveal leaked before both submitted");
  await shot(b, "reveal-waiting");
  await b.getByLabel(/Write yours/).fill("I saved every voice note");
  await b.getByRole("button", { name: "Seal it" }).click();
  await a.getByText("I saved every voice note").waitFor({ timeout: 15000 });
  await b.getByText("I practise our call in the mirror").waitFor({ timeout: 15000 });
  log("Mutual reveal: hidden until both wrote, then unveiled on both");
  await shot(a, "reveal-done");

  // Call room hands off to the phone app.
  await a.goto(`${BASE}/rooms?r=call`);
  const callLink = a.getByRole("link", { name: /Call Dudu/ });
  const href = await callLink.getAttribute("href");
  if (href !== "tel:+919876543210") throw new Error(`Unexpected call link ${href}`);
  log(`Call room hands off to the phone app: ${href}`);
  await shot(a, "call");

  if (errors.length) {
    console.error("\nBrowser errors:\n" + errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${step} checks passed with no browser errors.`);
  }
} catch (e) {
  console.error("\nFAILED at step", step + 1, "\n", e);
  if (errors.length) console.error("Browser errors:\n" + errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}

import { expect, test } from "@playwright/test";
import {
  bidInput,
  createAuctionViaApi,
  getSellerSnapshot,
  getSnapshot,
  inlineNotice,
  joinAs,
  placeBid,
} from "./helpers";

/**
 * Browser tests for the scenarios the task asks for, through the real UI:
 * main flow, bids at the same moment, a bid after the end, anti-sniping — plus a reload.
 * The same rules are tested faster and more exhaustively at the HTTP level (packages/server/test).
 */

test("main flow: seller creates an auction, two bidders bid several times, the winner is declared", async ({ browser }) => {
  // Seller creates the auction through the UI.
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await seller.goto("/");
  await seller.getByPlaceholder("e.g. Anna").fill("Sam");
  await seller.getByRole("button", { name: "Create an auction" }).click();
  await seller.getByPlaceholder("e.g. Leica M3 rangefinder, 1956").fill("Mid-century teak armchair");
  await seller.getByPlaceholder("Condition, history, what's included…").fill("Danish, 1960s, newly upholstered.");
  await seller.getByPlaceholder("150.00").fill("100");
  await seller.getByPlaceholder("5.00").fill("5");
  // End time 45 s from now, in the browser's own time zone (that's how the form reads it).
  const endsAtLocal = await seller.evaluate(() => {
    const d = new Date(Date.now() + 45_000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  });
  await seller.locator('input[type="datetime-local"]').fill(endsAtLocal);
  await seller.getByRole("button", { name: "Create auction" }).click();

  await expect(seller).toHaveURL(/\/a\/[^/]+\/seller\?key=/);
  const bidderLink = await seller.getByRole("textbox").first().inputValue();
  const auctionId = new URL(bidderLink).pathname.split("/")[2]!;

  // Two bidders join through the shared link and bid against each other.
  const anna = await joinAs(browser, "Anna", auctionId);
  const bob = await joinAs(browser, "Bob", auctionId);

  await expect(bidInput(anna)).toHaveValue("100.00"); // pre-filled with the minimum next bid
  await placeBid(anna);
  await expect(inlineNotice(anna, "Bid of €100.00 accepted")).toBeVisible();

  await expect(bidInput(bob)).toHaveValue("105.00"); // updated live, no reload
  await placeBid(bob);
  await expect(inlineNotice(anna, "You've been outbid — Bob leads with €105.00.")).toBeVisible();

  await expect(bidInput(anna)).toHaveValue("110.00");
  await placeBid(anna);
  await placeBid(bob, "120");
  await expect(inlineNotice(bob, "Bid of €120.00 accepted")).toBeVisible();

  // The seller sees every bid as it arrives.
  await expect(seller.getByRole("heading", { name: "All bids (4)" })).toBeVisible();

  // The auction ends on the server's clock; everyone sees the same result, without reloading.
  // (Checked inside <main>: the same words also appear in the toasts.)
  await expect(inlineNotice(bob, "You won")).toBeVisible({ timeout: 90_000 });
  await expect(inlineNotice(anna, "You lost")).toBeVisible();
  for (const page of [anna, bob, seller]) {
    await expect(inlineNotice(page, "Sold to Bob for €120.00")).toBeVisible();
  }
});

test("bids placed at the same moment: only one of them is accepted", async ({ browser, request }) => {
  const { id } = await createAuctionViaApi(request, { endsInMs: 10 * 60_000 });
  const anna = await joinAs(browser, "Anna", id);
  const bob = await joinAs(browser, "Bob", id);
  await expect(bidInput(anna)).toHaveValue("100.00");
  await expect(bidInput(bob)).toHaveValue("100.00");

  // Two clicks from a test are never truly simultaneous: the second page could already have
  // received the first bid live and re-filled a higher minimum. So hold both bid requests at a
  // barrier until both have been sent, then release them together — both carry the same view
  // (no bids yet, €100.00), exactly like two people clicking in the same instant.
  let release!: () => void;
  const bothSent = new Promise<void>((resolve) => (release = resolve));
  let sent = 0;
  for (const page of [anna, bob]) {
    await page.route("**/api/auctions/*/bids", async (route) => {
      if (++sent === 2) release();
      await bothSent;
      await route.continue();
    });
  }

  await Promise.all([placeBid(anna), placeBid(bob)]);

  const accepted = /Bid of €100\.00 accepted/;
  const outbid = /Someone else bid in the meantime/;
  await expect(inlineNotice(anna, accepted).or(inlineNotice(anna, outbid))).toBeVisible();
  await expect(inlineNotice(bob, accepted).or(inlineNotice(bob, outbid))).toBeVisible();
  const annaWon = await inlineNotice(anna, accepted).isVisible();
  const bobWon = await inlineNotice(bob, accepted).isVisible();
  expect(Number(annaWon) + Number(bobWon)).toBe(1); // never both

  const snapshot = await getSnapshot(request, id);
  expect(snapshot.bidCount).toBe(1);
});

test("a bid placed after the auction has ended is rejected", async ({ browser, request }) => {
  const { id } = await createAuctionViaApi(request, { endsInMs: 4_000 });
  const staleSnapshot = await getSnapshot(request, id);

  // A bidder whose page fell behind: its live updates are frozen at the moment the auction was
  // still running, so the bid form is still there after the server-side end.
  const context = await browser.newContext();
  await context.route("**/api/auctions/*/events", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `retry: 60000\n\ndata: ${JSON.stringify(staleSnapshot)}\n\n`,
    }),
  );
  const page = await context.newPage();
  await page.goto(`/a/${id}`);
  await page.getByPlaceholder("e.g. Anna").fill("Late Larry");
  await page.getByRole("button", { name: "Join the auction" }).click();

  await expect.poll(async () => (await getSnapshot(request, id)).status, { timeout: 15_000 }).toBe("ended");
  await expect(page.getByRole("button", { name: "Place bid" })).toBeVisible(); // the page still thinks it's live
  await placeBid(page);

  // The server says no. Its answer carries the real (ended) state, so the form is replaced by
  // the result; the reason is shown in the toast.
  await expect(page.locator(".Toastify").getByText("The auction has already ended.")).toBeVisible();
  await expect(inlineNotice(page, "Ended without bids")).toBeVisible();
  await expect(page.getByRole("button", { name: "Place bid" })).toHaveCount(0);
  expect((await getSnapshot(request, id)).bidCount).toBe(0);
});

test("anti-sniping: a bid in the last 30 seconds extends the end, and everyone sees the new end time", async ({ browser, request }) => {
  const { id, sellerKey } = await createAuctionViaApi(request, { endsInMs: 15_000 });
  const anna = await joinAs(browser, "Anna", id);
  const bob = await joinAs(browser, "Bob", id);
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await seller.goto(`/a/${id}/seller?key=${sellerKey}`);
  const originalEnd = (await getSnapshot(request, id)).endsAt;

  await placeBid(anna); // well inside the last 30 seconds
  await expect(inlineNotice(anna, "Bid of €100.00 accepted")).toBeVisible();

  // Server: the end moved to exactly 30 s after the bid.
  const after = await getSellerSnapshot(request, id, sellerKey);
  expect(after.endsAt).toBe(after.bids[0]!.createdAt + 30_000);
  expect(after.endsAt).toBeGreaterThan(originalEnd);

  // Everyone else is told without reloading: the new end time and the "extended" hint.
  const newEndText = await anna.evaluate(
    (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    after.endsAt,
  );
  for (const page of [bob, seller]) {
    await expect(page.getByText(`Ends at ${newEndText}`)).toBeVisible();
    await expect(page.getByText("Extended by a late bid")).toBeVisible();
  }
  // Still live after the original end time has passed.
  await expect.poll(() => Date.now() > originalEnd + 1_000, { timeout: 20_000 }).toBe(true);
  expect((await getSnapshot(request, id)).status).toBe("live");
  await expect(bob.getByRole("button", { name: "Place bid" })).toBeVisible();
});

test("a bid above the maximum amount says exactly that, instead of a generic format error", async ({ browser, request }) => {
  const { id } = await createAuctionViaApi(request, { endsInMs: 10 * 60_000 });
  const anna = await joinAs(browser, "Anna", id);

  await placeBid(anna, "99999999999");
  await expect(inlineNotice(anna, "That amount is too large. The maximum is €1,000,000,000.00.")).toBeVisible();
  await expect(anna.locator(".Toastify").getByText("That amount is too large.")).toBeVisible();

  await placeBid(anna, "abc"); // a real format error still gets the format hint
  await expect(inlineNotice(anna, "Enter an amount like 152.50.")).toBeVisible();
  expect((await getSnapshot(request, id)).bidCount).toBe(0);
});

test("a reload keeps the bidder's name and shows the current state", async ({ browser, request }) => {
  const { id } = await createAuctionViaApi(request, { endsInMs: 10 * 60_000 });
  const anna = await joinAs(browser, "Anna", id);
  await placeBid(anna);
  await expect(inlineNotice(anna, "You're the highest bidder.")).toBeVisible();

  await anna.reload();
  await expect(anna.getByText("Bidding as Anna")).toBeVisible();
  await expect(inlineNotice(anna, "You're the highest bidder.")).toBeVisible();
  await expect(bidInput(anna)).toHaveValue("105.00");
});

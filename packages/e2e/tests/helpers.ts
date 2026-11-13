import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type { AuctionSnapshot, CreateAuctionResponse, SellerSnapshot } from "@auction/shared";

/**
 * Setup goes through the API (fast, precise end times); everything the tests *check* is done
 * through the UI, the way a person would use it. Each browser context is a separate person:
 * its own localStorage, so its own bidder identity.
 */

export async function createAuctionViaApi(
  request: APIRequestContext,
  { endsInMs, title = "Test item", startingPrice = 10_000, increment = 500 }: {
    endsInMs: number;
    title?: string;
    startingPrice?: number;
    increment?: number;
  },
): Promise<CreateAuctionResponse> {
  const res = await request.post("/api/auctions", {
    data: {
      title,
      description: "Created by the browser tests",
      startingPriceCents: startingPrice,
      minIncrementCents: increment,
      endsAt: Date.now() + endsInMs,
      sellerName: "Sam",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as CreateAuctionResponse;
}

export async function getSnapshot(request: APIRequestContext, id: string): Promise<AuctionSnapshot> {
  return (await (await request.get(`/api/auctions/${id}`)).json()) as AuctionSnapshot;
}

export async function getSellerSnapshot(request: APIRequestContext, id: string, key: string): Promise<SellerSnapshot> {
  return (await (await request.get(`/api/auctions/${id}/seller?key=${key}`)).json()) as SellerSnapshot;
}

/** A new person (fresh browser context) opens the bidder link and joins with a name. */
export async function joinAs(browser: Browser, name: string, auctionId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/a/${auctionId}`);
  await page.getByPlaceholder("e.g. Anna").fill(name);
  await page.getByRole("button", { name: "Join the auction" }).click();
  await expect(page.getByText(`Bidding as ${name}`)).toBeVisible();
  return page;
}

export function bidInput(page: Page) {
  return page.getByLabel("Bid amount in euros");
}

/** Place a bid through the form; without an amount it uses the pre-filled minimum. */
export async function placeBid(page: Page, amount?: string): Promise<void> {
  if (amount !== undefined) await bidInput(page).fill(amount);
  await page.getByRole("button", { name: "Place bid" }).click();
}

/** The inline (non-toast) feedback under the bid form. */
export function inlineNotice(page: Page, text: string | RegExp) {
  return page.locator("main").getByText(text);
}

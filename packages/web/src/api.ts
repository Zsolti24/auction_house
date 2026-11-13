import type {
  ApiError,
  CreateAuctionInput,
  CreateAuctionResponse,
  PlaceBidInput,
  PlaceBidResponse,
  SellerSnapshot,
} from "@auction/shared";

/** Non-2xx response (other than a 409 bid rejection), or the server could not be reached. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? (status === 0 ? "Could not reach the server. Check your connection." : `Request failed (${status})`));
  }
}

async function postJson(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, null);
  }
}

async function errorFrom(res: Response): Promise<ApiRequestError> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return new ApiRequestError(res.status, body);
}

export async function createAuction(input: CreateAuctionInput): Promise<CreateAuctionResponse> {
  const res = await postJson("/api/auctions", input);
  if (res.status !== 201) throw await errorFrom(res);
  return (await res.json()) as CreateAuctionResponse;
}

/** Resolves for both accepted (201) and rejected (409) bids — a rejection is a normal outcome. */
export async function placeBid(auctionId: string, input: PlaceBidInput): Promise<PlaceBidResponse> {
  const res = await postJson(`/api/auctions/${encodeURIComponent(auctionId)}/bids`, input);
  if (res.status !== 201 && res.status !== 409) throw await errorFrom(res);
  return (await res.json()) as PlaceBidResponse;
}

/** Seller ends the auction now. Rejected with 409 (has bids / already ended) or 403 (wrong key). */
export async function endAuctionEarly(auctionId: string, sellerKey: string): Promise<SellerSnapshot> {
  const res = await postJson(`/api/auctions/${encodeURIComponent(auctionId)}/end`, { sellerKey });
  if (res.status !== 200) throw await errorFrom(res);
  return (await res.json()) as SellerSnapshot;
}

/** Used when a stream fails to open, to tell "not found" / "forbidden" apart from "offline". */
export async function probeStatus(path: string): Promise<number> {
  try {
    return (await fetch(path)).status;
  } catch {
    return 0;
  }
}

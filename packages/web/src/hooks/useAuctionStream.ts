import type { AuctionSnapshot, LiveAuctionsSnapshot } from "@auction/shared";
import { pickNewer, pickNewerList } from "../lib/view";
import { useEventStream } from "./useEventStream";

export type { ConnectionState } from "./useEventStream";

/** One auction's live state (public or seller view). */
export function useAuctionStream<T extends AuctionSnapshot>(streamUrl: string, probeUrl: string) {
  const { data, ...rest } = useEventStream<T>(streamUrl, probeUrl, pickNewer);
  return { snapshot: data, ...rest };
}

/** The live-auctions list. */
export function useLiveAuctions() {
  const { data, ...rest } = useEventStream<LiveAuctionsSnapshot>(
    "/api/live-auctions/events",
    "/api/live-auctions",
    pickNewerList,
  );
  return { list: data, ...rest };
}

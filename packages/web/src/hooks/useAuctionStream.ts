import type { AuctionSnapshot, AuctionListSnapshot } from "@auction/shared";
import { pickNewer, pickNewerList } from "../lib/view";
import { useEventStream } from "./useEventStream";

export type { ConnectionState } from "./useEventStream";

/** One auction's live state (public or seller view). */
export function useAuctionStream<T extends AuctionSnapshot>(streamUrl: string, probeUrl: string) {
  const { data, ...rest } = useEventStream<T>(streamUrl, probeUrl, pickNewer);
  return { snapshot: data, ...rest };
}

/** The auction list (lobby): running and recently ended auctions. */
export function useAuctionList() {
  const { data, ...rest } = useEventStream<AuctionListSnapshot>(
    "/api/lobby/events",
    "/api/lobby",
    pickNewerList,
  );
  return { list: data, ...rest };
}

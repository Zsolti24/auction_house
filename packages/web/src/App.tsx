import { BidderPage } from "./pages/BidderPage";
import { CreatePage } from "./pages/CreatePage";
import { SellerPage } from "./pages/SellerPage";
import { Unavailable } from "./pages/states";
import { useLocation } from "./router";

export function App() {
  const location = useLocation();
  const url = new URL(location, window.location.origin);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  const seller = /^\/a\/([^/]+)\/seller$/.exec(path);
  if (seller) {
    return (
      // key: remount (and reconnect) when navigating between auctions
      <SellerPage
        key={seller[1]}
        auctionId={decodeURIComponent(seller[1]!)}
        sellerKey={url.searchParams.get("key") ?? ""}
        justCreated={url.searchParams.has("created")}
      />
    );
  }

  const bidder = /^\/a\/([^/]+)$/.exec(path);
  if (bidder) return <BidderPage key={bidder[1]} auctionId={decodeURIComponent(bidder[1]!)} />;

  if (path === "/") return <CreatePage />;

  return <Unavailable message="Page not found." />;
}

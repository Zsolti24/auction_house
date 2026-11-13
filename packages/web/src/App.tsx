import { RequireName } from "./components/NameForm";
import { BidderPage } from "./pages/BidderPage";
import { CreatePage } from "./pages/CreatePage";
import { LandingPage } from "./pages/LandingPage";
import { LobbyPage } from "./pages/LobbyPage";
import { SellerPage } from "./pages/SellerPage";
import { Unavailable } from "./pages/states";
import { useLocation } from "./router";

/**
 * Routes:
 *   /                       landing: name + "Bid" / "Create"
 *   /auctions               live list of running auctions (needs a name)
 *   /create                 create an auction (needs a name)
 *   /a/:id                  bidder page (asks for a name inline if missing)
 *   /a/:id/seller?key=…     seller page
 */
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

  switch (path) {
    case "/":
      return <LandingPage />;
    case "/auctions":
      return (
        <RequireName purpose="bid on auctions">
          <LobbyPage />
        </RequireName>
      );
    case "/create":
      return (
        <RequireName purpose="create an auction">
          <CreatePage />
        </RequireName>
      );
    default:
      return <Unavailable message="Page not found." />;
  }
}

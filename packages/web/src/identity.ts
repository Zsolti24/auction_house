import { useCallback, useState } from "react";

/**
 * Bidder identity without accounts: a random id plus a display name, kept in localStorage so a
 * reload keeps both. The id (not the name) decides "you are leading" / "you won", so two people
 * called Anna are still told apart.
 */

const IDENTITY_KEY = "auction-house:bidder";
const participatedKey = (auctionId: string) => `auction-house:participated:${auctionId}`;

export interface BidderIdentity {
  id: string;
  name: string | null;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked (private mode, disabled cookies): fall back to memory
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore: identity then only lasts for this page load
  }
}

/** crypto.randomUUID only exists in secure contexts (https / localhost); fall back elsewhere. */
function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadIdentity(): BidderIdentity {
  try {
    const parsed = JSON.parse(readStorage(IDENTITY_KEY) ?? "null") as Partial<BidderIdentity> | null;
    if (parsed && typeof parsed.id === "string") {
      return { id: parsed.id, name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : null };
    }
  } catch {
    // corrupted value: start fresh
  }
  const identity = { id: newId(), name: null };
  writeStorage(IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}

export function useBidderIdentity() {
  const [identity, setIdentity] = useState<BidderIdentity>(loadIdentity);

  const setName = useCallback((name: string | null) => {
    setIdentity((current) => {
      const next = { ...current, name: name?.trim() || null };
      writeStorage(IDENTITY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { identity, setName };
}

/** Remembers that this browser placed an accepted bid, so "You lost" survives reloads. */
export function markParticipated(auctionId: string): void {
  writeStorage(participatedKey(auctionId), "1");
}

export function hasParticipated(auctionId: string): boolean {
  return readStorage(participatedKey(auctionId)) === "1";
}

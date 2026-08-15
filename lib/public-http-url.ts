import net from "node:net";
import { lookup } from "node:dns/promises";

function isNonPublicIpAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4) return isNonPublicIpAddress(mappedIpv4[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isNonPublicIpAddress(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
  }
  if (!net.isIPv6(normalized)) return false;
  if (normalized === "::" || normalized === "::1") return true;
  const firstGroup = parseInt(normalized.split(":")[0], 16);
  if (Number.isNaN(firstGroup)) return true;
  return (firstGroup >= 0xfe80 && firstGroup <= 0xfebf)
    || (firstGroup & 0xfe00) === 0xfc00;
}

export async function isPublicHttpUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname.replace(/^\[(.+)\]$/, "$1");
  if (isNonPublicIpAddress(hostname)) return false;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return false;
  }
  return addresses.every((entry) => !isNonPublicIpAddress(entry.address));
}

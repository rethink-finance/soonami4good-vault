import { formatUnits, parseUnits } from "viem";

/**
 * An 18-decimal amount for display, rounded DOWN so the page never shows more
 * than is there. Trailing zeros are dropped; dust below the last shown digit
 * reads as "<0.0001" rather than a misleading zero.
 */
export const fmtAmount = (wei: bigint, maxDecimals = 4): string => {
  if (wei === 0n) return "0";
  const unit = 10n ** BigInt(18 - maxDecimals);
  const floored = (wei / unit) * unit;
  if (floored === 0n) return `<${formatUnits(unit, 18)}`;
  const [whole, fraction = ""] = formatUnits(floored, 18).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
};

/**
 * The same, rounded to the NEAREST shown digit. For sciETH amounts: the vault
 * mints in parts per billion, so 2 ETH becomes 1.999999998 sciETH, and
 * flooring that to "1.9999" would look like a fee that does not exist.
 */
export const fmtRounded = (wei: bigint, maxDecimals = 4): string => {
  const unit = 10n ** BigInt(18 - maxDecimals);
  return fmtAmount(((wei + unit / 2n) / unit) * unit, maxDecimals);
};

/** The exact amount as an editable string, for filling the input on "Max". */
export const toInput = (wei: bigint): string => formatUnits(wei, 18);

/** What the visitor typed, in wei. Undefined while it is not a valid amount. */
export const parseAmount = (text: string): bigint | undefined => {
  const cleaned = text.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return undefined;
  const [, fraction = ""] = cleaned.split(".");
  if (fraction.length > 18) return undefined;
  try {
    return parseUnits(cleaned, 18);
  } catch {
    return undefined;
  }
};

export const shortAddress = (address: string): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export const fmtDate = (seconds: bigint): string =>
  new Date(Number(seconds) * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Basis points as a percentage: 25 becomes "0.25%". */
export const fmtBps = (bps: bigint): string => `${Number(bps) / 100}%`;

/**
 * The vault's own arithmetic, mirrored so the page can say what a deposit or
 * redemption will give before anything is signed. Kept free of chain access
 * so it can be tested against numbers taken from the contract.
 *
 * Source: GovernableFundFlows.sol (_handleDeposit, withdraw, valueOf).
 */

const MAX_BPS = 10_000n;
const FRACTION_BASE = 1_000_000_000n; // 1e9, the contract's share precision
const ROUND_BASE = 1_000n;

export interface VaultFigures {
  /** totalNAV(): everything the vault counts, in WETH wei. */
  totalNav: bigint;
  /** sciETH in existence. */
  totalSupply: bigint;
  depositFeeBps: bigint;
  withdrawFeeBps: bigint;
}

const roundToBase = (value: bigint, base: bigint) =>
  value / base + (value % base >= base / 2n ? 1n : 0n);

/**
 * sciETH minted for a deposit of `amount` WETH settling against these
 * figures. The contract works in parts per 1e9, so the result can land a few
 * billionths under the 1:1 a depositor expects; that remainder stays in the
 * vault.
 */
export const sharesForDeposit = (amount: bigint, vault: VaultFigures): bigint => {
  if (amount <= 0n) return 0n;
  const fee = (amount * vault.depositFeeBps) / MAX_BPS;
  const net = amount - fee;
  const navAfter = vault.totalNav + net;
  if (navAfter === 0n) return 0n;
  const fraction = (net * FRACTION_BASE) / navAfter;
  if (vault.totalSupply === 0n) return roundToBase(navAfter * ROUND_BASE, ROUND_BASE);
  // Supply with nothing behind it: the contract divides by zero and reverts.
  if (fraction >= FRACTION_BASE) return 0n;
  return roundToBase(
    (vault.totalSupply * fraction * ROUND_BASE) / (FRACTION_BASE - fraction),
    ROUND_BASE,
  );
};

/** WETH paid out for redeeming `shares`, before the vault's own rounding. */
export const valueForRedemption = (shares: bigint, vault: VaultFigures): bigint => {
  if (shares <= 0n || vault.totalSupply === 0n) return 0n;
  const gross = (vault.totalNav * shares) / vault.totalSupply;
  const fee = (gross * vault.withdrawFeeBps) / MAX_BPS;
  return gross - fee;
};

/** WETH behind one whole sciETH, in wei. 1:1 while the vault is empty. */
export const sharePrice = (vault: VaultFigures): bigint => {
  const one = 10n ** 18n;
  if (vault.totalSupply === 0n) return one;
  return (vault.totalNav * one) / vault.totalSupply;
};

/**
 * Whether a request can be settled now. The contract settles a request only
 * against a valuation made after it, except before the vault's very first
 * valuation, when requests settle straight away.
 */
export const isSettleable = (requestTime: bigint, lastNavUpdateTime: bigint): boolean => {
  if (requestTime === 0n) return false;
  return lastNavUpdateTime === 0n || requestTime < lastNavUpdateTime;
};

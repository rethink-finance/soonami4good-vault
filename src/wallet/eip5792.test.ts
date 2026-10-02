import { describe, expect, it } from "vitest";
import {
  isBatchUnsupportedError,
  isUpgradeRejectionError,
  isUserRejectionError,
  isWalletCallsSuccess,
  isWalletRpcHealthError,
  normalizeCallsStatus,
  parseAtomicBatchStatus,
} from "./eip5792";

describe("parseAtomicBatchStatus", () => {
  it("finds the chain however its id is written", () => {
    expect(parseAtomicBatchStatus({ "0x1": { atomic: { status: "supported" } } }, "0x1")).toBe("supported");
    expect(parseAtomicBatchStatus({ "0x01": { atomic: { status: "ready" } } }, "0x1")).toBe("ready");
  });
  it("is unsupported for anything else", () => {
    expect(parseAtomicBatchStatus({ "0xa4b1": { atomic: { status: "supported" } } }, "0x1")).toBe("unsupported");
    expect(parseAtomicBatchStatus({ "0x1": {} }, "0x1")).toBe("unsupported");
    expect(parseAtomicBatchStatus(undefined, "0x1")).toBe("unsupported");
  });
});

describe("status and error dialects", () => {
  it("normalizes old string statuses", () => {
    expect(normalizeCallsStatus("CONFIRMED")).toBe(200);
    expect(normalizeCallsStatus("pending")).toBe(100);
    expect(normalizeCallsStatus(500)).toBe(500);
    expect(normalizeCallsStatus("who knows")).toBe(100);
  });
  it("only calls a bundle successful when every receipt is", () => {
    expect(isWalletCallsSuccess({ statusCode: 200, receipts: [{ status: "0x1" }] })).toBe(true);
    expect(isWalletCallsSuccess({ statusCode: 200, receipts: [{ status: "0x0" }] })).toBe(false);
    expect(isWalletCallsSuccess({ statusCode: 500, receipts: [] })).toBe(false);
  });
  it("tells a refusal from an unsupported wallet from a failing endpoint", () => {
    expect(isUserRejectionError({ code: 4001 })).toBe(true);
    expect(isUserRejectionError({ message: "User rejected the request." })).toBe(true);
    expect(isUpgradeRejectionError({ code: 5750 })).toBe(true);
    expect(isBatchUnsupportedError({ code: -32601 })).toBe(true);
    expect(isBatchUnsupportedError({ message: "Method wallet_sendCalls not supported" })).toBe(true);
    expect(isBatchUnsupportedError({ code: 4001 })).toBe(false);
    expect(isWalletRpcHealthError({ message: "RPC endpoint returned too many errors" })).toBe(true);
  });
});

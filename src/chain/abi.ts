import { parseAbi } from "viem";

/** The slice of GovernableFund this page reads and writes. */
export const vaultAbi = parseAbi([
  "function totalNAV() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function delegates(address) view returns (address)",
  "function _navUpdateLatestTime() view returns (uint256)",
  "function _feeBal() view returns (uint256)",
  "struct Settings { uint256 depositFee; uint256 withdrawFee; uint256 performanceFee; uint256 managementFee; uint256 performaceHurdleRateBps; address baseToken; address safe; bool isExternalGovTokenInUse; bool isWhitelistedDeposits; address[] allowedDepositAddrs; address[] allowedManagers; address governanceToken; address fundAddress; address governor; string fundName; string fundSymbol; address[4] feeCollectors; }",
  "function getFundSettings() view returns (Settings)",
  "function fundFlowsCall(bytes flowCall)",
  "function delegate(address delegatee)",
]);

/**
 * The calls fundFlowsCall forwards. They are not functions of the vault
 * itself: the vault delegatecalls its flows module with these as the payload.
 */
export const flowsAbi = parseAbi([
  "function requestDeposit(uint256 amount)",
  "function deposit()",
  "function requestWithdraw(uint256 amount)",
  "function withdraw()",
  "function revokeDepositWithrawal(bool isDeposit)",
]);

export const wethAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit() payable",
  "function withdraw(uint256 amount)",
]);

export const multicall3Abi = parseAbi([
  "function getEthBalance(address addr) view returns (uint256)",
]);

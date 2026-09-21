/**
 * transaction_builder.ts
 *
 * Builds, signs, and submits Soroban transactions for the SorobanPay protocol.
 *
 * Flow:
 *   1. Fetch account sequence number from Soroban RPC
 *   2. Build transaction with `subscribe` contract call
 *   3. prepareTransaction (simulates and fills resource fees)
 *   4. Sign with Freighter via signTx()
 *   5. Submit and poll for confirmation (up to 60 seconds)
 */

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  Address,
  xdr,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { signTx } from './wallet_manager';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Parameters for creating a new subscription */
export interface SubscribeParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
  /** Payment amount as a positive integer (in token's smallest unit) */
  amount: number;
  /** Payment interval in seconds [86400, 31536000] */
  interval: number;
}

/** Result of a successful subscription transaction */
export interface SubscribeResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/** Contract event displayed in the frontend history table */
export interface ContractEventRecord {
  id: string;
  type: 'created' | 'renewed' | 'cancelled' | 'expired' | 'unknown';
  rawType: string;
  timestamp: string;
  ledger: number;
  subscriber: string;
  amount: string;
  pagingToken?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 60; // 60 seconds total
const DEFAULT_EVENT_LIMIT = 100;

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Build, sign, and submit a `subscribe` transaction to the SorobanPay contract.
 *
 * @param params            Subscription parameters
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On any failure: construction, signing, submission, or timeout
 */
export async function buildAndSubmitSubscribe(
  params: SubscribeParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string
): Promise<SubscribeResult> {
  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Fetch account
  const account = await server.getAccount(publicKey);

  // 2. Build transaction
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'subscribe',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
        new Address(params.token).toScVal(),
        nativeToScVal(BigInt(params.amount), { type: 'i128' }),
        nativeToScVal(BigInt(params.interval), { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build();

  // 3. Prepare transaction (simulation + resource fee injection)
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  // 4. Sign with Freighter
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  // 5. Submit
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`
    );
  }

  // 6. Poll for confirmation
  const txHash = await pollForConfirmation(server, sendResult.hash);

  return { txHash };
}

/**
 * Fetch lifecycle events emitted by the subscription contract.
 *
 * The current contract emits `subscribe` and `executed` events. The UI maps
 * those to the issue's lifecycle names (`created` and `renewed`) while still
 * supporting future `cancelled` and `expired` event names if the contract adds
 * them later.
 */
export async function fetchContractEvents(
  contractId: string,
  rpcUrl: string,
  startLedger: number,
  limit = DEFAULT_EVENT_LIMIT,
  cursor?: string
): Promise<ContractEventRecord[]> {
  if (!contractId) {
    return [];
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const response = await server.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [contractId] }],
    limit,
    cursor,
  });

  return response.events.map((event, index) =>
    toContractEventRecord(event, index)
  );
}

// ── Polling helper ────────────────────────────────────────────────────────────

async function pollForConfirmation(
  server: SorobanRpc.Server,
  hash: string
): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const result = await server.getTransaction(hash);

    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }

    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      const meta = (result as SorobanRpc.Api.GetFailedTransactionResponse).resultMetaXdr;
      throw new Error(
        `Transaction failed on-chain: ${meta ?? 'no result meta available'}`
      );
    }

    // status === NOT_FOUND — still in mempool, continue polling
  }

  throw new Error(
    `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toContractEventRecord(
  event: SorobanRpc.Api.EventResponse,
  index: number
): ContractEventRecord {
  const rawType = readTopic(event.topic[0]);
  const subscriber = readTopic(event.topic[1]);
  const amount = readValue(event.value);

  return {
    id: event.id ?? `${event.ledger}-${index}`,
    type: normalizeEventType(rawType),
    rawType,
    timestamp: event.ledgerClosedAt ?? 'Unknown',
    ledger: event.ledger,
    subscriber,
    amount,
    pagingToken: event.pagingToken,
  };
}

function normalizeEventType(rawType: string): ContractEventRecord['type'] {
  const normalized = rawType.toLowerCase();

  if (normalized === 'subscribe' || normalized === 'created') {
    return 'created';
  }

  if (normalized === 'executed' || normalized === 'renewed') {
    return 'renewed';
  }

  if (normalized === 'cancel' || normalized === 'cancelled') {
    return 'cancelled';
  }

  if (normalized === 'expire' || normalized === 'expired') {
    return 'expired';
  }

  return 'unknown';
}

function readTopic(value?: xdr.ScVal): string {
  if (!value) {
    return 'Unknown';
  }

  return readNative(value);
}

function readValue(value: xdr.ScVal): string {
  return readNative(value);
}

function readNative(value: xdr.ScVal): string {
  try {
    const native = scValToNative(value);
    if (typeof native === 'bigint') {
      return native.toString();
    }

    if (typeof native === 'string' || typeof native === 'number') {
      return String(native);
    }

    if (native && typeof native === 'object' && 'toString' in native) {
      return String(native);
    }

    return JSON.stringify(native);
  } catch {
    return value.toXDR('base64');
  }
}

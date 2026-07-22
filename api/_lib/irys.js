/**
 * Irys helper — Synergix permanent storage via Arweave (BNB payments)
 *
 * Reads  → queryByTags() + fetchById() — no key required, plain fetch
 * Writes → uploadJSON()               — requires funded BNB wallet (IRYS_PRIVATE_KEY)
 *
 * validateConfig() is called at the start of every API request.
 * If IRYS_PRIVATE_KEY is absent the system halts immediately (fail-fast).
 */

import { Uploader } from "@irys/upload";
import { BNB }      from "@irys/upload-ethereum";

export const IRYS_GATEWAY = process.env.IRYS_GATEWAY || "https://gateway.irys.xyz";
export const IRYS_GRAPHQL = "https://uploader.irys.xyz/graphql";
export const APP_NAME     = "Synergix";

let _client = null;

/**
 * Fail-fast: throws if IRYS_PRIVATE_KEY is not configured.
 * Must be called at the start of every API handler.
 */
export function validateConfig() {
  if (!process.env.IRYS_PRIVATE_KEY) {
    throw new Error(
      "CRITICAL: IRYS_PRIVATE_KEY environment variable is not set. " +
      "A BNB-funded Irys wallet is required to operate on mainnet. System halted."
    );
  }
}

/**
 * Lazy singleton Irys client (BNB mainnet).
 * Only used for uploads — reads go directly via fetch to gateway/GraphQL.
 */
export async function getClient() {
  validateConfig();
  if (!_client) {
    _client = await Uploader(BNB).withWallet(process.env.IRYS_PRIVATE_KEY);
  }
  return _client;
}

/**
 * Upload JSON data to Irys (Arweave) with BNB payment.
 * Performs loaded-balance check before upload — fails if insufficient.
 *
 * @param {object} data - Object to serialize as JSON
 * @param {Array}  tags - Additional Irys tags [{name, value}, ...]
 * @returns {object}    - Irys receipt with .id (Arweave TX ID)
 */
export async function uploadJSON(data, tags = []) {
  const client  = await getClient();
  const payload = JSON.stringify(data);
  const size    = Buffer.byteLength(payload, "utf8");
  const price   = await client.getPrice(size);
  const balance = await client.getLoadedBalance();

  const priceBN   = BigInt(price.toString());
  const balanceBN = BigInt(balance.toString());

  if (balanceBN < priceBN) {
    const fmt = (n) => (Number(n) / 1e18).toFixed(8);
    throw new Error(
      `CRITICAL: Insufficient Irys loaded balance. ` +
      `Loaded: ${fmt(balanceBN)} BNB. Required: ${fmt(priceBN)} BNB. ` +
      `Fund the Irys node with client.fund() before uploading.`
    );
  }

  return client.upload(payload, {
    tags: [
      { name: "Content-Type", value: "application/json" },
      { name: "App-Name",     value: APP_NAME },
      ...tags
    ]
  });
}

/**
 * Query Irys transactions by tag filters (newest first).
 *
 * Tag structure used by Synergix:
 *   Type: brain | aporte | user | db-snapshot | log | backup | global-stats | leaderboard
 *   Year-Month: YYYY-MM   (for aportes)
 *   User-Id: {uid}        (for users and aportes)
 *   Date: YYYY-MM-DD      (for logs)
 *
 * @param {Array}  tagFilters - [{name, values: [...]}, ...]
 * @param {number} first      - Max results (returned newest first)
 * @returns {Array}           - Transaction nodes [{id, tags, timestamp}]
 */
export async function queryByTags(tagFilters, first = 20) {
  const resp = await fetch(IRYS_GRAPHQL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
        query($tags: [TagFilter!]!, $first: Int!) {
          transactions(tags: $tags, first: $first, order: DESC) {
            edges { node { id tags { name value } timestamp } }
          }
        }
      `,
      variables: {
        tags: [
          { name: "App-Name", values: [APP_NAME] },
          ...tagFilters
        ],
        first
      }
    })
  });

  if (!resp.ok) throw new Error(`Irys GraphQL error: HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.errors?.length) throw new Error(`Irys GraphQL: ${json.errors[0].message}`);
  return json.data?.transactions?.edges?.map(e => e.node) ?? [];
}

/**
 * Fetch JSON data from Irys/Arweave gateway by transaction ID.
 *
 * @param {string} txId - Arweave/Irys transaction ID
 * @returns {object}    - Parsed JSON content
 */
export async function fetchById(txId) {
  const resp = await fetch(`${IRYS_GATEWAY}/${txId}`);
  if (!resp.ok) throw new Error(`Irys gateway error HTTP ${resp.status} — txId: ${txId}`);
  return resp.json();
}

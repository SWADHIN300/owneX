"use client";

import * as React from "react";
import type { ContractTransactionResponse, Signer } from "ethers";

import { CHAIN } from "@/lib/wallet";
import { getSigner } from "@/lib/contracts";
import { decodeFailure, type DecodedFailure } from "@/lib/tx-errors";
import { syncAudit } from "@/lib/api";
import { useWallet } from "@/components/wallet/wallet-provider";

/**
 * One write, four stages.
 *
 * Every state change in this app is the same shape: prepare the off-chain half,
 * get a signature, wait for the receipt, then record the result. Each stage fails
 * for a different reason and a single spinner would leave the user guessing which
 * — the same argument that shaped the sign-in rail, applied to transactions.
 *
 *   prepare   ask the server for the hash and anything else the call needs
 *   sign      the wallet prompt. The user can still walk away here
 *   mine      the transaction is broadcast and waiting for a block
 *   record    bind the result off-chain, then refresh the audit cache
 *
 * The server never signs. It computes hashes, verifies claims against the chain
 * afterwards, and nothing else — which is why `prepare` and `record` are separate
 * from the signature rather than wrapped around it.
 */

export type TxStage = "idle" | "prepare" | "sign" | "mine" | "record" | "done" | "error";

export const TX_STAGE_ORDER = ["prepare", "sign", "mine", "record"] as const;

export const TX_STAGE_LABEL: Record<(typeof TX_STAGE_ORDER)[number], string> = {
  prepare: "Preparing the record",
  sign: "Sign in your wallet",
  mine: "Waiting for the block",
  record: "Recording the result",
};

export interface TxRun<Prepared, Result> {
  /**
   * Off-chain work before the signature. Return whatever the call needs. Omit it
   * for a write with no off-chain half, which is most role changes.
   */
  prepare?: () => Promise<Prepared>;
  /** Send the transaction. Must return the response, not await the receipt. */
  send: (context: { signer: Signer; prepared: Prepared }) => Promise<ContractTransactionResponse>;
  /**
   * Bind the outcome off-chain. Receives the receipt so it can read the event the
   * transaction emitted — a token id, an organisation id — rather than trusting
   * anything the client guessed beforehand.
   */
  record?: (context: {
    prepared: Prepared;
    receipt: Awaited<ReturnType<ContractTransactionResponse["wait"]>>;
    txHash: string;
  }) => Promise<Result>;
  /** Skip the audit re-index. On by default, because the trail should be current. */
  skipAuditSync?: boolean;
}

export interface TxState<Prepared, Result> {
  stage: TxStage;
  failure: DecodedFailure | null;
  txHash: string | null;
  result: Result | undefined;
  /** True while anything is in flight. */
  busy: boolean;
  /**
   * Start a write. The spec is passed here rather than to the hook so it can
   * close over current form state without being memoised — and without a ref
   * written during render, which React rightly objects to.
   */
  run: (spec: TxRun<Prepared, Result>) => void;
  reset: () => void;
}

export function useTransaction<Prepared = void, Result = void>(): TxState<Prepared, Result> {
  const { active, chainId, refresh } = useWallet();

  const [stage, setStage] = React.useState<TxStage>("idle");
  const [failure, setFailure] = React.useState<DecodedFailure | null>(null);
  const [txHash, setTxHash] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result | undefined>(undefined);

  const reset = React.useCallback(() => {
    setStage("idle");
    setFailure(null);
    setTxHash(null);
    setResult(undefined);
  }, []);

  const run = React.useCallback(
    (spec: TxRun<Prepared, Result>) => {
      void (async () => {
        setFailure(null);
        setTxHash(null);

        try {
          if (!active) {
            throw Object.assign(
              new Error("No wallet is connected. Sign in again from the top bar."),
              { code: "NO_WALLET" },
            );
          }
          if (chainId !== null && chainId !== CHAIN.id) {
            throw Object.assign(
              new Error(
                `Your wallet is on chain ${chainId}, and this transaction has to go to ${CHAIN.name} (${CHAIN.id}). Switch networks first.`,
              ),
              { code: "WRONG_CHAIN" },
            );
          }

          setStage("prepare");
          const prepared = spec.prepare ? await spec.prepare() : (undefined as Prepared);

          setStage("sign");
          const signer = await getSigner(active.provider);
          const response = await spec.send({ signer, prepared });
          setTxHash(response.hash);

          setStage("mine");
          const receipt = await response.wait();

          setStage("record");
          const recorded = spec.record
            ? await spec.record({ prepared, receipt, txHash: response.hash })
            : (undefined as Result);
          setResult(recorded);

          // The trail is only as current as the last index, and the event this
          // transaction just emitted is the one the user will look for.
          if (!spec.skipAuditSync) await syncAudit().catch(() => null);

          // Roles and permissions are never cached, but the session snapshot the
          // shell renders from is a snapshot. Re-read it so a change to the
          // caller's own access is visible immediately.
          await refresh().catch(() => null);

          setStage("done");
        } catch (caught) {
          const decoded = decodeFailure(caught);
          setFailure(decoded);
          // A dismissed wallet prompt is not a failure worth a red panel; it puts
          // the form back exactly as it was.
          setStage(decoded.rejected ? "idle" : "error");
        }
      })();
    },
    [active, chainId, refresh],
  );

  return {
    stage,
    failure,
    txHash,
    result,
    busy: stage === "prepare" || stage === "sign" || stage === "mine" || stage === "record",
    run,
    reset,
  };
}

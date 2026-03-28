/**
 * Checkpoint certificate verification.
 *
 * Verifies that a CheckpointSummary was signed by a quorum (≥6667/10000)
 * of validators using BLS12-381 aggregate signatures.
 */

import { bls12_381 } from '@noble/curves/bls12-381';
import { bcs } from '@mysten/bcs';
import { decodeRoaringBitmap } from './bitmap.js';
import { checkpointContentsDigest } from './digest.js';
import {
	CHECKPOINT_SUMMARY_INTENT,
	QUORUM_THRESHOLD,
	type AuthorityQuorumSignInfo,
	type CheckpointContents,
	type CheckpointSummary,
	type Committee,
	type ExecutionDigests,
} from './types.js';
import { bcsCheckpointSummary, bcsCheckpointContents } from './bcs.js';

/**
 * Verify a checkpoint certificate against a committee.
 *
 * Checks that:
 * 1. The signature epoch matches the committee epoch
 * 2. The signing validators have enough voting power (≥6667/10000)
 * 3. The BLS aggregate signature is valid
 */
export function verifyCheckpoint(
	summary: CheckpointSummary,
	authSignature: AuthorityQuorumSignInfo,
	committee: Committee,
): void {
	// Epoch must match
	if (authSignature.epoch !== committee.epoch) {
		throw new Error(
			`Epoch mismatch: signature epoch ${authSignature.epoch} !== committee epoch ${committee.epoch}`,
		);
	}

	// Decode signer indices from RoaringBitmap
	const signerIndices = decodeRoaringBitmap(authSignature.signersMap);

	// Sum voting power and collect public keys
	let totalPower = 0n;
	const pubkeys: Uint8Array[] = [];

	for (const idx of signerIndices) {
		if (idx >= committee.members.length) {
			throw new Error(`Signer index ${idx} exceeds committee size ${committee.members.length}`);
		}
		const member = committee.members[idx];
		totalPower += member.votingPower;
		pubkeys.push(member.publicKey);
	}

	// Check quorum
	if (totalPower < QUORUM_THRESHOLD) {
		throw new Error(
			`Insufficient voting power: ${totalPower} < ${QUORUM_THRESHOLD} (${signerIndices.length}/${committee.members.length} validators)`,
		);
	}

	// Reconstruct the signed message:
	// BCS(IntentMessage<CheckpointSummary>) || BCS(epoch)
	const summaryBcs = bcsCheckpointSummary.serialize(summary).toBytes();
	const epochBcs = bcs.u64().serialize(authSignature.epoch).toBytes();

	const message = new Uint8Array(
		CHECKPOINT_SUMMARY_INTENT.length + summaryBcs.length + epochBcs.length,
	);
	message.set(CHECKPOINT_SUMMARY_INTENT);
	message.set(summaryBcs, CHECKPOINT_SUMMARY_INTENT.length);
	message.set(epochBcs, CHECKPOINT_SUMMARY_INTENT.length + summaryBcs.length);

	// Aggregate public keys and verify (min-sig mode: G2 pubkeys, G1 signatures)
	const aggregatedPubkey = bls12_381.shortSignatures.aggregatePublicKeys(pubkeys);
	const hashedMessage = bls12_381.shortSignatures.hash(message);
	const valid = bls12_381.shortSignatures.verify(authSignature.signature, hashedMessage, aggregatedPubkey);

	if (!valid) {
		throw new Error('BLS signature verification failed');
	}
}

/**
 * Verify that checkpoint contents match the content digest in a checkpoint summary.
 */
export function verifyCheckpointContents(
	summary: CheckpointSummary,
	contents: CheckpointContents,
): void {
	const contentsBcs = bcsCheckpointContents.serialize({ V1: contents }).toBytes();
	const computedDigest = checkpointContentsDigest(contentsBcs);

	if (!digestsEqual(computedDigest, summary.contentDigest)) {
		throw new Error('Checkpoint contents digest mismatch');
	}
}

/**
 * Verify that a transaction (by digest) is included in checkpoint contents.
 * Returns the execution digests (tx + effects) for the matched transaction.
 */
export function verifyTransactionInCheckpoint(
	txDigest: Uint8Array,
	contents: CheckpointContents,
): ExecutionDigests {
	for (const exec of contents.transactions) {
		if (digestsEqual(exec.transaction, txDigest)) {
			return exec;
		}
	}
	throw new Error('Transaction not found in checkpoint contents');
}

function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

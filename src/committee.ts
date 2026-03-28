/**
 * Committee management and transition verification.
 */

import type { CheckpointSummary, Committee, AuthorityQuorumSignInfo } from './types.js';
import { verifyCheckpoint } from './verify.js';

/**
 * Verify a committee transition: given a certified end-of-epoch checkpoint
 * and the current committee, extract and return the next epoch's committee.
 *
 * @throws If the checkpoint is not an end-of-epoch checkpoint
 * @throws If the checkpoint signature is invalid
 * @throws If the epoch doesn't match expectations
 */
export function verifyCommitteeTransition(
	summary: CheckpointSummary,
	authSignature: AuthorityQuorumSignInfo,
	currentCommittee: Committee,
): Committee {
	// Verify the checkpoint certificate
	verifyCheckpoint(summary, authSignature, currentCommittee);

	// Must be an end-of-epoch checkpoint
	if (!summary.endOfEpochData) {
		throw new Error('Checkpoint is not an end-of-epoch checkpoint');
	}

	// Extract next committee
	const nextEpoch = summary.epoch + 1n;
	const members = summary.endOfEpochData.nextEpochCommittee.map(([publicKey, votingPower]) => ({
		publicKey: Uint8Array.from(publicKey),
		votingPower,
	}));

	return { epoch: nextEpoch, members };
}

/**
 * Walk a chain of end-of-epoch checkpoints to advance from a trusted committee
 * to a target epoch.
 *
 * @param checkpoints - Ordered end-of-epoch certified checkpoints
 * @param trustedCommittee - Starting committee (must match first checkpoint's epoch)
 * @returns The committee for the epoch after the last checkpoint
 */
export function walkCommitteeChain(
	checkpoints: { summary: CheckpointSummary; authSignature: AuthorityQuorumSignInfo }[],
	trustedCommittee: Committee,
): Committee {
	let committee = trustedCommittee;

	for (const { summary, authSignature } of checkpoints) {
		if (summary.epoch !== committee.epoch) {
			throw new Error(
				`Epoch gap: expected checkpoint for epoch ${committee.epoch}, got ${summary.epoch}`,
			);
		}
		committee = verifyCommitteeTransition(summary, authSignature, committee);
	}

	return committee;
}

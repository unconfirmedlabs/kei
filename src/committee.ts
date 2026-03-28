/**
 * Committee management and transition verification.
 */

import type { CheckpointSummary, Committee, AuthorityQuorumSignInfo } from './types.js';
import { verifyCheckpoint } from './verify.js';

/**
 * Verify a committee transition: given a certified end-of-epoch checkpoint
 * and the current committee, extract and return the next epoch's committee.
 *
 * @param summaryBcs - Raw BCS bytes of the CheckpointSummary
 * @param summary - Parsed CheckpointSummary (for reading endOfEpochData)
 * @param authSignature - The quorum signature
 * @param currentCommittee - The committee that signed this checkpoint
 */
export function verifyCommitteeTransition(
	summaryBcs: Uint8Array,
	summary: CheckpointSummary,
	authSignature: AuthorityQuorumSignInfo,
	currentCommittee: Committee,
): Committee {
	verifyCheckpoint(summaryBcs, authSignature, currentCommittee);

	if (!summary.endOfEpochData) {
		throw new Error('Checkpoint is not an end-of-epoch checkpoint');
	}

	const nextEpoch = summary.epoch + 1n;
	const members = summary.endOfEpochData.nextEpochCommittee.map(([publicKey, weight]) => ({
		publicKey: Uint8Array.from(publicKey),
		weight,
	}));

	if (members.length === 0) {
		throw new Error('End-of-epoch checkpoint has empty next committee');
	}

	return { epoch: nextEpoch, members };
}

/**
 * Walk a chain of end-of-epoch checkpoints to advance from a trusted committee
 * to a target epoch.
 *
 * @param checkpoints - Ordered end-of-epoch certified checkpoints with raw BCS + parsed summary
 * @param trustedCommittee - Starting committee (must match first checkpoint's epoch)
 * @returns The committee for the epoch after the last checkpoint
 */
export function walkCommitteeChain(
	checkpoints: { summaryBcs: Uint8Array; summary: CheckpointSummary; authSignature: AuthorityQuorumSignInfo }[],
	trustedCommittee: Committee,
): Committee {
	let committee = trustedCommittee;

	for (const { summaryBcs, summary, authSignature } of checkpoints) {
		if (summary.epoch !== committee.epoch) {
			throw new Error(
				`Epoch gap: expected checkpoint for epoch ${committee.epoch}, got ${summary.epoch}`,
			);
		}
		committee = verifyCommitteeTransition(summaryBcs, summary, authSignature, committee);
	}

	return committee;
}

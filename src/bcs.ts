/**
 * BCS schemas for Sui checkpoint types.
 * Field order matches the Rust struct declarations exactly.
 */

import { bcs } from '@mysten/bcs';

// --- Primitives ---
// Sui's Digest([u8; 32]) serializes with a ULEB128 length prefix in BCS
const Digest = bcs.vector(bcs.u8());

// AuthorityPublicKeyBytes = [u8; 96] (BLS12-381 G2 compressed, ULEB-prefixed)
const AuthorityPublicKeyBytes = bcs.vector(bcs.u8());

// --- GasCostSummary ---

const GasCostSummary = bcs.struct('GasCostSummary', {
	computationCost: bcs.u64(),
	storageCost: bcs.u64(),
	storageRebate: bcs.u64(),
	nonRefundableStorageFee: bcs.u64(),
});

// --- CheckpointCommitment ---

const CheckpointCommitment = bcs.enum('CheckpointCommitment', {
	ECMHLiveObjectSetDigest: Digest,
	CheckpointArtifactsDigest: Digest,
});

// --- EndOfEpochData ---

const EndOfEpochData = bcs.struct('EndOfEpochData', {
	nextEpochCommittee: bcs.vector(bcs.tuple([AuthorityPublicKeyBytes, bcs.u64()])),
	nextEpochProtocolVersion: bcs.u64(),
	epochCommitments: bcs.vector(CheckpointCommitment),
});

// --- CheckpointSummary ---

export const bcsCheckpointSummary = bcs.struct('CheckpointSummary', {
	epoch: bcs.u64(),
	sequenceNumber: bcs.u64(),
	networkTotalTransactions: bcs.u64(),
	contentDigest: Digest,
	previousDigest: bcs.option(Digest),
	epochRollingGasCostSummary: GasCostSummary,
	timestampMs: bcs.u64(),
	checkpointCommitments: bcs.vector(CheckpointCommitment),
	endOfEpochData: bcs.option(EndOfEpochData),
	versionSpecificData: bcs.vector(bcs.u8()),
});

// --- ExecutionDigests ---

const ExecutionDigests = bcs.struct('ExecutionDigests', {
	transaction: Digest,
	effects: Digest,
});

// --- CheckpointContents (enum with single variant V1) ---

const CheckpointContentsV1 = bcs.struct('CheckpointContentsV1', {
	transactions: bcs.vector(ExecutionDigests),
	userSignatures: bcs.vector(bcs.vector(bcs.vector(bcs.u8()))),
});

// CheckpointContents is an enum, but only has one variant (V1)
export const bcsCheckpointContents = bcs.enum('CheckpointContents', {
	V1: CheckpointContentsV1,
});

// --- AuthorityQuorumSignInfo ---

export const bcsAuthorityQuorumSignInfo = bcs.struct('AuthorityQuorumSignInfo', {
	epoch: bcs.u64(),
	signature: bcs.vector(bcs.u8()),
	signersMap: bcs.vector(bcs.u8()),
});

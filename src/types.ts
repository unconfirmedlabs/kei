/** Sui checkpoint types for BCS serialization and light client verification. */

// --- Primitives ---

/** 32-byte digest (Blake2b-256 output) */
export type Digest = Uint8Array; // 32 bytes

/** BLS12-381 public key in min-sig mode (G2 compressed) */
export type AuthorityPublicKeyBytes = Uint8Array; // 96 bytes

/** BLS12-381 aggregate signature in min-sig mode (G1 compressed) */
export type AggregateSignatureBytes = Uint8Array; // 48 bytes

// --- Checkpoint ---

export interface GasCostSummary {
	computationCost: bigint;
	storageCost: bigint;
	storageRebate: bigint;
	nonRefundableStorageFee: bigint;
}

export interface EndOfEpochData {
	nextEpochCommittee: [AuthorityPublicKeyBytes, bigint][];
	nextEpochProtocolVersion: bigint;
	epochCommitments: CheckpointCommitment[];
}

export type CheckpointCommitment =
	| { ECMHLiveObjectSetDigest: Digest }
	| { CheckpointArtifactsDigest: Digest };

export interface CheckpointSummary {
	epoch: bigint;
	sequenceNumber: bigint;
	networkTotalTransactions: bigint;
	contentDigest: Digest;
	previousDigest: Digest | null;
	epochRollingGasCostSummary: GasCostSummary;
	timestampMs: bigint;
	checkpointCommitments: CheckpointCommitment[];
	endOfEpochData: EndOfEpochData | null;
	versionSpecificData: Uint8Array;
}

// --- Quorum Signature ---

export interface AuthorityQuorumSignInfo {
	epoch: bigint;
	signature: AggregateSignatureBytes;
	signersMap: Uint8Array; // Serialized RoaringBitmap
}

export interface CertifiedCheckpointSummary {
	summary: CheckpointSummary;
	authSignature: AuthorityQuorumSignInfo;
}

// --- Checkpoint Contents ---

export interface ExecutionDigests {
	transaction: Digest;
	effects: Digest;
}

export interface CheckpointContents {
	transactions: ExecutionDigests[];
	userSignatures: Uint8Array[][];
}

// --- Committee ---

export interface CommitteeMember {
	publicKey: AuthorityPublicKeyBytes;
	weight: bigint;
}

export interface Committee {
	epoch: bigint;
	members: CommitteeMember[];
}

// --- Constants ---

export const TOTAL_WEIGHT = 10_000n;
export const QUORUM_THRESHOLD = 6_667n;

// Intent bytes for CheckpointSummary signing
// scope=CheckpointSummary(2), version=V0(0), app_id=Sui(0)
export const CHECKPOINT_SUMMARY_INTENT = new Uint8Array([0x02, 0x00, 0x00]);

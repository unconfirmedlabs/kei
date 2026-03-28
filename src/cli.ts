#!/usr/bin/env bun
/**
 * CLI for testing Sui light client verification against live checkpoints.
 *
 * Usage:
 *   bun src/cli.ts verify <checkpoint_seq> [--url <fullnode_url>]
 *   bun src/cli.ts verify 318460000
 *   bun src/cli.ts verify 318460000 --url https://fullnode.mainnet.sui.io
 */

import { bcsCheckpointSummary } from './bcs.js';
import { decodeRoaringBitmap } from './bitmap.js';
import { verifyCheckpoint, PreparedCommittee } from './verify.js';
import type { Committee, CheckpointSummary, AuthorityQuorumSignInfo } from './types.js';

const DEFAULT_URL = 'https://fullnode.testnet.sui.io';

function usage(): never {
	console.log(`Usage:
  sui-light-client verify <checkpoint_seq> [--url <fullnode_url>]
  sui-light-client verify-range <from> <to> [--url <fullnode_url>]

Examples:
  bun src/cli.ts verify 318460000
  bun src/cli.ts verify 318460000 --url https://fullnode.mainnet.sui.io
  bun src/cli.ts verify-range 318460000 318460010`);
	process.exit(1);
}

function parseArgs() {
	const args = process.argv.slice(2);
	if (args.length === 0) usage();

	const command = args[0];
	let url = DEFAULT_URL;
	const urlIdx = args.indexOf('--url');
	if (urlIdx !== -1 && args[urlIdx + 1]) {
		url = args[urlIdx + 1];
	}

	if (command === 'verify') {
		const seq = args[1];
		if (!seq || isNaN(Number(seq))) usage();
		return { command: 'verify' as const, seq: Number(seq), url };
	}

	if (command === 'verify-range') {
		const from = args[1];
		const to = args[2];
		if (!from || !to || isNaN(Number(from)) || isNaN(Number(to))) usage();
		return { command: 'verify-range' as const, from: Number(from), to: Number(to), url };
	}

	usage();
}

let _grpcClient: any = null;
async function getGrpcClient(url: string) {
	if (_grpcClient) return _grpcClient;
	const { SuiGrpcClient } = await import('@mysten/sui/grpc');
	_grpcClient = new SuiGrpcClient({ baseUrl: url } as any);
	return _grpcClient;
}

async function fetchCheckpoint(url: string, seq: number) {
	const client = await getGrpcClient(url);
	const { response } = await client.ledgerService.getCheckpoint({
		checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: String(seq) },
		readMask: { paths: ['summary.bcs', 'signature'] },
	});
	return response.checkpoint!;
}

async function fetchCommittee(url: string, epoch: string): Promise<Committee> {
	const resp = await fetch(`${url}:443`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0', id: 1,
			method: 'suix_getCommitteeInfo',
			params: [epoch],
		}),
	});
	const json = (await resp.json()) as any;
	const validators = json.result.validators as [string, string][];
	return {
		epoch: BigInt(epoch),
		members: validators.map(([pk, stake]) => ({
			publicKey: new Uint8Array(Buffer.from(pk, 'base64')),
			votingPower: BigInt(stake),
		})),
	};
}

function parseCheckpointData(cp: any): { summary: CheckpointSummary; authSignature: AuthorityQuorumSignInfo } {
	const parsed: any = bcsCheckpointSummary.parse(cp.summary!.bcs!.value!);
	const sig = cp.signature!;

	const summary: CheckpointSummary = {
		epoch: BigInt(parsed.epoch),
		sequenceNumber: BigInt(parsed.sequenceNumber),
		networkTotalTransactions: BigInt(parsed.networkTotalTransactions),
		contentDigest: Uint8Array.from(parsed.contentDigest),
		previousDigest: parsed.previousDigest ? Uint8Array.from(parsed.previousDigest) : null,
		epochRollingGasCostSummary: {
			computationCost: BigInt(parsed.epochRollingGasCostSummary.computationCost),
			storageCost: BigInt(parsed.epochRollingGasCostSummary.storageCost),
			storageRebate: BigInt(parsed.epochRollingGasCostSummary.storageRebate),
			nonRefundableStorageFee: BigInt(parsed.epochRollingGasCostSummary.nonRefundableStorageFee),
		},
		timestampMs: BigInt(parsed.timestampMs),
		checkpointCommitments: parsed.checkpointCommitments,
		endOfEpochData: parsed.endOfEpochData,
		versionSpecificData: Uint8Array.from(parsed.versionSpecificData),
	};

	const authSignature: AuthorityQuorumSignInfo = {
		epoch: BigInt(sig.epoch!),
		signature: sig.signature!,
		signersMap: sig.bitmap!,
	};

	return { summary, authSignature };
}

async function verifySingle(seq: number, url: string) {
	const total = performance.now();

	process.stdout.write(`Fetching checkpoint ${seq}...`);
	let t = performance.now();
	const cp = await fetchCheckpoint(url, seq);
	const fetchMs = performance.now() - t;
	console.log(` ${fetchMs.toFixed(0)}ms`);

	const { summary, authSignature } = parseCheckpointData(cp);
	const signers = decodeRoaringBitmap(authSignature.signersMap);

	process.stdout.write(`Fetching committee for epoch ${summary.epoch}...`);
	t = performance.now();
	const committee = await fetchCommittee(url, summary.epoch.toString());
	const committeeMs = performance.now() - t;
	console.log(` ${committeeMs.toFixed(0)}ms (${committee.members.length} validators)`);

	process.stdout.write(`Verifying signature (${signers.length} signers)...`);
	t = performance.now();
	verifyCheckpoint(summary, authSignature, committee);
	const verifyMs = performance.now() - t;
	console.log(` ${verifyMs.toFixed(0)}ms`);

	console.log(`\nCheckpoint ${seq} verified in ${(performance.now() - total).toFixed(0)}ms`);
}

async function verifyRange(from: number, to: number, url: string) {
	const count = to - from + 1;
	console.log(`Verifying ${count} checkpoints (${from} → ${to})\n`);

	// Fetch first checkpoint to get epoch
	process.stdout.write('Fetching first checkpoint...');
	let t = performance.now();
	const firstCp = await fetchCheckpoint(url, from);
	const { summary: firstSummary } = parseCheckpointData(firstCp);
	console.log(` epoch ${firstSummary.epoch} (${(performance.now() - t).toFixed(0)}ms)`);

	// Fetch and prepare committee (one-time)
	process.stdout.write('Preparing committee...');
	t = performance.now();
	const committee = await fetchCommittee(url, firstSummary.epoch.toString());
	const prepared = new PreparedCommittee(committee);
	console.log(` ${committee.members.length} validators, ${(performance.now() - t).toFixed(0)}ms\n`);

	// Verify range
	let verified = 0;
	let totalVerifyMs = 0;
	const batchStart = performance.now();

	for (let seq = from; seq <= to; seq++) {
		t = performance.now();
		const cp = await fetchCheckpoint(url, seq);
		const fetchMs = performance.now() - t;

		const { summary, authSignature } = parseCheckpointData(cp);
		const signers = decodeRoaringBitmap(authSignature.signersMap);

		t = performance.now();
		verifyCheckpoint(summary, authSignature, prepared);
		const verifyMs = performance.now() - t;
		totalVerifyMs += verifyMs;
		verified++;

		console.log(`  [${verified}/${count}] seq=${seq} signers=${signers.length} fetch=${fetchMs.toFixed(0)}ms verify=${verifyMs.toFixed(0)}ms`);
	}

	const elapsed = performance.now() - batchStart;
	console.log(`\n${verified} checkpoints verified in ${(elapsed / 1000).toFixed(1)}s`);
	console.log(`Avg verify: ${(totalVerifyMs / verified).toFixed(1)}ms/checkpoint`);
	console.log(`Throughput: ${(verified / (elapsed / 1000)).toFixed(1)} checkpoints/sec (including network)`);
}

async function main() {
	const parsed = parseArgs();

	if (parsed.command === 'verify') {
		await verifySingle(parsed.seq, parsed.url);
	} else {
		await verifyRange(parsed.from, parsed.to, parsed.url);
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});

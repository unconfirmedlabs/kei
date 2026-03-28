/**
 * Minimal RoaringBitmap decoder for Sui's validator signers bitmap.
 *
 * Supports the standard portable serialization format (cookie 12346).
 * See: https://github.com/RoaringBitmap/RoaringFormatSpec
 */

const SERIAL_COOKIE_NO_RUNCONTAINER = 12346;
const SERIAL_COOKIE = 12347;

/** Decode a serialized RoaringBitmap into a sorted array of set bit positions. */
export function decodeRoaringBitmap(data: Uint8Array): number[] {
	if (data.byteLength < 8) {
		throw new Error(`RoaringBitmap too small: ${data.byteLength} bytes`);
	}

	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let offset = 0;

	const firstU32 = view.getUint32(0, true);
	const firstU16 = firstU32 & 0xffff;

	let containerCount: number;

	if (firstU32 === SERIAL_COOKIE_NO_RUNCONTAINER) {
		// Cookie 12346: [cookie: u32] [containerCount: u32]
		offset = 4;
		containerCount = view.getUint32(offset, true);
		offset += 4;
	} else if (firstU16 === SERIAL_COOKIE) {
		// Cookie 12347: [cookie: u16] [containerCount-1: u16] [run bitmap...]
		offset = 2;
		containerCount = view.getUint16(offset, true) + 1;
		offset += 2;
		// Skip run bitmap
		offset += Math.ceil(containerCount / 8);
	} else {
		throw new Error(`Invalid RoaringBitmap cookie: ${firstU32}`);
	}

	// Read container descriptive headers: [key: u16, cardinality-1: u16]
	const keys: number[] = [];
	const cardinalities: number[] = [];
	for (let i = 0; i < containerCount; i++) {
		keys.push(view.getUint16(offset, true));
		offset += 2;
		cardinalities.push(view.getUint16(offset, true) + 1);
		offset += 2;
	}

	// Skip offset headers (4 bytes per container)
	offset += containerCount * 4;

	// Read container data
	const result: number[] = [];
	for (let i = 0; i < containerCount; i++) {
		const highBits = keys[i] << 16;
		const cardinality = cardinalities[i];

		if (cardinality <= 4096) {
			// Array container: sorted uint16 values
			for (let j = 0; j < cardinality; j++) {
				result.push(highBits | view.getUint16(offset, true));
				offset += 2;
			}
		} else {
			// Bitset container: 1024 x uint64 words (8192 bytes)
			for (let word = 0; word < 1024; word++) {
				const lo = view.getUint32(offset, true);
				const hi = view.getUint32(offset + 4, true);
				offset += 8;
				for (let bit = 0; bit < 32; bit++) {
					if (lo & (1 << bit)) result.push(highBits | (word * 64 + bit));
					if (hi & (1 << bit)) result.push(highBits | (word * 64 + 32 + bit));
				}
			}
		}
	}

	return result;
}

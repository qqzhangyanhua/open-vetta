export const EXTERNAL_INVOCATION_OUTPUT_LIMIT_BYTES = 5 * 1024 * 1024;

export interface CapturedExternalOutput {
	readonly body: Buffer;
	readonly discardedBytes: number;
}

/**
 * 超出上限时保留开头一半和结尾一半，中间字节数记在 discardedBytes。
 * 未超出时正文就是全部输出。
 */
export class ExternalInvocationOutputCapture {
	private head = Buffer.alloc(0);
	private tail = Buffer.alloc(0);
	private discardedBytes = 0;
	private readonly headLen: number;

	constructor(private readonly limit = EXTERNAL_INVOCATION_OUTPUT_LIMIT_BYTES) {
		this.headLen = Math.floor(limit / 2);
	}

	push(chunk: string | Uint8Array): void {
		let rest = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		if (rest.length === 0) return;
		if (this.head.length < this.headLen) {
			const need = this.headLen - this.head.length;
			const take = rest.subarray(0, need);
			this.head = Buffer.concat([this.head, take]);
			rest = rest.subarray(take.length);
		}
		if (rest.length === 0) return;
		this.tail = Buffer.concat([this.tail, rest]);
		const overflow = this.head.length + this.tail.length - this.limit;
		if (overflow > 0) {
			this.tail = this.tail.subarray(overflow);
			this.discardedBytes += overflow;
		}
	}

	snapshot(): CapturedExternalOutput {
		return {
			body: Buffer.concat([this.head, this.tail]),
			discardedBytes: this.discardedBytes,
		};
	}
}

/** Hand-written test doubles for ChaincodeStub and ClientIdentity (only what the contract uses). */
const NUL = '\u0000';
const MS_PER_SECOND = 1000;

export class MockStub {
  public readonly state = new Map<string, Buffer>();
  public readonly privateData = new Map<string, Buffer>();
  public readonly writeLog: string[] = [];
  private transient = new Map<string, Uint8Array>();
  private txTimeMs = 1_700_000_000_000;

  setTime(ms: number): void {
    this.txTimeMs = ms;
  }

  setTransient(values: Record<string, string>): void {
    this.transient = new Map(Object.entries(values).map(([k, v]) => [k, Buffer.from(v)]));
  }

  getTransient(): Map<string, Uint8Array> {
    return this.transient;
  }

  getTxTimestamp(): { seconds: number; nanos: number } {
    return { seconds: Math.floor(this.txTimeMs / MS_PER_SECOND), nanos: (this.txTimeMs % MS_PER_SECOND) * 1_000_000 };
  }

  async getState(key: string): Promise<Uint8Array> {
    return this.state.get(key) ?? Buffer.alloc(0);
  }

  async putState(key: string, value: Uint8Array): Promise<void> {
    this.writeLog.push(key);
    this.state.set(key, Buffer.from(value));
  }

  async getPrivateData(collection: string, key: string): Promise<Uint8Array> {
    return this.privateData.get(`${collection}/${key}`) ?? Buffer.alloc(0);
  }

  async putPrivateData(collection: string, key: string, value: Uint8Array): Promise<void> {
    this.privateData.set(`${collection}/${key}`, Buffer.from(value));
  }

  createCompositeKey(objectType: string, attributes: string[]): string {
    return `${NUL}${objectType}${NUL}${attributes.join(NUL)}${NUL}`;
  }

  async deleteState(key: string): Promise<void> {
    this.writeLog.push(`DEL:${key}`);
    this.state.delete(key);
  }

  async getStateByRange(start: string, end: string) {
    const entries = [...this.state.entries()].filter(([k]) => k >= start && k < end).sort(([a], [b]) => (a < b ? -1 : 1));
    let index = 0;
    return {
      next: async () =>
        index < entries.length
          ? { done: false, value: { key: entries[index]![0], value: entries[index++]![1] } }
          : { done: true, value: undefined },
      close: async () => undefined,
    };
  }

  async getStateByPartialCompositeKey(objectType: string, attributes: string[]) {
    const prefix = `${NUL}${objectType}${NUL}${attributes.map((a) => a + NUL).join('')}`;
    const entries = [...this.state.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
    let index = 0;
    return {
      next: async () =>
        index < entries.length
          ? { done: false, value: { key: entries[index]![0], value: entries[index++]![1] } }
          : { done: true, value: undefined },
      close: async () => undefined,
    };
  }

  /** Snapshot of all keys starting with `prefix`, for immutability assertions. */
  snapshot(prefix: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.state) if (k.startsWith(prefix)) out[k] = v.toString('utf8');
    return out;
  }
}

export interface IdentitySpec {
  role?: string;
  tenantId?: string;
  orgId?: string;
  mspId?: string;
}

export class MockClientIdentity {
  constructor(private readonly spec: IdentitySpec) {}

  getAttributeValue(name: string): string | null {
    return (this.spec as Record<string, string | undefined>)[name] ?? null;
  }

  getMSPID(): string {
    return this.spec.mspId ?? 'ManufacturerMSP';
  }
}

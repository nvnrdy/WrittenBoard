/**
 * Minimal in-memory Firestore for worker tests. Supports exactly what the broadcast
 * worker uses: doc get/set(merge)/update/delete, equality where + orderBy + limit,
 * serial transactions, onSnapshot, and FieldValue.serverTimestamp().
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

type Data = Record<string, unknown>
type Listener = (snap: FakeSnapshot) => void

const SERVER_TS = FieldValue.serverTimestamp()

function resolveValues(data: Data): Data {
  const out: Data = {}
  for (const [k, v] of Object.entries(data)) {
    out[k] = v instanceof FieldValue && v.isEqual(SERVER_TS) ? Timestamp.now() : v
  }
  return out
}

export class FakeSnapshot {
  constructor(readonly ref: FakeDocRef, private readonly value: Data | undefined) {}
  get id() { return this.ref.id }
  get exists() { return this.value !== undefined }
  data() { return this.value ? { ...this.value } : undefined }
}

export class FakeDocRef {
  constructor(readonly db: FakeFirestore, readonly collection: string, readonly id: string) {}
  get path() { return `${this.collection}/${this.id}` }
  async get() { return this.db.snapshot(this) }
  async set(data: Data, opts?: { merge?: boolean }) { this.db.write(this, data, !!opts?.merge) }
  async update(data: Data) {
    if (!this.db.read(this)) throw new Error(`NOT_FOUND: ${this.path}`)
    this.db.write(this, data, true)
  }
  async delete() { this.db.remove(this) }
  onSnapshot(cb: Listener, _onError?: (err: Error) => void) {
    return this.db.listen(this, cb)
  }
}

class FakeQuery {
  constructor(
    private readonly db: FakeFirestore,
    private readonly collection: string,
    private readonly filters: Array<[string, unknown]> = [],
    private readonly order: string | null = null,
    private readonly max = Infinity,
  ) {}
  where(field: string, op: string, value: unknown) {
    if (op !== '==') throw new Error('fake only supports ==')
    return new FakeQuery(this.db, this.collection, [...this.filters, [field, value]], this.order, this.max)
  }
  orderBy(field: string) { return new FakeQuery(this.db, this.collection, this.filters, field, this.max) }
  limit(n: number) { return new FakeQuery(this.db, this.collection, this.filters, this.order, n) }
  async get() {
    let docs = this.db.all(this.collection).filter((s) => this.filters.every(([f, v]) => s.data()?.[f] === v))
    if (this.order) {
      const key = (s: FakeSnapshot) => (s.data()?.[this.order!] as Timestamp | undefined)?.toMillis?.() ?? 0
      docs = docs.sort((a, b) => key(a) - key(b))
    }
    docs = docs.slice(0, this.max)
    return { docs, size: docs.length, empty: docs.length === 0 }
  }
}

class FakeCollection extends FakeQuery {
  constructor(private readonly fdb: FakeFirestore, private readonly name: string) { super(fdb, name) }
  doc(id: string) { return new FakeDocRef(this.fdb, this.name, id) }
}

export class FakeFirestore {
  private store = new Map<string, Data>()
  private listeners = new Map<string, Set<Listener>>()
  private txChain: Promise<unknown> = Promise.resolve()

  collection(name: string) { return new FakeCollection(this, name) }

  read(ref: FakeDocRef) { return this.store.get(ref.path) }
  snapshot(ref: FakeDocRef) { return new FakeSnapshot(ref, this.read(ref)) }

  all(collection: string) {
    const out: FakeSnapshot[] = []
    for (const [path, value] of this.store) {
      const [col, id] = path.split('/')
      if (col === collection) out.push(new FakeSnapshot(new FakeDocRef(this, col, id), value))
    }
    return out
  }

  write(ref: FakeDocRef, data: Data, merge: boolean) {
    const next = { ...(merge ? this.read(ref) || {} : {}), ...resolveValues(data) }
    this.store.set(ref.path, next)
    this.notify(ref)
  }

  remove(ref: FakeDocRef) {
    this.store.delete(ref.path)
    this.notify(ref)
  }

  listen(ref: FakeDocRef, cb: Listener) {
    const set = this.listeners.get(ref.path) || new Set<Listener>()
    set.add(cb)
    this.listeners.set(ref.path, set)
    queueMicrotask(() => { if (set.has(cb)) cb(this.snapshot(ref)) })
    return () => { set.delete(cb) }
  }

  private notify(ref: FakeDocRef) {
    for (const cb of this.listeners.get(ref.path) || []) cb(this.snapshot(ref))
  }

  /** Serial transactions: reads see committed data, writes apply on success. */
  runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const run = this.txChain.then(async () => {
      const tx = new FakeTransaction()
      const result = await fn(tx)
      tx.commit()
      return result
    })
    this.txChain = run.catch(() => undefined)
    return run
  }

  /** Test helper: plain read of a document's data. */
  peek(path: string) {
    const v = this.store.get(path)
    return v ? { ...v } : undefined
  }
}

class FakeTransaction {
  private ops: Array<() => void> = []
  async get(ref: FakeDocRef) { return ref.db.snapshot(ref) }
  set(ref: FakeDocRef, data: Data, opts?: { merge?: boolean }) { this.ops.push(() => ref.db.write(ref, data, !!opts?.merge)) }
  update(ref: FakeDocRef, data: Data) {
    this.ops.push(() => {
      if (!ref.db.read(ref)) throw new Error(`NOT_FOUND: ${ref.path}`)
      ref.db.write(ref, data, true)
    })
  }
  create(ref: FakeDocRef, data: Data) { this.ops.push(() => ref.db.write(ref, data, false)) }
  delete(ref: FakeDocRef) { this.ops.push(() => ref.db.remove(ref)) }
  commit() { for (const op of this.ops) op() }
}

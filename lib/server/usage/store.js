// Usage ledger and budget settings.
// FileStore keeps a JSON ledger on disk (local dev, a VM, or a mounted volume).
// MemoryStore is for tests. Any durable backend (Postgres, KV) only needs these four methods.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export class MemoryStore {
  constructor() {
    this.data = { version: 1, events: [], budgets: {} };
  }
  async read() {
    return structuredClone(this.data);
  }
  async append(event) {
    this.data.events.push(event);
    return event;
  }
  async setBudgets(budgets) {
    this.data.budgets = { ...budgets };
    return this.data.budgets;
  }
  async getBudgets() {
    return { ...this.data.budgets };
  }
}

export class FileStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.queue = Promise.resolve();
  }
  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      return { version: 1, events: [], budgets: {}, ...parsed };
    } catch (e) {
      if (e.code === 'ENOENT') return { version: 1, events: [], budgets: {} };
      throw e;
    }
  }
  // Writes are serialized and atomic (temp file + rename) so concurrent requests can't corrupt the ledger.
  update(fn) {
    const run = this.queue.then(async () => {
      const data = await this.load();
      const result = fn(data);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, this.file);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async read() {
    await this.queue;
    return this.load();
  }
  append(event) {
    return this.update((d) => {
      d.events.push(event);
      // Keep the ledger bounded: drop events older than ~13 months.
      const cutoff = Date.now() - 400 * 864e5;
      d.events = d.events.filter((e) => Date.parse(e.at) >= cutoff);
      return event;
    });
  }
  setBudgets(budgets) {
    return this.update((d) => {
      d.budgets = { ...budgets };
      return d.budgets;
    });
  }
  async getBudgets() {
    return (await this.read()).budgets || {};
  }
}

let shared = null;
export function getStore(config) {
  if (!shared) shared = new FileStore(config.usageFile);
  return shared;
}
export function setStoreForTests(store) {
  shared = store;
}

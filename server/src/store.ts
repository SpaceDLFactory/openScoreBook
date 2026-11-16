// Where shared games are kept. The server only needs put/get/delete by id, so any host's storage fits behind this
// (a bucket, a key-value store, a database); the local runner keeps one JSON file per share.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Store {
  put(id: string, value: string): Promise<void>;
  get(id: string): Promise<string | null>;
  delete(id: string): Promise<void>;
}

export class MemoryStore implements Store {
  private m = new Map<string, string>();
  async put(id: string, value: string) { this.m.set(id, value); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async delete(id: string) { this.m.delete(id); }
}

/** ids are checked by the app before they get here (letters and digits only), so they are safe as file names */
export class FileStore implements Store {
  constructor(private dir: string) {}
  async put(id: string, value: string) { await mkdir(this.dir, { recursive: true }); await writeFile(join(this.dir, `${id}.json`), value); }
  async get(id: string) { try { return await readFile(join(this.dir, `${id}.json`), 'utf8'); } catch { return null; } }
  async delete(id: string) { await rm(join(this.dir, `${id}.json`), { force: true }); }
}

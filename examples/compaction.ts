import { rm } from "node:fs/promises";
import { SabliDatabase } from "sablidb";

const path = "./data/compaction.sabli";
await rm(path, { recursive: true, force: true });

const db = await SabliDatabase.open({
  path,
  createIfMissing: true
});

const first = await db.insert({
  user: { name: "Kim", role: "developer" },
  tags: ["backend", "typescript"]
});

const second = await db.insert({
  user: { name: "Lee", role: "designer" },
  tags: ["frontend"]
});

await db.flush();
await db.update(first.docId, {
  user: { name: "Kim", role: "architect" },
  tags: ["backend", "storage"]
});
await db.delete(second.docId);

const before = await db.search({
  where: {
    "tags[]": { contains: "backend" }
  }
});
console.dir(before.documents, { depth: null });

await db.compact();
await db.close();

const reopened = await SabliDatabase.open({
  path,
  createIfMissing: false
});

const after = await reopened.search({
  where: {
    "tags[]": { contains: "backend" }
  }
});
console.dir(after.documents, { depth: null });

await reopened.close();

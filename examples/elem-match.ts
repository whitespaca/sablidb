import { rm } from "node:fs/promises";
import { SabliDatabase } from "sablidb";

const path = "./data/elem-match.sabli";
await rm(path, { recursive: true, force: true });

const db = await SabliDatabase.open({
  path,
  createIfMissing: true
});

await db.insert({
  customer: "cross-element-only",
  orders: [
    { id: "A1", price: 8_000 },
    { id: "A2", price: 12_000 }
  ]
});

await db.insert({
  customer: "same-element-match",
  orders: [
    { id: "A1", price: 15_000 },
    { id: "B1", price: 4_000 }
  ]
});

const sameElement = await db.search({
  where: {
    and: [
      { path: "customer", eq: "same-element-match" },
      {
        path: "orders[]",
        elemMatch: {
          and: [
            { path: "id", eq: "A1" },
            { path: "price", gt: 10_000 }
          ]
        }
      }
    ]
  }
});

console.dir(sameElement.documents, { depth: null });

const crossElementDoesNotMatch = await db.search({
  where: {
    and: [
      { path: "customer", eq: "cross-element-only" },
      {
        path: "orders[]",
        elemMatch: {
          and: [
            { path: "id", eq: "A1" },
            { path: "price", gt: 11_000 }
          ]
        }
      }
    ]
  }
});

console.dir(crossElementDoesNotMatch.documents, { depth: null });

await db.close();

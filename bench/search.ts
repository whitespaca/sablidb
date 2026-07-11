import { performance } from "node:perf_hooks";
import { SabliDatabase, type Query } from "../src/index.js";
import {
  cleanupBenchmarkDatabase,
  createBenchmarkDatabasePath,
  createBenchmarkDocument,
  parseBenchOptions,
  printMeasurement
} from "./dataset.js";

const options = parseBenchOptions(process.argv.slice(2));
const path = await createBenchmarkDatabasePath("search", options.path);

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

async function measure(
  db: SabliDatabase,
  label: string,
  query: Query,
  measurementCount = options.queries,
  warmupCount = options.warmup
): Promise<void> {
  for (let index = 0; index < warmupCount; index += 1) {
    await db.search(query);
  }
  const latencies: number[] = [];
  let lastCount = 0;
  for (let index = 0; index < measurementCount; index += 1) {
    const start = performance.now();
    lastCount = (await db.search(query)).count;
    latencies.push(performance.now() - start);
  }
  const elapsed = latencies.reduce((sum, latency) => sum + latency, 0);
  const sorted = [...latencies].sort((left, right) => left - right);
  printMeasurement(label, measurementCount, elapsed, "queries");
  console.log(
    `${label} latency: average ${(elapsed / measurementCount).toFixed(3)} ms, ` +
    `p50 ${percentile(sorted, 0.5).toFixed(3)} ms, ` +
    `p95 ${percentile(sorted, 0.95).toFixed(3)} ms, ` +
    `p99 ${percentile(sorted, 0.99).toFixed(3)} ms.`
  );
  console.log(`${label} returned ${String(lastCount)} documents on the last run.`);
}

try {
  const db = await SabliDatabase.open({ path, createIfMissing: true });
  for (let id = 1; id <= options.count; id += 1) {
    await db.insert(createBenchmarkDocument(id));
  }
  await db.flush();

  await measure(db, "Equality search benchmark", { where: { path: "metrics.shard", eq: 4 } });
  await measure(db, "Contains search benchmark", { where: { path: "tags[]", contains: "backend" } });
  await measure(db, "AND search benchmark", {
    where: {
      and: [
        { path: "tags[]", contains: "backend" },
        { path: "metrics.shard", eq: 4 }
      ]
    }
  });
  await measure(db, "Repeated cached search benchmark", { where: { path: "tags[]", contains: "typescript" } });
  const equalityEquality: Query = {
    where: {
      path: "orders[]",
      elemMatch: {
        and: [
          { path: "status", eq: "paid" },
          { path: "channel", eq: "web" }
        ]
      }
    }
  };
  await measure(db, "elemMatch equality and equality cold-cache benchmark", equalityEquality, 1, 0);
  await measure(db, "elemMatch equality and equality warm-cache benchmark", equalityEquality);
  await measure(db, "elemMatch equality and range benchmark", {
    where: {
      path: "orders[]",
      elemMatch: {
        and: [
          { path: "status", eq: "paid" },
          { path: "price", gte: 15_000 }
        ]
      }
    }
  });
  await measure(db, "elemMatch low-cardinality child terms benchmark", {
    where: {
      path: "orders[]",
      elemMatch: {
        and: [
          { path: "status", eq: "pending" },
          { path: "channel", eq: "web" }
        ]
      }
    }
  });
  await measure(db, "elemMatch high-cardinality child terms benchmark", {
    where: {
      path: "orders[]",
      elemMatch: {
        and: [
          { path: "id", eq: "alternate-777" },
          { path: "price", gt: 1_000 }
        ]
      }
    }
  });
  const stats = await db.stats();
  console.log(`Posting cache: ${String(stats.postingCacheHits)} hits, ${String(stats.postingCacheMisses)} misses, ${String(stats.postingCacheSize)} entries.`);
  await db.close();
} finally {
  await cleanupBenchmarkDatabase(path, options.keep, options.path === undefined);
}

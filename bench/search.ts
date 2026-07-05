import { performance } from "node:perf_hooks";
import { SabliDatabase } from "../src/index.js";
import {
  cleanupBenchmarkDatabase,
  createBenchmarkDatabasePath,
  createBenchmarkDocument,
  parseBenchOptions,
  printMeasurement
} from "./dataset.js";

const options = parseBenchOptions(process.argv.slice(2));
const path = await createBenchmarkDatabasePath("search");

try {
  const db = await SabliDatabase.open({ path, createIfMissing: true });
  for (let id = 1; id <= options.count; id += 1) {
    await db.insert(createBenchmarkDocument(id));
  }
  await db.flush();

  const start = performance.now();
  const results = await db.search({
    where: {
      and: [
        { path: "tags[]", contains: "backend" },
        { path: "metrics.shard", eq: 4 }
      ]
    }
  });
  const elapsed = performance.now() - start;
  printMeasurement("Search benchmark", options.count, elapsed);
  console.log(`Search returned ${String(results.count)} documents.`);
  await db.close();
} finally {
  await cleanupBenchmarkDatabase(path, options.keep);
}

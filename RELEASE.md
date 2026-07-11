# Release Checklist

Before publishing `sablidb`:

1. Confirm Node.js 22 or newer is active.
2. Run `npm run check`.
3. Run benchmark scripts at small scale, for example:

   ```sh
   npm run bench:insert -- --count 100
   npm run bench:search -- --count 100
   npm run bench:reopen -- --count 100
   npm run bench:compaction -- --count 100
   ```

4. Run `npm pack --dry-run`.
5. Inspect the package contents from the dry run.
6. Verify `package.json` and `package-lock.json` use the intended release version.
7. Verify the latest `CHANGELOG.md` entry matches the release version.
8. Verify README version wording and examples match the release.
9. Run `npm run examples:check` and inspect `examples/elem-match.ts`.
10. Confirm new segments use metadata version 2 and contain a validated `scoped-postings.idx`.
11. Confirm a version-1 segment opens, returns exact `elemMatch` results through fallback, and upgrades after compaction.
12. Create a temporary ESModule consumer project and install the packed tarball.
13. Verify Node.js 22 or newer in that consumer project.
14. Verify basic insert, search, `elemMatch`, update, delete, and compact examples in that consumer project.
15. Publish only after the tarball and consumer smoke test match the intended release.

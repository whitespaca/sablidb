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
6. Create a temporary ESModule consumer project and install the packed tarball.
7. Verify the README examples in that consumer project.
8. Verify `CHANGELOG.md` contains the release version and notes.
9. Publish only after the tarball and consumer smoke test match the intended release.

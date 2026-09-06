# TUX-MENU History Import Provenance

- Source repository: `ahmedmohameda7222-ship-it/TUX-MENU`
- Source branch: `main`
- Original source HEAD: `285635181a9ee1ec2f760feb38abae8fa19a201d`
- Original source tree: `e9ddcc696470d7bb116e1d888a77ade84f95bf83`
- Original reachable commit count: `75`
- Original tracked-file count: `114`
- Canonical base before import: `2d32d29dead9b872ce392e9c186678d59de7603f`
- Canonical base tree: `085b08d4630a126482350f3b8ef9fc542216b23f`
- Rewrite method: `git filter-repo --to-subdirectory-filter apps/menu`
- Rewrite tool version: `2.47.0`
- Rewritten import tip: `12f1a8797ac2c58cba889f31ceab94043ba6173c`
- Import merge commit: `8bd491d2c1f17ea210b0f0c46aab729a8518edfa`

The pristine import merge was verified by comparing the complete original `git ls-tree -r` mode/type/blob/path inventory with `apps/menu/**` after stripping the prefix. The inventories matched exactly, the rewritten reachable commit count matched the original source count, the import merge has two parents, and source history is visible through `apps/menu/src/App.tsx`. Neither source repository history was rewritten.

Deferred byte-identical characterization before Task 3 produced one pre-existing TypeScript RED: both the untouched original source and the pristine imported copy fail `npm run typecheck` at `src/App.tsx(36,41)` with TS2322 involving `RouteComponentProps`. This was classified by separate source-authority execution and was not patched during Task 2. The untouched source and pristine import both build successfully, and the pristine import renders `/`, `/order-now`, `/tux-burger`, and `/admin` successfully in Chromium. Tracked Menu source and lockfiles remained byte-identical throughout characterization.

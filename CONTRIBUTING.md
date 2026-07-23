# Contributing to OreoDeck

Thank you for helping improve OreoDeck.

## Before opening a pull request

1. Open or reference an issue for substantial behavioral changes.
2. Preserve profile isolation, credential safety, and backwards compatibility.
3. Add or update tests for user-visible behavior.
4. Run the relevant checks:

   ```bash
   bun run typecheck
   bun run test
   cargo test --manifest-path packages/core-rs/Cargo.toml
   bun run test:app
   bun run lint
   bun run fmt:check
   ```

## Contribution licensing

Unless explicitly stated otherwise, contributions intentionally submitted for
inclusion in OreoDeck are provided under Apache-2.0, consistent with Section 5
of that license. Contributors must have the right to submit their code,
documentation, designs, or other materials.

Do not submit copied material under an incompatible license. When adding a
dependency, document its name, version, license, and upstream source in
`THIRD_PARTY_NOTICES.md`, and include files required for binary redistribution.

By submitting a pull request, you represent that the contribution is original
work or that you have sufficient rights to submit it under these terms.

## Security issues

Do not publish credentials or exploitable details in a public issue. Use the
repository's GitHub private security advisory feature instead.

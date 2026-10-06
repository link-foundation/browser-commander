## Summary

`.github/workflows/release.yml` runs the doc tests twice in the `test` job:

```yaml
      - name: Run tests            # release.yml:533-539
        run: >-
          bash scripts/run-with-budget-warning.sh "$TEST_BUDGET_SECONDS" "Test suite"
          cargo test --all-features --verbose

      - name: Run doc tests        # release.yml:541-547
        run: >-
          bash scripts/run-with-budget-warning.sh "$DOC_TEST_BUDGET_SECONDS" "Doc tests"
          cargo test --doc --verbose
```

`cargo test` already runs the library's doc tests (`Doc-tests <crate>` is the last target it executes) unless `[lib] doctest = false` is set, and the template's `Cargo.toml` does not set it. So the second step re-runs a target the first one already ran.

In the template itself the repeat is nearly free, because the crate has no `[features]` and `cargo test --doc` reuses the `--all-features` artifacts. A downstream crate that adds a feature pays for it: `--all-features` and the default feature set are different builds, so the second step recompiles the crate and its feature-dependent dependencies before running the same doc tests again.

## Reproduction

On the template (`main` at e7d4a5bceb152f76d9fde77bae6751b835b9cdcd):

```console
$ cargo test --all-features 2>&1 | grep -E "Doc-tests|test result" | tail -2
   Doc-tests example_sum_package_name
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
$ cargo test --doc 2>&1 | grep -E "Doc-tests|test result"
   Doc-tests example_sum_package_name
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Downstream, in link-foundation/browser-commander (crate with a `native-tls` feature), run [37505100807](https://github.com/link-foundation/browser-commander/actions/runs/37505100807), `Test (windows-latest)`:

- `17:53:59` `Doc-tests browser_commander` inside `cargo test --all-features` -> `20 passed ... finished in 16.27s`
- `17:54:20` the separate `cargo test --doc --verbose` step starts, rebuilds the crate for the default feature set, and runs `Doc-tests browser_commander` again at `17:55:12`.

The repeat cost ~77s per OS there, and on one Windows run it printed nothing until its 180s budget killed it, which turned `main` red for a step that tested nothing new (link-foundation/browser-commander#128).

## Workaround

Delete the `Run doc tests` step. Doc tests stay covered by `cargo test --all-features`. This is what browser-commander did in link-foundation/browser-commander#129, together with a unit test (`js/tests/unit/scripts/ci-timeout-budgets.test.js`, "runs the Rust doc tests once, inside the main test suite") that fails if the separate step comes back.

## Suggested fix

Either:

1. remove the `Run doc tests` step (and `DOC_TEST_BUDGET_SECONDS`), and note in a comment that `cargo test` already runs them; or
2. if a separate, separately budgeted doc-test step is wanted, split the targets instead of repeating one: `cargo test --all-features --lib --bins --tests` followed by `cargo test --all-features --doc`. Both use the same feature set, so nothing is rebuilt and each target runs once.

If option 2 is chosen, `--all-features` has to be on both commands, or a crate with features rebuilds again.

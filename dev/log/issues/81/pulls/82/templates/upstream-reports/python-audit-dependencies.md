## Summary

`scripts/audit_dependencies.py` has two defects that work against each other:
the audit **reports a vulnerability the project does not have**, and when it
fails it **prints no advisory table**, so the reader cannot tell.

### 1. The audited environment contains `pip`, so `pip` is audited (false positive)

```python
run([sys.executable, "-m", "venv", str(target_venv)], cwd=project_root)   # line 62
...
site_packages = run([str(target_python), "-c",
                     "import sysconfig; print(sysconfig.get_paths()['purelib'])"], ...)
run([str(audit_python), "-m", "pip_audit", "--path", site_packages, "--skip-editable"], ...)
```

`python -m venv` installs `pip` into the new environment's `site-packages` by
default. `--path` then points `pip-audit` at a directory whose contents are the
project's dependency closure **plus pip**. Every advisory against the pip
version that happens to be bundled with the runner's Python fails the job, for a
package the project neither declares nor ships.

### 2. `run()` captures stdout under `check=True`, so the failing run logs nothing

```python
def run(command: list[str], *, cwd: Path) -> str:
    completed = subprocess.run(command, cwd=cwd, check=True, text=True,
                               stdout=subprocess.PIPE)
    output = completed.stdout.strip()
    if output:
        print(output)
    return output
```

`subprocess.run(check=True)` raises `CalledProcessError` *before* returning, so
`print(output)` is never reached on a non-zero exit. `pip-audit` exits non-zero
exactly when it finds something — which means the advisory table it printed is
swallowed into `CalledProcessError.stdout` and the job log ends with a traceback
and an exit status. The one run where the output matters is the one run that
discards it.

## Reproducible example

Both defects, with nothing installed at all — no project, no dependencies:

```sh
mkdir /tmp/pipaudit-repro && cd /tmp/pipaudit-repro
python3 -m venv audit && ./audit/bin/pip install -q pip-audit==2.10.1
python3 -m venv target
PURELIB=$(./target/bin/python -c "import sysconfig; print(sysconfig.get_paths()['purelib'])")
ls "$PURELIB"
./audit/bin/python -m pip_audit --path "$PURELIB" --skip-editable
```

Observed:

```
pip
pip-26.1.2.dist-info
Found 1 known vulnerability in 1 package
Name Version ID              Fix Versions
---- ------- --------------- ------------
pip  26.1.2  PYSEC-2026-3721 26.2
exit=1
```

An empty project fails its own dependency audit.

For the second defect:

```python
import subprocess, sys
try:
    completed = subprocess.run([sys.executable, "-c", "print('advisory table'); raise SystemExit(1)"],
                               check=True, text=True, stdout=subprocess.PIPE)
    print(completed.stdout)          # never reached
except subprocess.CalledProcessError as error:
    print("job log shows only:", error)          # the table is in error.stdout
```

## Workaround

Run `pip-audit` against a requirements file rather than a resolved environment
(`pip-audit -r requirements.txt`), or filter `pip` out of the audited path
before the audit. Both are strictly worse than the fix: the first audits the
declared set rather than the resolved one, the second is a denylist.

## Suggested fix in code

Build the audited environment **without** pip and populate it from the outside
with `pip --python`, which has been supported since pip 22.3:

```python
run([sys.executable, "-m", "venv", "--without-pip", str(target_venv)], cwd=project_root)
run([sys.executable, "-m", "venv", str(audit_venv)], cwd=project_root)

target_python = python_executable(target_venv)
run([sys.executable, "-m", "pip", "--python", str(target_python), "install",
     project_install_target(project_root)], cwd=project_root)
```

The audited surface is then exactly the declared dependency closure — which is
what the job claims to audit.

And stream output by default, capturing only where a value is actually needed:

```python
def run(command: list[str], *, cwd: Path, capture: bool = False) -> str:
    """Run a command, failing the audit when dependency resolution fails.

    Output is streamed by default. Capturing it would hide the pip-audit table
    on the run that matters: subprocess.run(check=True) raises before the
    captured text is printed, leaving the job log with an exit status and no
    advisory.
    """
    completed = subprocess.run(command, cwd=cwd, check=True, text=True,
                               stdout=subprocess.PIPE if capture else None)
    if not capture:
        return ""
    output = completed.stdout.strip()
    if output:
        print(output)
    return output
```

Only the `sysconfig.get_paths()['purelib']` call needs `capture=True`.

Two regression tests are enough to hold both:

1. build the target environment and assert `pip` is **not** in its `purelib`;
2. stub a command that prints a table and exits 1, and assert the table appears
   on stdout before the failure propagates.

## Where this came from

`link-foundation/browser-commander` adopted this script from the template and
its first green-looking security run failed on **PYSEC-2026-3721 against pip
itself**, with no advisory table in the log to explain why. Both defects are
fixed there in PR link-foundation/browser-commander#82 (root cause RC-9), with
the two tests above in `python/tests/unit/scripts/test_audit_dependencies.py`.
The parent issue is link-foundation/browser-commander#81: eliminate every false
positive, false negative, warning and error in CI. This script was one of the
false positives.

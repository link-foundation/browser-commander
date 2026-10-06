## `run-with-budget-warning.sh` lists surviving processes on one line with literal `\n`, and its SIGTERM test child busy-loops a CPU core

Found while adopting the script in link-foundation/browser-commander#128. Both reproduce at template HEAD `4c8644f`.

### 1. Survivor list is one line with literal `\n`

`group_members()` in `scripts/run-with-budget-warning.sh` (line 168):

```bash
ps -eo pgid=,pid=,stat=,user=,args= 2>/dev/null \
  | awk -v group="${command_pid}" '$1 == group && $3 !~ /^Z/ {
      ...
      printf "%s %s %s\\n", pid, user, $0
    }'
```

The awk program is in single quotes, so the shell passes `\\n` to awk unchanged. Inside an awk string, `\\` is a literal backslash, so every record ends in the two characters `\` `n` and never in a newline. The Python and Rust templates write `\n` and are not affected.

Reproduction, with mawk and gawk alike:

```console
$ printf '1 10 S root sleep 100\n1 11 S root sleep 200\n' |
    awk '$1 == 1 { printf "%s %s %s\\n", $2, $4, $5 }'
10 root sleep\n11 root sleep\n
```

Against a real process group, using the function extracted from the script:

```console
$ sed -n '/^group_members() {/,/^}/p' scripts/run-with-budget-warning.sh > gm.sh
$ bash -c 'set -m; source ./gm.sh; (sleep 30 & sleep 31 & wait) & command_pid=$!; sleep 0.5
           out="$(group_members)"; printf "lines=%s\n" "$(printf %s "$out" | grep -c "")"; echo "$out"
           kill -KILL -- -$command_pid'
lines=1
218518 box bash -c ...\n218520 box sleep 30\n218521 box sleep 31\n
```

Effect: `report_survivors` is the one place a stuck step explains itself. It prints a single run-on line to stderr. Its `::error ... Still running: $(echo "${survivors}" | tr '\n' ';')` annotation has no newlines to translate, so it shows literal `\n` sequences. `group_is_populated` still works, because it only tests for non-empty output.

Fix: `printf "%s %s %s\n", pid, user, $0`. A regression test: start a group of two sleeps, call `group_members`, and assert two lines.

### 2. The SIGTERM-ignoring test child spins at 100% CPU

`tests/run-with-budget-warning.test.js` (`writeIgnoreTermChild`, line ~243):

```bash
trap 'echo "child ignored SIGTERM"' TERM
end=$((SECONDS + 600))
while [ "$SECONDS" -lt "$end" ]; do
  read -r -t 1 _ </dev/null 2>/dev/null || :
done
```

`read` from `/dev/null` hits EOF at once, so `-t 1` never waits. The loop spins until the wrapper's SIGKILL, about 4 s with a 2 s budget and 2 s grace. During that time it competes with the other test files that `node --test` runs in parallel on a 2-vCPU runner.

```console
$ bash -c 'end=$((SECONDS+2)); n=0; while [ "$SECONDS" -lt "$end" ]; do read -r -t 1 _ </dev/null 2>/dev/null || :; n=$((n+1)); done; echo $n'
43333                                # iterations in 2 s
$ time bash busy.sh                  # the loop above, 3 s
real 0m2.756s  user 0m1.239s  sys 0m1.474s
$ time bash calm.sh                  # same loop with `sleep 1 & wait $!`
real 0m3.030s  user 0m0.009s  sys 0m0.021s
```

Fix: wait in a way that blocks but still lets the trap run.

```bash
trap 'echo "child ignored SIGTERM"' TERM
end=$((SECONDS + 600))
while [ "$SECONDS" -lt "$end" ]; do
  sleep 1 & wait $!
done
```

`wait` returns when the trapped TERM arrives, the trap prints, and the loop continues, so the test still covers SIGTERM being ignored. This was verified: the process is still alive 1.5 s after `kill -TERM`, and SIGKILL is what ends it.

A simpler alternative is `while :; do sleep 0.2; done`. Bash runs the trap once the foreground `sleep` returns, at most 0.2 s later. browser-commander uses that form.

### Workaround

Downstream copies can apply both one-line fixes. browser-commander did so in link-foundation/browser-commander#129.

"""Named check batches, invoked under run-load.py check with no dormant Bun argv."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


root = Path(__file__).resolve().parent
phase, runtime = sys.argv[1:]
if phase == "final-complete":
    failed = False
    for batch in ("final", "full-final"):
        for version in ("142", "140"):
            result = subprocess.run([sys.executable, str(root / "run-checks.py"), batch, version])
            failed |= bool(result.returncode)
    raise SystemExit(int(failed))
if phase == "final-both":
    failed = False
    for version in ("142", "140"):
        result = subprocess.run([sys.executable, str(root / "run-checks.py"), "final", version])
        failed |= bool(result.returncode)
    raise SystemExit(int(failed))
if phase == "candidate-v2-both":
    for batch in ("candidate-v2", "full"):
        for version in ("142", "140"):
            result = subprocess.run([sys.executable, str(root / "run-checks.py"), batch, version])
            if result.returncode:
                raise SystemExit(result.returncode)
    raise SystemExit(0)
env = os.environ.copy()
binary_dir = "/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0" if runtime == "140" else "/home/ubuntu/.bun/bin"
env["PATH"] = binary_dir + os.pathsep + env["PATH"]
harness = "/home/ubuntu/workspace/zebra/bench/hot-path.ts"
baseline = "/tmp/zebra-performance-speedup-01/baseline-a856cab"
focused = ["bun", "test", "packages/core/test/app", "packages/core/test/middleware", "packages/core/test/contract", "packages/core/test/ws.test.ts", "packages/session/test", "packages/observability/test"]
if phase == "setup":
    commands = [("install", ["bun", "install", "--frozen-lockfile"])] if runtime == "140" else []
    commands += [("baseline-check", ["bun", harness, "--source-root", baseline, "--suite", "all", "--check"])]
elif phase in ("style", "style-fixed"):
    commands = [(f"candidate-{phase}", ["bun", "x", "biome", "check", "--write", "packages/core/src/app/internals.ts", "packages/core/src/middleware/compose.ts", "packages/core/test/app/pipeline-compatibility.test.ts", "packages/core/test/middleware/compose.test.ts"])]
elif phase in ("candidate", "candidate-v2", "final"):
    commands = [(f"{phase}-focused", focused), (f"{phase}-harness", ["bun", harness, "--source-root", os.getcwd(), "--suite", "all", "--check"]), (f"{phase}-typecheck", ["bun", "run", "typecheck"]), (f"{phase}-lint", ["bun", "run", "lint"])]
    if phase in ("candidate", "candidate-v2"):
        identity = 'import "reflect-metadata"; import {dirname} from "node:path"; import {realpathSync} from "node:fs"; const root=process.cwd(); const facade=realpathSync(Bun.resolveSync("@zebra-web/zebra", root+"/bench")); const core=realpathSync(Bun.resolveSync("@zebra-web/core", dirname(facade))); if (!core.startsWith(root+"/packages/core/")) throw new Error("Wrong workspace core"); const selected=await import(core); const direct=await import(root+"/packages/core/src/index.ts"); if (selected.Zebra !== direct.Zebra) throw new Error("Distinct module identity"); console.log(JSON.stringify({bun:Bun.version,revision:Bun.revision,executable:process.execPath,facade,core,sameModule:true}));'
        commands.insert(0, (f"{phase}-identity", ["bun", "-e", identity]))
elif phase in ("full", "full-final"):
    commands = [("candidate-build", ["bun", "run", "build"]), ("candidate-full-test", ["bun", "run", "test"]), ("candidate-packages", ["bun", "run", "verify:packages"]), ("candidate-coverage", ["bun", "test", "--coverage", "--coverage-reporter=lcov", "packages/core"]), ("candidate-coverage-gate", ["bun", "run", "check:coverage"]), ("candidate-docs", ["bun", "run", "docs:build"])]
    for package in ("client", "contract"):
        commands.append((f"candidate-browser-{package}", ["bun", "build", f"packages/{package}/src/index.ts", "--target", "browser", "--outfile", str(root / f"browser-{package}-{runtime}.js")]))
    commands.append(("candidate-browser-scan", [sys.executable, str(root / "scan-browser.py"), runtime]))
    env["DOCS_BASE"] = "/zebra/"
    if phase == "full-final":
        commands = [(label.replace("candidate-", "final-", 1), command) for label, command in commands]
else:
    raise ValueError(phase)
failed = False
for label, command in commands:
    if phase == "setup" and (root / "checks.jsonl").exists():
        previous = [json.loads(line) for line in (root / "checks.jsonl").read_text().splitlines()]
        if any(row["label"] == f"{label}-{runtime}" and row["command"] == command and row["exit"] == 0 for row in previous):
            print(f"Reusing completed {label}-{runtime}", flush=True)
            continue
    result = subprocess.run([sys.executable, str(root / "record-check.py"), f"{label}-{runtime}", *command], env=env)
    if result.returncode:
        if phase not in ("final", "full-final"):
            raise SystemExit(result.returncode)
        failed = True
if phase in ("final", "full-final"):
    raise SystemExit(int(failed))
if phase in ("style", "style-fixed"):
    for batch in ("candidate", "full"):
        failed = False
        for version in ("142", "140"):
            result = subprocess.run([sys.executable, str(root / "run-checks.py"), batch, version])
            if result.returncode:
                failed = True
        if failed:
            if batch == "candidate":
                # Only this exact, predeclared compatibility failure permits the
                # bounded fallback; unrelated failures need manual inspection.
                expected = ("middleware", "terminal")
                for version in ("142", "140"):
                    output = gzip.decompress((root / f"candidate-focused-{version}.log.gz").read_bytes()).decode()
                    assert len({line.split(" [")[0] for line in output.splitlines() if line.startswith("(fail)")}) == 2
                    assert all(f"(fail) {name} promise with a throwing then getter" in output for name in expected)
                patch = subprocess.check_output(["git", "diff", "--binary", "HEAD", "--", "packages/core/src/app/internals.ts", "packages/core/src/middleware/compose.ts"])
                assert patch == gzip.decompress((root / "candidate-initial-formatted.patch.gz").read_bytes())
                file = "packages/core/src/middleware/compose.ts"
                Path(file).write_bytes(subprocess.check_output(["git", "show", f"609c1d298393c49b49e6c11537e55437c5f6a89f:{file}"]))
                patch = subprocess.check_output(["git", "diff", "--binary", "HEAD", "--", "packages/core/src/app/internals.ts", "packages/core/src/middleware/compose.ts"])
                (root / "candidate-app-only.patch.gz").write_bytes(gzip.compress(patch, mtime=0))
                with (root / "candidate-patches.jsonl").open("a") as file:
                    file.write(json.dumps({"name": "dispatch-only fallback after both runtimes reject the Promise.resolve shortcut", "patch": "candidate-app-only.patch.gz", "sha256": hashlib.sha256(patch).hexdigest(), "parent": "609c1d298393c49b49e6c11537e55437c5f6a89f"}) + "\n")
                for version in ("142", "140"):
                    result = subprocess.run([sys.executable, str(root / "run-checks.py"), "candidate-v2", version])
                    if result.returncode:
                        raise SystemExit(result.returncode)
                continue
            raise SystemExit(1)

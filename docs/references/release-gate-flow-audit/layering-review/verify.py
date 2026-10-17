#!/usr/bin/env python3
"""固定源码的流程核对与纯逻辑反例；不运行产品、CI、网络或发布。"""

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import textwrap


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
INPUTS = json.loads((HERE / "inputs.json").read_text())


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_source(name):
    data = (ROOT / name).read_bytes()
    assert sha256(data) == INPUTS["sourceSha256"][name], f"研究输入已变化：{name}"
    return data.decode()


for source_name in INPUTS["sourceSha256"]:
    read_source(source_name)

scripts = json.loads(read_source("package.json"))["scripts"]
calls = lambda command: re.findall(r"\bnpm run ([\w:.-]+)", command)
reachable = set()


def visit(name):
    if name in reachable:
        return
    reachable.add(name)
    for dependency in calls(scripts.get(name, "")):
        visit(dependency)


visit("test")
top_level = calls(scripts["test"])
assert len(top_level) == 70
named_audit = [
    "typecheck:notifier", "test:notifier-smoke", "test:notifier-locale-smoke",
    "test:publish-tag-release", "test:vscode-smoke-runner-env",
    "test:runtime-root-ownership", "test:runtime-root-preparation",
    "test:runtime-supervisor-startup-profile", "test:runtime-supervisor-namespace",
    "test:execution-native-assets",
]
assert not set(named_audit) & reachable

clean_checkout = read_source("scripts/release/run-clean-checkout-vsix-validation.mjs")
packaged_runner = read_source("scripts/smoke/run-vscode-vsix-smoke.mjs")
assert "['run', 'package:vsix']" in clean_checkout
assert "['run', 'test:vsix-smoke']" in clean_checkout
assert "['run', 'package:vsix']" in packaged_runner
assert "['run', 'build:notifier']" in packaged_runner
for contents in (clean_checkout, packaged_runner):
    assert "right.mtimeMs - left.mtimeMs" in contents
assert "delete packageJson.extensionDependencies;" in packaged_runner
assert "delete packageJson.extensionPack;" in packaged_runner
assert "packageJson.main = './extension.js';" in packaged_runner

workflow = read_source(".github/workflows/publish-marketplace-release.yml")
assert 'run: npm run release:publish-tag -- --trigger-tag "$TRIGGER_TAG" --package-only' in workflow
merge_step = workflow.split("      - name: Merge marketplace manifests\n", 1)[1].split(
    "      - name: Update GitHub Release manifest and notes\n", 1
)[0]
merge_code = textwrap.dedent(merge_step.split("          node -e '\n", 1)[1].split(
    "          ' \"$manifest_path\"", 1
)[0])
assert 'const targetComplete = (key)' in merge_code

publisher = read_source("scripts/release/publish-tag-release.mjs")
verify_code = "async function verifyMarketplaceTargets" + publisher.split(
    "async function verifyMarketplaceTargets", 1
)[1].split("\nasync function marketplaceVersionExists", 1)[0]
assert "if (previousStatus === 'verified')" in verify_code
node = shutil.which("node")
assert node, "需要 Node 执行现有纯逻辑；无需 npm install"


def node_run(code, args, output_path):
    result = subprocess.run(
        [node, "-e", code, *args], cwd=output_path.parent,
        env={"PATH": os.defpath, "GITHUB_OUTPUT": str(output_path)},
        text=True, capture_output=True, timeout=10, check=True,
    )
    return result.stdout


def complete_entries(status="verified"):
    return {key: {"status": status, "version": "0.26.1"} for key in ("main", "notifier")}


def base_manifest():
    return {
        "schemaVersion": 1, "version": "0.26.1", "releaseRef": "a" * 40,
        "finalTag": "v0.26.1", "marketplaces": {},
        "artifacts": [
            {"extension": key, "sha256": "b" * 64, "path": f"{key}.vsix"}
            for key in ("main", "notifier")
        ],
    }


merge_results = []
history_results = []
with tempfile.TemporaryDirectory(prefix="dsc-gate-review-") as temp_name:
    temp_root = Path(temp_name)
    for name in (
        "matching-partial", "wrong-release-ref", "wrong-artifact-hash",
        "missing-partials-with-history", "missing-partials-without-history",
    ):
        directory = temp_root / name
        directory.mkdir()
        base = base_manifest()
        partial = copy.deepcopy(base)
        partial["marketplaces"]["openVsx"] = complete_entries()
        if name == "wrong-release-ref":
            partial["releaseRef"] = "c" * 40
        if name == "wrong-artifact-hash":
            partial["artifacts"][0]["sha256"] = "d" * 64
        if name == "missing-partials-with-history":
            base["marketplaces"]["openVsx"] = complete_entries()
        base_path = directory / "base.json"
        base_path.write_text(json.dumps(base))
        partial_path = directory / "open.json"
        partial_path.write_text(json.dumps(partial))
        use_partial = not name.startswith("missing-partials")
        output_path = directory / "outputs.txt"
        node_run(merge_code, [str(base_path), str(partial_path) if use_partial else "", ""], output_path)
        merged = json.loads(base_path.read_text())
        outputs = dict(line.split("=", 1) for line in output_path.read_text().splitlines())
        complete = outputs["release_complete"] == "true"
        assert complete == (name != "missing-partials-without-history")
        merge_results.append({
            "case": name, "releaseComplete": complete, "status": merged["status"],
            "partialPresent": use_partial, "scope": "existing-inline-merge-only",
        })

    for name, initial_status, query_ok in (
        ("history-verified-current-query-false", "verified", False),
        ("pending-current-query-false", "pending-verification", False),
        ("pending-current-query-true", "pending-verification", True),
    ):
        directory = temp_root / name
        directory.mkdir()
        body = (
            "const options = {dryRun:false, marketplaceVerifyAttempts:1};\n"
            "let queryCalls = 0;\n"
            f"async function marketplaceVersionExists() {{queryCalls++; return {str(query_ok).lower()};}}\n"
            "function marketplaceKey() {return 'openVsx';}\n"
            "async function sleep() {throw new Error('Unexpected retry');}\n"
            + verify_code + "\n"
            "(async () => {\n"
            f"const manifest = {{marketplaces:{{openVsx:{{main:{{status:{json.dumps(initial_status)}}}}}}}}};\n"
            "const ok = await verifyMarketplaceTargets({context:{version:'0.26.1'},"
            "extensions:[{id:'main'}],targets:['open-vsx'],manifest});\n"
            "console.log(JSON.stringify({ok,queryCalls,status:manifest.marketplaces.openVsx.main.status}));\n"
            "})().catch(error => {console.error(error);process.exitCode=1;});\n"
        )
        stdout = node_run(body, [], directory / "outputs.txt")
        value = json.loads(stdout.strip().splitlines()[-1])
        assert value["queryCalls"] == 1
        assert value["ok"] == (initial_status == "verified" or query_ok)
        history_results.append({"case": name, **value, "scope": "existing-verifier-with-query-stub"})

report = {
    "scope": "fixed-source-static-and-isolated-pure-logic-only",
    "inputHead": INPUTS["inputHead"],
    "sourceHashChecks": len(INPUTS["sourceSha256"]),
    "npmTest": {
        "topLevelCount": len(top_level), "topLevelOrder": top_level,
        "reachableRootScriptNames": sorted(reachable),
        "namedScriptsNotReachableByNpmRun": named_audit,
        "limitation": "只跟踪根 npm run 调用；不等于代码覆盖或这些脚本完全未测试",
    },
    "buildPaths": [
        "release:verify -> clean checkout -> package:vsix",
        "clean checkout -> test:vsix-smoke -> build:notifier + package:vsix -> latest-mtime main VSIX",
        "publish prepare -> release:publish-tag --package-only -> new main + notifier VSIX",
    ],
    "staticPathAssertions": {
        "cleanAndPackagedBothRepackageMain": True,
        "bothSelectLatestMtime": True,
        "packagedChangesManifestAndStagesNotifierBuild": True,
        "finalPrepareHasSeparatePackageStep": True,
    },
    "mergeCodeSha256": sha256(merge_code.encode()),
    "verifierCodeSha256": sha256(verify_code.encode()),
    "mergeControls": merge_results, "historyControls": history_results,
    "releaseAcceptanceRun": False, "productTestsRun": False,
    "networkUsedByControls": False, "temporaryFilesRemoved": True,
}
(HERE / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"sourceHashes": report["sourceHashChecks"], "topLevelCommands": len(top_level),
                  "mergeControls": len(merge_results), "historyControls": len(history_results),
                  "scope": report["scope"]}, ensure_ascii=False))

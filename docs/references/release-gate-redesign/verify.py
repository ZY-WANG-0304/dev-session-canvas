#!/usr/bin/env python3
"""核对设计依赖/覆盖和身份判定；只运行数据控制，不运行产品或CI。"""

import copy
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
model = json.loads((HERE / "design-model.json").read_text())
mapping = json.loads((HERE / "migration-map.json").read_text())
inputs = json.loads((HERE / "inputs.json").read_text())
for name, digest in inputs["sourceSha256"].items():
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, f"输入变化：{name}"


def check_dag(jobs):
    by_id = {job["id"]: job for job in jobs}
    assert len(by_id) == len(jobs)
    visited, active = set(), set()

    def visit(name):
        assert name in by_id and name not in active, f"无效依赖或环：{name}"
        if name in visited:
            return
        active.add(name)
        for dependency in by_id[name]["needs"]:
            visit(dependency)
        active.remove(name)
        visited.add(name)

    for name in by_id:
        visit(name)
    return by_id


jobs = check_dag(model["jobs"])
publish_jobs = check_dag(model["publishJobs"])
producers = {item: job["id"] for job in model["jobs"] for item in job["produces"]}
for job in model["jobs"]:
    for item in job["consumes"]:
        assert producers[item] in job["needs"], f"缺产物依赖：{job['id']}"
assert jobs["input-contract"]["needs"] == ["resolve"]
assert jobs["frontend-build"]["needs"] == ["resolve"]
assert "native-assets" in jobs["source-build"]["needs"]
assert "native-assets" in jobs["package-clean"]["needs"]
assert jobs["verify-result"]["always"] and publish_jobs["finalize-release"]["always"]
assert len(model["nativeTargets"]) == 6 and len(model["installedTargets"]) == 3
assert len(model["publishJobs"]) == 6

scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
top = re.findall(r"\bnpm run ([\w:.-]+)", scripts["test"])
assert [item["script"] for item in mapping["topLevel"]] == top and len(top) == 70
for item in mapping["topLevel"] + mapping["additionalNamedChecks"]:
    assert item["script"] in scripts
    assert item["destinationJobs"] and set(item["destinationJobs"]) <= jobs.keys()
for item in mapping["marketplaceBranches"]:
    assert item["script"] in scripts and item["destinationJob"] in jobs
assert sum(item["sourceDefault"] for item in mapping["smokeRoutes"]) == 19
assert sum(item["packagedDefault"] for item in mapping["smokeRoutes"]) == 8
assert sum(item["sourceFocusedOnly"] for item in mapping["smokeRoutes"]) == 3
assert len(mapping["smokeRoutes"]) == 22
catalog = {item["id"] for item in mapping["caseCatalog"]}
assert len(catalog) == 152
for item in mapping["smokeRoutes"]:
    assert set(item["caseTargets"]) <= catalog
    assert bool(item["defaultJobs"]) == (item["sourceDefault"] or item["packagedDefault"])


def selected(mode):
    tiers = model["modes"][mode]["tiers"]
    if not tiers:
        return []
    return [job["id"] for job in model["jobs"] if job["tier"] in tiers]


for mode in model["modes"]:
    scope = selected(mode)
    for name in scope:
        assert set(jobs[name]["needs"]) <= set(scope)
assert set(selected("release-pr")) == set(selected("release-tag"))
assert not model["modes"]["diagnostic"]["acceptance"]

plan = {"schemaVersion": 1, "inputSHA": "a" * 40, "planHash": "b" * 64,
        "version": "0.26.1", "environmentHash": "c" * 64, "mode": "release-tag"}
pair = {"main": "d" * 64, "notifier": "e" * 64}


def receipts():
    return [{**plan, "taskID": name, "jobResult": "success", "producerTrusted": True,
             "artifactHashes": copy.deepcopy(pair) if jobs[name]["tier"] == "artifact" else {},
             "caseResults": [{"id": case, "status": "passed"} for case in mandatory(name, plan["mode"])],
             "phases": {phase: "passed" for phase in model["phases"]}}
            for name in selected(plan["mode"])]


def mandatory(name, mode):
    if name == "native-assets":
        kinds = ["load"] + (model["nativeOperations"] if model["modes"][mode]["requiredNativeOperations"] else [])
        return [f"{target}/{kind}" for target in model["nativeTargets"] for kind in kinds]
    return model["mandatoryCases"].get(name, [name])


def aggregate(expected, reports):
    required = selected(expected["mode"])
    if not required or len(reports) != len(required):
        return False
    actual = [receipt["taskID"] for receipt in reports]
    if len(set(actual)) != len(actual) or set(actual) != set(required):
        return False
    for receipt in reports:
        if any(receipt.get(key) != expected[key] for key in model["identityFields"]):
            return False
        if not receipt["producerTrusted"] or receipt["jobResult"] != "success":
            return False
        cases = receipt["caseResults"]
        required_cases = mandatory(receipt["taskID"], expected["mode"])
        if len(cases) != len(required_cases) or {case["id"] for case in cases} != set(required_cases):
            return False
        if any(case["status"] != "passed" for case in cases):
            return False
        if set(receipt["phases"]) != set(model["phases"]) or any(
            state != "passed" for state in receipt["phases"].values()
        ):
            return False
        if jobs[receipt["taskID"]]["tier"] == "artifact" and receipt["artifactHashes"] != pair:
            return False
    return True


controls = []


def control(name, actual, expected):
    assert actual == expected, f"设计控制不符合约束：{name}"
    controls.append({"case": name, "observed": actual, "expected": expected})


control("complete-final-ref", aggregate(plan, receipts()), True)
control("missing-layer", aggregate(plan, receipts()[:-1]), False)
duplicated = receipts()
duplicated[-1] = copy.deepcopy(duplicated[-2])
control("duplicate-layer-hides-missing", aggregate(plan, duplicated), False)
for job_name in ("native-assets", "source-host", "packaged-host", "installed-pair"):
    reports = receipts()
    next(report for report in reports if report["taskID"] == job_name)["caseResults"].pop()
    control(f"missing-{job_name}-case", aggregate(plan, reports), False)
reports = receipts()
report = next(report for report in reports if report["taskID"] == "source-host")
report["caseResults"][-1] = copy.deepcopy(report["caseResults"][0])
control("duplicate-case-hides-missing", aggregate(plan, reports), False)
reports = receipts()
report = next(report for report in reports if report["taskID"] == "native-assets")
report["caseResults"][-1]["status"] = "failed"
control("native-load-pass-operation-fail", aggregate(plan, reports), False)
for field in model["identityFields"]:
    reports = receipts()
    reports[0][field] = "wrong"
    control(f"wrong-{field}", aggregate(plan, reports), False)
for phase in model["phases"]:
    reports = receipts()
    reports[3]["phases"][phase] = "failed"
    control(f"{phase}-failure", aggregate(plan, reports), False)
for status in ("failure", "cancelled", "skipped", "timed-out"):
    reports = receipts()
    reports[2]["jobResult"] = status
    control(f"job-{status}", aggregate(plan, reports), False)
reports = receipts()
reports[-1]["artifactHashes"]["main"] = "wrong"
control("changed-package", aggregate(plan, reports), False)
reports = receipts()
reports[0]["producerTrusted"] = False
control("self-claimed-provenance", aggregate(plan, reports), False)
diagnostic_plan = {**plan, "mode": "diagnostic"}
control("diagnostic-never-accepts", aggregate(diagnostic_plan, []), False)


def channel_entries():
    return [{"schemaVersion": 1, "inputSHA": plan["inputSHA"], "version": plan["version"],
             "extension": extension, "target": target, "sourcePackageHash": pair[extension],
             "contentPolicyHash": "f" * 64, "content": "match", "use": "fresh",
             "producerTrusted": True, "jobResult": "success", "currentObservation": "present"}
            for target in model["requiredCompletionTargets"] for extension in model["extensions"]]


def completion(entries, retry=False, selected_targets=()):
    required = {(target, extension) for target in model["requiredCompletionTargets"]
                for extension in model["extensions"]}
    seen = set()
    for entry in entries:
        key = (entry["target"], entry["extension"])
        if key in seen or entry["target"] not in model["requiredCompletionTargets"] + [model["deferredTarget"]]:
            return False
        seen.add(key)
        if entry["extension"] not in pair or entry["schemaVersion"] != 1:
            return False
        if entry["inputSHA"] != plan["inputSHA"] or entry["version"] != plan["version"]:
            return False
        if entry["sourcePackageHash"] != pair[entry["extension"]] or entry["contentPolicyHash"] != "f" * 64:
            return False
        if not entry["producerTrusted"]:
            return False
        if key not in required:
            continue  # VS deferred仍要校验身份，不要求成功
        if entry["content"] != "match" or entry["currentObservation"] == "mismatch":
            return False
        if entry["use"] == "reused":
            if not retry or entry["target"] in selected_targets or not entry.get("historicalTrusted"):
                return False
        elif entry["use"] != "fresh" or entry["jobResult"] != "success" or entry["currentObservation"] != "present":
            return False
    return required <= seen


control("open-vsx-and-github-vs-deferred", completion(channel_entries()), True)
control("required-channel-missing", completion(channel_entries()[:-1]), False)
for field in ("inputSHA", "version", "sourcePackageHash", "contentPolicyHash", "schemaVersion"):
    entries = channel_entries()
    entries[-1][field] = "wrong"
    control(f"channel-wrong-{field}", completion(entries), False)
entries = channel_entries()
entries[-1]["content"] = "unknown"
control("version-present-content-unknown", completion(entries), False)
entries = channel_entries()
entries[-1]["currentObservation"] = "unknown"
control("fresh-query-unknown", completion(entries), False)
entries = channel_entries()
entries[-1].update(use="reused", historicalTrusted=True, currentObservation="unknown", jobResult="skipped")
control("new-release-rejects-history", completion(entries), False)
control("retry-explicit-history-original-package", completion(entries, retry=True), True)
control("selected-retry-needs-fresh", completion(entries, retry=True, selected_targets=["open-vsx"]), False)
entries[-1]["currentObservation"] = "mismatch"
control("retry-mismatch-blocks-history", completion(entries, retry=True), False)
entries = channel_entries()
entries.append({**entries[-1], "target": "visual-studio", "content": "unknown", "currentObservation": "unknown", "jobResult": "failure"})
control("vs-deferred-does-not-block", completion(entries), True)
entries[-1]["inputSHA"] = "wrong"
control("deferred-result-wrong-identity-rejected", completion(entries), False)
submission_policy = {"absent": "submit-once", "present": "verify-content", "unknown": "query-only"}
control("unknown-submission-not-resubmitted", submission_policy["unknown"], "query-only")
control("pr-package-not-final-package", "release-pr" == "release-tag", False)

document = ROOT / "docs/design-docs/release-gate-redesign.md"
text = document.read_text()
assert "decision_status: 已选定" in text and "validation_status: 未验证" in text
assert "## 正式方案" in text
links = 0
for target in re.findall(r"\]\(([^)]+)\)", text):
    path = target.split("#", 1)[0]
    if path and "://" not in path:
        assert (document.parent / path).exists(), f"缺文档产物：{path}"
        links += 1
report = {
    "scope": "design-model-only-not-ci-product-release", "sourceHashChecks": len(inputs["sourceSha256"]),
    "validationJobs": len(jobs), "publishJobs": len(publish_jobs), "nativeTargets": 6, "installedTargets": 3,
    "legacyTopLevelMappings": len(mapping["topLevel"]), "marketplaceBranches": len(mapping["marketplaceBranches"]),
    "smokeRoutes": len(mapping["smokeRoutes"]), "caseCatalog": len(catalog), "documentLinks": links,
    "controls": controls, "productTestsRun": False, "workflowChanged": False,
    "hashes": {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest()
               for name in ("design-model.json", "migration-map.json")},
}
delivery_docs = ["docs/design-docs/release-gate-redesign.md", "docs/design-docs/smoke-scenario-boundaries.md",
                 "docs/references/release-gate-redesign/README.md", "docs/exec-plans/completed/release-gate-redesign.md"]
delivery_links = 0
for name in delivery_docs:
    file = ROOT / name
    contents = file.read_text()
    for target in re.findall(r"\]\(([^)]+)\)", contents):
        target = target.split("#", 1)[0]
        if target and "://" not in target:
            assert (file.parent / target).exists(), f"缺交付链接：{name} -> {target}"
            delivery_links += 1
    if name.startswith("docs/design-docs/"):
        assert "decision_status: 已选定" in contents and "validation_status: 未验证" in contents
        assert "## 正式方案" in contents
        row = next(line for line in (ROOT / "docs/design-docs/index.md").read_text().splitlines()
                   if f"`{name}`" in line)
        assert "| 已选定 | 未验证 |" in row
report["documentLinksAcrossDelivery"] = delivery_links
report["deliveryDocSha256"] = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in delivery_docs}
(HERE / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"jobs": len(jobs), "publishJobs": len(publish_jobs), "mappings": 70,
                  "smokeRoutes": 22, "controls": len(controls), "scope": report["scope"]}))

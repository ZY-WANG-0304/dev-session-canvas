#!/usr/bin/env python3
"""生成可审阅的设计模型和迁移输入；不创建实际CI或调用产品。"""

import hashlib
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BLUEPRINT = ROOT / "docs/design-docs/release-gate-redesign.md"


def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
coverage_path = ROOT / "docs/references/release-gate-flow-audit/smoke-redesign/coverage-map.json"
coverage = json.loads(coverage_path.read_text())
special = {
    "test:marketplace": ["regression", "marketplace-browser", "marketplace-host"],
    "test:package-vsix-file-list": ["package-clean"],
    "test:activitybar-badges": ["webview-function"],
    "test:avatar": ["webview-function"],
    "test:sidebar-node-list": ["webview-function"],
    "test:smoke": ["source-host"],
    "test:webview": ["webview-function", "webview-visual"],
}
top = re.findall(r"\bnpm run ([\w:.-]+)", scripts["test"])
mapping = [{"ordinal": i, "script": name, "currentCommand": scripts[name],
            "destinationJobs": special.get(name, ["regression"]),
            "migrationRule": "保留内部所有具名检查与断言；build入口改为显式消费所属层产物"}
           for i, name in enumerate(top, 1)]
routes = []
for item in coverage["currentRoutes"]:
    routes.append({
        "currentScenario": item["currentScenario"],
        "sourceDefault": item["sourceDefault"],
        "packagedDefault": item["packagedDefault"],
        "sourceFocusedOnly": item["sourceFocusedOnly"],
        "defaultJobs": (["source-host"] if item["sourceDefault"] else [])
        + (["packaged-host"] if item["packagedDefault"] else []),
        "diagnosticJob": "source-host" if item["sourceFocusedOnly"] else None,
        "caseTargets": item["targets"],
        "context": item["context"],
    })
write("migration-map.json", {
    "scope": "design-migration-not-implemented", "topLevel": mapping,
    "marketplaceBranches": [
        {"script": name, "destinationJob": destination}
        for name, destination in [
            ("typecheck:marketplace", "regression"), ("test:marketplace-shared", "regression"),
            ("test:marketplace-api", "regression"), ("test:marketplace-web", "regression"),
            ("test:marketplace-production-config", "regression"),
            ("test:marketplace-vscode-preview-preflight", "regression"),
            ("test:marketplace-browser-e2e", "marketplace-browser"),
            ("test:marketplace-vscode-fixture-e2e", "marketplace-host"),
        ]
    ],
    "additionalNamedChecks": [
        {"script": name, "destinationJobs": jobs}
        for name, jobs in [
            ("typecheck:notifier", ["regression"]),
            ("test:notifier-smoke", ["source-host", "installed-pair"]),
            ("test:notifier-locale-smoke", ["source-host", "installed-pair"]),
            ("test:publish-tag-release", ["regression"]),
            ("test:vscode-smoke-runner-env", ["regression"]),
            ("test:runtime-root-ownership", ["regression"]),
            ("test:runtime-root-preparation", ["regression"]),
            ("test:runtime-supervisor-startup-profile", ["regression"]),
            ("test:runtime-supervisor-namespace", ["regression"]),
            ("test:execution-native-assets", ["regression"]),
        ]
    ],
    "smokeRoutes": routes,
    "caseCatalog": [{"id": item["id"], "status": item["status"]} for item in coverage["cases"]],
    "limitations": ["静态迁移不代替helper内部断言review", "137现有目的地与15新增待验不是已实现case",
                    "focused诊断不自动计入默认完整通过", "未运行产品/CI/渠道"],
})

jobs = [
    ("resolve", "base", [], [], "冻结不可变SHA/范围/环境与任务计划"),
    ("input-contract", "base", ["resolve"], [], "静态输入与分类一致性"),
    ("regression", "base", ["resolve"], [], "类型/协议/状态/夹具/门禁自身回归"),
    ("frontend-build", "base", ["resolve"], [], "真实浏览器入口独立构建"),
    ("webview-function", "base", ["frontend-build"], ["frontend-bundle"], "前端交互/协议"),
    ("webview-visual", "base", ["frontend-build"], ["frontend-bundle"], "固定环境视觉基线"),
    ("marketplace-browser", "base", ["frontend-build"], ["frontend-bundle"], "本地浏览器/HTTP fixture"),
    ("native-assets", "functional", ["input-contract"], [], "六目标原生构建/load；操作独立结果"),
    ("source-build", "functional", ["input-contract", "native-assets"], ["native-set"], "主/notifier development bundle"),
    ("source-host", "functional", ["source-build"], ["source-bundle"], "全部标准源码case与Host组合"),
    ("marketplace-host", "functional", ["source-build"], ["source-bundle"], "VSCode Marketplace fixture"),
    ("package-clean", "artifact", ["input-contract", "native-assets"], ["native-set"], "干净来源一次双包生产构建"),
    ("packaged-host", "artifact", ["package-clean"], ["package-pair"], "消费双包的instrumented集成"),
    ("installed-pair", "artifact", ["package-clean"], ["package-pair"], "三x64系统原样双包安装"),
]
producer = {"frontend-build": "frontend-bundle", "native-assets": "native-set",
            "source-build": "source-bundle", "package-clean": "package-pair"}
model_jobs = [{"id": name, "tier": tier, "needs": needs, "consumes": consumes,
               "produces": [producer[name]] if name in producer else [], "responsibility": label,
               "failure": "dependent-not-run-independent-continue"}
              for name, tier, needs, consumes, label in jobs]
model_jobs.append({"id": "verify-result", "tier": "aggregate", "needs": [j[0] for j in jobs],
                   "consumes": [], "produces": ["gate-result"], "responsibility": "always严格聚合",
                   "failure": "missing-or-nonpass-fails", "always": True})
write("design-model.json", {
    "schemaVersion": 1, "status": "selected-design-not-implemented", "jobs": model_jobs,
    "modes": {
        "pr-base": {"tiers": ["base"], "requiredNativeOperations": False, "acceptance": False},
        "pr-functional": {"tiers": ["base", "functional"], "requiredNativeOperations": False, "acceptance": False},
        "pr-artifact": {"tiers": ["base", "functional", "artifact"], "requiredNativeOperations": False, "acceptance": False},
        "release-pr": {"tiers": ["base", "functional", "artifact"], "requiredNativeOperations": True, "acceptance": True},
        "release-tag": {"tiers": ["base", "functional", "artifact"], "requiredNativeOperations": True, "acceptance": True},
        "diagnostic": {"tiers": [], "requiredNativeOperations": False, "acceptance": False},
    },
    "nativeTargets": ["linux-x64-glibc", "linux-arm64-glibc", "darwin-x64", "darwin-arm64", "win32-x64", "win32-arm64"],
    "installedTargets": ["linux-x64", "darwin-x64", "win32-x64"],
    "nativeOperations": ["spawn", "input-output", "resize-observed", "natural-exit", "stop", "cleanup"],
    "publishJobs": [
        {"id": "resolve-release", "needs": []},
        {"id": "verify-release", "needs": ["resolve-release"]},
        {"id": "prepare-release", "needs": ["resolve-release", "verify-release"]},
        {"id": "publish-open-vsx", "needs": ["prepare-release"]},
        {"id": "publish-visual-studio", "needs": ["prepare-release"]},
        {"id": "finalize-release", "needs": ["prepare-release", "publish-open-vsx", "publish-visual-studio"], "always": True},
    ],
    "requiredCompletionTargets": ["github-release-assets", "open-vsx"],
    "deferredTarget": "visual-studio", "extensions": ["main", "notifier"],
    "identityFields": ["schemaVersion", "inputSHA", "planHash", "version", "environmentHash", "mode"],
    "mandatoryCases": {
        "source-host": [item["currentScenario"] for item in coverage["currentRoutes"] if item["sourceDefault"]],
        "packaged-host": [item["currentScenario"] for item in coverage["currentRoutes"] if item["packagedDefault"]],
        "installed-pair": ["linux-x64", "darwin-x64", "win32-x64"],
    },
    "packageReceiptFields": ["schemaVersion", "inputSHA", "nativeSetHash", "lockHash", "profile", "admission", "artifacts", "producer"],
    "phases": ["prepare", "action", "assert", "cleanup", "host-exit"],
    "phaseStatuses": ["passed", "failed", "timed-out", "not-run"],
    "infraBudgetsMs": {"npmCi": 600000, "download": 300000, "hostStartup": 180000,
                       "hostExit": 30000, "cleanup": 60000, "evidence": 30000, "jobReserve": 300000},
    "classification": {"unknownPath": "artifact", "functionalImpliesBase": True,
                       "artifactImpliesFunctional": True, "versionWithoutContract": "fail"},
    "releaseRetry": {"rebuild": False, "exactOriginalPair": True, "selectedTargetNeedsFresh": True,
                     "historicalReuseRequiresTrustedProvenance": True, "explicitMismatchBlocksReuse": True},
})
source_paths = ["package.json", "package-lock.json", "scripts/build/build.mjs",
                ".github/workflows/release-preflight.yml", ".github/workflows/publish-marketplace-release.yml",
                ".github/workflows/runtime-execution-assets.yml", "scripts/release/release-preflight.mjs",
                "scripts/release/run-clean-checkout-vsix-validation.mjs", "scripts/smoke/run-vscode-smoke.mjs",
                "scripts/smoke/run-vscode-vsix-smoke.mjs", "docs/design-docs/smoke-scenario-boundaries.md",
                str(coverage_path.relative_to(ROOT))]
write("inputs.json", {
    "inputHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "remoteMain": subprocess.check_output(["git", "rev-parse", "origin/main"], cwd=ROOT, text=True).strip(),
    "scope": "design-model-and-diagrams-not-product-acceptance", "sourceSha256": {
        name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in source_paths},
})
print(f"设计模型：{len(model_jobs)}验证job、6发布job、{len(top)}顶层迁移、{len(routes)}smoke入口")

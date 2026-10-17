"""核对设计输入与覆盖迁移；不启动 Host，不构成产品验收。"""

from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
DESIGN = REPO / "docs/design-docs/smoke-scenario-boundaries.md"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def extract_inputs():
    source = (REPO / "scripts/smoke/run-vscode-smoke.mjs").read_text()
    section = re.search(r"const scenarios = \[(.*?)\n\];", source, re.S).group(1)
    entries = [(m.group(1), "focusedOnly: true" in m.group(2)) for m in
               re.finditer(r"\{\s*name: '([^']+)'(.*?)\n  \}", section, re.S)]
    main = source[source.index("async function main("):source.index("async function runLegacySupervisorUpgradeScenario(")]
    special = re.findall(r"if \(shouldRunScenario\('([^']+)'\)\) \{\s*await ", main)
    states = re.search(r"for \(const hostScenario of \[(.*?)\]\)", main).group(1)
    special += [f"remote-ssh-real-reopen-{s}" for s in re.findall(r"'([^']+)'", states)]
    packaged = (REPO / "scripts/smoke/run-vscode-vsix-smoke.mjs").read_text()
    packaged_names = re.findall(r"'([^']+)'", re.search(r"const scenarios = \[(.*?)\];", packaged, re.S).group(1))
    return [n for n, focused in entries if not focused] + special, packaged_names, [n for n, focused in entries if focused]


def verify():
    mapping = json.loads((ROOT / "coverage-map.json").read_text())
    require(mapping["status"] == "proposal-not-implemented", "不能把设计清单标为已实施")
    require(mapping["validationScope"] == "static-design-traceability-not-product-acceptance", "必须保留非产品验收边界")
    for path, expected in mapping["sourceSha256"].items():
        actual = hashlib.sha256((REPO / path).read_bytes()).hexdigest()
        require(actual == expected, f"源码已变动，须重新核对设计：{path}")
        historical = subprocess.run(["git", "show", f"{mapping['inputHead']}:{path}"], cwd=REPO, check=True, capture_output=True).stdout
        require(hashlib.sha256(historical).hexdigest() == expected, f"输入HEAD与源码hash不一致：{path}")

    defaults, packaged, focused = extract_inputs()
    require(defaults == mapping["currentSourceDefault"] and len(defaults) == 19, "源码默认入口/顺序遗漏")
    require(packaged == mapping["currentPackagedDefault"] and len(packaged) == 8, "packaged默认入口/顺序遗漏")
    require(focused == mapping["currentSourceFocusedOnly"] and len(focused) == 3, "focused入口遗漏")
    cases = {c["id"]: c for c in mapping["cases"]}
    require(len(cases) == len(mapping["cases"]), "case ID重复")
    for case in cases.values():
        require(case["id"] == f"{case['scenario']}/{case['case']}", f"case层级不一致：{case['id']}")
        require(case["title"] and case["fixtureRule"], f"case缺目标/fixture规则：{case['id']}")
        require(case["status"] in ["existing-to-migrate", "proposed-gap"], "未知case状态")

    routes = {r["currentScenario"]: r for r in mapping["currentRoutes"]}
    require(list(routes) == defaults + focused, "当前入口迁移不完整或重复")
    for name, row in routes.items():
        require(row["sourceDefault"] == (name in defaults), f"源码默认标记错误：{name}")
        require(row["packagedDefault"] == (name in packaged), f"packaged标记错误：{name}")
        require(row["sourceFocusedOnly"] == (name in focused), f"focused标记错误：{name}")
        require(row["targets"] and row["context"], f"入口无去向/上下文：{name}")

    allowed_roles = {"prepare", "action", "action-assert", "observe-assert", "prepare-observe", "cleanup", "evidence-consumer"}
    for section in ["currentRoutes", "commonEntryMigration", "suiteCallMigration", "localSemanticMigration", "additionalSemanticMigration"]:
        for row in mapping[section]:
            require(row["targets"], f"{section}空映射")
            for target in row["targets"]:
                require(target in cases, f"{section}未知case：{target}")
            if "role" in row:
                require(row["role"] in allowed_roles, f"{section}未知角色")

    suite = (REPO / "tests/vscode-smoke/extension-tests.cjs").read_text()
    source_lines = suite.splitlines()
    counts = {}
    for name, end, expected in [("runTrustedSmoke", "verifySidebarNodeList", 109), ("runRestrictedSmoke", "waitForAgentLive", 38)]:
        start = suite.index("async function " + name + "(")
        section = suite[start:suite.index("async function " + end + "(")]
        extracted = [{"call": m.group(1), "line": suite[:start+m.start()].count("\n") + 1} for m in re.finditer(r"await ([A-Za-z_][A-Za-z0-9_.]*)\(", section)]
        rows = [r for r in mapping["suiteCallMigration"] if r["suite"] == name]
        require(len(rows) == len(extracted) == expected, f"{name}调用覆盖遗漏")
        require([r["ordinal"] for r in rows] == list(range(1, expected+1)), f"{name}调用顺序重复/缺项")
        for actual, row in zip(extracted, rows):
            require(actual == {"call": row["call"], "line": row["line"]}, f"{name}调用锚点不一致")
            require(row["note"] and row["file"] == "tests/vscode-smoke/extension-tests.cjs", "调用迁移缺少要求/文件")
            require(set(row["targets"]) <= set(routes["trusted" if name == "runTrustedSmoke" else "restricted"]["targets"]), "调用未进入对应旧入口映射")
        counts[name] = expected
    require(sum(counts.values()) == len(mapping["suiteCallMigration"]), "存在未知suite调用")

    for row in mapping["commonEntryMigration"]:
        require(f"await {row['call']}(" in source_lines[row["line"]-1], "公共入口锚点已失效")
    require(any(r["call"] == "verifyFirstOpenDefaultTemplate" for r in mapping["commonEntryMigration"]), "遗漏首次模板公共入口")
    require(any(r["call"] == "verifyWebviewLifecycleRaceDiagnostics" for r in mapping["commonEntryMigration"]), "遗漏trusted/restricted前生命周期诊断")

    semantic_ids = set()
    semantic_helpers = set()
    for row in mapping["localSemanticMigration"]:
        require(row["id"] not in semantic_ids, "语义映射ID重复")
        semantic_ids.add(row["id"])
        source = row["source"]
        require(source["file"] == "tests/vscode-smoke/extension-tests.cjs", "未知语义来源")
        require(source_lines[source["line"]-1].startswith("async function " + source["function"] + "("), "helper起点失效")
        require(source["line"] <= source["endLine"] <= len(source_lines), "helper行范围无效")
        require(row["evidence"] and row["title"], "语义覆盖没有证据/目标")
        semantic_helpers.add(source["function"])
    required_helpers = {
        "verifyAgentExecutionFlow", "verifyTerminalExecutionFlow", "verifyOwnedCanvasReconciliation",
        "verifyRuntimeReloadRecovery", "verifyLiveSessionCutoverAndReload", "verifyMissingAgentCliFailure",
        "verifyExecutionTerminalNativeInteractions", "verifyStopVsQueuedExitRace", "verifyClaudeStopRestoresPreviousSignal",
        "verifyClaudeExplicitSessionIdPreservesResumeContext", "verifyPtyRobustness", "verifyTerminalFloodKeepsCanvasResponsive", "verifyFailurePaths",
    }
    require(semantic_helpers == required_helpers, "原01–07关键helper语义映射遗漏")
    for row in mapping["additionalSemanticMigration"]:
        source = row["source"]
        require(source_lines[source["line"]-1].startswith("async function " + source["function"] + "("), "额外helper锚点失效")
        require(row["title"] and row["evidence"], "额外语义映射缺目标/证据")
    for target, case in cases.items():
        users = [r for r in routes.values() if target in r["targets"]]
        require(case["currentRoutes"] == [r["currentScenario"] for r in users], "case反向入口不一致")
        require(case["proposedSourceDefault"] == any(r["sourceDefault"] for r in users), "拟议源码默认范围不一致")
        require(case["proposedPackagedDefault"] == any(r["packagedDefault"] for r in users), "拟议packaged默认范围不一致")
        if case["status"] == "proposed-gap":
            require(not users and not case["proposedSourceDefault"] and not case["proposedPackagedDefault"], "新增缺口不能计为现有默认覆盖")
        else:
            require(users, f"现有case没有旧来源：{target}")
    require(not set(routes["local-links-and-stop"]["targets"]) & {"execution-exit/native-crash"}, "不能将命令退出当原生崩溃")
    require({"terminal-links", "execution-stop", "agent-resume-context", "terminal-resource-drop"} <= {t.split('/')[0] for t in routes["local-links-and-stop"]["targets"]}, "链接/Stop/身份/拖放未分离")

    complex_rows = mapping["complexCaseSteps"]
    require(len(complex_rows) == 9 and len({r["case"] for r in complex_rows}) == 9, "特殊拓扑步骤遗漏")
    for row in complex_rows:
        require(row["case"] in cases and row["steps"], "组合case未知或无步骤")
        require(len({s["id"] for s in row["steps"]}) == len(row["steps"]), "组合步骤ID重复")
        require(row["steps"][0]["role"] == "prepare" and row["steps"][-1]["role"] == "cleanup", "组合缺准备/清理")

    checked_links = 0
    for doc in [DESIGN, ROOT / "README.md"]:
        body = doc.read_text()
        for target in re.findall(r"(?<!!)\[[^\]]+\]\(([^)]+)\)", body):
            if target.startswith(("http://", "https://", "#")):
                continue
            resolved = (doc.parent / target.split("#")[0]).resolve()
            # verification.json由本次成功核对生成；首次运行不要求预先有报告。
            require(resolved.exists() or resolved == ROOT / "verification.json", f"文档链接不存在：{doc.name} -> {target}")
            checked_links += 1
    require("decision_status: 比较中" in DESIGN.read_text() and "validation_status: 未验证" in DESIGN.read_text(), "设计状态不得暗示产品验证完成")
    readme = (ROOT / "README.md").read_text()
    require(all(f"`{target}`" in readme for target in cases), "可读目录遗漏case")
    result = {
        "status": "pass", "scope": mapping["validationScope"], "productAcceptance": "not-run",
        "inputHead": mapping["inputHead"], "sourceHashes": len(mapping["sourceSha256"]),
        "currentSourceDefault": len(defaults), "currentPackagedDefault": len(packaged), "currentFocusedOnly": len(focused),
        "currentRouteMappings": len(routes), "suiteAwaitCalls": counts, "commonEntryCalls": len(mapping["commonEntryMigration"]),
        "localSemanticItems": len(semantic_ids), "proposalCaseIds": len(cases),
        "additionalSemanticItems": len(mapping["additionalSemanticMigration"]),
        "existingToMigrateCaseIds": sum(c["status"] == "existing-to-migrate" for c in cases.values()),
        "proposedGapCaseIds": sum(c["status"] == "proposed-gap" for c in cases.values()),
        "complexCasesWithSteps": len(complex_rows), "documentLinksChecked": checked_links,
        "command": "python3 docs/references/release-gate-flow-audit/smoke-redesign/verify.py",
        "limits": mapping["limits"],
    }
    (ROOT / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    verify()

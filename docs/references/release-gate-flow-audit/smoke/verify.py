"""静态核对 smoke 流程资料；不启动 Host，也不执行产品验收。"""

from pathlib import Path
import hashlib
import json
import re
import struct
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
NAMES = (
    "entry-scenarios", "single-host", "trusted-restricted",
    "real-reopen", "two-window", "legacy-resize",
)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify():
    mapping = json.loads((ROOT / "source-map.json").read_text())
    for path, expected in mapping["sourceSha256"].items():
        assert sha256(REPO / path) == expected, f"源码变动，需要重新核对流程：{path}"
    assert len(mapping["sourceSha256"]) == 16

    source = (REPO / "scripts/smoke/run-vscode-smoke.mjs").read_text()
    section = re.search(r"const scenarios = \[(.*?)\n\];", source, re.S).group(1)
    entries = []
    for match in re.finditer(r"\{\s*name: '([^']+)'(.*?)\n  \}", section, re.S):
        name, body = match.groups()
        test_file = re.search(r"testFile: '([^']+)'", body)
        entries.append({
            "name": name,
            "focusedOnly": "focusedOnly: true" in body,
            "testFile": test_file.group(1) if test_file else "extension-tests.cjs",
        })
    assert entries == mapping["sourceScenarios"]
    main = source[source.index("async function main("):source.index("async function runLegacySupervisorUpgradeScenario(")]
    special = re.findall(r"if \(shouldRunScenario\('([^']+)'\)\) \{\s*await ", main)
    host_states = re.search(r"for \(const hostScenario of \[(.*?)\]\)", main).group(1)
    special += [f"remote-ssh-real-reopen-{state}" for state in re.findall(r"'([^']+)'", host_states)]
    default = [entry["name"] for entry in entries if not entry["focusedOnly"]] + special
    assert default == mapping["sourceDefault"] and len(default) == 19
    focused = [entry["name"] for entry in entries if entry["focusedOnly"]]
    assert len(focused) == 3

    packaged = (REPO / "scripts/smoke/run-vscode-vsix-smoke.mjs").read_text()
    packaged_section = re.search(r"const scenarios = \[(.*?)\];", packaged, re.S).group(1)
    packaged_default = re.findall(r"'([^']+)'", packaged_section)
    assert packaged_default == mapping["packagedDefault"] and len(packaged_default) == 8

    suite = (REPO / "tests/vscode-smoke/extension-tests.cjs").read_text()
    for name, end, count in (
        ("runTrustedSmoke", "verifySidebarNodeList", 109),
        ("runRestrictedSmoke", "waitForAgentLive", 38),
    ):
        start = suite.index("async function " + name + "(")
        section = suite[start:suite.index("async function " + end + "(")]
        calls = [
            {"call": match.group(1), "line": suite[:start + match.start()].count("\n") + 1}
            for match in re.finditer(r"await ([A-Za-z_][A-Za-z0-9_.]*)\(", section)
        ]
        assert calls == mapping["suiteAwaitCalls"][name] and len(calls) == count

    gates = json.loads((ROOT / "validation.json").read_text())
    visual = json.loads((ROOT / "visual-review.json").read_text())
    diagrams = {}
    assert set(gates) == set(NAMES) == set(visual["diagrams"])
    for name in NAMES:
        record = gates[name]
        for gate in ("validate", "render", "check", "png"):
            assert record[gate]["ok"] is True, (name, gate)
        assert record["render"]["typography"]["complete_text"] is True
        assert record["render"]["typography"]["truncated"] == []
        data = json.loads((ROOT / (name + ".json")).read_text())
        assert data["text_policy"] == "strict" and data["quality_profile"] == "showcase"
        assert len(data["nodes"]) == record["validate"]["nodes"]
        assert len(data["arrows"]) == record["validate"]["edges"]
        ET.parse(ROOT / (name + ".svg"))
        png = (ROOT / (name + ".png")).read_bytes()
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        width, height = struct.unpack(">II", png[16:24])
        assert width == record["png"]["width"] == 2400
        assert height == record["png"]["height"]
        assert len(png) == record["png"]["bytes"]
        assert sha256(ROOT / (name + ".png")) == visual["diagrams"][name]["pngSha256"]
        assert visual["diagrams"][name]["result"] == "pass"
        diagrams[name] = {
            "width": width, "height": height,
            "sha256": {
                suffix: sha256(ROOT / (name + "." + suffix))
                for suffix in ("json", "svg", "png", "layout.json")
            },
        }

    links = []
    for target in re.findall(r"\]\(([^)]+)\)", (ROOT / "README.md").read_text()):
        path = (ROOT / target.split("#", 1)[0]).resolve()
        # 本脚本成功后写出的报告是唯一尚未落盘的允许目标。
        assert path.is_file() or path == ROOT / "verification.json", target
        links.append(target)
    for script in ("generate.py", "verify.py"):
        compile((ROOT / script).read_text(), str(ROOT / script), "exec")

    return {
        "ok": True,
        "scope": "静态源码、顺序、图工件与文档链接核对；不是产品或发布验收",
        "inputHead": mapping["inputHead"],
        "sourceFiles": len(mapping["sourceSha256"]),
        "sourceDefault": default,
        "focusedOnly": focused,
        "packagedDefault": packaged_default,
        "directAwaitCalls": {name: len(calls) for name, calls in mapping["suiteAwaitCalls"].items()},
        "diagrams": diagrams,
        "readmeLinks": links,
        "visualReview": "独立 view_image 记录的 hash 已核对；此脚本不会自动完成视觉检查",
    }


if __name__ == "__main__":
    result = verify()
    (ROOT / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print("静态核对通过：16份源码、19/3/8场景、109/38调用点、6套图及文档链接。未执行产品验收。")

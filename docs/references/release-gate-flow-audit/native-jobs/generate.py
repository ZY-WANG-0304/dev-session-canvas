"""六平台CI的原代码流程映射：三张双泳道图，执行/验证逐步展开。"""
import json, hashlib, subprocess
import yaml
from pathlib import Path
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
BLUE,GREEN,RED,GRAY='#2563eb','#16a34a','#dc2626','#6b7280'
def stage(label,detail,kind='exec',anchor=''):
    return {'label':label,'detail':detail,'kind':kind,'anchor':anchor}
def prefix(target,runner,windows=False,compiler=''):
    result=[]
    if windows:
        result.append(stage('Windows checkout 前保留源码字节','git config --global core.autocrlf false','exec','.github/workflows/runtime-execution-assets.yml:63'))
    result += [stage('checkout 固定输入 SHA','input_ref（调用方传入）或 github.sha；不持久化凭据','exec','.github/workflows/runtime-execution-assets.yml:68'),
      stage('配置当前 Node 25.6.0',f'architecture={"arm64" if "arm64" in target else "x64"}；npm cache','exec','.github/workflows/runtime-execution-assets.yml:73')]
    if windows:
        result.append(stage('配置 MSVC 编译环境',f'ilammy/msvc-dev-cmd；arch={compiler}','exec','.github/workflows/runtime-execution-assets.yml:79'))
    result += [stage('安装锁定依赖','npm ci --no-audit --no-fund','exec','.github/workflows/runtime-execution-assets.yml:84'),
      stage('验证分发契约回归','test-execution-distribution-assets；合成资产 / mock load','verify','scripts/test/test-execution-distribution-assets.mjs:1'),
      stage('验证本次构建身份与输出目录',f'HEAD=输入 SHA；platform / arch={target}；Node=25.6.0','verify','scripts/build/build-execution-distribution-assets.mjs:73')]
    return result

def tail(target,minimum,files,extra=''):
    return [stage('最小宿主：真实 require 加载同一 addon',minimum+'；写 minimum-load.json','load','scripts/build/build-execution-distribution-assets.mjs:144'),
      stage('当前宿主：真实 require 加载同一 addon','runner Node 25.6.0；写 current-load.json','load','scripts/build/build-execution-distribution-assets.mjs:154'),
      stage('验证两次加载使用同一份资产','两报告 manifestSha256、binarySha256 必须相同','verify','scripts/build/build-execution-distribution-assets.mjs:155'),
      stage('归档运行时文件并生成 summary',files+'；archive SHA256 + 输入/构建/两次加载结果','exec','scripts/build/build-execution-distribution-assets.mjs:158'),
      stage('成功：上传 runtime tar.gz 与 summary',f'execution-native-{target}-<run_id>；保留 14 天','exec','.github/workflows/runtime-execution-assets.yml:90'),
      stage('always：尝试上传当前可用构建 / 加载证据','manifest、原生文件、minimum/current-load；无文件只 warn','evidence','.github/workflows/runtime-execution-assets.yml:97')]

def linux(arch,runner):
    target=f'linux-{arch}-glibc'
    r=prefix(target,runner)
    r += [stage('固定旧 glibc 构建环境','Docker node:16.17.1-buster@SHA256；目标架构，--network none','exec','scripts/build/build-execution-distribution-assets.mjs:102'),
      stage('验证 headers / 依赖版本与供应源码','headers=Node 16.17.1；node-pty=1.2.0-beta.12 / addon-api=7.1.1','verify','scripts/build/linux-execution-candidate-assets.mjs:96'),
      stage('补丁后在容器中编译 execution-owner.node','g++；C++17 / shared / pthread / N-API 8；记录源文件 hash','exec','scripts/build/linux-execution-candidate-assets.mjs:113'),
      stage('验证候选 manifest、实际 ELF 与 ABI 基线','ELF64 架构；文件/源码 hash；GLIBC≤2.28 / GLIBCXX≤3.4.22','verify','scripts/build/linux-execution-candidate-assets.mjs:57')]
    r += tail(target,'同一固定容器的 Node 16.17.1','manifest.json + execution-owner.node')
    return {'target':target,'runner':runner,'steps':r,'baseline':'另核对 CXXABI≤1.3.9；容器运行沿用 runner 内核，不是旧 Linux 系统全验收。'}

def macos(arch,runner):
    target=f'darwin-{arch}';deployment='10.13' if arch=='x64' else '11.0'
    r=prefix(target,runner)
    r += [stage('下载 Node 25.6.0 headers 并核验 SHA256','nodejs.org SHASUMS256.txt 唯一条目匹配，再解包','exec','scripts/build/build-execution-distribution-assets.mjs:111'),
      stage('验证 headers / 依赖 / 原 pty 与 helper 源码','Node/模块 ABI 一致；node-pty / addon-api 固定；源码 hash','verify','scripts/build/macos-execution-candidate-assets.mjs:168'),
      stage('补丁并编译 addon 与 spawn-helper',f'xcrun SDK → clang++；目标 {arch}；-mmacosx-version-min={deployment}','exec','scripts/build/macos-execution-candidate-assets.mjs:178'),
      stage('下载最小 Node 16.17.1 并核验 SHA256',f'node-v16.17.1-darwin-{arch}.tar.gz；解包 bin/node','exec','scripts/build/build-execution-distribution-assets.mjs:134'),
      stage('再次验证候选资产与 Mach-O 声明',f'addon/helper hash、架构/类型；deployment={deployment}；helper 可执行','verify','scripts/build/macos-execution-candidate-assets.mjs:220')]
    r += tail(target,'同 macOS runner 的 Node 16.17.1','manifest + execution-owner.node + spawn-helper')
    return {'target':target,'runner':runner,'steps':r,'baseline':f'deployment {deployment} 是编译/文件声明校验；没有启动该旧版 macOS。spawn-helper 未实际启动。'}

def windows(arch,runner,compiler):
    target=f'win32-{arch}'
    r=prefix(target,runner,True,compiler)
    r += [stage('下载 headers 与目标 node.lib 并核验 SHA256',f'Node 25.6.0 headers + win-{arch}/node.lib；供应清单匹配','exec','scripts/build/build-execution-distribution-assets.mjs:111'),
      stage('验证构建源、hook 与 ConPTY 依赖','固定 pty / path_util / headers / delay hook；ConPTY PE 架构','verify','scripts/build/windows-execution-candidate-assets.mjs:210'),
      stage('编译 conpty.node 并写入两份 ConPTY 依赖',f'cl.exe /MT / N-API8 /MACHINE:{"X64" if arch=="x64" else "ARM64"} /DELAYLOAD:node.exe','exec','scripts/build/windows-execution-candidate-assets.mjs:245')]
    if arch=='arm64':
        r.append(stage('下载最小 Electron 22.3.14 并核验 SHA256','electron-v22.3.14-win32-arm64.zip；解包 electron.exe','exec','scripts/build/build-execution-distribution-assets.mjs:125'))
        minimum='Electron 22.3.14 / 内嵌 Node 16.17.1；RUN_AS_NODE=1'
    else:
        r.append(stage('下载最小 Node 16.17.1 并核验 SHA256','node-v16.17.1-win-x64.zip；解包 node.exe','exec','scripts/build/build-execution-distribution-assets.mjs:134'))
        minimum='同 Windows runner 的 Node 16.17.1；无 Electron 模式'
    r.append(stage('再次验证候选 manifest、PE 与静态 CRT','3 份文件 hash/架构/类型；解析 addon 导入表拒绝动态 CRT','verify','scripts/build/windows-execution-candidate-assets.mjs:140'))
    r += tail(target,minimum,'manifest + conpty.node + conpty.dll + OpenConsole.exe')
    return {'target':target,'runner':runner,'steps':r,'baseline':'minimumBuild=17763 是 manifest 契约；未启动旧 Windows，也没有实际创建 ConPTY 会话。'}

jobs=[linux('x64','ubuntu-24.04'),linux('arm64','ubuntu-24.04-arm'),macos('x64','macos-15-intel'),macos('arm64','macos-15'),windows('x64','windows-2025','x64'),windows('arm64','windows-11-arm','amd64_arm64')]
colors={'exec':('#eff6ff','#bfdbfe',BLUE),'verify':('#f0fdf4','#86efac',GREEN),'load':('#faf5ff','#d8b4fe','#9333ea'),'evidence':('#f9fafb','#d1d5db',GRAY)}
for group,pair in zip(['linux','macos','windows'],[jobs[:2],jobs[2:4],jobs[4:]]):
    n=max(len(j['steps']) for j in pair);height=240+n*134+290
    d={'schema_version':1,'mode':'flowchart','style':1,'text_policy':'strict','quality_profile':'showcase','width':1920,'height':height,
       'title':f'{group.upper()} 两个 CI：从执行到校验的逐步流程',
       'subtitle':'同输入六 job 并行；每 job 内串行、上限20分钟 · 蓝=执行，绿=字节/契约校验，紫=真实加载，灰=取证',
       'style_overrides':{'font_family':"'Noto Sans CJK SC', sans-serif",'arrow_colors':{'control':BLUE,'read':BLUE,'write':GREEN,'data':'#0d9488','async':'#9333ea','feedback':RED,'neutral':GRAY}},'nodes':[],'arrows':[]}
    for lane,j in enumerate(pair):
        x=50+960*lane
        d['nodes'].append({'id':j['target']+'-title','kind':'rect','x':x,'y':126,'width':860,'height':68,'label':j['target'],'sublabel':'runner: '+j['runner'],'title_size':24,'fill':'#f9fafb','flat':True})
        for i,s in enumerate(j['steps']):
            fill,stroke,color=colors[s['kind']];nid=f'{j["target"]}-{i}'
            d['nodes'].append({'id':nid,'kind':'rect','x':x,'y':240+i*134,'width':860,'height':92,'label':f'{i+1:02}  {s["label"]}','sublabel':s['detail'],'title_size':21,'fill':fill,'stroke':stroke,'flat':True})
            if i: d['arrows'].append({'source':f'{j["target"]}-{i-1}','target':nid,'source_port':'bottom','target_port':'top','color':BLUE})
    y=240+n*134+10
    d['nodes'] += [
      {'id':'failure','kind':'rect','x':50,'y':y,'width':1820,'height':70,'label':'任一步失败：跳过后续成功步骤 → 直接尝试 always 证据上传；fail-fast=false，其他平台继续','sublabel':'always 是尝试取证；job被强制超时/runner消失时不能保证上传完成；此前写出的有限文件仍保留','title_size':19,'fill':'#fef2f2','stroke':'#fca5a5','flat':True},
      {'id':'limit','kind':'rect','x':50,'y':y+110,'width':1820,'height':70,'label':'每次 require 只核对加载、hash 和导出函数存在；executionApiCalled=false / productValidated=false','sublabel':pair[0]['baseline']+'  '+('ARM64: '+pair[1]['baseline'] if group=='macos' else ''),'title_size':19,'fill':'#f9fafb','flat':True}]
    (ROOT/(group+'-jobs.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
# 同一个真实加载检查器的展开，两个runtime各完整执行一次。
checks=[stage('接收已验证的资产绝对路径','manifest.json 必须 schemaVersion=2'),stage('验证运行进程和目标完全匹配','process.platform / arch、精确 Node 版本、Electron 版本或 null','verify'),stage('验证 N-API 契约','要求 N-API=8、实际≥8；manifest.verification.productValidated=false','verify'),stage('逐个核对资产 SHA256','binary、helper、dependencies 与 manifest 记录一致','verify'),stage('真实 require 加载目标 .node','Linux/macOS: execution-owner.node；Windows: conpty.node','load'),stage('核对导出名称与类型','Object.keys(addon) 等于 manifest.exports；每项必须 function','verify'),stage('写当前这次宿主加载报告','OS/runtime、manifest/binary hash；nativeLoaded=true'),stage('不调用执行 API','没有 fork/start/read/write/resize/stop；productValidated=false','evidence')]
d={'schema_version':1,'mode':'flowchart','style':1,'text_policy':'strict','quality_profile':'showcase','width':1400,'height':1600,'title':'最小 / 当前宿主都执行一次的加载验证','subtitle':'check-execution-native-load.cjs · 原生 require 为真实动作，导出函数仅检查类型','style_overrides':{'font_family':"'Noto Sans CJK SC', sans-serif"},'nodes':[],'arrows':[]}
for i,s in enumerate(checks):
 fill,stroke,c=colors[s['kind']]
 d['nodes'].append({'id':f'load-{i}','kind':'rect','x':180,'y':160+i*168,'width':1040,'height':112,'label':f'{i+1:02}  {s["label"]}','sublabel':s['detail'],'title_size':22,'fill':fill,'stroke':stroke,'flat':True})
 if i: d['arrows'].append({'source':f'load-{i-1}','target':f'load-{i}','color':BLUE,'source_port':'bottom','target_port':'top'})
(ROOT/'native-load-detail.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
paths=['.github/workflows/runtime-execution-assets.yml','scripts/build/build-execution-distribution-assets.mjs','scripts/build/check-execution-native-load.cjs','scripts/build/linux-execution-candidate-assets.mjs','scripts/build/macos-execution-candidate-assets.mjs','scripts/build/windows-execution-candidate-assets.mjs','scripts/build/linux-execution-elf.mjs','scripts/test/test-execution-distribution-assets.mjs','scripts/build/linux-execution-provider-patch.mjs','scripts/build/macos-execution-provider-patch.mjs','scripts/build/windows-execution-provider-patch.mjs']
(ROOT/'source-map.json').write_text(json.dumps({'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True,cwd=REPO).strip(),'description':'原代码阅读映射，不是六平台重新运行结果','jobs':jobs,'sourceSha256':{p:hashlib.sha256((REPO/p).read_bytes()).hexdigest() for p in paths},'workflowJob':yaml.safe_load((REPO/paths[0]).read_text())['jobs']['native-assets']},ensure_ascii=False,indent=2)+'\n')
print('Generated 6 exact job step maps, 3 paired flowchart inputs and 1 load-check detail input.')

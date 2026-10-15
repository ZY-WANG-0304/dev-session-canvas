"""展开现有smoke设计；读取源码记录事实，不执行宿主、构建或发布。"""
from pathlib import Path
import json,hashlib,subprocess,re
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
BLUE,GREEN,RED,PURPLE,GRAY='#2563eb','#16a34a','#dc2626','#9333ea','#6b7280'
def base(title,subtitle,height,width=1920):
    return {'schema_version':1,'mode':'flowchart','style':1,'text_policy':'strict','quality_profile':'showcase','width':width,'height':height,'title':title,'subtitle':subtitle,'style_overrides':{'font_family':"'Noto Sans CJK SC', sans-serif",'arrow_colors':{'control':BLUE,'read':BLUE,'write':GREEN,'data':'#0d9488','async':PURPLE,'feedback':RED,'neutral':GRAY}},'nodes':[],'arrows':[]}
def box(i,x,y,w,label,sub='',kind='exec',h=100):
    fill,stroke={'exec':('#eff6ff','#bfdbfe'),'verify':('#f0fdf4','#86efac'),'fail':('#fef2f2','#fca5a5'),'wait':('#faf5ff','#d8b4fe'),'note':('#f9fafb','#d1d5db')}[kind]
    return {'id':i,'kind':'rect','x':x,'y':y,'width':w,'height':h,'label':label,'sublabel':sub,'title_size':21,'fill':fill,'stroke':stroke,'flat':True}
def edge(a,b,label='',sp='bottom',tp='top',color=BLUE):
    return {'source':a,'target':b,'label':label,'source_port':sp,'target_port':tp,'color':color}
def lane(d,key,x,title,sub,steps,y=245,pitch=160):
    d['nodes'].append(box(key+'-header',x,130,860,title,sub,'note',70))
    for i,(label,detail,kind) in enumerate(steps):
        d['nodes'].append(box(f'{key}-{i}',x,y+i*pitch,860,f'{i+1:02}  {label}',detail,kind,110))
        if i:d['arrows'].append(edge(f'{key}-{i-1}',f'{key}-{i}'))
def save(name,d):
    (ROOT/(name+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
# source/packaged: only smoke paths; Webview and earlier npm tests remain external.
d=base('Smoke 01：源码与 packaged 的入口和场景编排','两条路径在release:verify中前后串行；每条路径内部也串行；源码19场景，packaged8场景',1950)
lane(d,'source',50,'源码：npm test → test:smoke','build → build:notifier → run-vscode-smoke.mjs',[
 ('准备显示环境与场景选择','Linux无DISPLAY/WAYLAND时xvfb-run；filter可缩小范围','exec'),
 ('场景01–07：本地执行与恢复','execution-flow / owned-canvas / manual-recovery / cutover / failure / links-stop / PTY','exec'),
 ('场景08–10：checkpoint → trusted → restricted','trusted是一长串功能验证；restricted验证拒绝执行与可读状态','verify'),
 ('场景11：legacy-supervisor-upgrade','旧v1、上一代stream和当前新代；最近正式首败在Stop后Host终态','verify'),
 ('场景12–14：真实重开和workspace变化','single-root / multi-root / single→multi；setup与verify是两次启动','exec'),
 ('场景15：two-window-shared-runtime','owner与attacher并发；共享结构/输入/resize/stop/delete/模式切换','verify'),
 ('场景16–17：systemd两条路径','fake systemd成功；提交前缺bus则fallback，断言未提交systemctl','verify'),
 ('场景18–19：localhost Remote SSH','原远端Host退出exit / 保留retain；各自setup→断连→verify','verify'),
 ('所选全部场景成功后返回test:smoke','随后npm test运行Webview；最后clean-checkout进入右栏','verify')])
lane(d,'vsix',1010,'Packaged：clean-checkout → test:vsix-smoke','独立npm ci / package:vsix；仅Linux，默认8场景',[
 ('再次build:notifier与package:vsix','选mtime最新VSIX → unzip主扩展payload','exec'),
 ('核对打包内容与README','必需bundle/native/hook存在；排除源码/debug；Marketplace README标记','verify'),
 ('建立开发Host承载的packaged payload','复制payload；移除dependency/pack；测试wrapper转发真实dist入口','exec'),
 ('加入测试suite和源码notifier产物','notifier由source dist stage；不是原样双VSIX自动安装','exec'),
 ('按filter选择并串行运行8场景','owned-canvas → execution-flow → manual-recovery → cutover','exec'),
 ('继续其余四个场景','PTY → preparation-failure → links-and-stop → trusted','exec'),
 ('每场景新隔离环境并调用同一runner','同extension-tests.cjs；真实Host/原生PTY，Agent是fake provider','verify'),
 ('全部所选场景成功 → packaged通过','默认不包含restricted、legacy、real-reopen、systemd/SSH','verify')])
d['nodes'].append(box('stop',50,1775,1820,'首败抛错并停止后续场景；没有整场自动重试，后续未触达不计通过','源码另有3项focused-only不进默认19项；filter后的通过不能替代完整门禁','fail',95))
save('entry-scenarios',d)
# common runtime lifecycle: note boxes are not extra executed stages.
d=base('Smoke 02：一个普通场景的Host运行与验证责任','蓝=执行，绿=断言，紫=等待，红=失败；右侧取证发生在异常路径，注记不是测试步骤',2050)
steps=[('prepareRuntime：建立私有环境','重建HOME/user-data/extensions/XDG/runtime/TMP/artifacts；写场景配置','exec'),('stage源码或packaged承载与测试suite','复制主dist/运行依赖；stageSmokeTestSuite；使用extensionTestsPath','exec'),('选择实际VS Code宿主 → 构造启动参数','显式/已安装→缓存→下载stable；trace、私有目录、开发扩展与trust设置','exec'),('启动真实VS Code测试进程','过滤VSCODE_/Electron模式及敏感env；透传stdout/stderr；等待进程退出','wait'),('Host内module.run：激活扩展和命令','activateVisibleExtension → open editor → 等待测试命令 → 首开模板 → reset','exec'),('按scenario进入断言链','命令或测试消息进入原生产处理；DOM动作进入真实Webview；每项await串行','exec'),('核对三类观测，满足条件才继续','Host snapshot / messages / diagnostics；页面probe；必要时原Supervisor RPC','verify'),('extension-tests尾部检查owned resize失败','仅trusted和7个local场景执行该断言；专门suite有自己的结尾','verify'),('suite返回 → VS Code测试进程exit0','runner按exit/close和退出码判定；普通spawn没有整场进程deadline','verify'),('所有场景成功 → 外层命令返回','源码/packaged普通入口catch设exitCode=1；不自动重跑','verify')]
for i,(a,b,k) in enumerate(steps):
 d['nodes'].append(box(f'main-{i}',50,150+i*175,1120,f'{i+1:02}  {a}',b,k,115))
 if i:d['arrows'].append(edge(f'main-{i-1}',f'main-{i}'))
d['nodes'] += [box('channels',1370,150,500,'触发与观测是不同责任','测试命令/DOM动作 → 产品；probe/RPC → 结果','note',115),box('identities',1370,500,500,'身份检查随具名用例执行','原node/session/storage/owner/PID，防替换后假通过','note',115),box('fail',1370,1200,500,'断言或suite抛错：先取证','错误、快照、消息、诊断、last probe；各suite不同','fail',115),box('logs',1370,1375,500,'测试进程失败：runner复制日志','user-data/logs最新目录 → artifacts/vscode-logs','fail',115),box('outer',1370,1550,500,'外层抛错：停止后续场景','专门场景才有finally清理；现场当前仅留runner','fail',115)]
d['arrows'] += [edge('main-6','fail','失败','right','left',RED),edge('fail','logs',color=RED),edge('logs','outer',color=RED)]
save('single-host',d)
# selected high-level test suites, exact call list in source map.
d=base('Smoke 03：trusted 与 restricted 的内部验证顺序','两者都有公共激活/首开/reset及隔离生命周期诊断；下面按原调用顺序归组，完整调用名见源码映射',1990)
lane(d,'trusted',50,'trusted：完整功能链','普通trusted与packaged trusted调用同一runTrustedSmoke',[
 ('Panel → Editor ready与sidebar状态','active/ready/trust/sidebar；模板、session locator、CLI缓存','verify'),
 ('错误反馈、配置刷新和创建入口','未知消息toast；runtime配置/shell；QuickPick/Explorer/default root','verify'),
 ('组/布局 → 创建Agent/Terminal/Note','组删除确认、布局持久化、auto-start；停止夹具执行再验sidebar','verify'),
 ('真实页面交互与节点尺寸持久化','DOM、Note/checklist/file链接、node resize；再启动原执行','verify'),
 ('Agent与Terminal输入/输出/通知','burst/partial input/restart；attention；终端native交互和history/theme','verify'),
 ('同Host模拟reload与页面cutover','恢复、scrollback/viewport；PTY健壮性、flood、失败与snapshot保存','verify'),
 ('fault injection与Stop竞态','standby消息、pending请求故障、queued exit、Claude会话上下文','verify'),
 ('开启live-runtime → 原会话退役后显式重启','15秒共享观察预算；started事件/原session；reload/output/历史/reconnect','verify'),
 ('关闭持久化模式并验本地保存/文件行为','Host boundary flush、delete、edges、文件活动/read-exit drain','verify'),
 ('模式reload/清空 → 历史/分支UI → 关闭Editor','restore/fork/search/double-click；尾部全局owned resize失败检查','verify')],pitch=155)
lane(d,'restricted',1010,'restricted：安全拒绝与可读状态','开启workspace trust，断言workspaceTrusted=false',[
 ('Editor ready → 模板与sidebar','允许读Note；确认untrusted、空画布、可选类型展示','verify'),
 ('普通创建入口拒绝Agent/Terminal','Webview消息与QuickPick；精确错误/模态提示；只Note被创建','verify'),
 ('测试入口seed执行节点 → 拒绝start/input','分别核对Agent与Terminal错误；liveSession=false','verify'),
 ('真实页面Restricted Mode overlay','hasCanvasShell/ReactFlow；两个节点overlay标题/正文；诊断','verify'),
 ('live-runtime恢复拒绝与只清历史删除','restricted reconnect、history-only delete；模式reload清理','verify'),
 ('历史restore禁用 → 关闭Editor','尾部resize helper在restricted直接跳过；不启动真实执行','verify')],pitch=155)
d['nodes'].append(box('note',1010,1365,860,'这两条功能链内部都首败停止','普通单Host与真实重开是不同流程；模拟reload不退出Extension Host','note',115))
save('trusted-restricted',d)
# two phase local and controlled remote.
d=base('Smoke 04：真实重开的setup → 过渡 → verify','同一隔离runtime和状态文件贯穿两次启动；普通模拟reload只用于阶段内应用配置/恢复',2230)
setup=[('setup：激活、reset、配置持久化、open ready','ready预算45秒；配置后simulateRuntimeReload；多root有第二次组合','exec'),('创建Agent + live Terminal + offline完成Terminal','启动92×28；验live/owner/backend/原session及三份registry会话','verify'),('安排离线输出并flush状态 → 写state.json','保存node/session/storage/slot；远端另存原Host与Supervisor身份','verify')]
verify=[('verify：第二次启动 → editor ready','原workspace或multi-root组合；45秒ready；远端断言新Host不同PID','wait'),('原session重连与离线完成投影','原Agent/Terminal仍live；两会话；completed Terminal closed/history丢弃','verify'),('核对原storage slot和离线输出 → 再输入','不自动换session/owner；新输入标记15秒内抵达Host输出','verify')]
lane(d,'local',50,'本地真实重开 / 多root / systemd','single / multi / single→multi；fake-systemd成功与提交前fallback',setup+[
 ('setup suite返回，等待第一测试进程exit0','completed Terminal用kill -0观察原HostPID消失后再退出','wait'),
 ('Host关闭期间留3秒 → 写verify控制文件','runner保留同user-data；此路径没有远端retain分支','exec')]+verify+[
 ('此共享本地verify不调用专门resize helper','完整页面尺寸与原会话resize在其他具名场景单独覆盖','note'),
 ('reset → registry零会话 → 关持久化 → 关Editor','verify成功后清理；失败取阶段snapshot/Supervisor/diagnostics','exec')],pitch=180)
lane(d,'remote',1010,'localhost Remote SSH：exit / retain','私有sshd/server/RemoteSSH扩展；原进程身份与独立完成屏障',setup+[
 ('写setup-ready，Host测试故意保持运行','外层等ready（90秒）后中断本次私有本地client并复核退出','wait'),
 ('确立原远端Host退出exit / 保留retain','retain验原身份live；exit限私有原Host发信号并等待退出；原Supervisor活','verify'),
 ('释放完成屏障 → 等原Terminal实际closed','不靠固定sleep猜完成；verify前再次核对Host两态和原Supervisor','verify')]+verify+[
 ('原终端resize：先基线，再改卡片尺寸','每阶段20秒，Host/DOM fit/原session cols rows/正文共同相符','verify'),
 ('业务后再验Host两态 → reset → fixture.dispose','保存host/business/resize样本；清理须pass，故障不能伪造通过','exec')],pitch=180)
save('real-reopen',d)
# simultaneous windows.
d=base('Smoke 05：双窗口的协调与共享运行时验证','runner先启动owner，等owner-ready后连共享globalStorage再启动attacher；两个Host并发运行',1740)
lane(d,'owner',50,'Owner Window','独立profile/user-data，创建共享执行；以JSON文件协调',[
 ('reset → 开live-runtime → 创建两执行并flush','写owner-ready：node/session/storage/state；runner等ready90秒','exec'),
 ('等待attacher已附着原会话','只接受相同Agent/Terminal session和storage身份','wait'),
 ('双向共享Note结构变更','create → 对端edit/move/resize → 对端create → delete同步','verify'),
 ('双向输入标记抵达两窗口','先验attacher输入 → 发owner输入 → 对端确认','verify'),
 ('观察原Terminal resize及stop、Agent delete','页面动作来自attacher；owner必须得到尺寸/终态/删除投影','verify'),
 ('测试一个窗口关闭持久化与对端接管','共享执行保留，关闭方状态隔离；两方private note不交叉','verify'),
 ('重新开启模式 → 验共享根已清空','最后参与者关闭后清共享root；私有Note不进入共享画布','verify'),
 ('reset → 零会话 → 两Host结束','runner等两completed；失败尝试kill并allSettled收集结果','exec')],pitch=170)
lane(d,'attacher',1010,'Attacher Window','独立profile，共享同用户globalStorage；不另起一份相同执行',[
 ('激活 → 同root恢复共享画布','读取owner-ready，核对原session/storage并写attached','exec'),
 ('原会话附着后确认owner仍持有','共同输出与registry；不把第二窗口当新执行owner','verify'),
 ('编辑owner Note并创建peer Note','确认owner delete在本窗口消失；JSON文件握手','verify'),
 ('发attacher输入 → 验owner输入','真实执行输入、原输出标记，反向可见','verify'),
 ('页面resize/Stop/Delete → 等owner确认','操作原节点；对端完成标记只在其业务断言后写出','verify'),
 ('配合模式关闭与运行时接管','开启方保持会话；关闭方使用独立snapshot空间','verify'),
 ('两方再开启 → 验共享根已清空','清理后的共享画布为空；两方private Note均不可见','verify'),
 ('清理并返回 → runner汇总两进程','每个suite有失败取证；文件握手通常60秒，部分90秒','exec')],pitch=170)
save('two-window',d)
# legacy main and resize oracle expanded beside it, not parallel lanes.
d=base('Smoke 06：旧代升级场景与原终端resize验收','左：场景11的真实测试顺序；右：resize helper内部及当前Stop首败位置；右栏不是另一个job',2250)
legacy=[('激活 → 开live-runtime → reset / reload / panel ready','运行legacy-supervisor-upgrade-tests.cjs；panel ready20秒','exec'),('启动两种旧Supervisor并验证hello','历史5355e6a构建v1；当前bundle不传execution-profile模拟上一代stream','exec'),('创建旧Agent / 旧Terminal / 上一代stream Terminal','直接RPC seed真实旧会话；输入标记；保存原session/storage/PID','exec'),('恢复到当前Host → 验原绑定及输入/输出','legacy和stream能力/投影兼容；原会话不能换成新代','verify'),('真实页面resize → 原RPC会话尺寸一致','先建立容器基线再改尺寸；右侧helper逐层交叉核对','verify'),('新建当前Terminal → 验新generation和owner','新storage与旧路径不同；新能力hello；旧registry不被改写','verify'),('点击上一代stream Terminal的真实Stop按钮','清diagnostics；不是直接向PTY发signal；走当前产品停止处理','exec'),('等Host原节点live=false且status不再live','原30000ms waitForSnapshot；最近完整首败在这一步','wait'),('继续旧Terminal stop → 旧Agent delete → 旧客户端退役','每项原30秒；保存/registry及当前Terminal继续运行验收','verify'),('catch先保存失败现场；finally重置并清私有夹具','4份有限取证每项2秒；delete已seed会话、停私有Supervisor、恢复配置','exec')]
lane(d,'legacy',50,'场景11：legacy-supervisor-upgrade','与真实重开不同；此用例在同一Host模拟runtime reload',legacy,pitch=180)
resize=[('固定原节点与会话身份','nodeId/kind/sessionId/runtimeStoragePath；保存before基线','verify'),('同20秒预算读取Host、页面和原session','每次读取有剩余时间限制；getSnapshot / probe / RPC','wait'),('核对Host卡片与页面容器尺寸','host.size / renderedWidth Height = 目标；pending=false','verify'),('核对xterm行列符合独立容器fit','terminalCols Rows = terminalFitCols Rows；必须有真实尺寸变化','verify'),('核对原真实会话尺寸与正文','session.live、cols rows=页面；RPC输出标记+页面visible marker','verify'),('全部相符才通过；否则100ms内再采样','每次样本可留证；换绑定直接失败；超时带lastSample','verify')]
lane(d,'resize',1010,'尺寸验收：waitForTerminalResize','用于旧代和远端两态；证明原进程resize，非只看UI',resize,pitch=180)
d['nodes'] += [box('failure',1010,1505,860,'当前首败：Host在30秒后仍stopping/live=true','已复现因果：晚到恢复撤销订阅，PTY已退出/Supervisor closed，Host未收终态','fail',110),box('limit',1010,1735,860,'首败截图不能单独证明PTY是否退出','历史run缺PTY/订阅现场；因果诊断与原首败唯一归因分开记录','note',110),box('cleanup',1010,1965,860,'清理成功不是产品Stop已成功','finally里的delete/kill用于回收夹具；不替代Stop按钮的业务断言','note',110)]
d['arrows'].append(edge('legacy-7','failure','超时','right','left',RED))
save('legacy-resize',d)
# Reconstruct exact names from bounded source slices, without invoking main().
source=(REPO/'scripts/smoke/run-vscode-smoke.mjs').read_text()
array=source[source.index('const scenarios = ['):source.index('\n];',source.index('const scenarios = ['))+3]
entries=[]
for match in re.finditer(r"\{\s*name: '([^']+)'(.*?)\n  \}",array,re.S):
    name,body=match.groups()
    entries.append({'name':name,'focusedOnly':'focusedOnly: true' in body,'testFile':(re.search(r"testFile: '([^']+)'",body).group(1) if 'testFile:' in body else 'extension-tests.cjs')})
assert len(entries)==13
special=['legacy-supervisor-upgrade','real-reopen','multi-root-real-reopen','single-to-multi-root-real-reopen','two-window-shared-runtime','systemd-user-real-reopen','systemd-fallback-real-reopen','remote-ssh-real-reopen-exit','remote-ssh-real-reopen-retain']
default=[e['name'] for e in entries if not e['focusedOnly']]+special
packaged=(REPO/'scripts/smoke/run-vscode-vsix-smoke.mjs').read_text()
packagedNames=re.findall(r"'([^']+)'",re.search(r'const scenarios = \[(.*?)\];',packaged,re.S).group(1))
assert len(default)==19 and len(packagedNames)==8
suite=(REPO/'tests/vscode-smoke/extension-tests.cjs').read_text()
calls={}
for name,end in [('runTrustedSmoke','verifySidebarNodeList'),('runRestrictedSmoke','waitForAgentLive')]:
    section=suite[suite.index('async function '+name+'('):suite.index('async function '+end+'(')]
    calls[name]=[{'call':m.group(1),'line':suite[:suite.index(section)+m.start()].count('\n')+1} for m in re.finditer(r'await ([A-Za-z_][A-Za-z0-9_.]*)\(',section)]
paths=['package.json','scripts/release/release-preflight.mjs','scripts/release/run-clean-checkout-vsix-validation.mjs','scripts/smoke/run-vscode-smoke.mjs','scripts/smoke/run-vscode-vsix-smoke.mjs','scripts/smoke/vscode-smoke-runner.mjs','scripts/smoke/vscode-remote-ssh-fixture.mjs','tests/vscode-smoke/extension-tests.cjs','tests/vscode-smoke/test-helpers.cjs','tests/vscode-smoke/real-reopen-tests.cjs','tests/vscode-smoke/two-window-shared-runtime-tests.cjs','tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs','tests/vscode-smoke/terminal-resize.cjs','tests/vscode-smoke/runtime-retirement.cjs','tests/vscode-smoke/remote-host-control.cjs','extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts']
(ROOT/'source-map.json').write_text(json.dumps({'inputHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'scope':'现有源码设计映射；没有执行产品验收','sourceScenarios':entries,'sourceDefault':default,'packagedDefault':packagedNames,'suiteAwaitCalls':calls,'sourceSha256':{p:hashlib.sha256((REPO/p).read_bytes()).hexdigest() for p in paths}},ensure_ascii=False,indent=2)+'\n')
print('Generated 6 smoke design diagrams and exact source scenario/call mapping.')

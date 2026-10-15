"""生成三张可独立阅读的实际流程图；只写本目录的JSON输入。"""
import json
from pathlib import Path
root = Path(__file__).resolve().parent
BLUE, RED, GREEN, PURPLE = '#2563eb', '#dc2626', '#16a34a', '#9333ea'
def node(i,x,y,w,label,sub='',tone='blue',h=104):
    colors={'blue':('#eff6ff','#bfdbfe'),'red':('#fef2f2','#fca5a5'),'green':('#f0fdf4','#86efac'),'purple':('#faf5ff','#d8b4fe'),'gray':('#f9fafb','#d1d5db')}
    fill,stroke=colors[tone]
    return dict(id=i,x=x,y=y,width=w,height=h,kind='rect',label=label,sublabel=sub,title_size=21,fill=fill,stroke=stroke,flat=True)
def edge(a,b,label='',sp='bottom',tp='top',color=BLUE):
    return dict(source=a,target=b,source_port=sp,target_port=tp,label=label,color=color)
def base(title,sub,height):
    return dict(schema_version=1,mode='flowchart',style=1,text_policy='strict',quality_profile='showcase',width=1600,height=height,title=title,subtitle=sub,
      style_overrides={'font_family':"'Noto Sans CJK SC', sans-serif",'title_size':30,'arrow_colors':{'control':BLUE,'read':BLUE,'write':GREEN,'data':'#0d9488','async':PURPLE,'feedback':RED,'neutral':'#6b7280'}},nodes=[],arrows=[],legend=[{'label':'自动执行','color':BLUE},{'label':'失败 / 跳过','color':RED},{'label':'满足验收','color':GREEN},{'label':'人工协作','color':PURPLE}],legend_x=60,legend_y=height-48,legend_orientation='horizontal')
def save(name,d):
    (root/(name+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
# PR流程；单向主链，旁路均为横向退出。
d=base('01  发布 PR 的 CI 门禁','当前实际流程 · main 6e708c6b / 修复 dc165186 · PR327 的 0.26.1 发布契约',1380)
d['nodes']=[
 node('event',70,150,660,'PR 打开 / 更新 / 转为可 review','opened · reopened · synchronize · ready_for_review'),
 node('draft',980,150,550,'草稿 PR：不执行门禁','PR327 当前仍为 draft','gray'),
 node('resolve',70,330,660,'非草稿：固定预合并 SHA','checkout PR merge result · resolve 上限 5 分钟'),
 node('contract',70,510,660,'本次 diff 是否修改发布契约？','docs/release-contracts/vX.Y.Z.md'),
 node('skip',980,420,550,'0 个契约：成功跳过完整验证','普通 PR 不会因此自动执行 npm test','gray'),
 node('multiple',980,600,550,'多个契约：失败并中断','删掉唯一契约也会在静态检查失败','red'),
 node('assets',70,690,660,'1 个契约：并行构建六平台原生资产','Linux glibc / macOS / Windows × x64 / arm64'),
 node('assetfailure',980,780,550,'任一资产或前置失败：Verify 失败','always 检查 prerequisites，避免伪跳过','red'),
 node('verify',70,870,660,'同 SHA / 同 run 装配 → release:verify','Ubuntu 22.04 · Node 22 · Chromium · 90 分钟'),
 node('fail',980,960,550,'任一测试失败：停止后续验证','当前缺少 verify 失败现场的 always 上传','red'),
 node('review',70,1050,660,'完整验证与 review 通过 → 人工正常合并','合并前复查 main；rebase / 输入变化须固定新 SHA 重跑','purple'),
 node('unenforced',980,1140,550,'GitHub 未强制 required check','main protection=404；effective rules=[]','red'),
 node('tag',70,1230,660,'合入 main 后，人工创建 publish/vX.Y.Z','进入图 03：最终 tag 输入再次完整验证','purple',80)
]
d['arrows']=[edge('event','draft','draft','right','left',RED),edge('event','resolve','非草稿'),edge('resolve','contract'),edge('contract','skip','0 个','right','left',RED),edge('contract','multiple','多个','right','left',RED),edge('contract','assets','1 个'),edge('assets','assetfailure','失败','right','left',RED),edge('assets','verify','全成功'),edge('verify','fail','失败','right','left',RED),edge('verify','review','通过',color=GREEN),edge('review','tag',color=PURPLE)]
save('pr-gate',d)
# 完整verify内部：主链首败停止的通用规则在旁列，不制造 N 条拥挤失败边。
d=base('02  release:verify 的内部顺序','0.26.1 标准链 · 串行执行，前一步成功后才进入下一步 · PR 与 tag 共用',1620)
d['nodes']=[
 node('static',70,150,800,'静态输入：版本 / 两份 CHANGELOG / 契约','主扩展 + notifier + lock 版本一致，5 节契约与必需文档存在'),
 node('regress',70,330,800,'发布契约与 preflight workflow 回归','test:release-preflight → test:release-preflight-workflow'),
 node('early',70,510,800,'npm test：前段类型与功能 / 协议回归','共 70 个顶层命令；第 3 项 Marketplace 含浏览器与 VS Code E2E'),
 node('source',70,690,800,'第 69 项 test:smoke：默认 19 个源码场景','build main / notifier → 隔离宿主，逐个执行'),
 node('webview',70,870,800,'第 70 项 test:webview：浏览器全套','再次 build · Playwright · 保留失败 trace 与截图'),
 node('clean',70,1050,800,'git archive HEAD → 独立 clean checkout','隔离 HOME / npm cache / config；npm ci → 主扩展 package:vsix'),
 node('packaged',70,1230,800,'test:vsix-smoke：默认 8 个 packaged 场景','再次打包主扩展；解包到 development host，notifier 从源码 staging'),
 node('pass',70,1410,800,'所有阶段成功 → 输出完整验证通过','0.26.0 历史例外不会继承到 0.26.1','green'),
 node('firstfail',1040,150,490,'任何阶段首败即中断','后续阶段未触达，不能拼接成功样本','red'),
 node('filter',1040,510,490,'已确认过滤变量可缩小场景','trusted 可使 19 + 8 缩为 1 + 1','red'),
 node('legacy',1040,690,490,'已知卡点：第 11 个旧代升级','晚到恢复撤销订阅的生产竞态待修复','red'),
 node('bound',1040,870,490,'宿主普通启动无进程级截止','业务等待有界，进程卡住靠 job 90 分钟终止','gray'),
 node('evidence',1040,1050,490,'失败现场分散且未自动上传','源码 .debug；clean checkout 在 /tmp','red'),
 node('coverage',1040,1230,490,'packaged smoke 覆盖边界','Linux / fake Agent；非 Marketplace 安装验收','gray'),
 node('notifier',1040,1410,490,'notifier 回跳 / locale 需另验','标准链未接入对应独立宿主 smoke','gray')
]
d['arrows']=[edge(a,b) for a,b in zip(['static','regress','early','source','webview','clean','packaged'],['regress','early','source','webview','clean','packaged','pass'])]
d['arrows'] += [edge('source','legacy','第 11 个','right','left',RED)]
save('verify-detail',d)
# tag发布路径：复核通过才准备发布产物；渠道是并行分叉。
d=base('03  最终 tag 门禁与发布','人工在 main 创建 publish/vX.Y.Z 后触发；或 workflow_dispatch 重跑同一临时 tag',1580)
d['nodes']=[
 node('input',70,150,800,'解析 publish tag → 固定不可变 SHA','当前版本走完整 verify；历史 ref 仅保留其既有兼容路径'),
 node('assets',70,330,800,'同 SHA / 同 run 六平台资产构建与装配','六 job 并行，各 20 分钟；最小 / 当前 Node 原生加载检查'),
 node('verify',70,510,800,'prepare：再次执行 release:verify','Ubuntu 22.04 / Node 22 / Chromium；上限 90 分钟'),
 node('new',70,690,800,'验证通过：准备 / 核验同批 VSIX + manifest','Release 不存在则新打包；已存在须齐全，校验 ref / 版本 / SHA'),
 node('github',70,870,800,'核验 releaseRef 已合入 main → 正式 v tag / Release','主扩展 + notifier VSIX 上传，产物传给两个渠道'),
 node('openvsx',70,1050,520,'Open VSX：发布与验真','主扩展与 notifier 都必须成功；45 分钟'),
 node('vsmarket',720,1050,520,'VS Marketplace：发布与验真','允许 deferred，不阻断本版完成；45 分钟'),
 node('finalize',400,1230,620,'finalize：always 汇总渠道结果','仅 prepare 成功才运行；更新 manifest / notes；20 分钟'),
 node('complete',400,1410,620,'GitHub assets + Open VSX 完整：删 publish tag','否则保留临时 tag 并失败，供后续重跑','green',104),
 node('failure',1040,510,490,'verify 失败：停在 prepare','不进入正式打包 / Release / 渠道','red'),
 node('partial',1040,690,490,'已有 Release 缺资产：拒绝覆盖','须人工处理，不自动生成另一批 VSIX','red'),
 node('native',1040,330,490,'六平台 ≠ 六平台功能验收','nativeLoaded=true；productValidated=false','gray')
]
d['arrows']=[edge('input','assets'),edge('assets','verify'),edge('verify','new','通过',color=GREEN),edge('verify','failure','失败','right','left',RED),edge('new','partial','不完整','right','left',RED),edge('new','github'),edge('github','openvsx',sp='bottom',tp='top'),edge('github','vsmarket',sp='bottom',tp='top'),edge('openvsx','finalize'),edge('vsmarket','finalize'),edge('finalize','complete',color=GREEN)]
save('tag-publish',d)

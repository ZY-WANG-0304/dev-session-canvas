"""发布 workflow 六 job 的真实步骤映射与分支图；不执行任何发布动作。"""
from pathlib import Path
import json,hashlib,subprocess
import yaml
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
BLUE,GREEN,RED,PURPLE='#2563eb','#16a34a','#dc2626','#9333ea'
def base(title,subtitle,width,height):
 return {'schema_version':1,'mode':'flowchart','style':1,'text_policy':'strict','quality_profile':'showcase','width':width,'height':height,'title':title,'subtitle':subtitle,'style_overrides':{'font_family':"'Noto Sans CJK SC', sans-serif",'arrow_colors':{'control':BLUE,'read':BLUE,'write':GREEN,'data':'#0d9488','async':PURPLE,'feedback':RED,'neutral':'#6b7280'}},'nodes':[],'arrows':[]}
def node(i,x,y,w,label,sub='',kind='exec',h=100):
 fill,stroke={'exec':('#eff6ff','#bfdbfe'),'verify':('#f0fdf4','#86efac'),'fail':('#fef2f2','#fca5a5'),'gray':('#f9fafb','#d1d5db')}[kind]
 return {'id':i,'kind':'rect','x':x,'y':y,'width':w,'height':h,'label':label,'sublabel':sub,'title_size':21,'fill':fill,'stroke':stroke,'flat':True}
def edge(a,b,label='',sp='bottom',tp='top',color=BLUE):
 return {'source':a,'target':b,'label':label,'source_port':sp,'target_port':tp,'color':color}
def save(name,d):
 (ROOT/(name+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
# 入口和 reusable job 展开。
d=base('发布 job 01–02：输入解析 → 六平台资产','resolve-runtime-input → native-assets；当前 0.26.1 路径需要原生资产',1700,1230)
d['nodes']=[node('start',60,150,850,'01  resolve-runtime-input：ubuntu-latest','push publish/v*（非删除）或 workflow_dispatch；contents:read'),node('checkout',60,310,850,'checkout 临时 tag → 输出 input_ref=HEAD SHA','persist-credentials=false；此 job 尚不运行测试'),node('detect',60,470,850,'按装配脚本是否存在输出 needs_assets','存在 assemble-execution-distribution-assets.mjs → true'),node('skip',1110,470,530,'历史 ref：native-assets 跳过','脚本不存在时 needs_assets=false','gray'),node('native',60,630,850,'02  native-assets：调用 reusable workflow','input_ref 固定传递；展开 Linux/macOS/Windows × x64/arm64'),node('load',60,790,850,'六 job 各自构建 → 双宿主加载 → tar/summary','每个20分钟；fail-fast=false；逐步执行见六平台明细图'),node('ready',60,950,850,'成功资产提供给 prepare 同 run 下载','native成功或历史skip，且resolve成功，prepare才准入','verify'),node('fail',1110,790,530,'resolve 或任一资产失败','prepare 不准入；其他平台继续执行','fail')]
d['arrows']=[edge('start','checkout'),edge('checkout','detect'),edge('detect','skip','false','right','left',RED),edge('detect','native','true'),edge('native','load'),edge('load','ready','全成功',color=GREEN),edge('load','fail','失败','right','left',RED)]
save('resolve-native',d)
# prepare 分成准入验证与两个互斥产物分支，避免过密汇合掩盖条件。
d=base('发布 job 03A：prepare 的输入、完整验证与分支选择','Ubuntu22.04 / Node22 · 整个prepare上限90分钟 · 后半段见03B，两分支只执行其一',1920,1920)
steps=[
 ('解析 trigger tag、版本与三个产物路径','^publish/vX.Y.Z$；不匹配直接失败','verify'),
 ('checkout resolve 输出SHA → 记录 release_ref','fetch-depth=0；Node22 → npm ci','exec'),
 ('准备完整验证环境','有preflight脚本：安装Chromium；配置同浏览器缓存和短Host TMP','exec'),
 ('下载同run原生资产 → 装配同ref六平台','needs_assets=true时运行；设置EXECUTION_ASSETS_SET','exec'),
 ('装配器核验来源与内容','输入SHA / 六target / archive hash / 文件名单 / regular file','verify'),
 ('执行 release:verify -- --version X.Y.Z','静态preflight → npm test → Webview → clean VSIX；历史无脚本则skip','verify'),
 ('查询正式 vX.Y.Z Release 三份资产','只404视为不存在；已有必须manifest + main VSIX + notifier VSIX齐备','verify')]
for i,(a,b,k) in enumerate(steps):
 d['nodes'].append(node(f'prep-{i}',60,150+i*185,1150,f'{i+1:02}  {a}',b,k,115))
 if i:d['arrows'].append(edge(f'prep-{i-1}',f'prep-{i}'))
d['nodes'] += [node('verify-fail',1390,1075,470,'verify失败：停止prepare','无always上传；渠道/收尾跳过','fail',115),node('new',60,1560,820,'404：选择新打包分支 → 03B左栏','notifier→main；生成同批manifest','exec',115),node('reuse',1040,1560,820,'资产齐备：选择复用分支 → 03B右栏','缺资产 / 非404 API错误：直接失败','verify',115),node('note',60,1740,1800,'普通步骤失败后停止后续步骤；prepare失败不会进入两个渠道或finalize','图03B仅展开查询成功选择的两个互斥分支；没有重新运行产品验收','gray',80)]
d['arrows'] += [edge('prep-5','verify-fail','失败','right','left',RED),edge('prep-6','new','404'),edge('prep-6','reuse','齐备','right','top',GREEN)]
save('prepare-validation',d)
d=base('发布 job 03B：prepare 的新打包 / 复用与产物交付','这两个分支互斥；各自通过共用tag、manifest和上传步骤；仍属于同一个prepare job',1920,1780)
for lane,key in enumerate(['package','reuse']):
 x=50+960*lane
 common=[
 ('核验正式v tag的本地 / 远端SHA','已有tag必须指向release_ref；缺失则创建并推送','verify'),
 ('记录 finalTagStatus=pushed → 生成notes','notes来自该版本CHANGELOG与当前manifest','exec'),
 ('创建/更新GitHub Release并上传三份资产' if lane==0 else '只更新GitHub Release notes','manifest + main/notifier VSIX，--clobber' if lane==0 else '已有VSIX保持；finalize随后更新manifest','exec'),
 ('上传 prepared-release-<run_id>','release-artifacts + 两VSIX；缺产物error','exec'),
 ('输出版本、release_ref、final_tag与三路径','两渠道下载同run prepared产物，并行开始','verify')]
 specific=[('验证发布输入','三个版本 / preflight / HEAD=tag / clean / ref属于origin/main','verify'),('新打包 notifier → main','release:publish-tag --package-only；核对VSIX identity/README ref/hash','exec')] if lane==0 else [('下载GitHub Release中的三份原产物','精确名称；每个文件非空；放回约定路径','exec'),('验证发布输入和原manifest / VSIX','--skip-package --package-only；版本/ref/identity/README ref/hash','verify')]
 d['nodes'].append(node(key+'-head',x,130,860,'新打包（Release不存在）' if lane==0 else '复用（已有三份资产齐备）','从图03A选择；每次只执行一栏','gray',70))
 for i,(a,b,k) in enumerate(specific+common):
  d['nodes'].append(node(f'{key}-{i}',x,270+i*185,860,f'{i+1:02}  {a}',b,k,115))
  if i:d['arrows'].append(edge(f'{key}-{i-1}',f'{key}-{i}'))
d['nodes'].append(node('limits',50,1610,1820,'任一步失败：停止后续步骤；此job没有always失败现场上传','部分Release上传失败不会自动回滚；重跑时缺任一资产会拒绝新打包，需人工恢复','fail',90))
save('prepare-artifacts',d)
# 两发布job逐步对照。
d=base('发布 job 04–05：两个渠道的内部步骤','prepare成功后并行；各45分钟 · 发布顺序 notifier→main；使用同批产物，不重打包',1920,1740)
for lane,(key,label,pat) in enumerate([('open-vsx','Open VSX','OVSX_PAT'),('visual-studio','VS Marketplace','VSCE_PAT')]):
 x=50+960*lane
 steps=[('checkout 临时 trigger tag','fetch-depth=0；Node22 → npm ci','exec'),('下载 prepare 的同 run 产物','prepared-release-<run_id> → 当前目录','exec'),('检查本渠道 PAT 是否存在',pat+'缺失：status=1，跳过校验/发布','verify'),('校验 release 输入和原产物','版本、HEAD/tag/main、clean、manifest ref和VSIX hash','verify'),('查询已发布版本 → 发布缺失扩展','顺序 notifier→main；已verified/已存在跳过；失败继续其他扩展','exec'),('查询渠道结果，限次等待可见','Open VSX：版本+download/icon/license/sha256/vsixmanifest链接' if lane==0 else 'VS Marketplace：gallery API返回指定扩展的目标版本','verify'),('写结果 manifest 与命令 status','--skip-package；--no-create-final-tag；本job不删trigger tag','exec'),('always：上传本渠道 result manifest',f'marketplace-result-{key}-<run_id>；无文件warn','gray'),('Open VSX失败 → job失败' if lane==0 else 'VS渠道失败 → 输出 deferred 说明','finalize仍会运行；两扩展Open VSX必须满足完成' if lane==0 else '业务发布失败不强制该步exit1；前置硬失败仍可令job失败','fail' if lane==0 else 'gray')]
 d['nodes'].append(node(key+'-head',x,130,860,f'{"04" if lane==0 else "05"}  {label}','ubuntu-latest；needs prepare；45分钟','gray',70))
 for i,(a,b,k) in enumerate(steps):
  d['nodes'].append(node(f'{key}-{i}',x,255+i*145,860,f'{i+1:02}  {a}',b,k,96))
  if i:d['arrows'].append(edge(f'{key}-{i-1}',f'{key}-{i}'))
 # 缺PAT跳过后续校验/发布的条件已写在步骤03，避免将条件标注画成循环。
save('channels',d)
# finalizer branch carefully monotone.
d=base('发布 job 06：finalize 的汇总与删除条件','needs prepare + 两渠道；always && prepare成功才运行 · ubuntu-latest，20分钟',1840,2020)
d['nodes']=[node('start',60,150,860,'两渠道结束后准入 finalize','不要求渠道成功；prepare失败则整个job跳过'),node('input',60,320,860,'checkout 临时 tag，下载prepared产物','这里不setup Node/npm ci；使用runner工具与已准备manifest'),node('results',60,490,860,'分别下载两个渠道的结果 manifest','continue-on-error=true；缺失结果可继续汇总'),node('merge',60,660,860,'把两个 marketplace 分支合并到主 manifest','缺失分支不覆盖原值；已保存verified信息仍可用于重跑'),node('complete',60,830,860,'核对 main/notifier 的Open VSX状态是否完成','每项为verified或already-published；VS状态独立记录','verify'),node('release',60,1000,860,'更新 GitHub Release notes 和汇总manifest','complete / complete-with-deferred-visual-studio / publish-failed'),node('refs',60,1170,860,'Open VSX完成：核对最终 / 临时 tag SHA','两tag必须等于prepare.release_ref，否则拒绝删除','verify'),node('retain',1080,1170,700,'Open VSX未完成：跳过删tag','保持临时tag用于重跑；最终状态publish-failed','fail'),node('delete',60,1340,860,'删除远端临时 publish tag，再删本地tag','之后记录triggerTagStatus=deleted，更新notes/manifest'),node('artifacts',60,1510,860,'always：上传最终工件','marketplace-release-<run_id>；manifest、两VSIX、渠道结果'),node('result',60,1680,860,'完成条件满足则成功；未完成则exit1','已发布部分不会自动撤回；prepare失败不会触达该收尾','verify')]
d['arrows']=[edge(a,b) for a,b in zip(['start','input','results','merge','complete'],['input','results','merge','complete','release'])]+[edge('release','refs','release_complete=true'),edge('release','retain','false','right','top',RED),edge('refs','delete','SHA一致'),edge('delete','artifacts'),edge('retain','artifacts','','left','right',RED),edge('artifacts','result')]
save('finalize',d)
# 保存原workflow六job的完整YAML steps与条件；静态审查，不执行发布。
source=REPO/'.github/workflows/publish-marketplace-release.yml'
(ROOT/'source-metadata.json').write_text(json.dumps({'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True,cwd=REPO).strip(),'workflow':str(source.relative_to(REPO)),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'helperSha256':{p:hashlib.sha256((REPO/p).read_bytes()).hexdigest() for p in ['scripts/release/publish-tag-release.mjs','scripts/release/write-github-release-notes.mjs','scripts/release/release-preflight.mjs','scripts/build/assemble-execution-distribution-assets.mjs']},'scope':'原代码流程，不是发布执行结果','jobOrder':['resolve-runtime-input','native-assets','prepare','publish-open-vsx','publish-visual-studio','finalize']},ensure_ascii=False,indent=2)+'\n')
workflow=yaml.safe_load(source.read_text())
(ROOT/'source-jobs.json').write_text(json.dumps({'workflow':str(source.relative_to(REPO)),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'jobs':workflow['jobs']},ensure_ascii=False,indent=2)+'\n')
print('Generated publish workflow job detail inputs.')

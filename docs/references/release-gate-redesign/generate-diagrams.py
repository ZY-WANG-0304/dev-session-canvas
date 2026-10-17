#!/usr/bin/env python3
"""生成三张拟议流程图的精确文字/布局输入；JSON不接入实际CI。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BLUE, GREEN, RED, PURPLE = '#2563eb', '#16a34a', '#dc2626', '#9333ea'


def node(key, x, y, width, label, sub='', tone='blue', height=104):
    colors = {'blue': ('#eff6ff', '#bfdbfe'), 'green': ('#f0fdf4', '#86efac'),
              'red': ('#fef2f2', '#fca5a5'), 'purple': ('#faf5ff', '#d8b4fe'),
              'gray': ('#f9fafb', '#d1d5db')}
    fill, stroke = colors[tone]
    return dict(id=key, x=x, y=y, width=width, height=height, kind='rect', label=label,
                sublabel=sub, title_size=21, fill=fill, stroke=stroke, flat=True)


def edge(source, target, label='', source_port='bottom', target_port='top', color=BLUE):
    return dict(source=source, target=target, label=label,
                source_port=source_port, target_port=target_port, color=color)


def base(title, sub, width, height):
    return dict(schema_version=1, mode='flowchart', style=1, text_policy='strict',
                quality_profile='showcase', width=width, height=height, title=title, subtitle=sub,
                style_overrides={'font_family': "'Noto Sans CJK SC', sans-serif", 'title_size':30,
                                 'arrow_colors': {'control': BLUE, 'read': BLUE, 'write': GREEN,
                                                  'data':'#0d9488', 'async':PURPLE, 'feedback':RED,
                                                  'neutral':'#6b7280'}},
                nodes=[], arrows=[], legend=[{'label':'验证 / 输入依赖', 'color':BLUE},
                                            {'label':'同批产物 / 完成', 'color':GREEN},
                                            {'label':'失败 / 未完成', 'color':RED},
                                            {'label':'恢复 / 可deferred', 'color':PURPLE}],
                legend_x=60, legend_y=height-44, legend_orientation='horizontal')


def save(name, diagram):
    (ROOT / f'{name}.json').write_text(json.dumps(diagram, ensure_ascii=False, indent=2)+'\n')


d=base('01  验证依赖与范围', '已选定设计 · 未实施CI · 普通PR按分类选层；发布PR与最终tag各跑完整范围', 1800, 1460)
d['nodes']=[
    node('resolve',650,140,1090,'resolve：冻结完整SHA、模式与必跑任务','正式入口拒绝filter/skip；计划绑定目录、环境和预算摘要'),
    node('base',60,340,500,'基础层独立执行','regression / browser build / Webview功能与视觉 / Marketplace浏览器',height=150),
    node('contract',650,340,1090,'input-contract：静态输入与版本契约','不等待六平台资产；版本/契约分类不一致拒绝'),
    node('native',650,530,1090,'native-assets：六目标构建与load','真实PTY操作单独记结果；load可用不等于操作通过'),
    node('build',650,720,1090,'独立构建：source-build 与 package-clean','分别消费同run六资产；development主/notifier 与 干净production双包'),
    node('host',650,910,1090,'独立验收：源码Host 与 双包Host/安装','source-host / marketplace-host；packaged-host / 三x64 installed-pair'),
    node('aggregate',650,1120,1090,'verify-result：always聚合所有计划任务','逐case / 实际job / 包身份；同时核六目标操作，不只核load',tone='green'),
    node('output',650,1310,1090,'发布PR只用于review；最终tag通过才可交付','基础 / 功能 / 产物取并集；完整模式另要求六目标操作；诊断永不生成完整回执',tone='green',height=80),
    node('failure',60,720,500,'独立失败保留现场','同级job继续；依赖项not-run；同Host清理未知即停止本组',tone='red',height=120),
]
d['arrows']=[edge('resolve','base',source_port='left',target_port='right'),edge('resolve','contract'),edge('contract','native'),
             edge('native','build'),edge('build','host'),edge('host','aggregate'),
             edge('base','aggregate',source_port='right',target_port='left'),edge('aggregate','output',color=GREEN)]
save('validation-flow',d)

d=base('02  双包交接与验收', '每个预合并/最终tag输入各自构建验收；最终发布消费最终SHA上验过的同批文件', 1680, 1600)
d['nodes']=[
    node('input',60,140,920,'固定源码 + lock + 同run六目标native-set','git archive SHA；隔离HOME/config/npm依赖；native不在dist内'),
    node('build',60,340,920,'package-clean：主/notifier各构建打包一次','正式platform/profile/admission；保留补丁、资源、README-ref与file-list检查'),
    node('pair',60,540,920,'固定路径双包 + package-receipt','main.vsix / notifier.vsix；ID/版本/SHA/size、源码与asset-set摘要',tone='green'),
    node('instrument',60,740,920,'packaged-host：只消费两个包的测试副本','wrapper/manifest/test-mode变更清单；notifier禁止从源码dist替代'),
    node('installed',60,940,920,'installed-pair：原样双包安装','空extensionsDir；独立driver/公开入口；三x64系统；产品无smoke模式'),
    node('accept',60,1140,920,'聚合包验收与其他完整层 → acceptance回执','原包前后摘要不变；case/输入/环境/producer来源一致',tone='green'),
    node('prepare',60,1340,920,'最终tag：prepare只下载、核验和交付同批包','不重打包；远端GitHub资产核摘要 → 两渠道消费原包',tone='green'),
    node('notserial',1110,740,510,'两层验收独立执行','图按交接展开；installed不依赖packaged成功',tone='gray'),
    node('differentref',1110,140,510,'PR与最终tag是不同输入','两阶段分别全量验证；不拿PR包直接发布',tone='gray'),
    node('exact',1110,540,510,'不以mtime / glob选择包','每个消费边界重新计算原包摘要',tone='gray'),
    node('bad',1110,1140,510,'错包 / 缺回执 / 未验收','不能发布；保留现场与原输入',tone='red'),
    node('retry',1110,1340,510,'已有Release恢复原双包','匹配原acceptance；拒绝自动重打或覆盖',tone='purple'),
]
d['arrows']=[edge('input','build'),edge('build','pair',color=GREEN),edge('pair','instrument',color=GREEN),
             edge('pair','installed',source_port='left',target_port='left',color=GREEN),
             edge('instrument','accept',source_port='right',target_port='right'),edge('installed','accept'),
             edge('accept','prepare',color=GREEN),
             edge('prepare','retry','重跑','right','left',PURPLE)]
save('package-flow',d)

d=base('03  发布六job与渠道恢复', '已选定设计 · GitHub assets + Open VSX为必需目标；VS Marketplace保持可deferred', 1800, 1800)
d['nodes']=[
    node('resolve',60,140,1010,'1  resolve-release：解析并固定release SHA','版本 / main归属 / 最终tag / 新发布或合法原包恢复'),
    node('verify',60,340,1010,'2  verify-release：完整验证或原包回执复核','新发布同最终SHA全量；重试明确原包、证据来源与所选目标'),
    node('prepare',60,540,1010,'3  prepare-release：消费已验双包','同bytes正式tag/Release上传并复核远端摘要；无重新package',tone='green'),
    node('open',60,740,490,'4  publish-open-vsx','主/notifier：查询 → 提交 → 内容验真'),
    node('vs',680,740,490,'5  publish-visual-studio','独立发布/验真；失败可deferred',tone='purple'),
    node('finalize',60,980,1010,'6  finalize-release：always严格汇总','schema/ref/version/包/目标/producer校验；结合实际job与历史复用策略'),
    node('complete',60,1190,1010,'GitHub与Open VSX双包内容身份完整匹配','新发布须fresh；恢复可显式复用未选重试目标的可信历史证据',tone='green'),
    node('cleanup',60,1400,1010,'更新manifest/notes → 复查SHA → 删除publish tag','删tag失败单列cleanup-failed；既有成功事实保持',tone='green'),
    node('done',60,1600,1010,'完成；发布后事实留在Release与manifest','不回写同版本CHANGELOG / 不另建证据PR',tone='green',height=80),
    node('unknown',1290,740,450,'提交结果未知','只查询，不盲目重发',tone='red'),
    node('missing',1290,980,450,'缺结果或错身份','必需目标不完成；错partial拒绝合并',tone='red'),
    node('keep',1290,1190,450,'失败保留publish tag','工件always上传，原双包不可变',tone='red'),
    node('retry',1290,1400,450,'下一attempt原包恢复','重新核GitHub原资产；所选目标fresh',tone='purple'),
    node('conflict',1290,340,450,'已有Release资产不完整','拒绝自动重打/覆盖，保留修复入口',tone='red'),
    node('history',1290,540,450,'历史成功有条件复用','同包 / 同ref / 可核来源；本轮未知如实记',tone='purple'),
]
d['arrows']=[edge('resolve','verify'),edge('verify','prepare',color=GREEN),edge('prepare','open',color=GREEN),
             edge('prepare','vs',color=GREEN),edge('open','finalize'),edge('vs','finalize'),
             edge('finalize','complete','必需目标通过',color=GREEN),edge('complete','cleanup',color=GREEN),
             edge('cleanup','done',color=GREEN),edge('finalize','missing','拒绝','right','left',RED),
             edge('complete','keep','未完成','right','left',RED),edge('keep','retry',color=PURPLE)]
save('publish-flow',d)
print('生成3张拟议流程图JSON；发布job不在本脚本执行')

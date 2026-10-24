"""只核对CI明细文档与当前源码/工件，不运行构建、宿主或发布。"""
from pathlib import Path
import json,yaml,re,hashlib,struct
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
RESULT=ROOT/'job-detail-validation.json'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    report={'scope':'静态源码、文档与图文件核对；没有运行发布或跨平台产品验收','checks':{}}
    native=json.loads((ROOT/'native-jobs/source-map.json').read_text())
    workflow=yaml.safe_load((REPO/'.github/workflows/runtime-execution-assets.yml').read_text())['jobs']['native-assets']
    assert native['workflowJob']==workflow
    assert [(j['target'],j['runner']) for j in native['jobs']]==[(a['target'],a['runner']) for a in workflow['strategy']['matrix']['asset']]
    assert [len(j['steps']) for j in native['jobs']]==[15,15,16,16,18,18]
    anchors=0
    for job in native['jobs']:
        for stage in job['steps']:
            path,line=stage['anchor'].rsplit(':',1)
            assert 0<int(line)<=len((REPO/path).read_text().splitlines()),stage
            anchors+=1
    for path,sha in native['sourceSha256'].items():
        assert digest(REPO/path)==sha,path
    report['checks']['nativeMapping']={'ok':True,'targets':6,'stepCounts':[len(j['steps']) for j in native['jobs']],'existingSourceAnchors':anchors,'sourceHashes':len(native['sourceSha256'])}
    publish=json.loads((ROOT/'publish-jobs/source-jobs.json').read_text())
    actual=yaml.safe_load((REPO/publish['workflow']).read_text())['jobs']
    assert publish['jobs']==actual
    assert list(actual)==['resolve-runtime-input','native-assets','prepare','publish-open-vsx','publish-visual-studio','finalize']
    assert [len(j.get('steps',[])) for j in actual.values()]==[2,0,19,9,9,9]
    assert digest(REPO/publish['workflow'])==publish['sha256']
    meta=json.loads((ROOT/'publish-jobs/source-metadata.json').read_text())
    for path,sha in meta['helperSha256'].items():
        assert digest(REPO/path)==sha,path
    report['checks']['publishMapping']={'ok':True,'jobs':6,'steps':48,'reusableCalls':1,'allConditionsNeedsOutputsCommandsPreserved':True,'helperHashes':len(meta['helperSha256'])}
    links=0
    for p in [ROOT/'job-details.md',REPO/'docs/design-docs/release-gate-flow-audit.md',REPO/'docs/design-docs/core-beliefs.md']:
        for link in re.findall(r'\]\(([^)]+)\)',p.read_text()):
            if link.startswith(('http:','https:')):
                continue
            target=link.split('#',1)[0]
            if target:
                resolved=(p.parent/target).resolve()
                assert resolved==RESULT or resolved.exists(),(p,link)
            links+=1
    report['checks']['markdownLinks']={'ok':True,'checked':links}
    diagrams={}
    for group in ['native-jobs','publish-jobs']:
        droot=ROOT/group
        for name,result in json.loads((droot/'validation.json').read_text()).items():
            assert all(result[gate]['ok'] for gate in ['validate','render','check','png']),(name,result)
            png=droot/(name+'.png')
            width,height=struct.unpack('>II',png.read_bytes()[16:24])
            assert width==2400
            assert result['png']['width']==width and result['png']['height']==height
            diagrams[group+'/'+name]={'width':width,'height':height,'sha256':digest(png)}
    assert len(diagrams)==9
    report['checks']['diagrams']={'ok':True,'count':9,'pngs':diagrams}
    for p in [ROOT/'native-jobs/generate.py',ROOT/'publish-jobs/generate.py',Path(__file__)]:
        compile(p.read_text(),str(p),'exec')
    report['checks']['generatorSyntax']={'ok':True}
    RESULT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('PASS: six native targets / 98 mapped stages, six publish jobs / 48 YAML steps, source hashes, nine diagrams and document links.')

if __name__=='__main__':
    main()

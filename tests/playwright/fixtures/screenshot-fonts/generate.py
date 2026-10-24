"""从已校验的本地 Noto TTC 生成 Webview CJK 子集；不执行下载。"""
import hashlib
import json
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
import fontTools

root = Path(__file__).resolve().parents[4]
folder = Path(__file__).resolve().parent
source = Path(sys.argv[1])
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
expected = 'b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a'
if source_hash != expected or fontTools.__version__ != '4.61.1':
    raise ValueError('Requires the recorded Noto CJK source and fonttools 4.61.1')
roots = ['tests/playwright/webview-harness.spec.mjs',
         'extensions/vscode/dev-session-canvas/src/webview']
sources = []
for name in roots:
    path = root / name
    sources.extend([path] if path.is_file() else sorted(p for p in path.rglob('*')
                   if p.suffix in {'.ts', '.tsx', '.json', '.mjs', '.html'}))
def is_cjk(c):
    return any(lo <= ord(c) <= hi for lo, hi in
               [(0x3000, 0x30ff), (0x3400, 0x9fff), (0xf900, 0xfaff), (0xff00, 0xffef)])
characters = ''.join(sorted({c for p in sources for c in p.read_text() if is_cjk(c)}))
font = TTFont(source, fontNumber=2, recalcTimestamp=False)
missing = set(map(ord, characters)) - font.getBestCmap().keys()
if missing:
    raise ValueError(f'Source font lacks codepoints: {sorted(missing)}')
options = subset.Options()
options.flavor = 'woff'
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=characters)
subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in {1, 16}:
        record.string = 'DSC Screenshot CJK'.encode(record.getEncoding())
    elif record.nameID in {3, 4, 6}:
        record.string = 'DSCScreenshotCJK-Regular'.encode(record.getEncoding())
cff = font['CFF '].cff
cff.fontNames = ['DSCScreenshotCJK-Regular']
cff.topDictIndex[0].FamilyName = 'DSC Screenshot CJK'
cff.topDictIndex[0].FullName = 'DSCScreenshotCJK-Regular'
font.flavor = 'woff'
font.save(folder / 'cjk-regular.woff')
(folder / 'characters.txt').write_text(characters + '\n')
manifest = json.loads((folder / 'provenance.json').read_text())
manifest['source_roots'] = roots
manifest['characters_sha256'] = hashlib.sha256((characters + '\n').encode()).hexdigest()
manifest['codepoints'] = sorted(font.getBestCmap())
data = (folder / 'cjk-regular.woff').read_bytes()
manifest['files']['cjk-regular.woff'].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
(folder / 'provenance.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'{len(characters)} CJK characters, {len(data)} bytes')

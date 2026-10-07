"""Builds index.html from src/template.html, src/checker.js and the files in data/.
Run from the repository root:  python src/build.py"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda *p: open(os.path.join(ROOT, *p), encoding='utf-8').read()
t = rd('src', 'template.html')
arity = json.loads(rd('data', 'arity.json'))
cat = {'names': arity['names'], 'ar': arity['ar'],
       'ref': json.loads(rd('data', 'reference.json')),
       'idx': json.loads(rd('data', 'function-names.json'))}
t = t.replace('/*CATALOG*/', json.dumps(cat, separators=(',', ':')).replace('</', '<\\/')).replace('/*CHECKER*/', rd('src', 'checker.js'))
i = t.index('<div class="app">')
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        + t[:i] + '</head>\n<body>\n' + t[i:] + '\n</body>\n</html>\n')
open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(page)
print('index.html written,', len(page), 'bytes')

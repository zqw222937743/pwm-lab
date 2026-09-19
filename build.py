"""Build the static product from typed source folders, without remote resources."""
from pathlib import Path
from shutil import copy2

root = Path(__file__).resolve().parent
source = root / 'src'
destination = root / 'dist'
page = (source / 'index.html').read_text(encoding='utf-8')
page = page.replace('<!-- PARAMETERS -->', (source / 'parameters.html').read_text(encoding='utf-8'))
(destination / 'index.html').write_text(page, encoding='utf-8')
for file in source.glob('*.js'):
    copy2(file, destination / 'assets' / file.name)
copy2(source / 'styles.css', destination / 'assets/styles.css')
print('Built dist/index.html and local assets.')

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SOURCE = next(ROOT.parent.glob('*.pdf'))
CACHE = ROOT / '.cache' / 'manual'
ASSETS = ROOT / 'docs' / 'images' / 'manual'
CACHE.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)
reader = PdfReader(SOURCE)
pages = [{'pdf_page': i + 1, 'printed_page': i, 'text': p.extract_text() or ''}
         for i, p in enumerate(reader.pages)]
(CACHE / 'pages.json').write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding='utf-8')

selections = [(1, 0, 'club-mark'), (19, 0, 'motherboard'), (24, 0, 'm2-connectors'),
              (31, 0, 'memory'), (33, 0, 'hard-drive'), (37, 0, 'graphics-card'),
              (56, 0, 'boot-process'), (66, 0, 'uefi'), (131, 0, 'repair-tools')]
sheet = Image.new('RGB', (900, 900), '#f1f4f3')
draw = ImageDraw.Draw(sheet)
assets = []
for index, (page, image_index, name) in enumerate(selections):
    images = reader.pages[page - 1].images
    if len(images) <= image_index:
        continue
    original = images[image_index].image.convert('RGBA')
    if name == 'club-mark':
        # The PDF cover stores its transparent logo as an image mask.
        pixels = original.load()
        for py in range(original.height):
            for px in range(original.width):
                red, green, blue, alpha = pixels[px, py]
                if max(red, green, blue) < 25:
                    pixels[px, py] = (red, green, blue, 0)
        bounds = original.getbbox()
        if bounds:
            original = original.crop(bounds)
    original.save(ASSETS / (name + '.webp'), 'WEBP', quality=90)
    thumb = original.copy()
    thumb.thumbnail((280, 245))
    x, y = index % 3 * 300, index // 3 * 300
    sheet.paste(thumb, (x + (300 - thumb.width) // 2, y + 10), thumb)
    draw.text((x + 12, y + 267), f'{name} / PDF p.{page}', fill='#172925')
    assets.append({'file': f'/images/manual/{name}.webp', 'pdf_page': page,
                   'printed_page': page - 1, 'width': original.width, 'height': original.height})
sheet.save(CACHE / 'contact-sheet.jpg', quality=90)
with SOURCE.open('rb') as handle:
    source_hash = hashlib.file_digest(handle, 'sha256').hexdigest()
(ROOT / 'manual-source.json').write_text(json.dumps({
    'title': '四川大学飞扬俱乐部《维修手册》', 'source_sha256': source_hash,
    'pdf_pages': len(pages), 'printed_page_offset': -1, 'assets': assets,
    'editorial_note': '节选整理；原文件保留在项目目录之外。'
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'pages': len(pages), 'assets': len(assets), 'source_sha256': source_hash}))

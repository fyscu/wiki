import hashlib
import html
import json
import os
from pathlib import Path
import re
import yaml

from bs4 import BeautifulSoup
from jinja2 import ChoiceLoader, FileSystemLoader, PrefixLoader


ROOT = Path(__file__).resolve().parents[1]


def on_env(env, config, files, **kwargs):
    upstream = ROOT / 'vendor/oi-material/material/templates'
    env.loader = ChoiceLoader([FileSystemLoader(ROOT / 'overrides'),
                               PrefixLoader({'upstream': FileSystemLoader(upstream)}), env.loader])
    env.filters['nav_math'] = lambda value: value
    return env


def on_config(config, **kwargs):
    navigation = ROOT / 'navigation.yml'
    if navigation.exists():
        data = yaml.safe_load(navigation.read_text(encoding='utf-8'))
        def convert(nodes):
            return [{node['title']: convert(node['children']) if 'children' in node else node['path']} for node in nodes]
        if data.get('version') != 1 or not isinstance(data.get('items'), list):
            raise ValueError('Invalid navigation.yml')
        config.nav = convert(data['items'])
    manifest = json.loads((ROOT / 'docs/assets/community/.vite/manifest.json').read_text())
    entry = next(value for value in manifest.values() if value.get('isEntry'))
    config.extra['community_js'] = 'assets/community/' + entry['file']
    config.extra['community_css'] = ['assets/community/' + path for path in entry.get('css', [])]
    return config


def on_page_content(output, page, config, files, **kwargs):
    if page.meta.get('doc_id'):
        source = Path(page.file.abs_src_path).read_bytes()
        context = {'id': page.meta['doc_id'], 'title': page.title, 'path': '/' + page.url,
                   'revision': 'sha256:' + hashlib.sha256(source).hexdigest()}
        output += '<div data-wiki-component="article-questions" data-article="' + html.escape(json.dumps(context, ensure_ascii=False), quote=True) + '"></div>'
    return output


def on_post_page(output, page, config, **kwargs):
    soup = BeautifulSoup(output, 'html.parser')
    settings = soup.select_one('#__config')
    if settings:
        values = json.loads(settings.string)
        values['search'] = '/assets/vendor/material/workers/search.d50fe291.min.js'
        settings.string = json.dumps(values, ensure_ascii=False)
    header = soup.select_one('.md-header__inner')
    if header:
        account = soup.new_tag('div', attrs={'data-wiki-component': 'account-menu', 'class': 'wiki-account'})
        link = soup.new_tag('a', href='/login/', attrs={'class': 'md-header__button md-icon', 'title': '登录', 'aria-label': '登录'})
        icon = BeautifulSoup((ROOT / 'vendor/oi-material/material/templates/.icons/material/account-circle-outline.svg').read_text(), 'html.parser')
        link.append(icon)
        account.append(link)
        header.append(account)
    return str(soup)

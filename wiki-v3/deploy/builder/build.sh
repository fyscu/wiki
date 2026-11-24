#!/bin/sh
set -eu
[ "${1:-push}" != ping ] || exit 0

exec 9>/srv/.build.lock
flock 9
repo=/workspace/repo
origin="https://github.com/${GITHUB_REPO}.git"
if [ -d "$repo/.git" ]; then
    git -C "$repo" remote set-url origin "$origin"
    git -C "$repo" pull --ff-only origin main
else
    git clone --depth 1 --filter=blob:none --sparse --branch main "$origin" "$repo"
fi
git -C "$repo" sparse-checkout set wiki-v3/wiki

mkdocs build --strict -f "$repo/wiki-v3/wiki/mkdocs.yml" -d /srv/wiki_next
release=$(mktemp -d /srv/wiki-release.XXXXXX)
mv -T /srv/wiki_next "$release"
previous=$(readlink /srv/wiki || true)

# A single rename switches the symlink without leaving Caddy without a root.
ln -s "$release" /srv/.wiki-link.$$
mv -Tf /srv/.wiki-link.$$ /srv/wiki
for old in /srv/wiki-release.*; do
    if [ "$old" != "$release" ] && [ "$old" != "$previous" ]; then
        rm -rf -- "$old"
    fi
done

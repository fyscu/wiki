FROM python:3.12-alpine3.22

RUN apk add --no-cache ca-certificates git webhook flock coreutils
COPY wiki/requirements.txt /tmp/wiki-requirements.txt
RUN pip install --no-cache-dir -r /tmp/wiki-requirements.txt

COPY --chmod=755 deploy/builder/build.sh /usr/local/bin/build-wiki
COPY deploy/builder/hooks.json /etc/wiki-hooks.json
ENV NO_MKDOCS_2_WARNING=1
EXPOSE 9000
CMD ["webhook", "-port", "9000", "-urlprefix", "_hooks", "-hooks", "/etc/wiki-hooks.json", "-template", "-verbose"]

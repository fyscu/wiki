import { writeFile } from 'node:fs/promises'
import { routes } from '../lib/api-routes.mjs'
import { answerLinkRoutes } from '../lib/answer-links.mjs'

const groups = Map.groupBy(routes, route => route.path)
let output = '# Generated from lib/api-routes.mjs.\n'
output += 'set $wiki_comment_arg "";\nif ($arg_commentId ~ "^[0-9]{1,20}$") { set $wiki_comment_arg "&commentId=$arg_commentId"; }\n'
for (const route of answerLinkRoutes) {
  output += `location ~ "${route.pattern}" {\n    if ($request_method !~ ^(GET|HEAD)$) { return 405; }\n    add_header Cache-Control "no-store" always;\n    return 302 "/question/?id=$wiki_question_id${route.answer ? '&answer=$wiki_answer_id' : ''}$wiki_comment_arg";\n}\n\n`
}
for (const [path, entries] of groups) {
  output += `location = /_community/${path} {\n`
  if (path === 'captcha') output += '    if ($arg_action !~ "^(email|password)$") { return 400; }\n'
  output += `    client_max_body_size 256k;\n    if ($request_method !~ "^(${entries.map(item => item.method).join('|')})$") { return 405; }\n`
  output += '    set $origin_ok 0;\n    if ($http_origin = "") { set $origin_ok 1; }\n    if ($http_origin = "$scheme://$http_host") { set $origin_ok 1; }\n    if ($origin_ok = 0) { return 403; }\n'
  output += '    set $needs_auth 0;\n'
  for (const entry of entries.filter(item => item.auth)) output += `    if ($request_method = ${entry.method}) { set $needs_auth 1; }\n`
  output += '    if ($http_authorization ~ "^Bearer [A-Za-z0-9._-]{8,2048}$") { set $needs_auth 0; }\n    if ($needs_auth = 1) { return 401; }\n'
  output += '    set $wiki_target "";\n    set $wiki_method $request_method;\n'
  for (const entry of entries) {
    const query = (entry.query || []).map(key => `${key}=$arg_${key}`).join('&')
    output += `    if ($request_method = ${entry.method}) { set $wiki_target "/answer/api/v1/${entry.upstream}${query ? '?' + query : ''}"; set $wiki_method ${entry.upstreamMethod || entry.method}; }\n`
  }
  if (entries.some(item => item.query?.includes('page_size'))) output += '    if ($arg_page_size !~ "^$|^(?:[1-9]|1[0-9]|20)$") { return 400; }\n'
  output += '    proxy_pass http://127.0.0.1:9080$wiki_target;\n    proxy_method $wiki_method;\n    proxy_set_header Cookie "";\n    proxy_hide_header Set-Cookie;\n    proxy_set_header Host 127.0.0.1:9080;\n    proxy_set_header Accept-Language zh-CN;\n    proxy_set_header Authorization $http_authorization;\n    proxy_connect_timeout 3s;\n    proxy_read_timeout 15s;\n    proxy_cache off;\n    add_header Cache-Control "no-store" always;\n'
  if (path === 'logout') output += '    proxy_pass_request_body off;\n    proxy_set_header Content-Length "";\n'
  output += '}\n\n'
}
output += 'location /_community/ { return 404; }\n'
output = output.replaceAll('    proxy_set_header Host 127.0.0.1:9080;', '    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $remote_addr;\n    proxy_set_header X-Forwarded-Proto $scheme;')
await writeFile('deploy/community-api.conf', output)
let production = output
for (const path of ['register', 'email/resend', 'password/reset']) {
  production = production.replace(`location = /_community/${path} {`, `location = /_community/${path} {\n    limit_req zone=wiki_email burst=3 nodelay;\n    include /www/sites/wiki.feiyang.ac.cn/mail-gate.conf;`)
}
for (const path of ['login', 'register', 'email/verify', 'email/resend', 'email/unsubscribe', 'password/reset', 'password/replace']) {
  production = production.replace(`location = /_community/${path} {`, `location = /_community/${path} {\n    limit_req zone=wiki_accounts burst=10 nodelay;\n    limit_req_status 429;`)
}
await writeFile('deploy/community-api-production.conf', production)

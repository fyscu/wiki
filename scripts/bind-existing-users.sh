#!/usr/bin/env bash
# bind-existing-users.sh — 统一登录上线前，把已有 wiki 账号预绑定到统一身份主表 uid
#
# 背景：Answer 的 ExternalLogin 在「邮箱已存在但没有 user_external_login 绑定」时
# 直接返回 UserAccessDenied（internal/service/user_external_login/…:189）。
# wiki 现有账号若不预绑定，第一次走统一登录会失败；新注册用户不受影响（自动建号+绑定）。
#
# 数据来源：物理机 cron sync-wiki-identity.sh 维护的 user_identity_map(user_id, uid, email)。
# 只读 wiki 库 + 只写 wiki 库的 user_external_login，不触碰云端主表，不改用户密码/资料。
#
# 用法：
#   ./bind-existing-users.sh                 # dry-run，只报告
#   ./bind-existing-users.sh --apply        # 实际写入（幂等，可重复跑）
# 凭据：复用 /mnt/raid/fy/answer/.env 里的 MYSQL_ROOT_PASSWORD，不回显、不入仓。
set -euo pipefail

BASE=/mnt/raid/fy/answer
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

APW="$(docker exec answer-mysql sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')"
[ -n "$APW" ] || { echo "无法读取影子/生产 wiki 库凭据" >&2; exit 1; }

wiki() { docker exec answer-mysql mysql -uroot -p"$APW" -N -B feiyang_wiki_qa -e "$1" 2>/dev/null; }

# 只绑定「已验证邮箱 + 主表已有 uid + 尚未绑定」的用户
# provider 必须是 connector-basic 的 slug name = basic（见 basic.go ConnectorSlugName）
ROWS="$(wiki "SELECT m.user_id, m.uid, u.e_mail
              FROM user_identity_map m
              JOIN \`user\` u ON u.id = m.user_id
              LEFT JOIN user_external_login e
                     ON e.user_id = m.user_id AND e.provider = 'basic'
              WHERE m.uid IS NOT NULL AND m.uid > 0
                AND u.e_mail IS NOT NULL AND u.e_mail <> ''
                AND u.mail_status = 1
                AND u.status <> 11
                AND e.id IS NULL
              ORDER BY m.user_id")"

total=0; bound=0; skipped=0; errors=0
while IFS=$'\t' read -r wid uid email; do
  [ -n "${wid:-}" ] || continue
  total=$((total+1))
  if [ "$APPLY" -eq 1 ]; then
    if wiki "INSERT INTO user_external_login (user_id, provider, external_id, meta_info)
             SELECT '$wid', 'basic', '$uid', '{\"source\":\"sso-prebind\"}'
             WHERE NOT EXISTS (SELECT 1 FROM user_external_login e2
                               WHERE e2.user_id = '$wid' AND e2.provider = 'basic')" >/dev/null; then
      bound=$((bound+1))
    else
      errors=$((errors+1)); echo "FAIL wid=$wid uid=$uid" >&2
    fi
  else
    echo "DRY-RUN bind wid=$wid uid=$uid email=$email"
  fi
done <<< "$ROWS"

echo "----"
echo "mode=$([ "$APPLY" -eq 1 ] && echo apply || echo dry-run) candidates=$total bound=$bound errors=$errors skipped=$skipped"
echo "existing_bindings=$(wiki "SELECT COUNT(*) FROM user_external_login WHERE provider='basic'" | tr -d '\n')"

#!/usr/bin/env bash
#
# 部署后自检：确认服务、证书、口令门禁、数据目录、防火墙都真的对
#
# 用法：sudo bash verify.sh miku.icu
#      sudo bash verify.sh 1.2.3.4.sslip.io
#
set -uo pipefail

SITE="${1:-}"
APP_PORT="${APP_PORT:-8787}"
DATA_DIR="${DATA_DIR:-/var/lib/miku/data}"

PASS=0; FAIL=0
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
info() { printf '    %s\n' "$*"; }

echo "=== 1. 服务状态 ==="
for svc in miku caddy; do
  if systemctl is-active --quiet "$svc"; then ok "$svc 运行中"; else bad "$svc 未运行（journalctl -u $svc -n 50）"; fi
done

echo "=== 2. 本机健康检查 ==="
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${APP_PORT}/health" || echo 000)"
if [[ "$CODE" == "200" ]]; then ok "/health → 200"; else bad "/health → ${CODE}（应用没起来）"; fi

echo "=== 3. 访问口令是否生效（这条最重要）==="
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${APP_PORT}/api/meta" || echo 000)"
if [[ "$CODE" == "401" ]]; then
  ok "未登录访问 /api/meta → 401（门禁生效）"
elif [[ "$CODE" == "200" ]]; then
  bad "未登录就能访问 /api/meta → 200（ACCESS_TOKEN 没设，等于公网裸奔）"
else
  bad "/api/meta → ${CODE}（预期 401）"
fi

echo "=== 4. 数据目录 ==="
if [[ -d "$DATA_DIR" ]]; then
  ok "存在：$DATA_DIR"
  if sudo -u miku test -w "$DATA_DIR" 2>/dev/null; then ok "miku 用户可写"; else bad "miku 用户不可写（chown -R miku:miku $DATA_DIR）"; fi
  info "当前文件数：$(find "$DATA_DIR" -type f 2>/dev/null | wc -l)"
else
  bad "不存在：$DATA_DIR"
fi

echo "=== 5. 定时器 ==="
for t in miku-backup.timer miku-keepalive.timer; do
  if systemctl is-enabled --quiet "$t" 2>/dev/null; then ok "$t 已启用"; else bad "$t 未启用"; fi
done
info "最近备份：$(ls -1t /var/backups/miku/data-*.tar.gz 2>/dev/null | head -1 || echo '还没有（明天凌晨会生成）')"

echo "=== 6. 本机防火墙端口 ==="
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  for s in http https; do
    if firewall-cmd --query-service="$s" >/dev/null 2>&1; then ok "firewalld 放行 $s"; else bad "firewalld 未放行 $s"; fi
  done
elif command -v ufw >/dev/null 2>&1; then
  info "$(ufw status | grep -E '80|443' | tr '\n' ' ' || echo 'ufw 无 80/443 规则')"
else
  info "无 firewalld/ufw"
fi

echo "=== 7. 外网与证书 ==="
if [[ -z "$SITE" ]]; then
  info "没给域名参数，跳过外网检查"
else
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${SITE}/health" || echo 000)"
  if [[ "$CODE" == "200" ]]; then ok "https://${SITE}/health → 200"; else bad "https://${SITE}/health → ${CODE}（证书未签发 / DNS 未生效 / 安全列表没放行 443）"; fi

  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${SITE}/api/meta" || echo 000)"
  if [[ "$CODE" == "401" ]]; then ok "外网未登录 → 401"; else bad "外网未登录 → ${CODE}（预期 401）"; fi

  if command -v openssl >/dev/null 2>&1; then
    EXP="$(echo | timeout 15 openssl s_client -servername "$SITE" -connect "${SITE}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
    [[ -n "$EXP" ]] && ok "证书到期：$EXP" || bad "取不到证书（签发可能还在进行，等 1–2 分钟再看）"
  fi
fi

echo "=== 8. 磁盘 ==="
info "$(df -h / | tail -1 | awk '{print "根分区已用 "$5"，剩余 "$4}')"

echo
echo "──────────────────────────────"
echo " 通过 ${PASS} 项 · 失败 ${FAIL} 项"
[[ "$FAIL" -eq 0 ]] && echo " 全部通过 ✓" || echo " 有失败项，按上面提示逐条处理"
exit $([[ "$FAIL" -eq 0 ]] && echo 0 || echo 1)

#!/usr/bin/env bash
#
# Miku AI创作平台 · Oracle Cloud 一键部署
#
# 用法（在实例上以 root 运行）：
#   sudo bash setup.sh --domain miku.icu --repo https://github.com/你/仓库.git
#   sudo bash setup.sh --repo https://github.com/你/仓库.git          # 先不买域名，用 sslip.io
#
# 做的事：装 Node 22 → 建系统用户 → 拉代码 → 写环境文件（含随机口令）
#        → 装 systemd 服务 → 装 Caddy（自动 HTTPS）→ 开防火墙 → 设备份/保活定时器
#
# 幂等：重复运行不会重复创建用户/覆盖已有口令（口令只在不存在时生成一次）
#
set -euo pipefail

# ── 默认参数 ────────────────────────────────────────────────
DOMAIN=""
REPO=""
APP_DIR="/opt/miku"
DATA_DIR="/var/lib/miku/data"
BACKUP_DIR="/var/backups/miku"
ENV_DIR="/etc/miku"
ENV_FILE="${ENV_DIR}/miku.env"
APP_USER="miku"
APP_PORT="8787"
NODE_VERSION="${NODE_VERSION:-22.22.2}"
ACME_EMAIL=""

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "未知参数：$1（用 --help 看用法）" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "请用 root 运行：sudo bash $0 ..."
[[ -n "$REPO" ]] || [[ -f "${APP_DIR}/src/server.js" ]] || \
  die "还没代码：请用 --repo <git 地址>，或先把代码放到 ${APP_DIR}"

# ── 系统识别 ────────────────────────────────────────────────
MACHINE="$(uname -m)"
case "$MACHINE" in
  x86_64)  NODE_ARCH="x64";   CADDY_ARCH="amd64" ;;
  aarch64|arm64) NODE_ARCH="arm64"; CADDY_ARCH="arm64" ;;
  *) die "不支持的架构：$MACHINE" ;;
esac

if command -v apt-get >/dev/null 2>&1; then PKG="apt"
elif command -v dnf >/dev/null 2>&1; then PKG="dnf"
elif command -v yum >/dev/null 2>&1; then PKG="yum"
else die "没找到 apt/dnf/yum，未知发行版"
fi
log "系统：${PKG} · 架构：${MACHINE}"

pkg_install() {
  case "$PKG" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get update -qq
         DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" ;;
    dnf) dnf install -y -q "$@" ;;
    yum) yum install -y -q "$@" ;;
  esac
}

# ── 基础工具 ────────────────────────────────────────────────
log "安装基础工具"
pkg_install curl tar xz ca-certificates git openssl >/dev/null

# ── Node.js（官方 tarball，不引第三方源）────────────────────
if ! /usr/local/bin/node --version >/dev/null 2>&1; then
  log "安装 Node.js v${NODE_VERSION}（${NODE_ARCH}）"
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
    -o "${TMP}/node.tar.xz" || die "Node 下载失败：检查出网或改 NODE_VERSION"
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "${TMP}/node.tar.xz" -C /usr/local/lib/nodejs
  NODE_HOME="/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
  ln -sf "${NODE_HOME}/bin/node" /usr/local/bin/node
  ln -sf "${NODE_HOME}/bin/npm"  /usr/local/bin/npm
  ln -sf "${NODE_HOME}/bin/npx"  /usr/local/bin/npx
  rm -rf "$TMP"
fi
log "Node $(/usr/local/bin/node --version)"

# ── 系统用户与目录 ──────────────────────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "创建系统用户 ${APP_USER}"
  useradd --system --create-home --home-dir "/var/lib/${APP_USER}" --shell /usr/sbin/nologin "$APP_USER" 2>/dev/null || \
  useradd --system --create-home --home-dir "/var/lib/${APP_USER}" --shell /sbin/nologin "$APP_USER"
fi
if ! id caddy >/dev/null 2>&1; then
  log "创建系统用户 caddy"
  useradd --system --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy 2>/dev/null || \
  useradd --system --create-home --home-dir /var/lib/caddy --shell /sbin/nologin caddy
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" "$ENV_DIR" /etc/caddy /var/lib/caddy /var/log/caddy

# ── 代码 ────────────────────────────────────────────────────
if [[ -n "$REPO" ]]; then
  if [[ -d "${APP_DIR}/.git" ]]; then
    log "更新代码（git pull）"
    git -C "$APP_DIR" pull --ff-only
  else
    log "克隆代码到 ${APP_DIR}"
    # 目录非空时 git clone 会失败，这里先判空
    if [[ -n "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]]; then
      die "${APP_DIR} 非空且不是 git 仓库，请先清空或换 --app-dir"
    fi
    git clone --depth 1 "$REPO" "$APP_DIR"
  fi
fi
[[ -f "${APP_DIR}/src/server.js" ]] || die "代码不完整：没找到 ${APP_DIR}/src/server.js"
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chown -R caddy:caddy /var/lib/caddy /var/log/caddy
chmod +x "${APP_DIR}/deploy/oracle/"*.sh 2>/dev/null || true

# ── 环境文件（口令只生成一次）──────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  log "生成 ${ENV_FILE}"
  # 用 -hex 而不是 base64|tr|head：后者在 set -o pipefail 下 head 提前关闭管道会给
  # tr 发 SIGPIPE，整个脚本会被 set -e 干掉（这个坑很隐蔽）
  ACCESS_TOKEN="$(openssl rand -hex 16)"
  {
    echo "# 由 setup.sh 生成：$(date -Is)"
    echo "NODE_ENV=production"
    echo "HOST=127.0.0.1"
    echo "PORT=${APP_PORT}"
    echo "DATA_DIR=${DATA_DIR}"
    echo "ACCESS_TOKEN=${ACCESS_TOKEN}"
    echo "USE_MOCK=1"
    echo "CRAWL_USE_MOCK=1"
    echo "RATE_LIMIT_WINDOW_MS=60000"
    echo "RATE_LIMIT_MAX=300"
    echo "RATE_LIMIT_AUTH_MAX=10"
    echo "LANGSMITH_TRACING=false"
    echo "LANGCHAIN_TRACING_V2=false"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  NEW_TOKEN=1
else
  log "环境文件已存在，保留原口令"
  NEW_TOKEN=0
fi
ACCESS_TOKEN="$(grep -E '^ACCESS_TOKEN=' "$ENV_FILE" | cut -d= -f2- || true)"

# systemd 的 EnvironmentFile 不认引号包裹的空值组合问题，校验一下
[[ -n "$ACCESS_TOKEN" ]] || die "ACCESS_TOKEN 为空——公网裸奔，拒绝继续。请检查 $ENV_FILE"

# ── 应用服务 ────────────────────────────────────────────────
log "安装 systemd 服务"
install -m 644 "${APP_DIR}/deploy/oracle/miku.service" /etc/systemd/system/miku.service
systemctl daemon-reload
systemctl enable miku.service >/dev/null
systemctl restart miku.service

# 等它起来（最多 20 秒）
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null \
  || die "应用没起来，看日志：journalctl -u miku -n 50 --no-pager"
log "应用已在本机 ${APP_PORT} 端口就绪"

# ── Caddy（自动 HTTPS）─────────────────────────────────────
if ! /usr/local/bin/caddy version >/dev/null 2>&1; then
  log "安装 Caddy（${CADDY_ARCH}）"
  curl -fsSL -o /usr/local/bin/caddy \
    "https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}" || die "Caddy 下载失败"
  chmod +x /usr/local/bin/caddy
fi
log "Caddy $(/usr/local/bin/caddy version | head -1)"

# 没给域名就退回到 sslip.io（公网 IP 直接可用，先跑通再买域名）
if [[ -z "$DOMAIN" ]]; then
  PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  [[ -n "$PUBLIC_IP" ]] || die "拿不到公网 IP；请加 --domain 指定域名"
  SITE_ADDRESS="${PUBLIC_IP}.sslip.io"
  warn "未指定域名，暂用 ${SITE_ADDRESS}（免费、可直接拿证书；买到域名后重跑 --domain 即可换）"
else
  SITE_ADDRESS="$DOMAIN"
fi

log "写 Caddyfile：${SITE_ADDRESS}"
sed -e "s|{{SITE_ADDRESS}}|${SITE_ADDRESS}|g" \
    -e "s|{{ACME_EMAIL}}|${ACME_EMAIL}|g" \
    "${APP_DIR}/deploy/oracle/Caddyfile.example" > /etc/caddy/Caddyfile
# 没填邮箱时必须把整行删掉：留成 "email " 是非法配置，Caddy 会直接启动失败
if [[ -z "$ACME_EMAIL" ]]; then
  sed -i '/^[[:space:]]*email[[:space:]]*$/d' /etc/caddy/Caddyfile
fi
chown root:caddy /etc/caddy/Caddyfile
chmod 640 /etc/caddy/Caddyfile

install -m 644 "${APP_DIR}/deploy/oracle/caddy.service" /etc/systemd/system/caddy.service
systemctl daemon-reload
systemctl enable caddy.service >/dev/null
systemctl restart caddy.service

# ── 防火墙（本机层）────────────────────────────────────────
log "放行 80/443（本机防火墙层）"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http  >/dev/null
  firewall-cmd --permanent --add-service=https >/dev/null
  firewall-cmd --reload >/dev/null
  log "firewalld 已放行 http/https"
elif command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  log "ufw 已放行 80/443"
else
  warn "没检测到 firewalld/ufw，跳过本机防火墙配置"
fi
warn "别忘了 OCI 控制台那一层：VCN → Security List / NSG 也要放行 80 与 443，否则外网仍打不开"

# ── 备份与保活 ─────────────────────────────────────────────
log "安装备份与保活定时器"
cat > /usr/local/bin/miku-backup.sh <<BACKUP
#!/usr/bin/env bash
set -euo pipefail
STAMP="\$(date +%Y%m%d-%H%M)"
mkdir -p "${BACKUP_DIR}"
tar -czf "${BACKUP_DIR}/data-\${STAMP}.tar.gz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
# 只留最近 7 份
ls -1t "${BACKUP_DIR}"/data-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "backup ok: ${BACKUP_DIR}/data-\${STAMP}.tar.gz"
BACKUP
chmod +x /usr/local/bin/miku-backup.sh

cat > /usr/local/bin/miku-keepalive.sh <<KEEP
#!/usr/bin/env bash
set -euo pipefail
# 1) 网络活跃：访问自己的健康检查（走本机，不依赖证书）
curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/health" >/dev/null || true
# 2) 有界 CPU 峰值（10 秒），制造非零 CPU 分位
timeout 10 bash -c 'while :; do :; done' 2>/dev/null || true
exit 0
KEEP
chmod +x /usr/local/bin/miku-keepalive.sh

install -m 644 "${APP_DIR}/deploy/oracle/miku-backup.service"    /etc/systemd/system/
install -m 644 "${APP_DIR}/deploy/oracle/miku-backup.timer"      /etc/systemd/system/
install -m 644 "${APP_DIR}/deploy/oracle/miku-keepalive.service" /etc/systemd/system/
install -m 644 "${APP_DIR}/deploy/oracle/miku-keepalive.timer"   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now miku-backup.timer >/dev/null
systemctl enable --now miku-keepalive.timer >/dev/null

# ── 收尾 ────────────────────────────────────────────────────
sleep 3
echo
echo "──────────────────────────────────────────────"
echo " 应用：  http://127.0.0.1:${APP_PORT}/health  （本机）"
echo " 站点：  https://${SITE_ADDRESS}"
if [[ "$NEW_TOKEN" -eq 1 ]]; then
  echo " 口令：  ${ACCESS_TOKEN}"
  echo "        ↑ 只显示这一次，也已写入 ${ENV_FILE}"
else
  echo " 口令：  沿用 ${ENV_FILE} 里已有的（用 sudo grep ACCESS_TOKEN ${ENV_FILE} 查看）"
fi
echo "──────────────────────────────────────────────"
echo "证书签发需要几十秒到两分钟，之后："
echo "  curl -I https://${SITE_ADDRESS}/health"
echo
echo "自检：sudo bash ${APP_DIR}/deploy/oracle/verify.sh ${SITE_ADDRESS}"
if [[ -z "$DOMAIN" ]]; then
  echo
  warn "现在是临时域名。买到域名后：把 A 记录指向本机公网 IP，然后重跑"
  warn "  sudo bash $0 --domain 你的域名"
fi

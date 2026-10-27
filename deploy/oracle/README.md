# 部署到 Oracle Cloud 永久免费 VM（拿自己的域名 + 数据不丢）

**目标状态**：`https://你的域名` 可访问，数据存在 200GB 持久盘上，重启不丢，**年度成本只有域名费**。

| 项 | 成本 | 说明 |
| --- | --- | --- |
| 虚拟机 | **¥0** | Always Free：ARM 2 OCPU / 12GB 或 2 台 AMD 微型机；200GB 块存储；10TB/月流量 |
| HTTPS 证书 | **¥0** | Caddy 自动申请 Let's Encrypt |
| 域名 | **¥1–5 首年**，之后 ¥10–30/年 | `.icu` / `.cloud` / `.tech` 首年 1 元 |
| **合计** | **约 ¥10–30/年** | |

> 对比 Render 免费档：那边文件系统是临时的，重启即清空。这里是真的持久盘。

---

## 0. 五分钟快速路径

在实例上（前提：代码已推到 GitHub）：

```bash
# 1) 先不买域名，用 sslip.io 直接跑通
sudo bash setup.sh --repo https://github.com/你/仓库.git

# 2) 它最后会打印 https://<公网IP>.sslip.io 和访问口令

# 3) 买到域名后（A 记录指向本机 IP），换成正式域名
sudo bash setup.sh --domain miku.icu

# 4) 自检
sudo bash verify.sh miku.icu
```

下面是要点说明与坑。

---

## 1. 创建实例

Oracle 控制台 → Compute → Instances → **Create instance**：

| 项 | 选什么 |
| --- | --- |
| Image | **Ubuntu 22.04/24.04**（脚本最熟）或 Oracle Linux 8/9（一样支持） |
| Shape | 优先 `VM.Standard.A1.Flex`（ARM，2 OCPU / 12GB）；抢不到就用 `VM.Standard.E2.1.Micro`（AMD，1GB） |
| Boot volume | 默认 47GB 即可（Always Free 总额 200GB） |
| SSH key | 上传你的公钥，**这个丢了就进不去，务必保存** |
| 区域 | 必须是你的**主区域（home region）**，Always Free 只在那生效 |

**ARM 抢不到怎么办**：换可用性域（Availability Domain）重试；或先用 AMD 微型机（1GB 内存跑这个项目够用，Node 内存占用很小）。

---

## 2. 两层防火墙（最常见的坑，必须都做）

Oracle 有**两道**防火墙，只开一层必然打不开：

### 第一层：OCI 控制台（云平台层）
**Networking → Virtual Cloud Networks → 你的 VCN → Security Lists → Default Security List → Add Ingress Rules**

| Stateless | Source | Protocol | Destination Port |
| --- | --- | --- | --- |
| No | `0.0.0.0/0` | TCP | **80** |
| No | `0.0.0.0/0` | TCP | **443** |

> 如果用的是 NSG（Network Security Group）而不是 Security List，就在 NSG 里加同样的规则。

### 第二层：实例内部（系统防火墙）
`setup.sh` 会自动处理（firewalld / ufw 都认）。手动的话：

```bash
# Oracle Linux
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload

# Ubuntu
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

> ⚠️ 只做第一层：外网仍打不开。只做第二层：一样打不开。**两层都要。**

---

## 3. 域名（可以先跳过）

**先跑通再买**：不给 `--domain` 时，脚本会用 `<公网IP>.sslip.io` —— 这是一个免费、能正常签发证书的域名，用来验证链路。

**买好域名后**：

1. 在域名商处加 **A 记录**：`@ → 你的公网 IPv4`
2. （可选）`www` 也加一条
3. 等 DNS 生效：`dig +short 你的域名` 应返回你的 IP
4. 重跑 `sudo bash setup.sh --domain 你的域名`

**如果域名托管在 Cloudflare**：首次签证书时把那条记录改成**灰色云朵（DNS only）**。橙云（代理）会拦截 Let's Encrypt 的 HTTP-01 校验，导致签发失败。签下来之后想开橙云也可以，但要改成 Full (strict) 模式。

---

## 4. 代码怎么上去

**方式 A（推荐）**：先推到 GitHub，实例上 `git clone`

```bash
sudo bash setup.sh --repo https://github.com/你/仓库.git
```

**方式 B**：从本机 scp 整个目录

```bash
scp -r ./01_完整工程 opc@<公网IP>:/tmp/miku
# 实例上：
sudo mkdir -p /opt/miku && sudo cp -r /tmp/miku/. /opt/miku/
sudo bash /opt/miku/deploy/oracle/setup.sh        # 不带 --repo，复用已有代码
```

---

## 5. 部署脚本做了什么

```
装 Node 22（官方 tarball，自动识别 x86_64 / aarch64）
  → 建系统用户 miku / caddy
  → 拉代码到 /opt/miku
  → 生成 /etc/miku/miku.env（含随机 32 位 ACCESS_TOKEN，权限 600）
  → 装 systemd 服务 miku.service（加固：ProtectSystem=strict，只放开数据目录）
  → 装 Caddy，写 /etc/caddy/Caddyfile（自动 HTTPS，反代 127.0.0.1:8787）
  → 放行本机防火墙 80/443
  → 装两个定时器：每日备份、每小时保活
```

**关键设计**（都是为了少踩坑）：

| 决定 | 为什么 |
| --- | --- |
| 数据在 `/var/lib/miku/data`，不在代码目录 | `git pull` 更新代码不会覆盖作品 |
| 应用只听 `127.0.0.1:8787` | 外网只能经 Caddy 进，应用端口不直接暴露 |
| 用 systemd `EnvironmentFile` 注入环境变量 | **本项目零依赖、不会自动读 `.env`**，靠文件放同目录是无效的 |
| Node 走官方 tarball | 不引 NodeSource/copr 等第三方源，ARM 也能用 |
| Caddy 静态二进制 | 各发行版仓库里的 Caddy 版本很旧，静态包跨发行版一致 |

---

## 6. 日常运维

```bash
# 更新代码并重启
cd /opt/miku && sudo git pull && sudo systemctl restart miku

# 改访问口令（改完旧 cookie 立刻失效，所有人要重新登录）
sudo sed -i "s|^ACCESS_TOKEN=.*|ACCESS_TOKEN=新的口令|" /etc/miku/miku.env
sudo systemctl restart miku

# 看日志
journalctl -u miku -f          # 应用
journalctl -u caddy -f         # 证书与代理

# 手动备份一次
sudo /usr/local/bin/miku-backup.sh
ls -lt /var/backups/miku | head -3

# 从备份恢复
sudo systemctl stop miku
sudo tar -xzf /var/backups/miku/data-YYYYMMDD-HHMM.tar.gz -C /var/lib/miku
sudo chown -R miku:miku /var/lib/miku/data
sudo systemctl start miku

# 换域名
sudo bash /opt/miku/deploy/oracle/setup.sh --domain 新域名
```

---

## 7. 三个必须知道的坏消息

### ① 免费机可能被回收
Oracle 判定"空闲"的条件：**7 天内** CPU 95 分位 < 20%、网络 < 20%、内存 < 20%（A1 才看内存）。
个人小站几乎不可能达到 20% CPU 使用率。

**保活定时器只能降低"完全静默"的概率，不能保证不被回收。** 我不是在给你虚假安全感——真正的保险是：
- 每日备份（脚本已装）**并且定期把 `/var/backups/miku` 拷到别处**
- 代码在 GitHub，机器没了重跑 `setup.sh` 十分钟就能重建

### ② 国内访问会慢
境外节点（新加坡/首尔）到国内通常 100–250ms，丢包率看线路。这不是配置问题。
如果以后换到国内服务器，**就必须 ICP 备案**（个人可备，1–3 周）。境外实例不需要备案。

### ③ ARM 容量经常抢不到
`out of host capacity` 表示该区域暂时没有免费 ARM 资源。不要升级付费，先换可用性域或改用 AMD 微型机。

---

## 8. 证书签发失败怎么查

```bash
journalctl -u caddy -n 50 --no-pager | grep -iE "error|acme|challenge"
```

按顺序排查：

| 症状 | 原因 |
| --- | --- |
| `connection refused` | 80 端口没通 → 两层防火墙 |
| `dns problem` / `no such host` | A 记录没生效或指错 IP → `dig +short 域名` |
| `unauthorized` / `403` | Cloudflare 橙云拦截 → 改 DNS only |
| 一直 `trying again` | 域名拼错，或 IP 变了（实例重启换公网 IP） |

实在卡住：`sudo systemctl restart caddy` 再看日志；证书文件在 `/var/lib/caddy/.local/share/caddy/certificates/`。

---

## 9. 这份部署件**没有**验证过什么（诚实说明）

- 脚本只在本机做了 `bash -n` 语法检查，**没有在真实 Oracle 实例上跑过**（我没有你的云账号，也不该替你开机器）
- Node/Caddy 的下载地址依赖官方 CDN 可达性；如果实例出网受限，需要换镜像源
- 没有验证过 ARM（aarch64）分支的实际执行（架构判断逻辑是按官方命名写的）
- Oracle 的免费政策与空闲回收判定会变，以官方文档为准

**第一次跑建议**：先只在实例上跑到 `curl http://127.0.0.1:8787/health` 通，再管域名和证书。分两步排错比一次全上省时间。

---

## 10. 文件清单

| 文件 | 作用 |
| --- | --- |
| `setup.sh` | 一键部署（幂等，可重复跑） |
| `verify.sh` | 部署后 8 项自检 |
| `miku.service` | 应用 systemd 单元（含安全加固） |
| `caddy.service` | Caddy 单元 |
| `Caddyfile.example` | 反代 + 自动 HTTPS 模板 |
| `miku-backup.service` / `.timer` | 每日备份数据目录，留 7 份 |
| `miku-keepalive.service` / `.timer` | 每小时保活（降低回收概率，不保证） |
| `env.production.example` | 生产环境变量参考（脚本会自动生成实际文件） |

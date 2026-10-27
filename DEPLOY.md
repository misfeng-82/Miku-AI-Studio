# 部署到 Render（拿到公网域名）

本文是从零到「别人能打开你的域名」的完整步骤。全程不需要买服务器。

---

## 0. 先明确三件事（避免部署完才发现）

| 事项 | 现实 |
| --- | --- |
| **数据会丢** | Render 免费实例的文件系统是**临时的**：重启、重新部署、实例休眠后重置，`data/` 里的作品会清空。适合演示，不适合存创作 |
| **要设访问口令** | 本应用没有账号体系。不设 `ACCESS_TOKEN`，任何拿到域名的人都能改设置、删作品 |
| **内容是样本** | 默认 `USE_MOCK=1`，生成的是内置样本稿，不是真模型产出（省钱且不上传你的 Key） |

---

## 1. 推到 GitHub

在项目根目录（`01_完整工程/`）执行：

```bash
# 仓库已初始化并有一次提交，确认没有敏感文件再推
node scripts/secretscan.mjs          # 必须显示「未发现明文密钥」
git status --short

# 在 GitHub 上新建一个空仓库（不要勾选 README/.gitignore），然后：
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> `data/` 与 `.env` 已在 `.gitignore` 里，不会被推上去。**不要用 `git add -f` 强行添加。**
> 推之前如果 `secretscan` 报错，先处理再推——一旦推到公开仓库，历史里的密钥就只能靠吊销解决。

---

## 2. 在 Render 建服务

### 方式 A：Blueprint（用仓库里的 `render.yaml`，最省事）

1. 登录 Render → **New** → **Blueprint**
2. 选你刚推的仓库 → **Apply**
3. Render 会自动创建 Web Service，读 `render.yaml` 里的配置

### 方式 B：手动建

**New** → **Web Service** → 选仓库，然后填：

| 字段 | 值 |
| --- | --- |
| Runtime | Node |
| Region | Singapore（离得近） |
| Build Command | `echo "no dependencies to install"` |
| Start Command | `node src/server.js` |
| Health Check Path | `/health` |
| Instance Type | Free |

---

## 3. 填环境变量（关键）

在服务的 **Environment** 页加：

| Key | Value | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 不设的话静态资源不缓存、日志会带堆栈 |
| `ACCESS_TOKEN` | 见下 | **必填**，访问口令 |
| `USE_MOCK` | `1` | 离线样本引擎，零费用 |
| `CORS_ORIGINS` | `https://你的域名` | 域名分配后再填（同源访问其实可以不填） |

生成一个够强的随机口令：

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

> 这个口令就是「谁能用你网站」的唯一门槛。别用 `123456`，别写进代码或 `render.yaml`
> （`render.yaml` 里已经标了 `sync: false`，它只会从控制台取值）。

---

## 4. 部署完成后验证

Render 会给你一个 `https://<name>.onrender.com` 域名。按顺序验：

```bash
# 1) 探活（必须 200，且不需要口令）
curl -s -o /dev/null -w "%{http_code}\n" https://你的域名/health

# 2) 未登录时接口应被挡（应 401）
curl -s -o /dev/null -w "%{http_code}\n" https://你的域名/api/meta

# 3) 用口令登录，应 200 并下发 cookie
curl -s -i -X POST -H "content-type: application/json" \
  -d '{"token":"你的口令"}' https://你的域名/api/auth | head -5
```

浏览器里：打开域名 → 应看到「需要访问口令」页 → 输入口令 → 进入工作台。

---

## 5. 这个部署形态的边界

- **单口令 = 共享账号**：所有用口令进来的人看到同一份数据，能互相删对方的东西
- **免费实例会休眠**：15 分钟无请求就睡，下次访问要等 30–60 秒冷启动
- **文件系统临时**：见第 0 节。真要保存作品，得挂 Render Disk（付费）或改装 SQLite
- **限流是进程内的**：`RATE_LIMIT_MAX=300` 是每实例每分钟；多实例部署时各自计数

---

## 6. 想接真模型

在 Render 环境变量里加：

```
USE_MOCK=0
LLM_BASE_URL=https://<你的服务商>/v1
LLM_API_KEY=<你的 Key>
LLM_MODEL=<模型名>
```

⚠️ **注意**：Key 存在服务端，所有访客共用你的额度。要么只给自己用，要么换成按用户配额的服务商。
另外 `USE_MOCK=0` 后每次生成都会产生真实费用，而限流只防滥用、不防正常使用。

---

## 7. 常见故障

| 现象 | 原因与处理 |
| --- | --- |
| 部署失败、日志说找不到 `src/server.js` | 仓库根目录传错了（应该是 `01_完整工程/` 的内容，不是外层父目录） |
| 打开是白屏，控制台 401 | 没设或设错 `ACCESS_TOKEN`，登录页没种上 cookie；清 cookie 重试 |
| `/health` 200 但页面打不开 | 检查 `NODE_ENV=production` 是否设了；以及静态文件是否在仓库里 |
| 一访问就 429 | 触发限流。调大 `RATE_LIMIT_MAX`，或等 1 分钟 |
| 忘记口令 | 在 Environment 改 `ACCESS_TOKEN` 即立刻生效（旧 cookie 失效，需要重新登录） |
| 改了代码想上线 | `git push` 后 Render 自动部署（`autoDeployTrigger: commit`）；也可在控制台手动 Deploy |

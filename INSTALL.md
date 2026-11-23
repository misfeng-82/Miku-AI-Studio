# 安装指引 · Miku AI创作平台

这份文档只讲「怎么把它装到自己电脑上、怎么第一次跑起来」。功能怎么用看 [README.md](README.md)。

---

## 0. 三种获取方式

| 方式 | 适合谁 | 拿到什么 |
| --- | --- | --- |
| **安装包（推荐）** | 只想用，不改代码 | `MikuAI-Studio-1.0.1-安装包.zip` → 解压后双击 `安装.bat` |
| 源码运行 | 要改功能 / 二次开发 | `git clone` + `npm ci` + `node src/server.js` |
| 在线体验 | 只想看看界面 | 仓库主页的演示站地址（功能受浏览器限制，画布出图建议用桌面版） |

**安装包下载**：[MikuAI-Studio-1.0.1-安装包.zip](https://aka.doubaocdn.com/s/I9ZhvhVZcU)（80.2 MB）

---

## 1. 桌面版安装（Windows）

### 1.1 先关掉旧版本

安装会覆盖程序文件。如果 MikuAI Studio 正在运行，`node.exe` 占着文件，覆盖会失败。

- 关掉软件窗口
- 任务管理器里如果还有 `node.exe`（工作目录是 `MikuAI-Studio`），一并结束

### 1.2 解压 + 安装

1. 解压 `MikuAI-Studio-1.0.1-安装包.zip`，得到 `MikuAI-Studio-1.0.1/`
2. 进入该文件夹，**双击 `安装.bat`**
3. 它会做三件事：
   - 把程序复制到 `%LOCALAPPDATA%\MikuAI-Studio`
   - 在桌面生成「MikuAI Studio」快捷方式（图标 `miku.ico`）
   - 遇到已存在的目录只覆盖程序文件，**不动 `data\`**

> 覆盖安装 = 升级。你的画布、剧本、主体资产图、历史版本都留在 `data\`，不会被清掉。

### 1.3 第一次启动

从桌面快捷方式打开。启动后：

| 入口 | 地址 | 说明 |
| --- | --- | --- |
| 主工作台 | `http://127.0.0.1:8788` | 21 个功能入口（剧本、漫剧工作台、资产库…） |
| 无限画布 | `http://127.0.0.1:5181/canvas/` | 节点式出图 / 出片 |

首次启动会弹浏览器窗口；端口被占用时启动失败，见第 5 节。

### 1.4 接模型（不接就不能生成）

右上角「接 API」填三项：

- **Base URL**：任何 OpenAI 兼容网关，如 `https://api.deepseek.com/v1`
- **模型名**：网关支持的模型
- **Key**：你自己的 Key

画布出图 / 出片另有一套配置（AutoDL 令牌 + ComfyUI 工作流），在画布的「接 API」里填。

---

## 2. 源码运行（开发用）

```bash
git clone https://github.com/misfeng-82/Miku-AI-Studio.git
cd Miku-AI-Studio
npm ci
node src/server.js      # 主服务 8787，无限画布 5180
```

要求 Node 20+。工程版与桌面版端口不同（8787/5180 vs 8788/5181），可以同时跑，互不冲突。

---

## 3. 目录说明

```
%LOCALAPPDATA%\MikuAI-Studio\
├─ MikuAI-Studio.exe      桌面壳（WinForms + WebView2）
├─ node.exe               内置 Node，不依赖系统环境
├─ src\                   主服务
├─ public\                主工作台前端
├─ canvas\                无限画布
│  └─ data\               ★ 你的数据：画布 json、资产图、上传图
└─ data\                  ★ 你的数据：剧本、作品、配置
```

**备份**：只需要拷 `data\` 和 `canvas\data\`。
**迁机**：装好新版，把这两个目录覆盖过去即可。

---

## 4. 更新与卸载

**更新**：下载新安装包 → 关软件 → 双击 `安装.bat`。数据自动保留。

**卸载**：目录里的 `卸载.bat`，或手动删 `%LOCALAPPDATA%\MikuAI-Studio` 并删桌面快捷方式。删除前先备份两个 `data\`。

---

## 5. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `安装.bat` 报「安装失败」 | 软件还在运行，文件被占用 | 关软件 + 结束 `node.exe` 再装 |
| 启动后浏览器打不开 8788 | 端口被别的程序占用 | 结束占用进程；或改 `Start.bat` 里的端口 |
| 画布一片空白 | 画布服务没起来（5181 未监听） | 看启动窗口报错；确认 `canvas\` 目录完整 |
| 出图报「余额不足」 | AutoDL 账户欠费 | 控制台充值后重试 |
| 出片报「模型没就绪」 | ComfyUI 工作流 / 分组令牌没配 | 画布「接 API」里核对令牌与工作流 |
| 漫剧工作台整页空白 | 前端缺文件（如 `views\drama-asset-prompt.js`） | 用安装包重新覆盖，别单独拷个别 js |
| 杀软报毒 | 自带 `node.exe` 被误判 | 加入信任；文件来自本仓库 Release / 安装包 |

---

## 6. 校验你拿到的是不是正版安装包

- 文件名：`MikuAI-Studio-1.0.1-安装包.zip`
- 大小：约 **80.2 MB**
- 解压后根目录名：`MikuAI-Studio-1.0.1`
- 内含 `安装.bat`、`MikuAI-Studio\MikuAI-Studio.exe`、`MikuAI-Studio\node.exe`

版本号对不上就不要装，回仓库要最新链接。

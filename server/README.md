# Lingora 账户后端

零 npm 依赖的 Node HTTP 服务。它同时干两件事：

1. 托管前端静态文件（`index.html` / `login.html` / `register.html` / `app.html` / `assets/**`）
2. 提供 `/api/*`：图形验证码、验证码下发、登录、会话、退出

**为什么前端和后端做成同源**：会话用 `HttpOnly` Cookie 承载，同源才能天然生效 ——
不需要跨域放行、不需要 CORS 白名单，也没有 `SameSite` 的灰色地带。
同源也让页面探活（`/api/health`）能直接判断「在线 / 离线」而无需处理跨域。

> **关于登录门禁**：按需求已撤除。工具页 `/app.html` 是公开页面，不登录也能打开、
> 也能正常使用；登录只影响顶栏是否显示账号与「退出登录」按钮，不拦截任何请求。

---

## 快速开始

```bash
# 默认 http://127.0.0.1:8787
node server/app.js

# 换端口
PORT=8080 node server/app.js

# 端到端冒烟测试（覆盖 71 项：接口、限流、图形码、Cookie 属性、静态服务）
node server/test/smoke.js
```

启动后：

| 地址 | 说明 |
| --- | --- |
| `/` | 落地页 |
| `/login.html` | 登录页（先过图形码，再免密登录，成功后回 `?next=` 指定页） |
| `/register.html` | 注册页（与登录页同一套接口） |
| `/app.html` | 语音转写工具页 —— **公开可用，无需登录** |
| `/app` | `/app.html` 的短链接别名（纯跳转，无鉴权） |

---

## 接口契约

所有接口都返回 JSON，且都带 `ok` 字段。错误响应形如
`{ "ok": false, "error": "<机器可读的错误码>" }`，前端负责把错误码翻译成人话。

### `GET /api/health`
部署自检。返回当前进程的投递通道状态。

```json
{ "ok": true, "service": "lingora-account", "smtp": false, "sms": false, "demoMode": true }
```

### `GET /api/captcha/new`
申请一张图形验证码。

```json
{ "ok": true, "captchaId": "9d3d…", "imageUrl": "/api/captcha/9d3d….svg", "expiresIn": 300 }
```

### `GET /api/captcha/<id>.svg`
返回图形验证码图片（**实际是 PNG 字节流**，路径后缀保留 `.svg` 只是为了兼容早期版本）。

> 早期版本用 SVG `<text>` 画字符，答案会明文写进 SVG 源码，任何人正则一下就能提取。
> 现在改用**手写的最小 PNG 编码器**（`lib/captcha.js`），把字符画成像素位图：
> 5×7 点阵字模 + 4 倍超采样抗锯齿 + 波形扭曲 + 干扰线 + 噪点。
> 答案只存在于服务端内存，客户端拿到的是纯像素。

### `POST /api/code/send`
校验图形码 → 限流 → 投递 6 位一次性验证码。

```jsonc
// 请求
{ "captchaId": "…", "captchaText": "K7M2", "channel": "phone", "target": "13800138000", "region": "cn" }

// 成功
{
  "ok": true,
  "requestId": "…",          // 登录时带回
  "channel": "phone",
  "masked": "138****8000",   // 脱敏后的目标
  "deliveredBy": "smtp",     // smtp | sms | demo
  "ttl": 300,
  "cooldown": 60
}

// 演示通道额外回传（仅 DEMO_MODE=on 时出现）
{ "demo": true, "devCode": "483920" }
```

### `POST /api/login`
校验 6 位码 → 下发会话 Cookie。

```jsonc
// 请求
{ "requestId": "…", "code": "483920", "target": "13800138000",
  "channel": "phone", "region": "cn", "referral": "ABCD1234", "agree": true }

// 成功：响应体 + Set-Cookie
{ "ok": true, "authed": true, "target": "13800138000", "region": "cn", "at": "…" }
Set-Cookie: lingora_sid=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800
```

### `GET /api/session`
查询当前登录态。未登录时 `{ "ok": true, "authed": false }`。

### `POST /api/logout`
销毁会话并清空 Cookie（`Max-Age=0`）。

### 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `CAPTCHA_BAD` | 400 | 图形码填错（失败次数用尽会变 `CAPTCHA_EXPIRED`） |
| `CAPTCHA_EXPIRED` | 400 | 图形码不存在、已过期或已使用 |
| `TARGET_BAD` | 400 | 手机号 / 邮箱格式不合法 |
| `TOO_FAST` | 429 | 同一目标 60 秒内重复请求（带 `retryAfter`） |
| `IP_LIMITED` | 429 | 同一 IP 一小时内超过 20 次 |
| `DELIVER_FAILED` | 502 | 短信网关 / SMTP 投递失败 |
| `NO_CHANNEL` | 503 | 未配投递通道且演示模式已关闭 |
| `CODE_BAD` | 400 | 6 位码错误（带 `triesLeft`） |
| `CODE_EXPIRED` | 400 | 6 位码不存在 / 已过期 / 已使用 |
| `CODE_LOCKED` | 400 | 6 位码错误满 5 次 |
| `TARGET_CHANGED` | 400 | 目标在中途被改，必须重新获取 |
| `NEED_AGREE` | 400 | 未勾选协议 |
| `BAD_ORIGIN` | 403 | Origin 与 Host 不一致 |
| `NO_SUCH_API` | 404 | 未知接口 |

---

## 验证码投递：三级自动降级

```
图形码校验通过
   │
   ├─ 配置了 SMS_WEBHOOK_URL  → POST 到网关          deliveredBy: "sms"
   ├─ 配置了 SMTP_*           → 真实发邮件            deliveredBy: "smtp"
   └─ 都没配 + DEMO_MODE=on   → 服务端演示码          deliveredBy: "demo"
                                （回传给页面显示，校验仍在服务端完成）
```

**关键点：无论走哪条通道，6 位码的生成、保存、过期、限次、校验全在服务端。**
演示通道只是「把码告诉你」的方式变了，不是把校验搬到前端。

---

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `COOKIE_SECURE` | 自动 | `1` 时给 Cookie 加 `Secure`（HTTPS 部署必开） |
| `PUBLIC_ORIGIN` | — | 若以 `https://` 开头会自动启用 `Secure` Cookie |
| `DEMO_MODE` | `on` | `off` 关闭演示通道，此时必须配好 SMTP 或短信网关 |
| `SMTP_HOST` | — | 例如 `smtp.qq.com` |
| `SMTP_PORT` | `465` | `465` 走隐式 TLS，`587` / `25` 走 STARTTLS |
| `SMTP_USER` | — | 登录用户名（通常是完整邮箱） |
| `SMTP_PASS` | — | **邮箱授权码**，不是登录密码 |
| `SMTP_FROM` | 同 `SMTP_USER` | 发件地址 |
| `SMTP_FROM_NAME` | `Lingora` | 发件人显示名 |
| `SMS_WEBHOOK_URL` | — | 短信网关地址，收到 `POST {phone, code, scene}` |
| `SMS_WEBHOOK_TOKEN` | — | 以 `Authorization: Bearer <token>` 发送 |

### 想真的收短信 / 邮件

```bash
# 用 QQ 邮箱发验证码邮件（授权码在 QQ 邮箱设置 → 账户 → IMAP/SMTP 服务里生成）
SMTP_HOST=smtp.qq.com SMTP_PORT=465 \
SMTP_USER=you@qq.com SMTP_PASS=<授权码> \
DEMO_MODE=off \
node server/app.js
```

接短信只需一个能收 `POST {phone, code}` 的地址，把地址填进 `SMS_WEBHOOK_URL`
即可对接任何短信服务商（阿里云、腾讯云、容联等），不需要改代码。

---

## 安全设计

| 项 | 做法 |
| --- | --- |
| 图形码答案 | 只存服务端内存，图片是像素位图，不随响应下发 |
| 6 位码 | 只存 `sha256` 摘要，不存明文；一次性，校验通过即销毁 |
| 会话令牌 | 只存 `sha256(token)`；Cookie 为 `HttpOnly` + `SameSite=Lax` |
| 暴力破解 | 图形码错满 5 次作废；6 位码错满 5 次作废 |
| 短信轰炸 | 同目标 60 秒冷却 + 同 IP 每小时 20 次 |
| 跨站请求 | `SameSite=Lax` + 服务端 `Origin` 校验 |
| 目标篡改 | `requestId` 与目标绑定，中途换号直接拒绝 |
| 重放 | 验证码一次性，`requestId` 用过即失效 |
| 路径穿越 | 静态服务做 `path.resolve` 前缀校验 + 黑名单目录 |
| 源码泄露 | `/server/`、`/.git/`、`/.verify/` 一律不暴露 |

### 上线前必须做的三件事

1. `DEMO_MODE=off`，并配好 SMTP 或短信网关 —— 否则任何人填个手机号就能看验证码
2. HTTPS 部署并设 `COOKIE_SECURE=1`
3. 把内存态换成 Redis（或接受单实例重启即掉线）—— `lib/store.js` 里三个 `Map` 就是全部状态

---

## 目录

```
server/
├── app.js              入口：路由 + 静态服务（工具页公开，无门禁）
├── lib/
│   ├── captcha.js      图形验证码：PNG 编码器 + 点阵字模 + 绘制
│   ├── store.js        内存态：验证码请求 / 会话 / 限流
│   └── mailer.js       极简 SMTP 客户端（AUTH LOGIN + STARTTLS）
├── test/
│   └── smoke.js        端到端冒烟测试（71 项）
└── package.json        零依赖
```

---

## 部署

根目录的 `Dockerfile` 走容器方式：

```bash
docker build -t lingora .
docker run -p 3000:3000 -e COOKIE_SECURE=1 -e DEMO_MODE=off \
  -e SMTP_HOST=smtp.qq.com -e SMTP_USER=you@qq.com -e SMTP_PASS=<授权码> \
  lingora
```

`.dockerignore` 排除了 137MB 的 Whisper 模型与 onnxruntime（后端不需要），
镜像里只剩前端静态文件 + 后端代码，约 1MB。**如需在线离线转写**，
把 `assets/vendor/models` 与 `assets/vendor/ort` 单独托管到对象存储 / 静态托管，
由前端按绝对 URL 加载。

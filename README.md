# Lingora · 在线语音转写工具

> 打开网页就能用的语音转写工具：在线录音、实时语音识别、本地 Whisper 离线转写，可导出 TXT / SRT / VTT。
> 无需注册、无需安装，音频不上传服务器。

零构建的静态站点：**纯 HTML + CSS + 原生 JS**，克隆即可跑，推送到 GitHub Pages 即可上线。

---

## 线上地址

**https://anan-jiejie.github.io/lingora/**

| 项 | 值 |
|---|---|
| 落地页 | https://anan-jiejie.github.io/lingora/ |
| 工具页 | https://anan-jiejie.github.io/lingora/app.html |
| 仓库 | https://github.com/anan-jiejie/lingora |
| 托管 | GitHub Pages · `Deploy from a branch` · `main` + `/ (root)` |

## 目录结构

```
lingora-site/
├── index.html                    落地页（产品说明、场景、版本计划、FAQ）
├── app.html                      工具页（真正的录音 + 转写工作台）
├── login.html                    登录页（区域选择 → 验证码免密登录）
├── register.html                 注册页（与登录页共用逻辑，靠 <body data-mode> 区分）
├── assets/
│   ├── styles.css                落地页样式 + 全站设计令牌
│   ├── main.js                   落地页交互（导航、演示窗、滚动揭示…）
│   ├── app.css                   工具页样式（控制区深色 / 转写区暖白纸面）
│   ├── app.js                    工具页逻辑（录音、双引擎识别、字幕导出）
│   ├── auth.css                  账户页样式（全部复用 styles.css 的令牌）
│   ├── auth.js                   账户页逻辑（区域、双语、校验、验证码、推荐码）
│   └── vendor/                   自托管运行时与模型，见下节
├── .nojekyll                     关闭 GitHub Pages 的 Jekyll 处理
├── .gitignore                    排除 .verify/ 等本地校验产物
└── README.md
```

## 本地预览

```bash
python -m http.server 8099
# 落地页 http://127.0.0.1:8099/
# 工具页 http://127.0.0.1:8099/app.html
```

> 必须用 HTTP 服务预览，不要双击 `index.html`：`file://` 下麦克风权限会被浏览器禁用，模型也加载不了。

---

## 工具页怎么实现的

### 两个识别引擎

| 引擎 | 原理 | 音频去向 | 依赖 |
|---|---|---|---|
| **浏览器实时识别** | `SpeechRecognition` / `webkitSpeechRecognition` | 由浏览器厂商的语音服务处理（Chrome→Google、Edge→Microsoft） | 浏览器本身 |
| **本地 Whisper 模型** | transformers.js + onnxruntime WASM，同源加载模型 | 只在本机内存里解码推理，不出设备 | 本站自托管模型 |

录音始终由 `MediaRecorder` 负责，两套引擎共用同一段音频，所以在浏览器识别效果不好时可以一键「用本地模型重新转写」。

### 为什么模型要自托管（重要）

`hf-mirror.com` 只返回 `Access-Control-Allow-Origin: https://hf-mirror.com`，
浏览器从本站 `fetch` 它会被 CORS 直接拦掉。**用 curl 测 HTTP 200 是测不出这个问题的**——curl 不校验 CORS。

所以模型全部放进 `assets/vendor/models/`，与本页同源，跨域问题从根上消失。

### `assets/vendor/` 里有什么

| 路径 | 体积 | 说明 |
|---|---|---|
| `transformers.min.js` | 0.86 MB | @xenova/transformers 2.17.2 运行时 |
| `models/whisper-tiny/` | 41.6 MB | 量化版 tiny 模型（config + tokenizer + 2 个 onnx） |
| `models/whisper-base/` | 76.0 MB | 量化版 base 模型，默认使用 |
| `ort/ort-wasm-simd.wasm` | 9.55 MB | onnxruntime 单线程 SIMD 版 |
| `ort/ort-wasm.wasm` | 8.80 MB | onnxruntime 无 SIMD 回退版 |

> GitHub Pages 无法设置 COOP/COEP，拿不到 `SharedArrayBuffer`，所以只会用到**非多线程**的 wasm。
> 合计约 137 MB。

### 关键配置

`assets/app.js` 的 `loadWhisper()`：

```js
// 路径必须换算成绝对 URL —— 这两件事的解析基准不一样：
//   import('./vendor/transformers.min.js')  相对 app.js 解析
//   env.localModelPath / wasmPaths          直接拼进 fetch()，相对当前文档解析
const vendorBase = new URL('assets/vendor/', document.baseURI).href;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = vendorBase + 'models/';
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = vendorBase + 'ort/';
```

> **踩过的坑**：早先这两项写成相对路径 `'./vendor/models/'`，`import()` 那条能命中（模块相对），
> 但 `fetch()` 那条会去 `/vendor/models/...` 取文件——页面在站点根目录、`vendor/` 却在 `assets/` 下，
> 于是全部 404。报错信息只显示 `file was not found locally at "./vendor/models/whisper-tiny/tokenizer.json"`，
> 而文件明明存在，很容易误判成模型损坏。用绝对 URL 就不会再有"相对谁"的歧义。

模型名直接写目录名（`whisper-tiny` / `whisper-base`）。transformers.js 判断本地还是远程的依据是路径有没有 `http(s):` 前缀——不带前缀就走 `localModelPath`。

另外 `wasmPaths` 会被 emscripten 的 `locateFile` 直接字符串拼接（`wasmPaths + 'ort-wasm-simd.wasm'`），所以**必须以 `/` 结尾**。

---

## 换品牌 / 换配色

所有颜色、字号、圆角都收敛在 `assets/styles.css` 顶部的 `:root` 里：

```css
--lang-a: #12E1B0;   /* 语言 A / 原文 —— 电光青 */
--lang-b: #FF7A5C;   /* 语言 B / 译文 —— 暖珊瑚 */
--ink-1:  #080D18;   /* 深色底 */
--paper:  #F6F4EF;   /* 浅色底 */
```

改这几个值就能整体换皮。品牌名替换搜 `Lingora` 即可。

## 已实现的交互

| 页面 | 交互 |
|---|---|
| 落地页 | 导航滚动毛玻璃、移动汉堡菜单、Scroll Spy、Hero 演示窗打字机（3 种语言可切）、滚动揭示、数字滚动、FAQ 手风琴、返回顶部、`prefers-reduced-motion`、`<noscript>` 兜底 |
| 工具页 | 双引擎切换、实时波形、录音计时、回放、本地模型加载进度、实时识别流式出字、转写稿可直接编辑、复制全文、导出 TXT / SRT / VTT、清空、用完后才解锁的下载入口、`contenteditable` 粘贴纯净化 |

## 无障碍与 SEO

- `<html lang="zh-CN">`、语义化标签、`skip-link`
- 所有交互控件带 `aria-*`，状态区 `aria-live`，`:focus-visible` 描边
- `<noscript>` 兜底：禁用 JS 时落地页内容依然完整可见
- 无外链图片依赖，字体走 Google Fonts 并配置系统字体回退

## 实测记录

用真实语音样本（`jfk.wav`）作为假麦克风输入，让 Playwright 走完整 UI 流程（选引擎 → 录音 → 停止 → 加载模型 → 推理 → 落字）实测：

| 模型 | 首次加载＋转写耗时 | 识别结果 | 资源请求 |
|---|---|---|---|
| `whisper-tiny` | 约 8 秒 | `And so my fellow American ask not what you are country…`（77 字） | 全部 200 |
| `whisper-base` | 约 13 秒 | `And so my fellow American asked not what your country…`（73 字） | 全部 200 |

两者控制台均零报错、零请求失败。base 准确率明显更好（`your country` 正确，tiny 误作 `you are country`），所以默认用 base。

**加载失败会自动降级**：弱网下大模型可能读不下来，此时会自动改用更小的 tiny 继续，
并同步更新下拉框，保证界面显示的模型与实际使用的一致（见 `getPipelineWithFallback()`）。

## 已知边界

- 浏览器实时识别**不返回逐句时间点**，导出的字幕时间戳按每句识别到的时刻估算；要精确到句需改用本地模型
- **首次使用本地模型需读取 42 MB（tiny）/ 76 MB（base）模型文件**，之后由浏览器 Cache API 缓存，再打开就快了
- 本地模型处理长录音耗时与音频长度大致成正比，建议单段 30 分钟以内
- Firefox 不支持 `SpeechRecognition`，建议用 Chrome / Edge
- 仓库含 137 MB 自托管模型，`git clone` 与首次推送会比较慢
- 弱网下大模型可能加载超时，此时会自动降级到 tiny

## 推送这个大仓库的注意点

137 MB 一次性推会被断（`RPC failed; curl 56 schannel: server closed abruptly`）。
实测**拆成多个小提交分批推**就顺利通过（2.5 MB + 22 MB + 51 MB 三批全部一次成功）：

```bash
# 分批 commit 后，按顺序推（用 API 校验才准，git 失败时可能打印
# "Everything up-to-date" 的假信号）
curl -s -H "Authorization: Bearer $PAT" \
  https://api.github.com/repos/anan-jiejie/lingora/commits/main \
  | tr ',' '\n' | grep -m1 '"sha"'
```

另外 `.gitattributes` 里的 `assets/vendor/** -text -diff` 不能少——
本机 `core.autocrlf=true` 会把模型和 tokenizer 的换行符改掉，造成内容漂移。

## 动画层（GSAP）

落地页的动效由 `assets/motion.js` + `assets/motion.css` 承担，
运行时是自托管在 `assets/vendor/gsap/` 的 **GSAP 3.15.0**（核心 + ScrollTrigger + CustomEase，约 122 KB，**不走 CDN**）。

### 为什么用 GSAP

站点原有的动画是 CSS transition + IntersectionObserver：
`[data-reveal]` 加个 `.is-visible` 类就淡入。够用，但有几个够不着的地方：

- 首屏想要一条**多段编排**的亮相（顺序、重叠、错峰），CSS 只能靠手写 `transition-delay`
- 滚动叙事需要把动画进度**绑定到滚动位置**（scrub），IntersectionObserver 只能给「进来了 / 出去了」
- 用户中途反向滚动时，CSS 动画没法优雅回退
- `prefers-reduced-motion` 需要逐条分支，GSAP 的 `matchMedia` 一次搞定

### 三层降级（关键设计）

动画是**增强**，不是**依赖**。任一层断裂，页面都必须照常可用：

| 情况 | 行为 | 判定位置 |
|---|---|---|
| 允许动效 + GSAP 就绪 | `motion.js` 全量接管 | `html.has-gsap` 被加上 |
| 用户开启「减少动效」 | `motion.js` 直接 return；`main.js` 的 `reduced` 分支给终态 | `motion.js` 第二道守卫 |
| GSAP 文件加载失败 | `motion.js` return；`main.js` 的 IntersectionObserver 兜底 | `main.js` 的 `gsapActive` |

`motion.css` 里**所有规则都挂在 `html.has-gsap` 下**——GSAP 没起来时这份样式整体失效，
不会出现「元素被 CSS 藏起来、JS 又没来放行」的白屏。

### main.js 与 motion.js 的分工

**`main.js` 做事，`motion.js` 只做动。**

`main.js` 里的 `gsapActive` 开关让出两段逻辑：
滚动揭示、数字计数。避免两套东西同时写 `opacity` 与 `transform`。

被让出的两段**没有删掉**，仍然在 GSAP 缺席时生效。

### 缓动对齐

`motion.js` 用 `CustomEase` 复刻了 `styles.css` 的两条曲线：

```js
CustomEase.create('lingora-ease', '0.22, 0.61, 0.36, 1'); // = --ease
CustomEase.create('lingora-out',  '0.16, 1, 0.3, 1');      // = --ease-out
```

这样 GSAP 的动画与既有 CSS 动画**手感完全一致**，不会出现「引了个新库就换一套节奏」。

### 动画与各区块的对应关系

| 区块 | 动效 |
|---|---|
| 全局 | 顶部 2px 滚动进度条（scrub，两端为品牌双色） |
| 页头 `#nav` | 滚动毛玻璃（原有 CSS，未改动） |
| 首屏 `.hero` | 一条 master timeline：徽章 → **标题逐行遮罩推出** → 副标题 → CTA → 信任行 ／ 演示窗从右侧带 3D 侧身入场 → 语言切换按钮 → 提示语 ／ 合规条 4 项错峰；光晕滚动视差 |
| 功能 `#features` | 6 张卡 `ScrollTrigger.batch` 错峰上浮 + 卡片 3D 倾斜跟随指针 |
| 三步 `#steps` | 3 张卡错峰入场 + 3D 倾斜 |
| 场景 `#scenes` | 3 张卡错峰入场 + 3D 倾斜 |
| 配合软件 `#integrations` | 8 个标签 `back.out` 逐个弹入 |
| 设计原则 `#proof` | 4 组数据错峰入场，`99` / `3` 用补间滚动计数 |
| 版本计划 `#pricing` | 3 张卡错峰入场；主推卡有呼吸光晕（GSAP 只推 `--lingora-halo` 一个数值，渐变由 CSS 画） |
| 常见问题 `#faq` | 7 条问题**逐条**滑入；展开时内容段落再次错峰淡入 |
| 结尾号召 `#cta` | 整块轻微放大落定 + 内部元素次第浮出 |
| 页脚 | 巨型字标滚动视差 |
| 返回顶部 | 点击时图标弹跳一次 |

### 验证

> 两个脚本放在 `.verify/`，按项目约定**不纳入版本控制**（见 `.gitignore`），
> 属于本地回归工具而非站点资源。

```bash
# 本地（先起静态服务器）
python -m http.server 8088 --bind 127.0.0.1
NODE_PATH=<playwright-core 所在目录> node .verify/motion-test.js

# 线上
TARGET=https://anan-jiejie.github.io/lingora/index.html \
  NODE_PATH=<playwright-core 所在目录> node .verify/motion-test.js
```

两个脚本的分工：

- `motion-test.js` —— 三档视口（1440 / 1024 / 390）跑一遍，统计 `[data-reveal]` 可见数、
  控制台错误、404、横向溢出；另跑一次 `reducedMotion: 'reduce'` 的 context 验证降级
- `motion-trace.js` —— **逐帧采样**首屏标题位移、滚动前卡片不透明度、进度条 scaleX、
  数字终值、3D 倾斜 matrix3d、光晕伪元素 opacity 序列、FAQ 阶梯值

`motion-trace.js` 是为了区分「动画真的在播」与「元素只是碰巧可见」——
只查最终 opacity 是看不出来的，必须抓到中间帧。

### 升级 GSAP

```bash
npm pack gsap@<版本> --registry=https://registry.npmmirror.com
tar -xzf gsap-<版本>.tgz
cp package/dist/{gsap,ScrollTrigger,CustomEase}.min.js assets/vendor/gsap/
```

许可：GSAP 现为 Standard "no charge" license，核心与常用插件**免费含商用**，
**无需 `.npmrc`、无需 auth token**。详见 `assets/vendor/gsap/README.md`。

---

## 账户体系（登录 / 注册）

对照对象是 `app.transyncai.com`。它的关键特征是：**不是密码登录，而是验证码免密登录**，
并且登录前有一个**必经的「选择服务器区域」步骤**。下面按参考站的真实行为逐项对照。

### 与参考站逐项对照

| 参考站功能 | 本站 | 说明 |
|---|---|---|
| 区域前置弹窗（中国区 / 国际区） | ✅ | 首次访问自动弹出，**不允许点遮罩跳过**；结果写入 localStorage |
| 区域绑定语言（切国际区即转英文） | ✅ | `chooseRegion()` 里由区域决定默认语言 |
| 手机登录 + `+86` 国家码 | ✅ | 国家码为本地循环切换 `+86/+852/+886/+1`，真实产品应换成完整选择器 |
| 邮箱登录 | ✅ | 邮箱格式前端校验 |
| 手机 / 邮箱 tab 切换 | ✅ | 国际区只剩邮箱，分段控件整块收起（参考站国际版也没有 tab 行） |
| 6 位验证码 + 60 秒倒计时 | ⚠️ 前端演示 | 见「无法实现的部分」 |
| 第三方登录：中国区仅 Apple | ✅ 入口 | 按钮真实存在，点击给出限制说明 |
| 第三方登录：国际区 Google + Apple | ✅ 入口 | 同上 |
| 推荐码（8 位字母数字） | ✅ | 弹窗输入、自动大写、长度校验、结果回显到入口 |
| 协议勾选（未勾选不可提交） | ✅ | 未勾选时红框 + 提示条 |
| 登录即注册（没有独立注册页） | ✅ 已照参考站行为 | 参考站确实没有注册页；`register.html` 是本站设计稿的增补 |
| 忘记密码 | — 参考站没有 | 免密登录模型下不存在这个入口，不做 |
| 主题切换按钮 | ❌ 未实现 | 参考站登录弹窗外有一个明暗切换，属非账户功能 |
| 桌面端窗口控件 | ❌ 不适用 | 参考站是 Electron 桌面壳，本站在浏览器里跑 |

### 为什么「没有独立的注册页」

参考产品把注册并进了登录：**首次验证码登录就等于完成注册**，因此它没有 `/signup` 路由
（实测 `/cn/login`、`/cn/signup`、`/cn/register` 全部回落首页 SPA）。

`register.html` 是按本项目设计稿（Ardot 屏 `3:5`）保留的独立入口。它与 `login.html`
**共用同一份 `auth.js`**，只靠 `<body data-mode="register">` 切换标题、主按钮、
左侧文案与成功提示；两页共用同一套校验与同一份 localStorage 契约。

### 无法实现的部分（静态站的固有限制）

这几项**不是没做，是静态站做不到**。每一处都在界面上写了明确说明，不留「看起来能用其实没接」的假象。

| 功能 | 为什么做不到 | 页面上怎么交代 | 替代方案 |
|---|---|---|---|
| 短信 / 邮件下发验证码 | 需要服务端 + 短信 / 邮件服务商资质，纯静态站没有后端 | 点「获取验证码」后用提示条显示演示码，并写明「真实环境由短信 / 邮件下发」 | 云函数（CloudBase / Vercel Function）调用短信 API |
| 验证码校验 | 校验必须在服务端，前端校验等于没有校验 | 演示码比对只在前端，`auth.js` 顶部注释已标注 | 服务端存 code + 过期时间 + 尝试次数 |
| 登录态 / 会话 | 静态站没有服务端会话，localStorage 谁都能改 | 左侧注明「登录态只存在你的浏览器本地」 | 服务端下发 **HttpOnly + Secure + SameSite Cookie**，前端不自行判定登录成功 |
| 第三方登录（Google / Apple） | 需要 Client ID、重定向 URI 与服务端换 token 的回调地址 | 点击后提示「需要客户端 ID 与服务端回调，静态站无法完成」 | 走 OAuth 2.0 授权码流程，回调落在服务端 |
| 用户服务协议 / 隐私协议全文 | 属法务文案，演示站不含 | 协议链接不跳转，改为提示「演示站未包含协议全文，正式上线前需接入法务文案」 | 补 `terms.html` / `privacy.html`，入口改成真实链接 |
| 找回密码 | 免密登录模型下不存在 | — | 若改为密码登录，需服务端重置令牌流程 |
| 账号数据同步 | 无后端、无数据库 | 会话只记录最后一个登录标识 | 服务端用户表 + 设备会话管理 |

### 上线前必须替换的 3 处

1. `auth.js` 中 `state.demoCode` 的本地生成与比对 → 换成 `POST /api/send-code` + `POST /api/verify-code`
2. `write(STORE.session, ...)` 的 localStorage 会话 → 换成服务端 `Set-Cookie`
3. `render()` 里 `el.oauthGoogle.hidden = ...` 的按钮 → 换成真实 OAuth 跳转

### 踩过的两个坑（改样式 / 改交互时注意）

1. **`[hidden]` 会被显式 `display` 压掉。** 浏览器默认的 `[hidden] { display: none }` 优先级极低，
   `.field { display: flex }`、`.oauth button { display: inline-flex }`、`.modal { display: grid }`
   都会让它失效。`auth.css` 第 13 节集中做了兜底（`.field[hidden]`、`.seg[hidden]`、
   `.oauth button[hidden]`、`.authswitch[hidden]`、`.modal[hidden]`），**这一段别删**。
2. **`#authSubmit` 是 `type="submit"`，必须 `preventDefault()`。** 不拦原生提交的话浏览器会以
   GET 重载本页，与「900 ms 后写会话 → 跳 app.html」抢跑，表现为偶发停在 `login.html?` 且会话丢失。

### 验证

```bash
python -m http.server 8088 --bind 127.0.0.1
NODE_PATH=<playwright 所在 node_modules> node .verify/verify-auth.js
```

覆盖 109 项：区域弹窗与不可跳过、中国区 / 国际区差异、中英联动、手机号 3-4-4 分组、
空值 / 格式 / 验证码 / 协议四类校验、60 秒倒计时、提交加载态、跳转与退出登录、
推荐码弹窗与校验、1440 / 1024 / 390 三档视口、`reduced-motion` 降级、四个页面控制台零错误。

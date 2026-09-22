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
├── assets/
│   ├── styles.css                落地页样式 + 全站设计令牌
│   ├── main.js                   落地页交互（导航、演示窗、滚动揭示…）
│   ├── app.css                   工具页样式（控制区深色 / 转写区暖白纸面）
│   ├── app.js                    工具页逻辑（录音、双引擎识别、字幕导出）
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

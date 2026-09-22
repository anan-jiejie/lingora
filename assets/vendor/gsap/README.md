# GSAP 运行时（自托管）

本目录存放 Lingora 站点使用的 GSAP 运行时文件。**不使用任何 CDN**，与站点同源，
避免第三方域名的可用性与隐私面。

## 文件清单

| 文件 | 体积 | 作用 |
|---|---|---|
| `gsap.min.js` | 71 KB | 核心引擎：补间、缓动、时间轴、CSSPlugin |
| `ScrollTrigger.min.js` | 44 KB | 滚动驱动：区块入场、进度条、视差、batch |
| `CustomEase.min.js` | 7 KB | 自定义缓动，用于复刻站点既有的贝塞尔曲线 |

合计约 **122 KB**（未压缩传输，已启用 GitHub Pages 的 gzip）。

## 来源

- 上游仓库：<https://github.com/greensock/GSAP>
- 发行渠道：npm 公共包 `gsap`
- 取得版本：**3.15.0**
- 取得命令：

  ```bash
  npm pack gsap --registry=https://registry.npmmirror.com
  # 产出 gsap-3.15.0.tgz，解包后取 dist/ 下的 .min.js
  ```

- 完整性：`npm pack` 返回的 shasum 为 `7851baaffc77642f2db3b1749d3634f9b5a19d14`
  （sha512 前缀 `dMW4CWBTUK1AE…`）

## 许可

GSAP 自 2024 年（Webflow 收购后）起采用 **Standard "no charge" license**：
<https://gsap.com/standard-license>

要点：核心库与原先仅对付费会员开放的插件（SplitText、MorphSVG、ScrollSmoother 等）
**现已全部免费**，可用于商业项目。**无需 `.npmrc`、无需 auth token、无需私有 registry**
—— 直接从公共 `gsap` npm 包安装即可。

本目录只包含核心 + ScrollTrigger + CustomEase 三个文件，均为免费范围。

## 为什么自托管而不是 CDN

1. **同源**：不受 CDN 可用性、地域、CSP 限制，也不会向第三方泄露访客 IP
2. **可复现**：版本锁定在仓库里，上游发新版不会悄悄改变线上表现
3. **一致**：与站点已有的 `assets/vendor/`（transformers.js、onnxruntime、Whisper 模型）
   采用同一套自托管策略

## 升级方式

```bash
npm pack gsap@<新版本> --registry=https://registry.npmmirror.com
tar -xzf gsap-<新版本>.tgz
cp package/dist/{gsap,ScrollTrigger,CustomEase}.min.js assets/vendor/gsap/
```

升级后跑一次 `node .verify/motion-test.js`，确认控制台无报错、动画正常。

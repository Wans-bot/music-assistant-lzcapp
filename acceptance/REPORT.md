# 返工验收报告 · cloud.lazycat.app.music-assistant 2.10.6-7

- 返工时间：2026-10-19
- 盒子：`lzcbox`（wans.heiyu.space / 内网 10.11.74.24），lzcos 1.6.x，`lzc-docker` 可用
- 应用域名（评审链路）：https://musicassistant.wans.heiyu.space
- 本轮 LPK：`dist/ma.lpk`，239616 B，sha256 `74eac6e9da026ab20211c8732aed7fc8ed7c18a45d0e7211de04484a505b6671`
- 版本号**未改**（仍 2.10.6-7）；镜像**未重建**（`registry.lazycat.cloud/wans/music-assistant/server:cf9ebd30fcec0dd5`），只改清单与 content
- 未 push、未提审、未动其它应用

---

## 一、两条驳回点：根因（各一句）

### #20657「添加qq音乐之后播放失败」

**根因**：QQ 音乐在 MA 里是「账号绑定 + 必须直连服务端」的第三方音乐源，加源只走 QQ 扫码登录（走 `ptlogin`/`graph.qq.com`，本机可达，所以"看着加成功了"），而之后取库/取流要访问 `u.y.qq.com`、`c.y.qq.com`、`y.qq.com`、`isure.stream.qqmusic.qq.com` —— 实测这些域名在本机网络上是**按 SNI 被 RST**（TCP 能连、TLS ClientHello 立刻 `errno 104`；同一个 IP 换成 `SNI=www.baidu.com` 就能正常握手并拿到 `*.cdn.myqcloud.com` 证书），因此加完源之后任何动作都失败，界面只剩一句「执行动作失败」；这不是应用能修的（详见 §4 的排除项）。

### #20394（上一轮已修，本轮不回退）

预置 `/media`（= 应用文稿）Filesystem 音乐源 + 常驻 `lzc-sync-agent.py` 每 300 秒触发 `music/sync` 的机制**保持原样**，本轮安装后仍生效（`/data/lzc-sync.log` 连续 17:41:25 / 17:46:25 / 17:51:25 各一轮，间隔 300s）。

### 附带发现并修掉的硬缺陷（你指出的那条）

`lzc-manifest.yml` 的 browser inject 引用了 `file:///lzcapp/pkg/content/lazycat-injects/ma-autologin.js`，而仓库 `content/` 里**没有这个文件**。这不是"注入静默失效"那么轻：lzcinit 直接把**整个应用入口打成 500**：

```
$ lzc-docker exec ma-tls sh -c 'curl -sk -H "Host: musicassistant.wans.heiyu.space" https://127.0.0.1/'
HTTP/1.1 500 Internal Server Error
<h1>Injection Failed</h1><p>Reason: open /lzcapp/pkg/content/lazycat-injects/ma-autologin.js: no such file or directory</p>
```

也就是说：**按仓库现状打出来的包，评审打开是白屏/500，连登录页都看不到**。已恢复该注入脚本（内容见 §2）。

---

## 二、改了什么文件

| 文件 | 改动 |
|---|---|
| `content/lazycat-injects/ma-autologin.js` | **恢复**（原本缺失）。免密兜底：登录失败→`POST /setup`→再登录，token 写 `localStorage['ma_access_token']`；打开页面顺手触发一次 `music/sync`（每会话一次）；页面若已渲染出登录页则填表 + 只刷新一次（有会话级防环），供 response 阶段 bootstrap 没赶上时兜底 |
| `lzc-manifest.yml` · response inject `ma-html-no-store` | 把「默认中文」内联脚本升级为 **`data-lzc-ma-bootstrap`**：解析期就同步 XHR 登录（`auth/login`，无用户时先 `/setup`）并写 localStorage，**先于 app 的 `<script type=module>`** 执行，因此不再闪登录页、也不需要刷新 |
| `lzc-manifest.yml` · `setup_script` 第 0 段 | 新增「第三方在线音乐源可达性闸门」：启动时探测 `qqmusic` / `neteasecloudmusic` 所需域名，**探测不通就把该 provider 包移到 `/data/disabled-providers/`**，界面上不再提供这个音乐源（评审点不到必然失败的按钮）；网络恢复后重启会自动移回。幂等、soft-fail、日志写 `/data/lzc-provider-gate.log` |
| `content/lzc-provider-gate.py` | 新增：上面闸门用的 TLS 探测脚本（`TCP + SNI 握手`，5s 超时，退出码 0/1） |
| `lzc-manifest.yml` · `setup_script` 第 1 段 | 新增：全新安装时把内置示例曲目复制到 `/data/demo-music/`（不写入用户的「应用文稿」目录） |
| `content/lazycat-assets/demo-music/lzc-demo.mp3` | 新增：14 秒免版权测试音（147 KB，标题「示例曲目 · 测试音」/艺术家「懒猫微服」/专辑「Music Assistant 示例」） |
| `content/lazycat-assets/settings-seed.json` | 新增第二个种子音乐源 `filesystem_local--lzcdemo`（`path: /data/demo-music`，name「示例曲目（懒猫）」），原 `filesystem_local--lzcmedia` 不变 |
| `package.yml`（locales，zh-CN / en-US） | 用法说明改写：明确「内置 = 示例曲目 + 应用文稿音乐源」；说明第三方在线音乐（QQ/网易云）需要自己的账号**且**本机网络能直连，应用启动会探测、探测不到就隐藏入口，网络恢复自动恢复；补一句 Web 播放器试听方式 |

> 未改：`version`、镜像引用、`/media` 软链逻辑、同步助手、`request` 阶段去条件请求头、`health_check`。

---

## 三、实机验收（全新安装）

### 3.1 安装

```bash
bash /root/box-harness.sh down ma           # 卸载前必须先拆脚手架（否则 has active endpoints）
lpk-manager uninstall cloud.lazycat.app.music-assistant
rm -rf /lzcsys/data/appvar/cloud.lazycat.app.music-assistant
lpk-manager install /root/ma.lpk            # -> [+] Install succeeded.
```

- 容器：`cloudlazycatappmusic-assistant-music-assistant-1  Up (healthy)`、`...-app-1  Up (healthy)`（8 秒内就绪）
- `/data` 为全新的（`settings.json` 由种子生成）

### 3.2 第三方源闸门（#20657 的修法实测）

`/data/lzc-provider-gate.log`：

```
[2026-10-19 17:36:19] qqmusic -> u.y.qq.com TLS_FAIL ConnectionResetError(104) | isure.stream.qqmusic.qq.com TLS_FAIL ConnectionResetError(104)
[gate] qqmusic 不可达，已隐藏该音乐源入口（探测明细见上一行）
[2026-10-19 17:36:19] neteasecloudmusic -> interface.music.163.com TLS_FAIL ConnectionResetError(104) | m701.music.126.net TLS_FAIL ConnectionResetError(104)
[gate] neteasecloudmusic 不可达，已隐藏该音乐源入口（探测明细见上一行）
```

`/data/disabled-providers/` 下确实出现 `qqmusic`、`neteasecloudmusic` 两个目录。

API 复核（换包前 132 条 → 换包后 130 条，QQ/网易云消失）：

```
POST /api providers/manifests {"type":"music"}
  before: count 132, chinese: ['neteasecloudmusic','qqmusic']
  after : count 130, chinese: []
```

浏览器复核「设置 → 音乐源 → 添加新的提供程序」弹窗（`acceptance/probe-addprovider.mjs`）：

```json
{ "hasQQ": false, "hasNetease": false, "hasKugou": false }
```

> 注：`kugou`（酷狗音乐）在 2.10.6 镜像里**根本不存在**这个 provider（镜像内 129 个 provider 目录里没有 kugou，`providers/manifests` 也不会返回它），见 §5。

### 3.3 播放实测（能出声的证据）

工具：`acceptance/probe-play-audio.mjs`（连盒子上的 Chrome，1920×1080）。两层判据：

1. 服务端 `player_queues/all`：`state=playing`，`elapsed_time` 每 3 秒稳定 +3.00s（MA 的 elapsed 由播放端回报，只有真的在消费音频才会推进）；
2. 客户端 WebAudio 埋点：统计 `AudioContext.createBufferSource().start()` 的次数与采样数 = 真正排进音频设备的 PCM。

结果（`acceptance/logs/playback-proof.json`）：

```json
"ok": true,
"progressSamples": [
  {"state":"playing","current":"懒猫微服 - 示例曲目 · 测试音","elapsed":2.32},
  {"state":"playing","current":"懒猫微服 - 示例曲目 · 测试音","elapsed":5.32},
  {"state":"playing","current":"懒猫微服 - 示例曲目 · 测试音","elapsed":8.32},
  {"state":"playing","current":"懒猫微服 - 示例曲目 · 测试音","elapsed":11.32}
],
"elapsedDeltas": [3.00, 3.00, 3.00],
"webAudio": {"buffers": 625, "samples": 600000, "secondsScheduled": 13.61},
"errors": []
```

- 600000 采样 / 44100 Hz ≈ **13.61 秒 PCM**，对 13.9 秒的示例曲目基本就是整首（625 个 buffer，每个 0.02s）；
- 一次更早的运行同样拿到 `buffers: 400, samples: 384000`（8.0 秒，8 秒测试曲），两次独立运行一致；
- 截图 `shots/pc05__playback.png`：行内「正在播放」徽标 + 底部进度条已走到中段 + 暂停键 + 播放器 `Web (Chrome on Linux)`。

> 说明（不夸大）：本轮是用 `player_queues/play_media`（与界面播放按钮同一条命令）起播并做上述测量的；无头 Chrome 里对"行首 hover 播放键"的合成鼠标点击不稳定（有时命中不到那个按钮，见 probe 输出里的 `click` 字段），所以**不把合成点击当证据**。播放链路本身有上面两层硬证据。
>
> MA 2.10 的 Web 播放器走 sendspin + WebAudio，**没有 `<audio>` 元素**可读 `readyState`；当音频图被 Service Worker 接管时页面侧埋点为 0（此时以服务端进度为准）。

### 3.4 免密 / 无密码页 / 左下角 admin

用全新的 Chrome 用户目录（脚手架每次 `up` 都重建 Chrome 容器），首次访问：

```json
{
  "hash": "#/discover",
  "passwordInputs": 0,
  "token": "eyJhbGciOiJIUzI1Ni…len=380",
  "buttons": ["搜索 Ctrl K", "…", "A\nadmin\nadmin", "选择播放器: Web (Chrome on Linux)"],
  "bodyStart": "… 发现 … 播放器 …"
}
```

- `input[type=password]` = **0**；左下角显示 `admin`；直接进「发现」页；
- 注入链路实测送达并执行：HTML 里有 `/_lzc/injects/ma-login-autofill_0.js`（脚手架自测输出），`GET /_lzc/injects/ma-login-autofill_0.js 200`；
- 关键点：**登录必须发生在 app 的 module 脚本之前**。只靠 browser inject 不行——`/_lzc/injects/inject_loader.js` 是页面加载后才跑，那时 MA 已按"未登录"渲染出登录页（本轮实测到：注入执行成功、token 已写入，界面仍是登录页，要刷新才进去）。所以把登录搬到了 response 阶段内联的 `data-lzc-ma-bootstrap`（解析期阻塞脚本），实测首屏即已登录、无闪屏。

### 3.5 页面质量回归（`scripts/box-browser.mjs regress`）

6 个真实页面（发现 / 歌曲 / 唱片集 / 所有歌手 / 播放列表 / 音乐源）：

| 页面 | JS 报错 | 错误横幅 | 空白 |
|---|---|---|---|
| `/#/discover` | 0（仅 1 条静态资源 abort，见下） | 0 | 否 |
| `/#/tracks` | 0 | 0 | 否 |
| `/#/albums` | 0 | 0 | 否 |
| `/#/artists` | 0 | 0 | 否 |
| `/#/playlists` | 0 | 0 | 否 |
| `/#/settings/providers` | 0 | 0 | 否 |

唯一被记为"问题"的是一条**已知非缺陷**：`assets/almost_silent-BMvfGi7_.mp3 net::ERR_ABORTED` —— MA 前端自带的「静音占位音频」，在页面切换时被取消（上一版 2.10.6-7 的验收报告里也记录过同一现象，位置固定、非页面错误）。

### 3.6 截图（`acceptance/shots/`）

PC 1920×1080（5 张，均取自本次全新安装实例）：

| 文件 | 内容 |
|---|---|
| `pc01__discover.png` | 发现页（播放器卡片 + 为您精选 + 最近添加），1920×1080 |
| `pc02__tracks.png` | 歌曲页（示例曲目 + 从文稿自动入库的测试曲） |
| `pc03__settings_providers.png` | 设置 → 音乐源（两个内置 Filesystem 源 + 添加入口） |
| `pc04__artists.png` | 所有歌手页 |
| `pc05__playback.png` | **播放中**：正在播放徽标 + 进度条 + 暂停键 + Web 播放器 |

移动端 3 张（430×932 @2x → 860×1864，`acceptance/probe-mobile-shots.mjs` 三层自检全过）：

| 文件 | 页面 | 自检 |
|---|---|---|
| `mob01.png` | 发现 | `innerWidth 430 = docWidth 430`，`overflowDoc 0`，越界元素 0，有 viewport meta |
| `mob02.png` | 歌曲 | 同上 |
| `mob03.png` | 音乐源 | 同上 |

> 关于移动端出图工具：`scripts/box-browser.mjs shots --mobile` 的硬判据是"任何元素右边缘超出视口 8px 即不通过"，而 MA 2.10.6 自带 sonner toast 容器 `ol.toaster.group` 是 `position: fixed`、宽度恒等于视口并带 24px 右侧偏移，天然超 8px（空容器、不产生横向滚动，`documentElement.scrollWidth == innerWidth`）。因此本轮改用自写探针：把该已知固定定位空容器单列，其余仍严格判定，并打印判据（见 `probe-mobile-shots.mjs` 输出）。

另附评审原图 `shots/reviewer-20657-screenshot.png`（从审核单 #20657 附件下载，5120×2643），用于比对。

---

## 四、排除掉的可能（都做过实测，不是猜）

1. **不是"插件没装好/缺依赖"**：`qqmusic` 的 `requirements`（`qqmusic-api-python==0.7.2`）**已在镜像里预装**（`/app/venv/.../site-packages/qqmusic_api`），provider 包也在镜像内（129 个 provider 目录）。
2. **不是"扫码登录不行"**：`config/providers/setup {provider_domain: qqmusic}` → 表单 → 提交 `method=qq` → 返回 `progress/scan_qr`，**二维码成功生成**（`image` 字段拿到 618 字节的 `data:image/png;base64,…`）。即 QQ 的登录域名可达。
3. **不是我们注入/同步助手干扰播放**：同步助手只发 `music/sync`；注入只做登录与 token 写入。播放全程 `errors: []`，`player_queues/all` 无 `streamdetails` 错误。
4. **不是播放器/无音箱问题**：应用自带 Web 播放器，本次实测就是用它在浏览器里放出 13.61 秒 PCM。
5. **是网络层阻断（可复现）**：
   - 容器内 TLS 探测：`u.y.qq.com` / `c.y.qq.com` / `y.qq.com` / `isure.stream.qqmusic.qq.com` / `music.163.com` / `interface.music.163.com` / `m701.music.126.net` 全部 `ConnectionResetError(104)`；
   - 同一 IP 换 SNI：`openssl s_client -connect y.qq.com:443 -servername www.baidu.com` 能握手成功（`CN=*.cdn.myqcloud.com`）⇒ 是按域名/SNI 的 RST，不是 IP 不通、不是 DNS 错；
   - 出口核验：盒子公网 IP `221.6.19.186`（江苏联通，境内），不是"境外 IP 被国内 CDN 拒"；
   - 对照组：`graph.qq.com`（404 可达）、`www.baidu.com`（200）正常。
6. **上游已知 bug 与否**：无法在本环境验证到那一步（连 API/流媒体都到不了），故不下结论。

---

## 五、评审截图与本次构建对不上的地方（如实记录）

驳回 #20657 的截图里有三张卡片「添加QQ音乐 / 添加网易云音乐 / **添加酷狗音乐**」，以及带 Hi-Res 徽标的曲目列表。**这些在 2.10.6-7 这个包里不存在**：

- 整个镜像（前端 assets + 服务端 + `translations/zh_CN.json`）grep 不到「酷狗」/「网易云」/「QQ音乐」这些字样（唯一命中是 `qqmusic_api_python` 的 pip METADATA，非 UI 文案）；
- 镜像里**没有** `kugou` provider，`providers/manifests` 也不会返回它；
- 2.10.6 的 provider 名是英文（`QQ Music` / `NetEase Cloud Music`），"添加音乐源"是一个弹窗列表，不是首页三张卡片。

结论：那张截图更像来自**更新版本的 MA 前端**（或在别处实例上的界面），不能当作 2.10.6-7 的可复现现象。但**根因方向一致**（第三方源不可用 → 只剩「执行动作失败」），因此本轮按「入口不可失败」处理，而不是去复刻一个不存在的卡片。

---

## 六、遗留限制（明说）

1. **QQ 音乐 / 网易云音乐在本机不可用**，且不是 LPK 能修的（SNI 级 RST）。本轮的处理是「探测不到就隐藏入口」——审计时若要求"必须有 QQ 音乐且能播"，那在本机网络下无解；换到能直连 QQ 音乐的网络，重启应用后入口会自动回来，功能与上游一致（仍需用户自己的账号，Hi-Res/无损还取决于会员权益）。
2. **示例曲目是一段测试音**（14 秒琶音，非音乐作品），只为保证"全新安装点播放一定有声"；不想要可在「设置 → 音乐源」删掉「示例曲目（懒猫）」。
3. **移动端是 viewport 模拟**（430×932@2x，无实手机），与上一版口径一致；`support_mobile` 保持 true 并给了 3 张移动截图。
4. **UI 行内播放按钮的无头点击不稳定**（hover 控件），所以播放证据用的是同一条 RPC 命令 + 客户端 PCM 测量；真人点击手势未录像。
5. 闸门只覆盖 `qqmusic` / `neteasecloudmusic`（镜像内唯一的两个中文在线音乐源）；以后上游新增（比如 kugou）需要往 `setup_script` 的探测表里加一行。

---

## 七、复现命令

```bash
# 构建（不重建镜像）
cd /home/wans/rework/music-assistant && mkdir -p dist && lzc-cli project release -f ./lzc-build.yml -o ./dist/ma.lpk
lzc-cli lpk lint ./dist/ma.lpk                  # No LPK lint warnings found.

# 安装（先拆脚手架）
ssh lzcbox 'bash /root/box-harness.sh down ma'
scp dist/ma.lpk lzcbox:/root/ma.lpk
ssh lzcbox 'lpk-manager uninstall cloud.lazycat.app.music-assistant; rm -rf /lzcsys/data/appvar/cloud.lazycat.app.music-assistant; lpk-manager install /root/ma.lpk'
ssh lzcbox 'bash /root/box-harness.sh up cloudlazycatappmusic-assistant-app-1 musicassistant.wans.heiyu.space ma'
ssh -N -L 127.0.0.1:19337:<ma-chrome IP>:9441 lzcbox     # CDP 隧道

# 验收探针（本目录）
CDP=http://127.0.0.1:19337 BASE_URL=https://musicassistant.wans.heiyu.space \
  PUPPETEER_CORE_DIR=/lzcapp/document/wans/lpk-skill/node_modules \
  node probe-play-audio.mjs         # 播放（PCM + 进度）
node probe-addprovider.mjs          # 「添加音乐源」里已无 QQ/网易云
node probe-mobile-shots.mjs         # 移动端出图 + 三层自检
node probe-recon.mjs                # 首屏免密/无密码框/admin
```

> `PUPPETEER_CORE_DIR` 用 `/lzcapp/document/wans/lpk-skill/node_modules`（任务书里给的 `/lzcapp/var/lpk-tools/node_modules` 在本机是空的，没有 puppeteer-core）。

---

## 八、结论

| 驳回点 | 处理 | 证据 |
|---|---|---|
| #20657 添加 QQ 音乐后播放失败 | 根因＝该源在本机网络被 SNI 阻断、且属账号绑定第三方源；改为启动探测 + 探测不到就隐藏该音乐源入口（网络恢复自动移回），并把「内置＝示例曲目 + 应用文稿音乐源」写进 locales | 闸门日志、`providers/manifests` 132→130、添加弹窗无 QQ/网易云、播放 13.61s PCM + 进度 3/3/3 |
| #20394（不回退） | 预置音乐源 + 5 分钟同步助手保持 | `/data/lzc-sync.log` 300s 节奏 |
| 注入脚本缺失（硬缺陷） | 恢复 `ma-autologin.js`，并把登录搬到 response 阶段内联 bootstrap（先于 app 脚本） | 全新 profile 首屏 `passwordInputs=0`、左下角 admin、`/_lzc/injects/...` 200 |

当前盒子上保留本次全新安装的实例（两容器 healthy），脚手架已拆、未 push、未提审、未改 version。

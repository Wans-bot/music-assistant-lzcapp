# Music Assistant（懒猫微服打包说明）

本包由懒猫微服社区开发者移植打包，仅做容器编排、网络与登录体验适配，未修改上游代码。

- 上游服务端：https://github.com/music-assistant/server
  - 版本：2.10.6（镜像内 revision `c24866405bd2068c25a60e1014e5ef8c3f6445bb`）
  - 许可：Apache License 2.0（见同目录 LICENSE）
- 上游前端：https://github.com/music-assistant/frontend
  - 版本：2.17.297（随官方镜像分发）
- 运行时镜像（懒猫官方源中转）：
  - `registry.lazycat.cloud/wans/music-assistant/server:cf9ebd30fcec0dd5`
  - 对应 `ghcr.io/music-assistant/server:2.10.6`
  - digest：`sha256:cf9ebd30fcec0dd59e276d56dcaacb537b67143b97c566e464877cb03c55b9bb`
- 应用图标：上游前端 `public/pwa-512x512.png`（512×512，随官方镜像分发）
- 第三方组件与模型许可：见同目录 NOTICE（上游随发行版提供）

## 本地适配清单（与上游发行版的差异）

1. `lzc-manifest.yml` 中服务使用 `network_mode: host`（宿主网络），用于音箱发现
   （mDNS/uPnP）与推流；上游官方要求 Docker 部署必须 host 网络或 macvlan。
2. 提供浏览器注入 `ma-autologin.js`（懒猫免密登录/首次初始化/切换账号控件）。
3. HTML 缓存修正注入（条件请求头剥离 + no-store），保证平台注入稳定送达。
4. 数据目录 `/lzcapp/var/music-assistant` 挂载到容器 `/data`；用户应用文稿目录
   挂载到 `/media`；懒猫网盘挂载通过 `enable_media_access` 暴露在 `/lzcapp/media`。

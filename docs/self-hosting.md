# 自部署说明

## 环境

- Node.js 22.13 或更高版本；
- 支持 WebSocket 的反向代理；
- 推荐使用 HTTPS；
- 至少运行一个网页进程和一个多人服务进程。

## 安装与构建

~~~bash
git clone https://github.com/luolisama/aiyiba.git
cd aiyiba
cp .env.example .env
# 编辑 .env，至少设置 SITE_ORIGIN；多人服务按需设置 PK_ALLOWED_ORIGINS
npm ci
npm run build
~~~

`SITE_ORIGIN` 必须填写浏览器实际访问的完整 Origin，例如 `https://example.com`；它用于元数据、Sitemap、robots、
分享链接和多人来源默认值。`PK_ALLOWED_ORIGINS` 仍必须填写多人服务允许的完整 Origin，多个来源使用逗号分隔；
显式的 `PK_ALLOWED_ORIGINS` 优先于 `SITE_ORIGIN`。请在 `npm run build` 前设置 `SITE_ORIGIN`；网页构建会将
规范化后的来源写入 Vinext/Cloudflare 运行时使用的 bundle。

如需验证 Google Search Console 或 Bing Webmaster Tools，可分别设置 `GOOGLE_SITE_VERIFICATION` 和
`BING_SITE_VERIFICATION`。只填写平台 meta 标签的 `content` 值；两项均为可选，并且必须在 `npm run build`
前设置，因为 Vinext 会把站点元数据写入构建产物。

## 启动

~~~bash
npm run start -- --hostname 127.0.0.1 --port 3000
npm run pk:server
~~~

生产环境建议使用 systemd、Docker Compose 或其他进程管理器分别托管两个进程。仓库中的 deploy/examples/
提供不含真实服务器信息的 systemd 和 Nginx 示例。

## 反向代理

- 普通 HTTP 请求转发到 127.0.0.1:3000。
- /pk/ws 转发到 127.0.0.1:3001。
- WebSocket 位置必须传递 Upgrade 和 Connection 请求头。
- 生产环境应配置 TLS，并限制多人服务端口只能由本机反向代理访问。

## 验证

部署后至少确认首页、三个单人玩法和多人页面可访问，多人页面能够收到大厅快照，两个浏览器能够完成一局；
单人页面加载后可在断开网络的情况下继续完成当前回合，且浏览器网络面板中不再出现单人 API 请求。

正式服务器的 IP、SSH 配置、证书、备份和发布脚本不应提交到公开仓库。

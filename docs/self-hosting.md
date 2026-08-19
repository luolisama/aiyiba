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
npm ci
npm run build
cp .env.example .env
~~~

PK_ALLOWED_ORIGINS 必须填写浏览器实际访问的完整 Origin，例如 https://example.com。多个来源使用逗号分隔。

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

部署后至少确认首页、三个单人玩法和多人页面可访问，多人页面能够收到大厅快照，两个浏览器能够完成一局，
且单人回合结束前响应中没有完整答案字段。

正式服务器的 IP、SSH 配置、证书、备份和发布脚本不应提交到公开仓库。

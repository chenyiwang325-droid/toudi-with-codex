# FullCalendar 本地资源

使用 FullCalendar 标准开源包 7.1.1 的全局脚本、Monarch 主题、中文 locale 和外部样式；没有使用 Premium 插件。原始资源来自 npm 官方注册表的 `fullcalendar-7.1.1.tgz`，保留上游源码与许可。

- FullCalendar：MIT，见 LICENSE.md；https://fullcalendar.io/license
- 全局脚本包含 Preact 与 temporal-polyfill；对应 MIT 许可分别保留在 PREACT-LICENSE.md、TEMPORAL-POLYFILL-LICENSE.md。
- TouDi 使用自身主题变量，不加载上游彩色 palette、不从 CDN 运行脚本、不请求第三方日历服务。
- `schedule.js` 在首次打开日程时按顺序加载所需本地资源。升级该目录时应同步核对 FullCalendar API、样式变量、原生 WebView CSP 与端到端测试。

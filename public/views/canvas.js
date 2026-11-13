/* 无限画布：iframe 嵌入子服务（/canvas → 独立 Express 进程）
 * Miku 的 view 约定是「无参调用、返回 HTML 字符串」，iframe 的加载遮罩用内联 onload 移除。
 * 遮罩是本视图内部的兄弟节点，用 this.nextElementSibling 移除，不走全局 getElementById，
 * 避免被 uicheck 当成 index.html 里应存在的全局 DOM id。 */
export function viewCanvas() {
  return `
    <div class="view-head">
      <h2>无限画布</h2>
      <p class="muted">节点式创作工作台：剧本 → 分镜 → 图片 → 视频，真实对接 AutoDL 生成。也可以 <a href="/canvas/" target="_blank" rel="noreferrer">在新窗口打开</a>。</p>
    </div>
    <div style="position:relative;width:100%;height:calc(100vh - 210px);min-height:420px;border:1px solid #D9DEE5;border-radius:12px;overflow:hidden;background:#F6F7F9">
      <iframe src="/canvas/" style="width:100%;height:100%;border:0" title="无限画布"
        onload="this.nextElementSibling && this.nextElementSibling.remove();"></iframe>
      <div data-canvas-boot="1" style="position:absolute;inset:0;display:grid;place-items:center;color:#888;font-size:13px;background:#F6F7F9">
        画布服务启动中…（首次约 2 秒；若长时间无响应，重启平台或手动运行 canvas/server.js）
      </div>
    </div>`;
}

/* 本视图没有 data-run 按钮，按项目约定导出空 runners，供 uicheck 的接线校验通过。 */
export const runners = {};

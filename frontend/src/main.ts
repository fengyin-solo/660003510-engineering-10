import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useSQLStore } from './store/sql'
import './style.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// 业务代码只通过统一加载器读取示例数据（public/data/manifest.json 规则）
useSQLStore(pinia).init()

// 最后一道防线：组件渲染意外抛错时给出可恢复提示，避免整页白屏
app.config.errorHandler = (err) => {
  console.error('[app] 未处理的渲染错误：', err)
  const root = document.getElementById('app')
  if (root && !root.hasChildNodes()) {
    root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#cbd5e1;font-family:sans-serif">
        <div style="max-width:520px;border:1px solid #b91c1c;border-radius:8px;padding:24px;background:#1e293b">
          <h2 style="color:#f87171;margin:0 0 8px">页面渲染出现意外错误</h2>
          <p style="font-size:13px;color:#94a3b8">可尝试刷新页面恢复；若问题持续，请检查浏览器控制台与 public/data 下的示例数据文件。</p>
          <button onclick="location.reload()" style="margin-top:12px;padding:6px 16px;background:#0891b2;color:#fff;border:0;border-radius:4px;cursor:pointer">刷新页面</button>
        </div>
      </div>`
  }
}
window.addEventListener('unhandledrejection', event => {
  console.error('[app] 未处理的 Promise 错误：', event.reason)
})

app.mount('#app')

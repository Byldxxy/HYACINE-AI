/** Web 管理面板入口。桌宠使用独立的 src/pet/main.jsx，不会挂载此组件树。 */
import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  // 避免单个配置组件异常后留下空白页；这里只提供刷新恢复，不吞掉控制台错误。
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-pink-50 p-8">
          <div className="w-full max-w-md rounded-3xl border border-white bg-white/80 p-8 text-center shadow-xl backdrop-blur-xl">
            <h1 className="mb-3 text-xl font-semibold text-red-600">页面加载失败</h1>
            <p className="mb-5 text-sm text-gray-600">{this.state.error?.message || '未知错误'}</p>
            <button onClick={() => window.location.reload()} className="ui-button btn-primary btn-md">
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

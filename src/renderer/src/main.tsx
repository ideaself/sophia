import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { migrateLegacySettings } from '../../shared/settings-migrate'
import './assets/main.css'

// 品牌迁移：在任何组件读取设置前，把旧 localStorage 键复制到新键
migrateLegacySettings()

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found in document')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

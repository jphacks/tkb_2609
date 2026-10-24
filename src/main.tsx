// 共通スタイルを先に読み込み、各画面の *.module.css で上書きできるようにする
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { RefreshProvider } from './app/RefreshProvider'
import { RepositoryContext } from './app/contexts'
import { FeedbackProvider } from './components/feedback/FeedbackProvider'
import { repository } from './data'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepositoryContext.Provider value={repository}>
      <RefreshProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </RefreshProvider>
    </RepositoryContext.Provider>
  </StrictMode>,
)

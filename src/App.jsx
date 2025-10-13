import { useState } from 'react'
import reactLogo from './assets/react.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div>
      {/* Vite logo removido */}
      <a href="https://react.dev" target="_blank" rel="noreferrer">
        <img src={reactLogo} className="logo react" alt="React logo" />
      </a>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>Click on the React logo to learn more — Extensão funcionando!</p>
      </div>
      <p className="read-the-docs">
        Edit <code>src/App.jsx</code> and save to test HMR
      </p>
    </div>
  )
}

export default App


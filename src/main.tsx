import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Resolve the brand theme from the build-time env var (VITE_THEME).
// "katan" => purple theme; anything else (incl. unset) => legacy blue theme.
// Setting it before render avoids a color flash.
const brandTheme = String(import.meta.env.VITE_THEME ?? '').trim().toLowerCase()
document.documentElement.setAttribute('data-theme', brandTheme === 'katan' ? 'katan' : 'blue')

createRoot(document.getElementById('root')!).render(<App />)

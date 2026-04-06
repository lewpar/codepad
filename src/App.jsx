import { useState, useCallback, useRef, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { dracula } from '@uiw/codemirror-theme-dracula'
import './App.css'

const KVS_URL = 'https://kvs.cyberbilby.com'

const LANGS = [
  { id: 'html', label: 'HTML' },
  { id: 'css',  label: 'CSS'  },
  { id: 'js',   label: 'JS'   },
]

const DEFAULT_CODE = {
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
</head>
<body>
  <div class="card">
    <h1>Hello, World!</h1>
    <p>Edit the panes on the left to see live changes.</p>
    <button onclick="greet()">Click me</button>
  </div>
</body>
</html>`,
  css: `* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f0f2f5;
}

.card {
  background: #fff;
  border-radius: 12px;
  padding: 40px 48px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  text-align: center;
  max-width: 480px;
  width: 100%;
}

h1 {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 12px;
  color: #111;
}

p {
  color: #555;
  line-height: 1.6;
  margin-bottom: 24px;
}

button {
  background: #6366f1;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 24px;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.15s;
}

button:hover { background: #4f46e5; }`,
  js: `function greet() {
  console.log('Hello from JavaScript! 👋');
}`,
}

const CM_EXTENSIONS = {
  html: [html()],
  css:  [css()],
  js:   [javascript()],
}

// Injected before user code to intercept console output.
// Accepts a nonce so the parent can discard messages from stale iframes.
function buildConsoleInterceptor(nonce) {
  return (
    '<scr' + 'ipt>' +
    '(function(){' +
    'var n="' + nonce + '";' +
    'var s=function(m,a){' +
    'try{parent.postMessage({source:"codepad",nonce:n,method:m,' +
    'args:[].slice.call(a).map(function(x){' +
    'try{return typeof x==="object"?JSON.stringify(x,null,2):String(x)}' +
    'catch(e){return"[unserializable]"}})' +
    '},"*")}catch(e){}};' +
    '["log","warn","error","info"].forEach(function(m){' +
    'var o=console[m];' +
    'console[m]=function(){s(m,arguments);o&&o.apply(console,arguments)}});' +
    'window.addEventListener("error",function(e){' +
    's("error",[e.message+" ("+(e.lineno||0)+":"+(e.colno||0)+")"])});' +
    '})();' +
    '<\/scr' + 'ipt>'
  )
}

function stripScripts(htmlStr) {
  return htmlStr.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, '')
}

function buildSrcdoc(code, includeJs = true, nonce = '') {
  let doc = includeJs ? code.html : stripScripts(code.html)

  // Inject CSS before </head> if present, otherwise prepend a <style> tag
  const styleTag = `<style>${code.css}<\/style>`
  if (doc.includes('</head>')) {
    doc = doc.replace('</head>', `${styleTag}\n</head>`)
  } else {
    doc = styleTag + '\n' + doc
  }

  // Inject console interceptor + user JS before </body> if present
  if (includeJs) {
    const scripts = '\n' + buildConsoleInterceptor(nonce) + '\n<script>' + code.js + '<\/script>'
    if (doc.includes('</body>')) {
      doc = doc.replace('</body>', `${scripts}\n</body>`)
    } else {
      doc = doc + scripts
    }
  }

  return doc
}

// ── sub-components ────────────────────────────────────────────────────────────

function JsConsentDialog({ onAllow, onDeny }) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 19h20L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            <path d="M12 9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="12" cy="16.5" r="0.75" fill="currentColor"/>
          </svg>
        </div>
        <h2 id="dialog-title">Enable JavaScript?</h2>
        <p>The preview iframe can execute JavaScript written in the JS pane. Only run code you trust.</p>
        <div className="dialog-actions">
          <button className="dialog-btn deny" onClick={onDeny}>Deny</button>
          <button className="dialog-btn allow" onClick={onAllow}>Allow</button>
        </div>
      </div>
    </div>
  )
}

function ShareDialog({ url, error, onClose }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="dialog-backdrop dialog-backdrop--fixed" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h2 id="share-title">Share</h2>
        {error ? (
          <>
            <p style={{ color: '#f87171' }}>Failed to generate share link. Please try again.</p>
            <div className="dialog-actions">
              <button className="dialog-btn allow" onClick={onClose}>Close</button>
            </div>
          </>
        ) : !url ? (
          <p style={{ color: '#aaa' }}>Generating link…</p>
        ) : (
          <>
            <p>Anyone with this link can view and edit this code.</p>
            <div className="share-url-row">
              <p className="share-url-text">{url}</p>
              <button className="dialog-btn allow share-copy-btn" onClick={handleCopy}>
                {copied
                  ? <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 8l4 4 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="5" y="1" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M3 5H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                }
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const LOG_COLORS = { log: '#ccc', info: '#60a5fa', warn: '#f59e0b', error: '#f87171' }
const LOG_LABELS = { log: 'LOG', info: 'INF', warn: 'WRN', error: 'ERR' }

function ConsolePanel({ logs, isOpen, layout, onToggle, onClear }) {
  const bodyRef = useRef(null)

  // auto-scroll to bottom on new log
  useEffect(() => {
    if (isOpen && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [logs, isOpen])

  const errorCount = logs.filter(l => l.method === 'error').length
  const warnCount  = logs.filter(l => l.method === 'warn').length

  return (
    <div className={`console-panel console-panel--${layout}${isOpen ? '' : ' console-panel--collapsed'}`}>
      <div className="console-header">
        <span className="console-title">Console</span>
        {isOpen && errorCount > 0 && <span className="console-badge console-badge--error">{errorCount}</span>}
        {isOpen && warnCount  > 0 && <span className="console-badge console-badge--warn">{warnCount}</span>}
        <div className="console-header-actions">
          {isOpen && (
            <button className="console-icon-btn" onClick={onClear} title="Clear console">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          <button className="console-icon-btn" onClick={onToggle} title={isOpen ? 'Collapse console' : 'Expand console'}>
            {layout === 'row'
              ? <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d={isOpen ? 'M2 4l4.5 4.5L11 4' : 'M2 9l4.5-4.5L11 9'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              : <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d={isOpen ? 'M9 2L4.5 6.5 9 11' : 'M4 2l4.5 4.5L4 11'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            }
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="console-body" ref={bodyRef}>
          {logs.length === 0
            ? <div className="console-empty">No output</div>
            : logs.map(entry => (
                <div key={entry.id} className={`console-entry console-entry--${entry.method}`}>
                  <span className="console-entry__tag">[{LOG_LABELS[entry.method] ?? 'LOG'}]</span>
                  <span className="console-entry__text" style={{ color: LOG_COLORS[entry.method] ?? '#ccc' }}>
                    {entry.args.join(' ')}
                  </span>
                </div>
              ))
          }
        </div>
      )}
    </div>
  )
}

// ── main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab]       = useState('html')
  const [code, setCode]                 = useState(DEFAULT_CODE)
  const [srcdoc, setSrcdoc]             = useState(() => buildSrcdoc(DEFAULT_CODE, false))
  const [layout, setLayout]             = useState('row')
  const [jsAllowed, setJsAllowed]       = useState(null)
  const [showShare, setShowShare]       = useState(false)
  const [shareUrl, setShareUrl]         = useState(null)
  const [shareError, setShareError]     = useState(false)
  const [isSharing, setIsSharing]       = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [splitSize, setSplitSize]       = useState(50)
  const [isDragging, setIsDragging]     = useState(false)
  const [consoleLogs, setConsoleLogs]   = useState([])
  const [consoleOpen, setConsoleOpen]   = useState(true)

  const previewDebounceRef = useRef(null)
  const previewDelayRef    = useRef(null)
  const workspaceRef       = useRef(null)
  const jsAllowedRef       = useRef(null)   // always holds latest jsAllowed
  const activeNonceRef     = useRef('')      // nonce of the currently live iframe
  const lastSharedCodeRef  = useRef(null)   // code snapshot at last successful share

  // keep jsAllowed in sync
  useEffect(() => { jsAllowedRef.current = jsAllowed }, [jsAllowed])
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.source !== 'codepad') return
      if (e.data.nonce !== activeNonceRef.current) return
      setConsoleLogs(prev => [...prev, {
        id: Date.now() + Math.random(),
        method: e.data.method,
        args: e.data.args,
      }])
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const updatePreview = useCallback((next, includeJs) => {
    clearTimeout(previewDebounceRef.current)
    clearTimeout(previewDelayRef.current)
    previewDebounceRef.current = setTimeout(() => {
      setPreviewLoading(true)
      previewDelayRef.current = setTimeout(() => {
        const nonce = Math.random().toString(36).slice(2)
        activeNonceRef.current = nonce
        setConsoleLogs([])
        setSrcdoc(buildSrcdoc(next, includeJs ?? jsAllowedRef.current === true, nonce))
      }, 500)
    }, 300)
  }, [])

  const handleChange = useCallback((value) => {
    setCode(prev => {
      const next = { ...prev, [activeTab]: value }
      updatePreview(next, null) // null → reads jsAllowedRef at fire time
      return next
    })
  }, [activeTab, updatePreview])

  useEffect(() => () => {
    clearTimeout(previewDebounceRef.current)
    clearTimeout(previewDelayRef.current)
  }, [])

  // load code from KV if a share code is present in the URL path
  useEffect(() => {
    const pathCode = window.location.pathname.slice(1)
    if (!pathCode) return
    fetch(`${KVS_URL}/${pathCode}`)
      .then(r => r.json())
      .then(data => {
        if (data && typeof data.html === 'string') {
          setCode(data)
          updatePreview(data, null)
        }
      })
      .catch(() => {})
  }, [updatePreview])

  const handleDividerMouseDown = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
    const onMouseMove = (e) => {
      const workspace = workspaceRef.current
      if (!workspace) return
      const rect = workspace.getBoundingClientRect()
      const size = layout === 'row'
        ? ((e.clientX - rect.left) / rect.width) * 100
        : ((e.clientY - rect.top) / rect.height) * 100
      setSplitSize(Math.min(Math.max(size, 15), 85))
    }
    const onMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [layout])

  async function handleShare() {
    // reuse existing link if code hasn't changed since last share
    if (shareUrl && lastSharedCodeRef.current === JSON.stringify(code)) {
      setShowShare(true)
      return
    }
    setShareUrl(null)
    setShareError(false)
    setShowShare(true)
    setIsSharing(true)
    try {
      const res = await fetch(KVS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: code.html, css: code.css, js: code.js }),
      })
      if (!res.ok) throw new Error('Request failed')
      const data = await res.json()
      lastSharedCodeRef.current = JSON.stringify(code)
      setShareUrl(`${window.location.origin}/${data.id}`)
    } catch {
      setShareUrl(null)
      lastSharedCodeRef.current = null
      setShareError(true)
    } finally {
      setIsSharing(false)
    }
  }

  function closeShare() {
    setShowShare(false)
    setShareError(false)
    // shareUrl is intentionally kept so the cached link can be reused
  }

  const editorStyle = layout === 'row' ? { width: `${splitSize}%` } : { height: `${splitSize}%` }

  function grantConsent(allowed) {
    const nonce = Math.random().toString(36).slice(2)
    activeNonceRef.current = nonce
    setJsAllowed(allowed)
    setConsoleLogs([])
    setPreviewLoading(true)
    setSrcdoc(buildSrcdoc(code, allowed, nonce))
  }

  return (
    <div className={`app${isDragging ? ' is-dragging-' + layout : ''}`}>
      {showShare && <ShareDialog url={shareUrl} error={shareError} onClose={closeShare} />}

      <div className="topbar">
        <div className="topbar-tabs">
          {LANGS.map(({ id, label }) => (
            <button key={id} className={`tab-btn${activeTab === id ? ' active' : ''}`} onClick={() => setActiveTab(id)}>
              {label}
            </button>
          ))}
        </div>

        <button className="layout-btn" onClick={handleShare} disabled={isSharing} title="Share">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="13" cy="3"  r="1.75" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="3"  cy="8"  r="1.75" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="13" cy="13" r="1.75" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="4.7" y1="7.1" x2="11.3" y2="4"  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="4.7" y1="8.9" x2="11.3" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>

        <button className="layout-btn" onClick={() => setLayout(l => l === 'row' ? 'column' : 'row')}
          title={layout === 'row' ? 'Switch to vertical split' : 'Switch to horizontal split'}>
          {layout === 'row'
            ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="6" rx="1.5" fill="currentColor" opacity="0.5"/><rect x="1" y="9" width="14" height="6" rx="1.5" fill="currentColor"/></svg>
            : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="14" rx="1.5" fill="currentColor" opacity="0.5"/><rect x="9" y="1" width="6" height="14" rx="1.5" fill="currentColor"/></svg>
          }
        </button>
      </div>

      <div className={`workspace ${layout}`} ref={workspaceRef}>
        <div className={`editor-panel editor-panel--${layout}`} style={editorStyle}>
          <CodeMirror
            key={activeTab}
            value={code[activeTab]}
            style={{ flex: 1, overflow: 'hidden' }}
            theme={dracula}
            extensions={CM_EXTENSIONS[activeTab]}
            onChange={handleChange}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true, tabSize: 2 }}
          />
          <ConsolePanel
            logs={consoleLogs}
            isOpen={consoleOpen}
            layout={layout}
            onToggle={() => setConsoleOpen(v => !v)}
            onClear={() => setConsoleLogs([])}
          />
        </div>

        <div className={`divider divider--${layout}`} onMouseDown={handleDividerMouseDown}>
          <div className="divider__grip"><span /><span /><span /><span /></div>
        </div>

        <div className="preview-panel">
          {jsAllowed === null && (
            <JsConsentDialog onAllow={() => grantConsent(true)} onDeny={() => grantConsent(false)} />
          )}
          {previewLoading && (
            <div className="preview-spinner">
              <div className="preview-spinner__badge">
                <div className="spinner" />
                <span className="preview-spinner__label">Reloading</span>
              </div>
            </div>
          )}
          {jsAllowed !== null && (
            <iframe
              key={String(jsAllowed)}
              title="preview"
              sandbox={jsAllowed ? 'allow-scripts allow-modals' : ''}
              srcDoc={srcdoc}
              onLoad={() => setPreviewLoading(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

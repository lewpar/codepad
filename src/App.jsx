import { useState, useCallback, useRef, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { dracula } from '@uiw/codemirror-theme-dracula'
import './App.css'

const KVS_URL = 'https://kvs.cyberbilby.com'

const LANGS = [
  { id: 'html', label: 'HTML', color: '#f06535' },
  { id: 'css',  label: 'CSS',  color: '#4a82f8' },
  { id: 'js',   label: 'JS',   color: '#f5e24e' },
]

const TAB_ICONS = {
  html: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M4 2L1 6.5l3 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 2l3 4.5-3 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.8 1l-2.6 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  css: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M1.5 4.5h10M1.5 8.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M4.5 1.5l-1 10M9.5 1.5l-1 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  js: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M5 1.5C4 1.5 3.5 2 3.5 3v1.5c0 .8-.5 1.3-1.5 1.5 1 .2 1.5.7 1.5 1.5V9c0 1 .5 1.5 1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8 1.5c1 0 1.5.5 1.5 1.5v1.5c0 .8.5 1.3 1.5 1.5-1 .2-1.5.7-1.5 1.5V9c0 1-.5 1.5-1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
}

const DEFAULT_CODE = {
  html: '',
  css:  '',
  js:   '',
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

function parseFragment() {
  try {
    const hash = window.location.hash.slice(1)
    if (!hash) return null
    const data = JSON.parse(atob(hash))
    if (typeof data.html === 'string' || typeof data.css === 'string' || typeof data.js === 'string') {
      return { html: data.html ?? '', css: data.css ?? '', js: data.js ?? '', title: data.title ?? null }
    }
  } catch {}
  return null
}

function buildFragmentUrl(code, title) {
  return `${window.location.origin}/#${btoa(JSON.stringify({ title, html: code.html, css: code.css, js: code.js }))}`
}

function buildSrcdoc(code, includeJs = true, nonce = '') {
  let doc = includeJs ? code.html : stripScripts(code.html)

  // Navigation guard: intercept anchor clicks to handle hash scrolling and
  // open external links in a new tab instead of navigating the iframe.
  const navGuard =
    '<scr' + 'ipt>' +
    '(function(){' +
    'document.addEventListener("click",function(e){' +
    'var a=e.target.closest("a");' +
    'if(!a||!a.hasAttribute("href"))return;' +
    'e.preventDefault();' +
    'var h=a.getAttribute("href");' +
    'if(!h||h==="#"){return;}' +
    'if(h.startsWith("#")){' +
    'var el=document.getElementById(h.slice(1));' +
    'if(el)el.scrollIntoView({behavior:"smooth"});' +
    'return;}' +
    'window.open(h,"_blank","noopener,noreferrer");' +
    '});' +
    '})();' +
    '<\/scr' + 'ipt>'

  // Inject CSS at the start of <head> so user styles declared later take precedence
  const styleTag = `<style>${code.css}<\/style>`
  if (doc.includes('<head>')) {
    doc = doc.replace('<head>', `<head>\n${styleTag}\n${navGuard}`)
  } else if (doc.includes('</head>')) {
    doc = doc.replace('</head>', `${styleTag}\n${navGuard}\n</head>`)
  } else {
    doc = styleTag + '\n' + navGuard + '\n' + doc
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

// ── cookie helpers ────────────────────────────────────────────────────────────

function getJsConsentCookie() {
  return document.cookie.split(';').some(c => c.trim() === 'js_consent=allowed')
}

function setJsConsentCookie() {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `js_consent=allowed; expires=${expires}; path=/`
}

// Computed once per page load so jsAllowed, srcdoc, and activeNonce are consistent.
let _initConsent = null
function getInitialConsent() {
  if (!_initConsent) {
    const cookied = getJsConsentCookie()
    const nonce = cookied ? Math.random().toString(36).slice(2) : ''
    _initConsent = { allowed: cookied ? true : null, nonce, srcdoc: buildSrcdoc(DEFAULT_CODE, cookied, nonce) }
  }
  return _initConsent
}

function PreviewPlaceholder() {
  return (
    <div className="preview-placeholder">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="33" height="33" rx="6" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
        <path d="M11 18l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M25 18l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M20 15l-4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <p className="preview-placeholder__title">Nothing to preview yet</p>
      <p className="preview-placeholder__sub">Write some HTML, CSS, or JavaScript in the editor to see a live preview here.</p>
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────

function JsConsentDialog({ onAllow, onDeny }) {
  const [remember, setRemember] = useState(false)
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
        <label className="consent-remember">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          <span className="consent-remember__box" />
          Don't ask again for 24 hours
        </label>
        <div className="dialog-actions">
          <button className="dialog-btn deny" onClick={onDeny}>Deny</button>
          <button className="dialog-btn allow" onClick={() => onAllow(remember)}>Allow</button>
        </div>
      </div>
    </div>
  )
}

function ClearDialog({ tab, onConfirm, onClose }) {
  const [clearAll, setClearAll] = useState(true)
  return (
    <div className="dialog-backdrop dialog-backdrop--fixed" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog--left" role="dialog" aria-modal="true" aria-labelledby="clear-title">
        <h2 id="clear-title">Clear {clearAll ? 'All Tabs' : tab.toUpperCase()}?</h2>
        <p>This will erase all content in {clearAll ? 'all tabs' : <>the <strong>{tab.toUpperCase()}</strong> tab</>}. This cannot be undone.</p>
        <label className="consent-remember">
          <input type="checkbox" checked={clearAll} onChange={e => setClearAll(e.target.checked)} />
          <span className="consent-remember__box" />
          Clear all tabs
        </label>
        <div className="dialog-actions">
          <button className="dialog-btn deny" onClick={onClose}>Cancel</button>
          <button className="dialog-btn clear" onClick={() => onConfirm(clearAll)}>Clear</button>
        </div>
      </div>
    </div>
  )
}

const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="5" y="1" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M3 5H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
)
const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 8l4 4 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
)

function ShareDialog({ code, title, shortUrl, shortError, isGenerating, onGenerateShortLink, onClose }) {
  const [copiedFragment, setCopiedFragment] = useState(false)
  const [copiedShort, setCopiedShort]       = useState(false)
  const fragmentUrl = buildFragmentUrl(code, title)

  function copyText(text, setCopied) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="dialog-backdrop dialog-backdrop--fixed" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h2 id="share-title">Share</h2>

        <p className="share-section-label">Fragment link <span className="share-section-note">(instant, no server)</span></p>
        <div className="share-url-row">
          <p className="share-url-text">{fragmentUrl}</p>
          <button className="dialog-btn allow share-copy-btn" onClick={() => copyText(fragmentUrl, setCopiedFragment)}>
            {copiedFragment ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>

        <div className="share-divider" />

        <p className="share-section-label">Short link <span className="share-section-note">(stored on server)</span></p>
        {shortError ? (
          <p style={{ color: '#f87171', margin: '4px 0 0' }}>Failed to generate short link. Please try again.</p>
        ) : shortUrl ? (
          <div className="share-url-row">
            <p className="share-url-text">{shortUrl}</p>
            <button className="dialog-btn allow share-copy-btn" onClick={() => copyText(shortUrl, setCopiedShort)}>
              {copiedShort ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        ) : (
          <button className="dialog-btn allow" style={{ marginTop: '4px' }} onClick={onGenerateShortLink} disabled={isGenerating}>
            {isGenerating ? 'Generating…' : 'Generate Short Link'}
          </button>
        )}

        <div className="dialog-actions" style={{ marginTop: '12px' }}>
          <button className="dialog-btn deny" onClick={onClose}>Close</button>
        </div>
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
  const [title, setTitle]               = useState('Untitled')
  useEffect(() => { document.title = `CodePad - ${title}` }, [title])
  const [srcdoc, setSrcdoc]             = useState(() => getInitialConsent().srcdoc)
  const [layout, setLayout]             = useState('row')
  const [jsAllowed, setJsAllowed]       = useState(() => getInitialConsent().allowed)
  const [showClear, setShowClear]       = useState(false)
  const [showShare, setShowShare]       = useState(false)
  const [shareUrl, setShareUrl]         = useState(null)
  const [shareError, setShareError]     = useState(false)
  const [isSharing, setIsSharing]       = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [splitSize, setSplitSize]       = useState(50)
  const [isDragging, setIsDragging]     = useState(false)
  const [consoleLogs, setConsoleLogs]   = useState([])
  const [consoleOpen, setConsoleOpen]   = useState(false)

  const previewDebounceRef = useRef(null)
  const previewDelayRef    = useRef(null)
  const workspaceRef       = useRef(null)
  const editorPanelRef     = useRef(null)
  const jsAllowedRef       = useRef(null)   // always holds latest jsAllowed
  const activeNonceRef     = useRef(getInitialConsent().nonce)  // nonce of the currently live iframe
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

  // Toggle 'has-scrollbar' on the editor panel so the clear button shifts right.
  // setTimeout(0) defers until after @uiw/react-codemirror's own effects have updated the DOM.
  useEffect(() => {
    const panel = editorPanelRef.current
    if (!panel) return
    const id = setTimeout(() => {
      const scroller = panel.querySelector('.cm-scroller')
      if (!scroller) return
      panel.classList.toggle('has-scrollbar', scroller.scrollHeight > scroller.clientHeight)
    }, 0)
    return () => clearTimeout(id)
  }, [code[activeTab]])

  // load code from KV path (takes priority) or fall back to fragment
  useEffect(() => {
    const pathCode = window.location.pathname.slice(1)
    if (pathCode) {
      fetch(`${KVS_URL}/${pathCode}`)
        .then(r => r.json())
        .then(data => {
          if (data && typeof data.html === 'string') {
            setCode(data)
            if (data.title) setTitle(data.title)
            updatePreview(data, null)
          }
        })
        .catch(() => {})
      return // ignore fragment when a share path is present
    }
    const fragData = parseFragment()
    if (fragData) {
      const { title: fragTitle, ...fragCode } = fragData
      setCode(fragCode)
      if (fragTitle) setTitle(fragTitle)
      updatePreview(fragCode, null)
    }
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

  function handleShare() {
    setShowShare(true)
  }

  async function handleGenerateShortLink() {
    // reuse existing link if code hasn't changed since last share
    if (shareUrl && lastSharedCodeRef.current === JSON.stringify({ ...code, title })) return
    setShareUrl(null)
    setShareError(false)
    setIsSharing(true)
    try {
      const res = await fetch(KVS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, html: code.html, css: code.css, js: code.js }),
      })
      if (!res.ok) throw new Error('Request failed')
      const data = await res.json()
      lastSharedCodeRef.current = JSON.stringify({ ...code, title })
      setShareUrl(`${window.location.origin}/${data.id}`)
    } catch {
      setShareUrl(null)
      lastSharedCodeRef.current = null
      setShareError(true)
    } finally {
      setIsSharing(false)
    }
  }

  function handleClearConfirm(clearAll) {
    setCode(prev => {
      const next = clearAll
        ? { html: '', css: '', js: '' }
        : { ...prev, [activeTab]: '' }
      updatePreview(next, null)
      return next
    })
    setShowClear(false)
  }

  function closeShare() {
    setShowShare(false)
    setShareError(false)
    // shareUrl is intentionally kept so the cached link can be reused
  }

  const editorStyle = layout === 'row' ? { width: `${splitSize}%` } : { height: `${splitSize}%` }
  const isEmpty = !code.html.trim() && !code.css.trim() && !code.js.trim()
  const hasJs   = !!code.js.trim() || /<script\b/i.test(code.html)

  function grantConsent(allowed, remember = false) {
    if (allowed && remember) setJsConsentCookie()
    const nonce = Math.random().toString(36).slice(2)
    activeNonceRef.current = nonce
    setJsAllowed(allowed)
    setConsoleLogs([])
    setPreviewLoading(true)
    setSrcdoc(buildSrcdoc(code, allowed, nonce))
  }

  return (
    <div className={`app${isDragging ? ' is-dragging-' + layout : ''}`}>
      {showClear && <ClearDialog tab={activeTab} onConfirm={handleClearConfirm} onClose={() => setShowClear(false)} />}
      {showShare && <ShareDialog code={code} title={title} shortUrl={shareUrl} shortError={shareError} isGenerating={isSharing} onGenerateShortLink={handleGenerateShortLink} onClose={closeShare} />}

      <div className="header">
        <img src="/favicon.png" alt="CodePad" className="header-logo" />
        <div className="header-title-wrap">
          <div className="header-title-sizer" data-value={title}>
            <input
              className="header-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              spellCheck={false}
              aria-label="Project title"
            />
          </div>
        </div>
        <div className="header-actions">
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
      </div>

      <div className="topbar" style={layout === 'row' ? { padding: 0, gap: 0 } : {}}>
        <div className="topbar-tabs" style={layout === 'row' ? { width: `${splitSize}%`, flexShrink: 0, padding: '0 12px' } : {}}>
          {LANGS.map(({ id, label, color }) => (
            <button key={id} className={`tab-btn${activeTab === id ? ' active' : ''}`} style={{ '--tab-color': color }} onClick={() => setActiveTab(id)}>
              {TAB_ICONS[id]}
              {label}
            </button>
          ))}
        </div>
        {layout === 'row' && (
          <div className="topbar-preview-label">Live Preview</div>
        )}
      </div>

      <div className={`workspace ${layout}`} ref={workspaceRef}>
        <div className="editor-panel" style={editorStyle} ref={editorPanelRef}>
          <div className="editor-cm-wrapper">
            <button className="editor-clear-btn" onClick={() => setShowClear(true)} title={`Clear ${activeTab.toUpperCase()}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true">
                <path d="M235.5,216.81c-22.56-11-35.5-34.58-35.5-64.8V134.73a15.94,15.94,0,0,0-10.09-14.87L165,110a8,8,0,0,1-4.48-10.34l21.32-53a28,28,0,0,0-16.1-37,28.14,28.14,0,0,0-35.82,16,.61.61,0,0,0,0,.12L108.9,79a8,8,0,0,1-10.37,4.49L73.11,73.14A15.89,15.89,0,0,0,55.74,76.8C34.68,98.45,24,123.75,24,152a111.45,111.45,0,0,0,31.18,77.53A8,8,0,0,0,61,232H232a8,8,0,0,0,3.5-15.19ZM67.14,88l25.41,10.3a24,24,0,0,0,31.23-13.45l21-53c2.56-6.11,9.47-9.27,15.43-7a12,12,0,0,1,6.88,15.92L145.69,93.76a24,24,0,0,0,13.43,31.14L184,134.73V152c0,.33,0,.66,0,1L55.77,101.71A108.84,108.84,0,0,1,67.14,88Zm48,128a87.53,87.53,0,0,1-24.34-42,8,8,0,0,0-15.49,4,105.16,105.16,0,0,0,18.36,38H64.44A95.54,95.54,0,0,1,40,152a85.9,85.9,0,0,1,7.73-36.29l137.8,55.12c3,18,10.56,33.48,21.89,45.16Z"/>
              </svg>
            </button>
            <CodeMirror
              key={activeTab}
              value={code[activeTab]}
              height="100%"
              theme={dracula}
              extensions={CM_EXTENSIONS[activeTab]}
              onChange={handleChange}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true, tabSize: 2 }}
            />
          </div>
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

        <div className="preview-wrapper">
          {layout === 'column' && <div className="preview-header">Live Preview</div>}
        <div className="preview-panel">
          {isEmpty && <PreviewPlaceholder />}
          {jsAllowed === null && hasJs && (
            <JsConsentDialog onAllow={(remember) => grantConsent(true, remember)} onDeny={() => grantConsent(false)} />
          )}
          {previewLoading && (
            <div className="preview-spinner">
              <div className="preview-spinner__badge">
                <div className="spinner" />
                <span className="preview-spinner__label">Reloading</span>
              </div>
            </div>
          )}
          {(jsAllowed !== null || !hasJs) && (
            <iframe
              key={String(jsAllowed)}
              title="preview"
              sandbox={jsAllowed ? 'allow-scripts allow-modals allow-popups' : 'allow-scripts allow-popups'}
              srcDoc={srcdoc}
              onLoad={() => setPreviewLoading(false)}
            />
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

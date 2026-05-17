import { useState, useCallback, useRef, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { dracula } from '@uiw/codemirror-theme-dracula'
import './App.css'

const KVS_URL = 'https://kvs.cyberbilby.com'
const STORAGE_KEY = 'codepad:autosave:v1'

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
  pages: [{ name: 'index.html', html: '' }],
  css:   '',
  js:    '',
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

function base64DecodeUnicode(base64) {
  try {
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch (e) {
    return null
  }
}

function base64EncodeUnicode(str) {
  const utf8 = new TextEncoder().encode(str)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < utf8.length; i += chunkSize) {
    binary += String.fromCharCode(...utf8.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// Normalize a page filename/path to a canonical route key.
// Examples:
//  - '/about' -> 'about'
//  - 'about.html' -> 'about'
//  - 'services/a/index.html' -> 'services/a'
//  - '' or 'index.html' -> ''
function normalizePath(name) {
  if (!name || typeof name !== 'string') return ''
  let raw = String(name).split('#')[0].split('?')[0].trim()
  raw = raw.replace(/\\/g, '/')
  while (raw.startsWith('./')) raw = raw.slice(2)
  if (raw.startsWith('/')) raw = raw.slice(1)
  raw = raw.replace(/\/\/+/g, '/')
  const parts = raw.split('/')
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p || p === '.') continue
    if (p === '..') { if (out.length) out.pop(); continue }
    out.push(p)
  }
  return out.join('/')
}

function routeKey(name) {
  const p = normalizePath(name)
  if (!p) return ''
  if (p.endsWith('/index.html')) return p.slice(0, -('/index.html'.length)).replace(/\/$/, '')
  if (p.endsWith('.html')) return p.slice(0, -('.html'.length))
  return p.replace(/\/$/, '')
}

function parseFragment() {
  try {
    const hash = window.location.hash.slice(1)
    if (!hash) return null
    const decoded = base64DecodeUnicode(hash)
    if (decoded == null) return null
    const data = JSON.parse(decoded)
    // New multi-page format
    if (Array.isArray(data.pages)) {
      return { pages: data.pages, css: data.css ?? '', js: data.js ?? '', title: data.title ?? null }
    }
    // Legacy single-page format
    if (typeof data.html === 'string' || typeof data.css === 'string' || typeof data.js === 'string') {
      return {
        pages: [{ name: 'index.html', html: data.html ?? '' }],
        css: data.css ?? '',
        js: data.js ?? '',
        title: data.title ?? null,
      }
    }
  } catch {}
  return null
}

function buildFragmentUrl(code, title) {
  const payload = JSON.stringify({ title, pages: code.pages, css: code.css, js: code.js })
  return `${window.location.origin}/#${base64EncodeUnicode(payload)}`
}

function buildSrcdoc(code, pageName, includeJs = true, nonce = '') {
  const page = code.pages.find(p => p.name === pageName) ?? code.pages[0]
  let doc = includeJs ? page.html : stripScripts(page.html)

  // Navigation guard: intercept anchor clicks.
  // - Local .html links → postMessage to parent to switch preview page.
  // - Hash links → smooth-scroll within the iframe.
  // - All other links → open in a new tab.
  const navGuard =
    '<scr' + 'ipt>' +
    '(function(){' +
    'var n="' + nonce + '";' +
    'function handle(e){' +
    'var a=e.target.closest("a");' +
    'if(!a||!a.hasAttribute("href"))return;' +
    'var h=a.getAttribute("href");' +
    'if(!h||h==="#"){return;}' +
    'if(h.startsWith("#")){' +
    'var el=document.getElementById(h.slice(1));' +
    'if(el){var top=el.getBoundingClientRect().top+window.pageYOffset;window.scrollTo({top:top,behavior:"smooth"});}' +
    'e.preventDefault();return;}' +
    'var raw = h.split("#")[0].split("?")[0];' +
    'var path = raw;' +
    'while(path.startsWith("./")) path = path.slice(2);' +
    'if(path.startsWith("/")) path = path.slice(1);' +
    'var parts = path.split("/");' +
    'var normParts = [];' +
    'for(var i=0;i<parts.length;i++){' +
    '  if(parts[i]===""||parts[i]===".") continue;' +
    '  if(parts[i]===".."){ if(normParts.length) normParts.pop(); continue; }' +
    '  normParts.push(parts[i]);' +
    '}' +
    'var norm = normParts.join("/");' +
    'if(!h.includes("://")&&!h.startsWith("//")&&!h.startsWith("mailto")&&!h.startsWith("javascript")){' +
    '  try{parent.postMessage({source:"codepad",nonce:n,type:"navigate",page:norm,href:h},"*")}catch(e_){}' +
    '  e.preventDefault();' +
    '  return;' +
    '}' +
    'window.open(h,"_blank","noopener,noreferrer");' +
    '}' +
    'document.addEventListener("click",handle,true);' +
    'document.addEventListener("auxclick",handle,true);' +
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
    _initConsent = { allowed: cookied ? true : null, nonce, srcdoc: buildSrcdoc(DEFAULT_CODE, 'index.html', cookied, nonce) }
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

// ── HTML page sub-bar ─────────────────────────────────────────────────────────

function PageSettingsDialog({ name, existingNames, onRename, onRemove, onClose }) {
  const [value, setValue]           = useState(name.replace(/\.html$/, ''))
  const [error, setError]           = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  // Close this dialog when the global close event is dispatched (Escape key pressed)
  useEffect(() => {
    const onCloseEvent = () => { try { onClose() } catch (__) {} }
    window.addEventListener('codepad-close-dialog', onCloseEvent)
    return () => window.removeEventListener('codepad-close-dialog', onCloseEvent)
  }, [onClose])

  function handleApply() {
    let n = value.trim()
    if (!n) { setError('Name is required.'); return }
    if (!n.endsWith('.html')) n += '.html'
    // prevent creating a name that collides with another page's route
    if (n !== name && existingNames.some(ex => ex !== name && routeKey(ex) === routeKey(n))) { setError(`"${n}" conflicts with an existing page.`); return }
    onRename(n)
    onClose()
  }

  function handleDelete() {
    onRemove()
    onClose()
  }

  return (
    <div className="dialog-backdrop dialog-backdrop--fixed" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog--left" role="dialog" aria-modal="true" aria-labelledby="pagesettings-title">
        {confirmDelete ? (
          <>
            <h2 id="pagesettings-title">Delete Page?</h2>
            <p style={{ alignSelf: 'flex-start' }}>
              <strong style={{ color: '#e0e0e0' }}>{name}</strong> will be permanently removed. This cannot be undone.
            </p>
            <div className="dialog-actions">
              <button className="dialog-btn deny" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="dialog-btn clear" onClick={handleDelete}>Delete</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="pagesettings-title">Page Settings</h2>
            <p style={{ alignSelf: 'flex-start' }}>Rename the page or delete it entirely.</p>
            <label style={{ alignSelf: 'flex-start', fontSize: 12, color: '#666', marginBottom: -4 }}>File name</label>
            <div className="dialog-input-row">
              <input
                ref={inputRef}
                className="dialog-input"
                value={value}
                onChange={e => { setValue(e.target.value); setError('') }}
                onKeyDown={e => { if (e.key === 'Enter') handleApply(); if (e.key === 'Escape') onClose() }}
              />
              <span className="dialog-input-suffix">.html</span>
            </div>
            {error && <p className="dialog-input-error">{error}</p>}
            <div className="dialog-actions" style={{ flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                <button className="dialog-btn deny" onClick={onClose}>Cancel</button>
                <button className="dialog-btn allow" onClick={handleApply}>Apply</button>
              </div>

              <hr className="horizontal-rule"></hr>

              <button className="dialog-btn clear" style={{ width: '100%' }} onClick={() => setConfirmDelete(true)}>Delete Page</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const GearIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

function HtmlPageTab({ name, isActive, isIndex, onSelect, onRemove, onRename, existingNames }) {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <>
      {showSettings && (
        <PageSettingsDialog
          name={name}
          existingNames={existingNames}
          onRename={onRename}
          onRemove={onRemove}
          onClose={() => setShowSettings(false)}
        />
      )}
      <div className={`html-page-tab${isActive ? ' active' : ''}`}>
        <button className="html-page-tab-btn" onClick={onSelect} title={name}>
          {TAB_ICONS.html}
          {name}
        </button>
        {!isIndex && (
          <button
            className="html-page-tab-gear"
            onClick={e => { e.stopPropagation(); setShowSettings(true) }}
            title="Page settings"
          >
            <GearIcon />
          </button>
        )}
      </div>
    </>
  )
}

function HtmlPageBar({ pages, activePage, layout, splitSize, onSelect, onAdd, onRemove, onRename }) {
  const innerStyle = layout === 'row' ? { width: `${splitSize}%`, flexShrink: 0 } : {}
  return (
    <div className="html-pagebar">
      <div className="html-pagebar-inner" style={innerStyle}>
        {pages.map(page => (
          <HtmlPageTab
            key={page.name}
            name={page.name}
            isActive={activePage === page.name}
            isIndex={page.name === 'index.html'}
            existingNames={pages.map(p => p.name)}
            onSelect={() => onSelect(page.name)}
            onRemove={() => onRemove(page.name)}
            onRename={newName => onRename(page.name, newName)}
          />
        ))}
        <button className="html-page-add-btn" onClick={onAdd} title="Add HTML page">+</button>
      </div>
      {layout === 'row' && <div style={{ flex: 1 }} />}
    </div>
  )
}

function AddPageDialog({ existingNames, onAdd, onClose }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  function handleAdd() {
    let n = name.trim()
    if (!n) { setError('Name is required.'); return }
    if (!n.endsWith('.html')) n += '.html'
    const newKey = routeKey(n)
    if (existingNames.some(ex => routeKey(ex) === newKey)) { setError(`"${n}" conflicts with an existing page.`); return }
    onAdd(n)
    onClose()
  }

  return (
    <div className="dialog-backdrop dialog-backdrop--fixed" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog--left" role="dialog" aria-modal="true" aria-labelledby="addpage-title">
        <h2 id="addpage-title">New HTML Page</h2>
        <p>Enter a name for the new page.</p>
        <div className="dialog-input-row">
          <input
            ref={inputRef}
            className="dialog-input"
            placeholder="e.g. about"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') onClose() }}
          />
          <span className="dialog-input-suffix">.html</span>
        </div>
        {error && <p className="dialog-input-error">{error}</p>}
        <div className="dialog-actions">
          <button className="dialog-btn deny" onClick={onClose}>Cancel</button>
          <button className="dialog-btn allow" onClick={handleAdd}>Add Page</button>
        </div>
      </div>
    </div>
  )
}

function HelpDialog({ onClose, onOpenGuide }) {
  const topics = [
    { id: 'tabs', title: 'Editor Tabs', desc: 'HTML / CSS / JS' },
    { id: 'pages', title: 'Pages', desc: 'Add and manage HTML pages' },
    { id: 'sharing', title: 'Sharing', desc: 'Generate a short URL to share' },
  ]

  return (
    <div className="dialog-backdrop dialog-backdrop--fixed" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <img src="/favicon.png" alt="CodePad" className="dialog-icon-img" />
        <h2 id="help-title">About CodePad</h2>
        <p>CodePad is a lightweight in-browser editor with a live preview. Edit HTML, CSS, and JS, add multiple HTML pages, and share snapshots via short links.</p>

        <div style={{ display: 'grid', gap: '8px', marginTop: '12px', width: '100%' }}>
          {topics.map(t => (
            <button
              key={t.id}
              className="help-topic-btn"
              onClick={() => onOpenGuide(t.id)}
            >
              <strong style={{ lineHeight: 1 }}>{t.title}</strong>
              <div className="help-topic-desc">{t.desc}</div>
            </button>
          ))}
        </div>

        <div className="dialog-actions" style={{ marginTop: '12px' }}>
          <button className="dialog-btn deny" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function GuideDialog({ guide, onBack, onClose }) {
  let title = ''
  let content = null
  if (guide === 'tabs') {
    title = 'Editor Tabs'
    content = (
      <>
        <p>HTML: edit your page markup. When multiple pages exist, use the page tabs to switch between them.</p>
        <p>CSS: global styles applied to the preview.</p>
        <p>JS: JavaScript injected into the preview. You may be asked to allow JS execution for security.</p>
      </>
    )
  } else if (guide === 'pages') {
    title = 'Pages'
    content = (
      <>
        <p>Use the + button next to the HTML tab to add new pages. Rename or remove pages in the page settings menu.</p>
        <p>The special file index.html is served at the root path ("/").</p>
      </>
    )
  } else if (guide === 'sharing') {
    title = 'Sharing'
    content = (
      <>
        <p>Click the Share button to upload a snapshot and get a short URL. The link loads the snapshot in this editor.</p>
        <p>Shared links are stored on a remote key-value service and can be opened by others.</p>
      </>
    )
  }

  return (
    <div className="dialog-backdrop dialog-backdrop--fixed" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog--left" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <h2 id="guide-title">{title}</h2>
        {content}
        <div className="dialog-actions">
          <button className="dialog-btn deny" onClick={onBack}>Back to help</button>
          <button className="dialog-btn allow" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab]       = useState('html')
  const [activePage, setActivePage]     = useState('index.html')
  const [code, setCode]                 = useState(DEFAULT_CODE)
  const [title, setTitle]               = useState('Untitled')
  useEffect(() => { document.title = `CodePad - ${title}` }, [title])
  const [srcdoc, setSrcdoc]             = useState(() => getInitialConsent().srcdoc)
  const [layout, setLayout]             = useState('row')
  const [jsAllowed, setJsAllowed]       = useState(() => getInitialConsent().allowed)
  const [showClear, setShowClear]       = useState(false)
  const [showShare, setShowShare]       = useState(false)
  const [showAddPage, setShowAddPage]   = useState(false)
  // Help dialog state
  const [showHelp, setShowHelp]         = useState(false)
  const [helpView, setHelpView]         = useState('main')
  const [shareUrl, setShareUrl]         = useState(null)
  const [shareError, setShareError]     = useState(false)
  const [isSharing, setIsSharing]       = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [splitSize, setSplitSize]       = useState(50)
  const [isDragging, setIsDragging]     = useState(false)
  const [consoleLogs, setConsoleLogs]   = useState([])
  const [consoleOpen, setConsoleOpen]   = useState(false)
  const [isSourceShared, setIsSourceShared] = useState(null)

  const previewDebounceRef = useRef(null)
  const previewDelayRef    = useRef(null)
  const workspaceRef       = useRef(null)
  const editorPanelRef     = useRef(null)
  const jsAllowedRef       = useRef(null)   // always holds latest jsAllowed
  const activeNonceRef     = useRef(getInitialConsent().nonce)  // nonce of the currently live iframe
  const lastSharedCodeRef  = useRef(null)   // code snapshot at last successful share
  const activePageRef      = useRef('index.html')  // always holds latest activePage
  const codeRef            = useRef(DEFAULT_CODE)  // always holds latest code

  // keep refs in sync
  useEffect(() => { jsAllowedRef.current = jsAllowed }, [jsAllowed])
  useEffect(() => { activePageRef.current = activePage }, [activePage])
  useEffect(() => { codeRef.current = code }, [code])

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.source !== 'codepad') return
      if (e.data.nonce !== activeNonceRef.current) return
      // Inter-page navigation from the preview
      if (e.data.type === 'navigate') {
        const incoming = e.data.page
        const normalize = (name) => {
          if (!name || typeof name !== 'string') return name
          const raw = String(name).split('#')[0].split('?')[0]
          let path = raw
          while (path.startsWith('./')) path = path.slice(2)
          if (path.startsWith('/')) path = path.slice(1)
          const parts = path.split('/')
          const out = []
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i]
            if (!p || p === '.') continue
            if (p === '..') { if (out.length) out.pop(); continue }
            out.push(p)
          }
          return out.join('/')
        }
        const normIncoming = normalize(incoming)
        const findMatch = (incomingVal) => {
          const tryNames = []
          if (typeof incomingVal === 'string') tryNames.push(incomingVal)
          else if (incomingVal && typeof incomingVal === 'object') {
            if (incomingVal.raw) tryNames.push(incomingVal.raw)
            if (incomingVal.norm) tryNames.push(incomingVal.norm)
            if (incomingVal.base) tryNames.push(incomingVal.base)
          }
          tryNames.push(String(incomingVal))

          // Special-case: empty/root path should match index.html if present.
          // If all collected tryNames are empty/falsey, treat as root and prefer index.html pages.
          const nonEmptyTryNames = tryNames.filter(Boolean)
          if (nonEmptyTryNames.length === 0) {
            const idx = codeRef.current.pages.find(p => p.name === 'index.html' || p.name.endsWith('/index.html'))
            if (idx) return idx
          }

          const genCandidates = (s) => {
            const out = new Set()
            if (!s) return []
            const n = normalize(s)
            out.add(n)
            // try with and without .html and with index
            if (!n.endsWith('.html')) {
              out.add(n + '.html')
              out.add(n.replace(/\/$/, '') + '/index.html')
            } else {
              out.add(n.replace(/\.html$/, ''))
            }
            // basename variants
            const base = n.split('/').pop()
            if (base) {
              out.add(base)
              out.add(base + '.html')
              out.add(base.replace(/\.html$/, ''))
            }
            return [...out].filter(Boolean)
          }

          const incomingCandidates = [...new Set(tryNames.filter(Boolean).flatMap(t => genCandidates(t)))]

          // First pass: exact normalized candidate match against pages' candidates
          for (let p of codeRef.current.pages) {
            const pn = normalize(p.name)
            const pcands = genCandidates(pn)
            for (const ic of incomingCandidates) {
              if (pcands.includes(ic) || pn === ic) return p
            }
          }

          // Second pass: basename match ignoring .html
          for (let t of tryNames.filter(Boolean)) {
            const base = String(t).split('/').pop().replace(/\.html$/, '')
            const m = codeRef.current.pages.find(p => normalize(p.name).split('/').pop().replace(/\.html$/, '') === base)
            if (m) return m
          }

          // Third pass: endsWith fallback
          for (let t of incomingCandidates) {
            const m = codeRef.current.pages.find(p => {
              const pn = normalize(p.name)
              return pn === t || pn.endsWith('/' + t) || pn.endsWith(t)
            })
            if (m) return m
          }

          return null
        }
        const match = findMatch(incoming)
        if (match) {
          const pageName = match.name
          activePageRef.current = pageName
          setActivePage(pageName)
          const nonce = Math.random().toString(36).slice(2)
          activeNonceRef.current = nonce
          setSrcdoc(buildSrcdoc(codeRef.current, pageName, jsAllowedRef.current === true, nonce))
        }
        return
      }
      setConsoleLogs(prev => [...prev, {
        id: Date.now() + Math.random(),
        method: e.data.method,
        args: e.data.args,
      }])
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      try {
        if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 's') {
          e.preventDefault()
          setShowShare(true)
          return
        }
        if (e.key === 'Escape') {
          // Close top-level dialogs
          try { setShowShare(false) } catch (_) {}
          try { setShowAddPage(false) } catch (_) {}
          try { setShowClear(false) } catch (_) {}
          // notify nested dialogs (PageSettingsDialog) to close
          try { window.dispatchEvent(new Event('codepad-close-dialog')) } catch (__) {}
        }
      } catch (err) {}
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
        setSrcdoc(buildSrcdoc(next, activePageRef.current, includeJs ?? jsAllowedRef.current === true, nonce))
      }, 500)
    }, 300)
  }, [])

  const handleChange = useCallback((value) => {
    if (activeTab === 'html') {
      setCode(prev => {
        const next = { ...prev, pages: prev.pages.map(p => p.name === activePageRef.current ? { ...p, html: value } : p) }
        updatePreview(next, null)
        return next
      })
    } else {
      setCode(prev => {
        const next = { ...prev, [activeTab]: value }
        updatePreview(next, null)
        return next
      })
    }
  }, [activeTab, updatePreview])

  useEffect(() => () => {
    clearTimeout(previewDebounceRef.current)
    clearTimeout(previewDelayRef.current)
  }, [])

  // Toggle 'has-scrollbar' on the editor panel so the clear button shifts right.
  // setTimeout(0) defers until after @uiw/react-codemirror's own effects have updated the DOM.
  const activeEditorValue = activeTab === 'html'
    ? (code.pages.find(p => p.name === activePage)?.html ?? '')
    : code[activeTab]
  useEffect(() => {
    const panel = editorPanelRef.current
    if (!panel) return
    const id = setTimeout(() => {
      const scroller = panel.querySelector('.cm-scroller')
      if (!scroller) return
      panel.classList.toggle('has-scrollbar', scroller.scrollHeight > scroller.clientHeight)
    }, 0)
    return () => clearTimeout(id)
  }, [activeEditorValue])

  // load code from KV path (takes priority) or fall back to fragment, otherwise load autosave from localStorage
  useEffect(() => {
    const pathCode = window.location.pathname.slice(1)
    if (pathCode) {
      setIsSourceShared(true)
      fetch(`${KVS_URL}/${pathCode}`)
        .then(r => r.json())
        .then(data => {
          if (!data) return
          let loaded
          if (Array.isArray(data.pages)) {
            loaded = { pages: data.pages, css: data.css ?? '', js: data.js ?? '' }
          } else if (typeof data.html === 'string') {
            loaded = { pages: [{ name: 'index.html', html: data.html }], css: data.css ?? '', js: data.js ?? '' }
          }
          if (loaded) {
            setCode(loaded)
            if (data.title) setTitle(data.title)
            updatePreview(loaded, null)
          }
        })
        .catch(() => {})
      return // ignore fragment when a share path is present
    }
    const fragData = parseFragment()
    if (fragData) {
      setIsSourceShared(true)
      const { title: fragTitle, ...fragCode } = fragData
      setCode(fragCode)
      if (fragTitle) setTitle(fragTitle)
      updatePreview(fragCode, null)
      return
    }

    // No share URL or fragment — prefer loading user's last autosaved state from localStorage
    setIsSourceShared(false)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && parsed.code) {
          setCode(parsed.code)
          if (parsed.title) setTitle(parsed.title)
          // restore UI settings if present
          const s = parsed.settings || {}
          if (s.layout) setLayout(s.layout)
          if (typeof s.splitSize === 'number') setSplitSize(s.splitSize)
          if (s.activeTab) setActiveTab(s.activeTab)
          if (s.activePage) { activePageRef.current = s.activePage; setActivePage(s.activePage) }
          if (typeof s.jsAllowed === 'boolean') setJsAllowed(s.jsAllowed)
          if (typeof s.consoleOpen === 'boolean') setConsoleOpen(s.consoleOpen)
          updatePreview(parsed.code, null)
        }
      }
    } catch (e) {}
  }, [updatePreview])

  useEffect(() => {
    // Persist user code + UI settings to localStorage when the page wasn't loaded from a share URL/fragment.
    if (typeof window === 'undefined') return
    if (isSourceShared !== false) return
    try {
      const payload = {
        code: code,
        title: title,
        settings: {
          layout,
          splitSize,
          activeTab,
          activePage,
          jsAllowed,
          consoleOpen,
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (e) {
      // ignore storage errors
    }
  }, [code, title, layout, splitSize, activeTab, activePage, jsAllowed, consoleOpen, isSourceShared])

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
    const snapshot = JSON.stringify({ pages: code.pages, css: code.css, js: code.js, title })
    if (shareUrl && lastSharedCodeRef.current === snapshot) return
    setShareUrl(null)
    setShareError(false)
    setIsSharing(true)
    try {
      const res = await fetch(KVS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, pages: code.pages, css: code.css, js: code.js }),
      })
      if (!res.ok) throw new Error('Request failed')
      const data = await res.json()
      lastSharedCodeRef.current = snapshot
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
      let next
      if (clearAll) {
        next = { pages: prev.pages.map(p => ({ ...p, html: '' })), css: '', js: '' }
      } else if (activeTab === 'html') {
        next = { ...prev, pages: prev.pages.map(p => p.name === activePage ? { ...p, html: '' } : p) }
      } else {
        next = { ...prev, [activeTab]: '' }
      }
      updatePreview(next, null)
      return next
    })
    // If the user cleared all tabs, remove the autosaved state from storage so they truly start fresh.
    try { if (clearAll) localStorage.removeItem(STORAGE_KEY) } catch (e) {}
    setShowClear(false)
  }

  function closeShare() {
    setShowShare(false)
    setShareError(false)
    // shareUrl is intentionally kept so the cached link can be reused
  }

  const editorStyle = layout === 'row' ? { width: `${splitSize}%` } : { height: `${splitSize}%` }
  const isEmpty = code.pages.every(p => !p.html.trim()) && !code.css.trim() && !code.js.trim()
  const hasJs   = !!code.js.trim() || code.pages.some(p => /<script\b/i.test(p.html))

  function switchPage(pageName) {
    activePageRef.current = pageName
    setActivePage(pageName)
    clearTimeout(previewDebounceRef.current)
    clearTimeout(previewDelayRef.current)
    const nonce = Math.random().toString(36).slice(2)
    activeNonceRef.current = nonce
    setConsoleLogs([])
    setPreviewLoading(true)
    setSrcdoc(buildSrcdoc(code, pageName, jsAllowedRef.current === true, nonce))
  }

  function handleAddPage(name) {
    const newKey = routeKey(name)
    if (code.pages.some(p => routeKey(p.name) === newKey)) return
    setCode(prev => ({ ...prev, pages: [...prev.pages, { name, html: '' }] }))
    switchPage(name)
  }

  function handleRemovePage(name) {
    if (name === 'index.html') return
    setCode(prev => ({ ...prev, pages: prev.pages.filter(p => p.name !== name) }))
    if (activePage === name) switchPage('index.html')
  }

  function handleRenamePage(oldName, newName) {
    if (oldName === 'index.html' || !newName || newName === oldName) return
    const newKey = routeKey(newName)
    if (code.pages.some(p => p.name !== oldName && routeKey(p.name) === newKey)) return
    setCode(prev => ({
      ...prev,
      pages: prev.pages.map(p => p.name === oldName ? { ...p, name: newName } : p),
    }))
    if (activePage === oldName) {
      activePageRef.current = newName
      setActivePage(newName)
    }
  }

  function grantConsent(allowed, remember = false) {
    if (allowed && remember) setJsConsentCookie()
    const nonce = Math.random().toString(36).slice(2)
    activeNonceRef.current = nonce
    setJsAllowed(allowed)
    setConsoleLogs([])
    setPreviewLoading(true)
    setSrcdoc(buildSrcdoc(code, activePageRef.current, allowed, nonce))
  }

  return (
    <div className={`app${isDragging ? ' is-dragging-' + layout : ''}`}>
      {showClear && <ClearDialog tab={activeTab} onConfirm={handleClearConfirm} onClose={() => setShowClear(false)} />}
      {showShare && <ShareDialog code={code} title={title} shortUrl={shareUrl} shortError={shareError} isGenerating={isSharing} onGenerateShortLink={handleGenerateShortLink} onClose={closeShare} />}
      {showAddPage && <AddPageDialog existingNames={code.pages.map(p => p.name)} onAdd={handleAddPage} onClose={() => setShowAddPage(false)} />}
      {showHelp && helpView === 'main' && <HelpDialog onClose={() => setShowHelp(false)} onOpenGuide={(g) => setHelpView(g)} />}
      {showHelp && helpView !== 'main' && <GuideDialog guide={helpView} onBack={() => setHelpView('main')} onClose={() => setShowHelp(false)} />}

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
          <button className="layout-btn" onClick={() => { setShowHelp(true); setHelpView('main') }} title="Help">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7.25 5.5a1.25 1.25 0 112.5 0c0 .9-1 1.25-1.25 2-0.23.55.25 1 1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx="8" cy="11" r="0.6" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      <div className="topbar" style={layout === 'row' ? { padding: 0, gap: 0 } : {}}>
        <div className="topbar-tabs" style={layout === 'row' ? { width: `${splitSize}%`, flexShrink: 0, padding: '0 12px' } : {}}>
          {LANGS.map(({ id, label, color }) => (
            id === 'html' && code.pages.length === 1 ? (
              <div
                key={id}
                className={`tab-btn${activeTab === id ? ' active' : ''}`}
                style={{ '--tab-color': color, cursor: 'pointer' }}
                onClick={() => setActiveTab(id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setActiveTab(id)}
              >
                {TAB_ICONS[id]}
                {label}
                <button
                  className="tab-add-page-btn"
                  title="Add HTML page"
                  onClick={e => { e.stopPropagation(); setActiveTab('html'); setShowAddPage(true) }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ) : (
              <button key={id} className={`tab-btn${activeTab === id ? ' active' : ''}`} style={{ '--tab-color': color }} onClick={() => setActiveTab(id)}>
                {TAB_ICONS[id]}
                {label}
              </button>
            )
          ))}
        </div>
        {layout === 'row' && (
          <div className="topbar-preview-label">Live Preview</div>
        )}
      </div>

      {code.pages.length > 1 && (
        <HtmlPageBar
          pages={code.pages}
          activePage={activePage}
          layout={layout}
          splitSize={splitSize}
          onSelect={switchPage}
          onAdd={() => setShowAddPage(true)}
          onRemove={handleRemovePage}
          onRename={handleRenamePage}
        />
      )}

      <div className={`workspace ${layout}`} ref={workspaceRef}>
        <div className="editor-panel" style={editorStyle} ref={editorPanelRef}>
          <div className="editor-cm-wrapper">
            <button className="editor-clear-btn" onClick={() => setShowClear(true)} title={`Clear ${activeTab.toUpperCase()}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true">
                <path d="M235.5,216.81c-22.56-11-35.5-34.58-35.5-64.8V134.73a15.94,15.94,0,0,0-10.09-14.87L165,110a8,8,0,0,1-4.48-10.34l21.32-53a28,28,0,0,0-16.1-37,28.14,28.14,0,0,0-35.82,16,.61.61,0,0,0,0,.12L108.9,79a8,8,0,0,1-10.37,4.49L73.11,73.14A15.89,15.89,0,0,0,55.74,76.8C34.68,98.45,24,123.75,24,152a111.45,111.45,0,0,0,31.18,77.53A8,8,0,0,0,61,232H232a8,8,0,0,0,3.5-15.19ZM67.14,88l25.41,10.3a24,24,0,0,0,31.23-13.45l21-53c2.56-6.11,9.47-9.27,15.43-7a12,12,0,0,1,6.88,15.92L145.69,93.76a24,24,0,0,0,13.43,31.14L184,134.73V152c0,.33,0,.66,0,1L55.77,101.71A108.84,108.84,0,0,1,67.14,88Zm48,128a87.53,87.53,0,0,1-24.34-42,8,8,0,0,0-15.49,4,105.16,105.16,0,0,0,18.36,38H64.44A95.54,95.54,0,0,1,40,152a85.9,85.9,0,0,1,7.73-36.29l137.8,55.12c3,18,10.56,33.48,21.89,45.16Z"/>
              </svg>
            </button>
            <CodeMirror
              key={activeTab === 'html' ? `html-${activePage}` : activeTab}
              value={activeEditorValue}
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

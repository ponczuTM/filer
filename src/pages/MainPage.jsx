import { useState, useEffect, useRef, useCallback } from 'react';
import s from './MainPage.module.css';

const API = '/api';

const BUNDLE_EXTS = new Set([
  'app',
  'framework',
  'bundle',
  'plugin',
  'kext',
  'xcodeproj',
  'xcworkspace',
  'xctestplan',
  'dsym',
  'appex',
  'prefpane',
  'qlgenerator',
  'component',
  'systemextension',
]);

const EXT_GROUPS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'],
  video: ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
  text: [
    'txt',
    'md',
    'js',
    'jsx',
    'ts',
    'tsx',
    'json',
    'html',
    'css',
    'xml',
    'yaml',
    'yml',
    'sh',
    'bash',
    'py',
    'rb',
    'go',
    'rs',
    'c',
    'cpp',
    'h',
    'java',
    'php',
    'csv',
    'log',
    'env',
  ],
  pdf: ['pdf'],
  zip: ['zip', 'tar', 'gz', 'rar', '7z'],
};

function isMacBundle(entryName) {
  const extension = entryName.split('.').pop()?.toLowerCase() ?? '';
  return BUNDLE_EXTS.has(extension);
}

function getFileType(name) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';

  for (const [type, extensions] of Object.entries(EXT_GROUPS)) {
    if (extensions.includes(extension)) {
      return type;
    }
  }

  return 'other';
}

function isPreviewable(name) {
  return ['image', 'video', 'audio', 'text', 'pdf'].includes(getFileType(name));
}

function formatSize(bytes) {
  const value = Number(bytes);

  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;

  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso) {
  if (!iso) return '—';

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createUploadId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getErrorMessage(payload, fallback = 'Wystąpił nieznany błąd.') {
  if (typeof payload === 'string' && payload.trim()) return payload;

  if (payload && typeof payload === 'object') {
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }

    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
  }

  return fallback;
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let data = null;

  try {
    data = isJson ? await response.json() : await response.text();
  } catch {
    data = null;
  }

  if (!response.ok || data?.error === true) {
    throw new Error(
      getErrorMessage(
        data,
        `Żądanie nie powiodło się (${response.status} ${response.statusText || 'Błąd HTTP'}).`
      )
    );
  }

  return data;
}

async function apiFetch(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`Błąd sieci: ${error.message || 'nie można połączyć się z serwerem.'}`);
  }

  return parseResponse(response);
}

async function copyToClipboard(text) {
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');

    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand('copy');

    textarea.remove();

    return copied;
  }
}

let jsZipModule = null;

async function getJSZip() {
  if (jsZipModule) return jsZipModule;

  const module = await import('jszip');
  jsZipModule = module.default ?? module;

  return jsZipModule;
}

async function packBundleAsZip(entry) {
  const JSZip = await getJSZip();
  const zip = new JSZip();

  async function addEntry(currentEntry, zipPath) {
    if (currentEntry.isFile) {
      const blob = await new Promise((resolve, reject) => {
        currentEntry.file(resolve, reject);
      });

      zip.file(zipPath, blob);
      return;
    }

    if (!currentEntry.isDirectory) return;

    const reader = currentEntry.createReader();

    await new Promise((resolve, reject) => {
      const readAll = () => {
        reader.readEntries(
          async batch => {
            try {
              if (batch.length === 0) {
                resolve();
                return;
              }

              for (const child of batch) {
                await addEntry(child, `${zipPath}/${child.name}`);
              }

              readAll();
            } catch (error) {
              reject(error);
            }
          },
          reject
        );
      };

      readAll();
    });
  }

  await addEntry(entry, entry.name);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
  });

  return new File([blob], `${entry.name}.zip`, {
    type: 'application/zip',
  });
}

function Icon({ name, size = 16 }) {
  const icons = {
    folder: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    image: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
    video: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
    audio: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
    text: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    pdf: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M9 15h6M9 18h4" />
      </svg>
    ),
    zip: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <polyline points="21 8 21 21 3 21 3 8" />
        <rect x="1" y="3" width="22" height="5" />
        <line x1="10" y1="12" x2="14" y2="12" />
      </svg>
    ),
    other: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
    eye: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    download: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    trash: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    ),
    plus: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
    folder_plus: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </svg>
    ),
    close: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
    upload: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <polyline points="16 16 12 12 8 16" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      </svg>
    ),
    home: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    chevron: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    ),
    check: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    note: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    server: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <rect x="3" y="3" width="18" height="7" rx="2" />
        <rect x="3" y="14" width="18" height="7" rx="2" />
        <line x1="7" y1="6.5" x2="7.01" y2="6.5" strokeWidth="3" />
        <line x1="7" y1="17.5" x2="7.01" y2="17.5" strokeWidth="3" />
      </svg>
    ),
  };

  return icons[name] ?? icons.other;
}

function ErrorBox({ error, onClose }) {
  if (!error) return null;

  return (
    <div role="alert" className={s.errorBox}>
      <div>
        <strong>Błąd</strong>
        <div>{error}</div>
      </div>
      {onClose && (
        <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Zamknij komunikat błędu">
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

function ServerStatus({ serverStatus, onRefresh }) {
  const disk = serverStatus?.disk;
  const online = serverStatus?.online === true;

  return (
    <div className={s.serverStatus} data-online={online ? 'true' : 'false'}>
      <div className={s.serverStatusMain}>
        <Icon name="server" size={16} />
        <span>
          Serwer: <strong>{online ? 'online' : 'niedostępny'}</strong>
        </span>
      </div>

      {disk && (
        <span className={s.diskStatus}>
          Wolne miejsce: <strong>{formatSize(disk.availableBytes)}</strong>
          {disk.totalBytes ? ` z ${formatSize(disk.totalBytes)}` : ''}
        </span>
      )}

      {serverStatus?.message && !online && (
        <span className={s.serverStatusError}>{serverStatus.message}</span>
      )}

      <button type="button" className={s.btnSecondary} onClick={onRefresh}>
        Odśwież status
      </button>
    </div>
  );
}

function UploadStatus({ uploadState, onCancel }) {
  if (!uploadState || uploadState.status === 'idle') return null;

  const percent = Math.max(0, Math.min(100, Number(uploadState.percent) || 0));
  const isError = uploadState.status === 'Błąd';
  const isSuccess = uploadState.status === 'Sukces';
  const isActive = !isError && !isSuccess;

  return (
    <div className={s.uploadStatus} data-status={uploadState.status}>
      <div className={s.uploadStatusHeader}>
        <div>
          <strong>{uploadState.status}</strong>
          <span>{uploadState.message}</span>
        </div>

        <strong>{percent}%</strong>
      </div>

      <div className={s.progressTrack} aria-label={`Postęp uploadu: ${percent}%`}>
        <div
          className={s.progressBar}
          style={{ width: `${percent}%` }}
          data-status={uploadState.status}
        />
      </div>

      <div className={s.uploadStatusMeta}>
        <span>
          {formatSize(uploadState.loadedBytes)} / {formatSize(uploadState.totalBytes)}
        </span>

        {uploadState.filesCount > 0 && (
          <span>Pliki: {uploadState.filesCount}</span>
        )}

        {isActive && onCancel && (
          <button type="button" className={s.btnDanger} onClick={onCancel}>
            Anuluj upload
          </button>
        )}
      </div>

      {uploadState.error && <div className={s.uploadError}>{uploadState.error}</div>}
    </div>
  );
}

function NotePanel({ currentPath, onError, onSuccess }) {
  const [content, setContent] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef(null);
  const initialLoadRef = useRef(false);
  const copyTimeoutRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    initialLoadRef.current = false;
    setSaveStatus('idle');
    setCopied(false);
    clearTimeout(debounceRef.current);
    clearTimeout(copyTimeoutRef.current);

    apiFetch(`${API}/note?path=${encodeURIComponent(currentPath)}`)
      .then(data => {
        if (cancelled) return;

        setContent(data.content ?? '');
        initialLoadRef.current = true;
      })
      .catch(error => {
        if (cancelled) return;

        setContent('');
        initialLoadRef.current = true;
        setSaveStatus('error');
        onError(`Nie udało się wczytać notatki: ${error.message}`);
      });

    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
      clearTimeout(copyTimeoutRef.current);
    };
  }, [currentPath, onError]);

  async function saveNote(value) {
    try {
      const data = await apiFetch(`${API}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, content: value }),
      });

      setSaveStatus('saved');

      if (data.disk) {
        onSuccess(`Notatka zapisana. Wolne miejsce: ${formatSize(data.disk.availableBytes)}.`);
      }

      window.setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      setSaveStatus('error');
      onError(`Nie udało się zapisać notatki: ${error.message}`);
    }
  }

  function handleChange(event) {
    const value = event.target.value;

    setContent(value);

    if (!initialLoadRef.current) return;

    setSaveStatus('saving');
    clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(() => {
      saveNote(value);
    }, 800);
  }

  async function handleCopy() {
    const success = await copyToClipboard(content);

    if (!success) {
      onError('Nie udało się skopiować treści.');
      return;
    }

    clearTimeout(copyTimeoutRef.current);
    setCopied(true);

    copyTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
    }, 1000);
  }

  return (
    <div className={s.notePanel}>
      <div className={s.notePanelHeader}>
        <span className={s.notePanelTitle}>
          <Icon name="note" size={14} />
          Notatka katalogu
        </span>

        <span className={s.noteSaveStatus} data-status={saveStatus}>
          {saveStatus === 'saving' && 'Zapisywanie…'}
          {saveStatus === 'saved' && 'Zapisano'}
          {saveStatus === 'error' && 'Błąd zapisu'}
        </span>
      </div>

      <div className={s.noteFieldRow}>
        <textarea
          className={s.noteTextarea}
          placeholder="Wpisz notatki, komendy, opisy… (autosave)"
          value={content}
          onChange={handleChange}
          spellCheck={false}
        />

        <button
          type="button"
          className={`${s.copyBtn} ${copied ? s.copyBtnCopied : ''}`}
          onClick={handleCopy}
          disabled={!content.trim()}
          aria-live="polite"
        >
          {copied ? 'Skopiowano' : 'Kopiuj'}
        </button>
      </div>
    </div>
  );
}

function PreviewModal({ file, filePath, onClose, onError }) {
  const type = getFileType(file.name);
  const url = `${API}/preview?path=${encodeURIComponent(filePath)}`;

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalBox} onClick={event => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>{file.name}</span>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Zamknij">
            <Icon name="close" />
          </button>
        </div>

        <div className={s.modalBody}>
          {type === 'image' && (
            <img
              src={url}
              alt={file.name}
              className={s.previewImg}
              onError={() => onError(`Nie udało się wyświetlić obrazu "${file.name}".`)}
            />
          )}

          {type === 'video' && (
            <video controls className={s.previewVideo} onError={() => onError(`Nie udało się odtworzyć filmu "${file.name}".`)}>
              <source src={url} />
            </video>
          )}

          {type === 'audio' && (
            <audio controls style={{ width: '100%' }} onError={() => onError(`Nie udało się odtworzyć audio "${file.name}".`)}>
              <source src={url} />
            </audio>
          )}

          {type === 'pdf' && (
            <iframe
              src={url}
              className={s.previewIframe}
              title={file.name}
              onError={() => onError(`Nie udało się wyświetlić PDF "${file.name}".`)}
            />
          )}

          {type === 'text' && <TextPreview url={url} onError={onError} />}
        </div>
      </div>
    </div>
  );
}

function TextPreview({ url, onError }) {
  const [text, setText] = useState('Ładowanie...');

  useEffect(() => {
    let cancelled = false;

    fetch(url)
      .then(async response => {
        if (!response.ok) {
          const textResponse = await response.text();

          try {
            const parsed = JSON.parse(textResponse);
            throw new Error(getErrorMessage(parsed));
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new Error(textResponse || `Błąd HTTP ${response.status}.`);
            }

            throw error;
          }
        }

        return response.text();
      })
      .then(content => {
        if (!cancelled) setText(content);
      })
      .catch(error => {
        if (cancelled) return;

        const message = `Nie można wczytać pliku tekstowego: ${error.message}`;
        setText(message);
        onError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [url, onError]);

  return <pre className={s.previewText}>{text}</pre>;
}

function ConfirmModal({ items, onConfirm, onCancel }) {
  return (
    <div className={s.modalOverlay} onClick={onCancel}>
      <div className={`${s.modalBox} ${s.modalBoxSm}`} onClick={event => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>Potwierdź usunięcie</span>
          <button type="button" className={s.iconBtn} onClick={onCancel} aria-label="Zamknij">
            <Icon name="close" />
          </button>
        </div>

        <div className={s.modalFooter}>
          <p className={s.modalText}>
            Usunąć {items.length === 1 ? `"${items[0]}"` : `${items.length} elementów`}? Tej operacji nie można cofnąć.
          </p>

          <div className={s.modalActions}>
            <button type="button" className={s.btnSecondary} onClick={onCancel}>
              Anuluj
            </button>
            <button type="button" className={s.btnDanger} onClick={onConfirm}>
              Usuń
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewFolderModal({ currentPath, onCreated, onCancel, onError }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();

    if (!trimmed) {
      setError('Podaj nazwę katalogu.');
      return;
    }

    if (/[/\\:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
      setError('Nazwa katalogu zawiera niedozwolone znaki.');
      return;
    }

    const relativePath = currentPath ? `${currentPath}/${trimmed}` : trimmed;

    try {
      setCreating(true);
      setError('');

      await apiFetch(`${API}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relativePath }),
      });

      onCreated();
    } catch (requestError) {
      const message = `Nie udało się utworzyć katalogu: ${requestError.message}`;
      setError(message);
      onError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={s.modalOverlay} onClick={onCancel}>
      <div className={`${s.modalBox} ${s.modalBoxXs}`} onClick={event => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>Nowy katalog</span>
          <button type="button" className={s.iconBtn} onClick={onCancel} aria-label="Zamknij">
            <Icon name="close" />
          </button>
        </div>

        <div className={s.newFolderBody}>
          <input
            autoFocus
            className={s.input}
            placeholder="Nazwa katalogu"
            value={name}
            disabled={creating}
            onChange={event => {
              setName(event.target.value);
              setError('');
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !creating) {
                handleCreate();
              }
            }}
          />

          {error && <span className={s.errorText}>{error}</span>}

          <div className={s.modalActions}>
            <button type="button" className={s.btnSecondary} onClick={onCancel} disabled={creating}>
              Anuluj
            </button>
            <button type="button" className={s.btnPrimary} onClick={handleCreate} disabled={creating}>
              {creating ? 'Tworzenie…' : 'Utwórz'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({
  entry,
  filePath,
  isSelected,
  onSelect,
  onNavigate,
  onPreview,
  onDownload,
  onDelete,
  onDrop,
  disabled,
}) {
  const fileType = entry.isDirectory ? 'folder' : getFileType(entry.name);
  const [tileDragOver, setTileDragOver] = useState(false);
  const dragCounter = useRef(0);

  function handleDragEnter(event) {
    if (!entry.isDirectory || disabled) return;

    event.preventDefault();
    event.stopPropagation();

    dragCounter.current += 1;
    setTileDragOver(true);
  }

  function handleDragLeave(event) {
    if (!entry.isDirectory || disabled) return;

    event.preventDefault();
    event.stopPropagation();

    dragCounter.current -= 1;

    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setTileDragOver(false);
    }
  }

  function handleDragOver(event) {
    if (!entry.isDirectory || disabled) return;

    event.preventDefault();
    event.stopPropagation();
  }

  async function handleDrop(event) {
    if (!entry.isDirectory || disabled) return;

    event.preventDefault();
    event.stopPropagation();

    dragCounter.current = 0;
    setTileDragOver(false);

    await onDrop(event, entry.name);
  }

  return (
    <div
      className={`${s.tile} ${isSelected ? s.tileSelected : ''} ${tileDragOver ? s.tileDragOver : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <button
        type="button"
        className={`${s.tileCheckbox} ${isSelected ? s.tileCheckboxActive : ''}`}
        onClick={event => {
          event.stopPropagation();
          onSelect(entry.name);
        }}
        disabled={disabled}
        aria-label={isSelected ? 'Odznacz' : 'Zaznacz'}
      >
        {isSelected && <Icon name="check" size={12} />}
      </button>

      <div
        className={s.tileMain}
        onClick={() => {
          if (entry.isDirectory && !disabled) {
            onNavigate(entry.name);
          }
        }}
        style={{ cursor: entry.isDirectory && !disabled ? 'pointer' : 'default' }}
      >
        <div
          className={s.tileIcon}
          style={{
            color: entry.isDirectory ? 'var(--color-gold)' : 'var(--color-text-muted)',
          }}
        >
          <Icon name={fileType} size={36} />
        </div>

        <div className={s.tileName} title={entry.name}>
          {entry.name}
        </div>

        <div className={s.tileMeta}>
          {!entry.isDirectory && <span>{formatSize(entry.size)}</span>}
          {entry.isDirectory && <span className={s.tileTypeLabel}>Katalog</span>}
        </div>

        <div className={s.tileDate}>{formatDate(entry.modified)}</div>
      </div>

      <div className={s.tileActions}>
        {!entry.isDirectory && isPreviewable(entry.name) && (
          <button
            type="button"
            className={s.tileBtn}
            title="Podgląd"
            disabled={disabled}
            onClick={event => {
              event.stopPropagation();
              onPreview({ file: entry, filePath });
            }}
          >
            <Icon name="eye" size={18} />
          </button>
        )}

        <button
          type="button"
          className={s.tileBtn}
          title="Pobierz"
          disabled={disabled}
          onClick={event => {
            event.stopPropagation();
            onDownload(entry.name);
          }}
        >
          <Icon name="download" size={18} />
        </button>

        <button
          type="button"
          className={`${s.tileBtn} ${s.tileBtnDanger}`}
          title="Usuń"
          disabled={disabled}
          onClick={event => {
            event.stopPropagation();
            onDelete([entry.name]);
          }}
        >
          <Icon name="trash" size={18} />
        </button>
      </div>
    </div>
  );
}

export default function MainPage() {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [serverStatus, setServerStatus] = useState({
    online: false,
    disk: null,
    message: 'Status serwera nie został jeszcze pobrany.',
  });
  const [uploadState, setUploadState] = useState({
    status: 'idle',
    percent: 0,
    message: '',
    error: null,
    loadedBytes: 0,
    totalBytes: 0,
    filesCount: 0,
  });

  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const activeXhrRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const serverStatusIntervalRef = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    window.clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });

    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
    }, 4500);
  }, []);

  const showError = useCallback(message => {
    const fullMessage = getErrorMessage(message);

    setError(fullMessage);
    showToast(fullMessage, 'error');
  }, [showToast]);

  const fetchServerStatus = useCallback(async () => {
    try {
      const data = await apiFetch(`${API}/status`);

      setServerStatus({
        online: data.server?.status === 'online',
        disk: data.disk ?? null,
        limits: data.limits ?? null,
        message: '',
      });

      return data;
    } catch (requestError) {
      const message = `Nie można pobrać stanu serwera: ${requestError.message}`;

      setServerStatus({
        online: false,
        disk: null,
        limits: null,
        message,
      });

      return null;
    }
  }, []);

  const loadDir = useCallback(async (pathToLoad = currentPath) => {
    setLoading(true);
    setSelected(new Set());

    try {
      const data = await apiFetch(`${API}/files?path=${encodeURIComponent(pathToLoad)}`);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (requestError) {
      setEntries([]);
      showError(`Nie udało się wczytać katalogu: ${requestError.message}`);
    } finally {
      setLoading(false);
    }
  }, [currentPath, showError]);

  useEffect(() => {
    loadDir(currentPath);
  }, [currentPath, loadDir]);

  useEffect(() => {
    fetchServerStatus();

    serverStatusIntervalRef.current = window.setInterval(() => {
      fetchServerStatus();
    }, 30000);

    return () => {
      window.clearInterval(serverStatusIntervalRef.current);
      window.clearTimeout(toastTimeoutRef.current);

      if (activeXhrRef.current) {
        activeXhrRef.current.abort();
      }
    };
  }, [fetchServerStatus]);

  function navigateTo(name) {
    setCurrentPath(previous => (previous ? `${previous}/${name}` : name));
  }

  const breadcrumbs = currentPath ? currentPath.split('/') : [];

  function toggleSelect(name) {
    setSelected(previous => {
      const next = new Set(previous);

      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }

      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(entries.map(entry => entry.name)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  const allSelected = entries.length > 0 && selected.size === entries.length;
  const noneSelected = selected.size === 0;
  const selectedArray = [...selected];
  const uploadInProgress = ['Przygotowanie', 'Przesyłanie', 'Weryfikacja', 'Sprawdzanie miejsca'].includes(uploadState.status);

  function buildFormData(fileList, targetPath) {
    const formData = new FormData();

    formData.append('path', targetPath);

    for (const file of fileList) {
      const relativeName = file.webkitRelativePath || file.name;
      const uploadFile = new File([file], relativeName, {
        type: file.type,
        lastModified: file.lastModified,
      });

      formData.append('files', uploadFile);
    }

    return formData;
  }

  function uploadWithProgress(formData, uploadId, totalFileBytes, filesCount) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      activeXhrRef.current = xhr;

      xhr.open('POST', `${API}/upload`, true);
      xhr.setRequestHeader('X-Upload-Id', uploadId);
      xhr.responseType = 'text';

      xhr.upload.onloadstart = () => {
        setUploadState({
          status: 'Przesyłanie',
          percent: 0,
          message: 'Rozpoczynanie przesyłania plików.',
          error: null,
          loadedBytes: 0,
          totalBytes: totalFileBytes,
          filesCount,
        });
      };

      xhr.upload.onprogress = event => {
        const total = event.lengthComputable ? event.total : totalFileBytes;
        const loaded = event.loaded;
        const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;

        setUploadState(previous => ({
          ...previous,
          status: 'Przesyłanie',
          percent,
          message: `Przesyłanie danych: ${formatSize(loaded)} z ${formatSize(total)}.`,
          error: null,
          loadedBytes: loaded,
          totalBytes: total || totalFileBytes,
          filesCount,
        }));
      };

      xhr.upload.onerror = () => {
        reject(new Error('Przesyłanie zostało przerwane przez błąd sieci.'));
      };

      xhr.upload.onabort = () => {
        reject(new Error('Przesyłanie zostało anulowane.'));
      };

      xhr.onerror = () => {
        reject(new Error('Nie można połączyć się z serwerem podczas wysyłania plików.'));
      };

      xhr.onabort = () => {
        reject(new Error('Przesyłanie zostało anulowane.'));
      };

      xhr.onload = () => {
        let responseData = null;

        try {
          responseData = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          responseData = xhr.responseText;
        }

        if (xhr.status >= 200 && xhr.status < 300 && responseData?.error !== true) {
          resolve(responseData);
          return;
        }

        reject(
          new Error(
            getErrorMessage(
              responseData,
              `Serwer odrzucił upload (${xhr.status} ${xhr.statusText || 'Błąd HTTP'}).`
            )
          )
        );
      };

      xhr.send(formData);
    });
  }

  async function uploadFilesToPath(fileList, targetPath) {
    if (!Array.isArray(fileList) || fileList.length === 0) {
      showError('Nie wybrano żadnych plików do przesłania.');
      return;
    }

    if (uploadInProgress) {
      showError('Inny upload jest już w toku. Poczekaj na jego zakończenie lub anuluj go.');
      return;
    }

    const totalFileBytes = fileList.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const diskAvailable = serverStatus.disk?.availableBytes;
    const reserved = serverStatus.disk?.reservedBytes || 0;
    const safeAvailable = Math.max(0, Number(diskAvailable || 0) - Number(reserved || 0));

    if (diskAvailable != null && totalFileBytes > safeAvailable) {
      const message = `Za mało miejsca na serwerze. Pliki mają ${formatSize(totalFileBytes)}, a dostępne miejsce po rezerwie to ${formatSize(safeAvailable)}.`;

      setUploadState({
        status: 'Błąd',
        percent: 0,
        message,
        error: message,
        loadedBytes: 0,
        totalBytes: totalFileBytes,
        filesCount: fileList.length,
      });

      showError(message);
      return;
    }

    const uploadId = createUploadId();
    const formData = buildFormData(fileList, targetPath);

    setError(null);
    setUploadState({
      status: 'Przygotowanie',
      percent: 0,
      message: 'Przygotowywanie plików do wysłania.',
      error: null,
      loadedBytes: 0,
      totalBytes: totalFileBytes,
      filesCount: fileList.length,
    });

    try {
      const response = await uploadWithProgress(formData, uploadId, totalFileBytes, fileList.length);

      setUploadState({
        status: 'Sukces',
        percent: 100,
        message: response.upload?.message || `Pomyślnie przesłano ${response.uploaded ?? fileList.length} plików.`,
        error: null,
        loadedBytes: totalFileBytes,
        totalBytes: totalFileBytes,
        filesCount: response.uploaded ?? fileList.length,
      });

      if (response.disk) {
        setServerStatus(previous => ({
          ...previous,
          online: true,
          disk: response.disk,
          message: '',
        }));
      } else {
        fetchServerStatus();
      }

      const uploaded = response.uploaded ?? fileList.length;
      showToast(`Pomyślnie wgrano ${uploaded} plik${uploaded === 1 ? '' : uploaded < 5 ? 'i' : 'ów'}.`);

      await loadDir(currentPath);
    } catch (requestError) {
      const message = `Upload nie powiódł się: ${requestError.message}`;

      setUploadState(previous => ({
        ...previous,
        status: 'Błąd',
        percent: previous.percent || 0,
        message,
        error: message,
      }));

      showError(message);
      fetchServerStatus();
    } finally {
      activeXhrRef.current = null;
    }
  }

  async function uploadFiles(fileList) {
    await uploadFilesToPath(fileList, currentPath);
  }

  function handleFileInputChange(event) {
    const files = Array.from(event.target.files || []);
    uploadFiles(files);
    event.target.value = '';
  }

  function handleDragEnter(event) {
    event.preventDefault();

    if (uploadInProgress) return;

    dragCounter.current += 1;

    if (dragCounter.current === 1) {
      setDragging(true);
    }
  }

  function handleDragLeave(event) {
    event.preventDefault();

    if (uploadInProgress) return;

    dragCounter.current -= 1;

    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  async function handleDrop(event) {
    event.preventDefault();

    if (uploadInProgress) {
      showError('Nie można dodać plików, ponieważ upload już trwa.');
      return;
    }

    dragCounter.current = 0;
    setDragging(false);

    try {
      const items = event.dataTransfer.items;
      const files = items?.length
        ? await collectFilesPreservingStructure(items)
        : Array.from(event.dataTransfer.files || []);

      await uploadFiles(files);
    } catch (dropError) {
      showError(`Nie udało się przygotować plików do uploadu: ${dropError.message}`);
    }
  }

  async function handleTileDrop(event, folderName) {
    event.preventDefault();

    if (uploadInProgress) {
      showError('Nie można dodać plików, ponieważ upload już trwa.');
      return;
    }

    dragCounter.current = 0;
    setDragging(false);

    const targetPath = currentPath ? `${currentPath}/${folderName}` : folderName;

    try {
      const items = event.dataTransfer.items;
      const files = items?.length
        ? await collectFilesPreservingStructure(items)
        : Array.from(event.dataTransfer.files || []);

      await uploadFilesToPath(files, targetPath);
    } catch (dropError) {
      showError(`Nie udało się przygotować plików do uploadu: ${dropError.message}`);
    }
  }

  async function collectFilesPreservingStructure(dataTransferItems) {
    const files = [];
    const packedBundles = [];

    async function traverseEntry(entry, relativePath) {
      if (entry.isFile) {
        const sourceFile = await new Promise((resolve, reject) => {
          entry.file(resolve, reject);
        });

        files.push(
          new File([sourceFile], relativePath, {
            type: sourceFile.type,
            lastModified: sourceFile.lastModified,
          })
        );

        return;
      }

      if (!entry.isDirectory) return;

      if (isMacBundle(entry.name)) {
        try {
          const zipped = await packBundleAsZip(entry);
          const parentPath = relativePath.includes('/')
            ? relativePath.slice(0, relativePath.lastIndexOf('/'))
            : '';

          const zipPath = parentPath ? `${parentPath}/${zipped.name}` : zipped.name;

          files.push(
            new File([zipped], zipPath, {
              type: 'application/zip',
              lastModified: Date.now(),
            })
          );

          packedBundles.push(entry.name);
        } catch (bundleError) {
          throw new Error(`Nie udało się spakować pakietu "${entry.name}": ${bundleError.message}`);
        }

        return;
      }

      const reader = entry.createReader();

      await new Promise((resolve, reject) => {
        const readAll = () => {
          reader.readEntries(
            async batch => {
              try {
                if (batch.length === 0) {
                  resolve();
                  return;
                }

                for (const child of batch) {
                  await traverseEntry(child, `${relativePath}/${child.name}`);
                }

                readAll();
              } catch (error) {
                reject(error);
              }
            },
            reject
          );
        };

        readAll();
      });
    }

    for (const item of dataTransferItems) {
      const entry = item.webkitGetAsEntry?.();

      if (!entry) {
        const file = item.getAsFile?.();

        if (file) files.push(file);

        continue;
      }

      await traverseEntry(entry, entry.name);
    }

    if (packedBundles.length > 0) {
      const message = packedBundles.length === 1
        ? `"${packedBundles[0]}" został spakowany jako ZIP.`
        : `${packedBundles.length} pakietów macOS zostało spakowanych jako ZIP.`;

      showToast(message);
    }

    return files;
  }

  function cancelUpload() {
    if (activeXhrRef.current) {
      activeXhrRef.current.abort();
    }
  }

  async function downloadItem(name) {
    try {
      const entry = entries.find(item => item.name === name);

      if (!entry) {
        throw new Error(`Nie znaleziono "${name}" na aktualnej liście.`);
      }

      if (entry.isDirectory) {
        await downloadSelected([name]);
        return;
      }

      const filePath = currentPath ? `${currentPath}/${name}` : name;
      const response = await fetch(`${API}/file?path=${encodeURIComponent(filePath)}`);

      if (!response.ok) {
        await parseResponse(response);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = objectUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (requestError) {
      showError(`Nie udało się pobrać "${name}": ${requestError.message}`);
    }
  }

  async function downloadSelected(names = selectedArray) {
    if (!names.length) {
      showError('Wybierz co najmniej jeden element do pobrania.');
      return;
    }

    try {
      if (names.length === 1) {
        const entry = entries.find(item => item.name === names[0]);

        if (entry && !entry.isDirectory) {
          await downloadItem(names[0]);
          return;
        }
      }

      const response = await fetch(`${API}/download-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: names,
          basePath: currentPath,
        }),
      });

      if (!response.ok) {
        await parseResponse(response);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = objectUrl;
      link.download = 'filer_download.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (requestError) {
      showError(`Nie udało się przygotować pobierania: ${requestError.message}`);
    }
  }

  function requestDelete(names) {
    setConfirmDelete(names);
  }

  async function confirmDeleteItems() {
    const names = confirmDelete;

    if (!Array.isArray(names) || names.length === 0) {
      setConfirmDelete(null);
      showError('Nie wybrano elementów do usunięcia.');
      return;
    }

    try {
      const data = await apiFetch(`${API}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: names,
          basePath: currentPath,
        }),
      });

      const removedCount = data.removed?.length ?? 0;
      const missingCount = data.notFound?.length ?? 0;

      setConfirmDelete(null);

      if (missingCount > 0) {
        showToast(
          `Usunięto ${removedCount} elementów. Nie znaleziono: ${data.notFound.join(', ')}.`,
          'error'
        );
      } else {
        showToast(`Usunięto ${removedCount} element${removedCount === 1 ? '' : 'ów'}.`);
      }

      await loadDir(currentPath);
      fetchServerStatus();
    } catch (requestError) {
      showError(`Nie udało się usunąć elementów: ${requestError.message}`);
    }
  }

  return (
    <div
      className={s.app}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragging && !uploadInProgress && (
        <div className={s.dropOverlay}>
          <div className={s.dropBox}>
            <Icon name="upload" size={48} />
            <p style={{ marginTop: 16, fontSize: 'var(--text-lg)', fontWeight: 600 }}>
              Upuść pliki lub katalogi tutaj
            </p>
            <p className={s.textMuted} style={{ marginTop: 4 }}>
              Wgrywanie do: /{currentPath || 'root'}
            </p>
            <p className={s.textFaint} style={{ marginTop: 4, fontSize: 'var(--text-xs)' }}>
              Pakiety macOS (.app, .framework i podobne) zostaną spakowane do ZIP.
            </p>
          </div>
        </div>
      )}

      <header className={s.header}>
        <div className={s.headerLogo}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="FILER logo">
            <rect width="28" height="28" rx="7" fill="var(--color-primary)" />
            <path d="M6 10h7.5L16 7h6v14H6V10z" fill="none" stroke="white" strokeWidth="1.75" strokeLinejoin="round" />
            <line x1="14" y1="13" x2="14" y2="18" stroke="white" strokeWidth="1.75" />
            <polyline points="11 16 14 19 17 16" fill="none" stroke="white" strokeWidth="1.75" />
          </svg>
          <span className={s.headerTitle}>FILER</span>
        </div>

        <div className={s.headerActions}>
          <button
            type="button"
            className={s.btnSecondary}
            onClick={() => setShowNewFolder(true)}
            disabled={uploadInProgress}
          >
            <Icon name="folder_plus" size={14} />
            Nowy katalog
          </button>

          <button
            type="button"
            className={s.btnPrimary}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadInProgress}
          >
            <Icon name="plus" size={14} />
            Dodaj pliki
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
            disabled={uploadInProgress}
          />
        </div>
      </header>

      <ServerStatus serverStatus={serverStatus} onRefresh={fetchServerStatus} />

      <ErrorBox error={error} onClose={() => setError(null)} />

      <UploadStatus uploadState={uploadState} onCancel={cancelUpload} />

      <div className={s.breadcrumbs}>
        <button
          type="button"
          className={s.breadcrumbBtn}
          onClick={() => setCurrentPath('')}
          disabled={uploadInProgress}
          aria-label="Przejdź do katalogu głównego"
        >
          <Icon name="home" size={14} />
        </button>

        {breadcrumbs.map((crumb, index) => (
          <span key={`${crumb}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--color-text-faint)' }}>
              <Icon name="chevron" size={12} />
            </span>

            <button
              type="button"
              className={s.breadcrumbBtn}
              style={index === breadcrumbs.length - 1 ? { color: 'var(--color-text)', fontWeight: 500 } : {}}
              disabled={uploadInProgress}
              onClick={() => setCurrentPath(breadcrumbs.slice(0, index + 1).join('/'))}
            >
              {crumb}
            </button>
          </span>
        ))}
      </div>

      <div className={s.selectionBar}>
        <div className={s.selectionBarLeft}>
          <button
            type="button"
            className={allSelected ? s.btnPrimary : s.btnSecondary}
            onClick={selectAll}
            disabled={entries.length === 0 || uploadInProgress}
          >
            Zaznacz wszystkie
          </button>

          <button
            type="button"
            className={s.btnSecondary}
            onClick={deselectAll}
            disabled={noneSelected || uploadInProgress}
          >
            Odznacz
          </button>

          {selectedArray.length > 0 && (
            <span className={s.selectionCount}>
              Zaznaczono: <strong>{selectedArray.length}</strong>
            </span>
          )}
        </div>

        <div className={s.selectionBarRight}>
          {selectedArray.length > 0 && (
            <>
              <button
                type="button"
                className={s.btnSecondary}
                onClick={() => downloadSelected()}
                disabled={uploadInProgress}
              >
                <Icon name="download" size={14} />
                Pobierz ({selectedArray.length})
              </button>

              <button
                type="button"
                className={s.btnDanger}
                onClick={() => requestDelete(selectedArray)}
                disabled={uploadInProgress}
              >
                <Icon name="trash" size={14} />
                Usuń ({selectedArray.length})
              </button>
            </>
          )}
        </div>
      </div>

      <div className={s.gridWrapper}>
        {loading ? (
          <div className={s.tileGrid}>
            {[...Array(6)].map((_, index) => (
              <div key={index} className={s.tileSkeleton}>
                <div className={`${s.skeleton} ${s.skeletonIcon}`} />
                <div className={`${s.skeleton} ${s.skeletonText}`} />
                <div className={`${s.skeleton} ${s.skeletonTextSm}`} />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className={s.emptyState}>
            <div style={{ color: 'var(--color-text-faint)', marginBottom: 12 }}>
              <Icon name="folder" size={48} />
            </div>
            <p style={{ color: 'var(--color-text)', fontWeight: 500, marginBottom: 4 }}>
              Ten katalog jest pusty
            </p>
            <p className={s.textFaint}>
              Przeciągnij pliki lub katalogi albo kliknij „Dodaj pliki”.
            </p>
          </div>
        ) : (
          <div className={s.tileGrid}>
            {entries.map(entry => {
              const filePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

              return (
                <Tile
                  key={entry.name}
                  entry={entry}
                  filePath={filePath}
                  isSelected={selected.has(entry.name)}
                  onSelect={toggleSelect}
                  onNavigate={navigateTo}
                  onPreview={setPreview}
                  onDownload={downloadItem}
                  onDelete={requestDelete}
                  onDrop={handleTileDrop}
                  disabled={uploadInProgress}
                />
              );
            })}
          </div>
        )}
      </div>

      <NotePanel currentPath={currentPath} onError={showError} onSuccess={showToast} />

      {preview && (
        <PreviewModal
          file={preview.file}
          filePath={preview.filePath}
          onClose={() => setPreview(null)}
          onError={showError}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          items={confirmDelete}
          onConfirm={confirmDeleteItems}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showNewFolder && (
        <NewFolderModal
          currentPath={currentPath}
          onCreated={async () => {
            setShowNewFolder(false);
            showToast('Katalog został utworzony.');
            await loadDir(currentPath);
          }}
          onCancel={() => setShowNewFolder(false)}
          onError={showError}
        />
      )}

      {toast && (
        <div className={`${s.toast} ${toast.type === 'error' ? s.toastError : s.toastSuccess}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
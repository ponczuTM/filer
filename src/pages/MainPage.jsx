import { useState, useEffect, useRef, useCallback } from 'react';
import s from './MainPage.module.css';

const API = 'http://192.168.68.247:9876/api';

const BUNDLE_EXTS = new Set([
  'app', 'framework', 'bundle', 'plugin', 'kext',
  'xcodeproj', 'xcworkspace', 'xctestplan',
  'dSYM', 'appex', 'prefPane', 'qlgenerator',
  'component', 'systemextension',
]);

function isMacBundle(entryName) {
  const ext = entryName.split('.').pop()?.toLowerCase() ?? '';
  return BUNDLE_EXTS.has(ext);
}

const EXT_GROUPS = {
  image: ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'],
  video: ['mp4','webm','ogg','mov','mkv','avi'],
  audio: ['mp3','wav','ogg','flac','aac','m4a'],
  text:  ['txt','md','js','jsx','ts','tsx','json','html','css','xml','yaml','yml',
          'sh','bash','py','rb','go','rs','c','cpp','h','java','php','csv','log','env'],
  pdf:   ['pdf'],
  zip:   ['zip','tar','gz','rar','7z'],
};

function getFileType(name) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const [type, exts] of Object.entries(EXT_GROUPS)) {
    if (exts.includes(ext)) return type;
  }
  return 'other';
}

function isPreviewable(name) {
  const t = getFileType(name);
  return ['image','video','audio','text','pdf'].includes(t);
}

function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

let _jszip = null;
async function getJSZip() {
  if (_jszip) return _jszip;
  const mod = await import('jszip');
  _jszip = mod.default ?? mod;
  return _jszip;
}

async function packBundleAsZip(entry) {
  const JSZip = await getJSZip();
  const zip = new JSZip();
  async function addEntry(e, zipPath) {
    if (e.isFile) {
      const blob = await new Promise((resolve, reject) => e.file(resolve, reject));
      zip.file(zipPath, blob);
    } else if (e.isDirectory) {
      const reader = e.createReader();
      await new Promise(resolve => {
        const readAll = () =>
          reader.readEntries(async batch => {
            if (batch.length === 0) return resolve();
            for (const sub of batch) await addEntry(sub, zipPath + '/' + sub.name);
            readAll();
          });
        readAll();
      });
    }
  }
  await addEntry(entry, entry.name);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return new File([blob], entry.name + '.zip', { type: 'application/zip' });
}

const Icon = ({ name, size = 16 }) => {
  const icons = {
    folder:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    image:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
    video:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>,
    audio:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
    text:       <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    pdf:        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6M9 18h4"/></svg>,
    zip:        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
    other:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
    eye:        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    download:   <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    trash:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
    plus:       <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    folder_plus:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>,
    close:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    upload:     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>,
    home:       <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    chevron:    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
    check:      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    note:       <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  };
  return icons[name] ?? icons.other;
};

// ─── Note Panel ───────────────────────────────────────────────────────────────
function NotePanel({ currentPath }) {
  const [content, setContent] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const debounceRef = useRef(null);
  const initialLoadRef = useRef(false);

  useEffect(() => {
    initialLoadRef.current = false;
    setSaveStatus('idle');
    fetch(API + '/note?path=' + encodeURIComponent(currentPath))
      .then(r => r.json())
      .then(data => {
        setContent(data.content ?? '');
        initialLoadRef.current = true;
      })
      .catch(() => {
        setContent('');
        initialLoadRef.current = true;
      });
  }, [currentPath]);

  function handleChange(e) {
    const val = e.target.value;
    setContent(val);
    if (!initialLoadRef.current) return;
    setSaveStatus('saving');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(API + '/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: currentPath, content: val }),
        });
        setSaveStatus(res.ok ? 'saved' : 'error');
        if (res.ok) setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
      }
    }, 800);
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
          {saveStatus === 'saved'  && '✓ Zapisano'}
          {saveStatus === 'error'  && '✗ Błąd zapisu'}
        </span>
      </div>
      <textarea
        className={s.noteTextarea}
        placeholder="Wpisz notatki, komendy, opisy… (autosave)"
        value={content}
        onChange={handleChange}
        spellCheck={false}
      />
    </div>
  );
}

function PreviewModal({ file, filePath, onClose }) {
  const type = getFileType(file.name);
  const url = API + '/preview?path=' + encodeURIComponent(filePath);
  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalBox} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>{file.name}</span>
          <button className={s.iconBtn} onClick={onClose} aria-label="Zamknij"><Icon name="close" /></button>
        </div>
        <div className={s.modalBody}>
          {type === 'image' && <img src={url} alt={file.name} className={s.previewImg} />}
          {type === 'video' && <video controls className={s.previewVideo}><source src={url} /></video>}
          {type === 'audio' && <audio controls style={{ width: '100%' }}><source src={url} /></audio>}
          {type === 'pdf'   && <iframe src={url} className={s.previewIframe} title={file.name} />}
          {type === 'text'  && <TextPreview url={url} />}
        </div>
      </div>
    </div>
  );
}

function TextPreview({ url }) {
  const [text, setText] = useState('Ładowanie...');
  useEffect(() => {
    fetch(url).then(r => r.text()).then(setText).catch(() => setText('Nie można wczytać pliku.'));
  }, [url]);
  return <pre className={s.previewText}>{text}</pre>;
}

function ConfirmModal({ items, onConfirm, onCancel }) {
  return (
    <div className={s.modalOverlay} onClick={onCancel}>
      <div className={s.modalBox + ' ' + s.modalBoxSm} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>Potwierdź usunięcie</span>
          <button className={s.iconBtn} onClick={onCancel}><Icon name="close" /></button>
        </div>
        <div className={s.modalFooter}>
          <p className={s.modalText}>
            Usunąć {items.length === 1 ? '"' + items[0] + '"' : items.length + ' elementów'}? Tej operacji nie można cofnąć.
          </p>
          <div className={s.modalActions}>
            <button className={s.btnSecondary} onClick={onCancel}>Anuluj</button>
            <button className={s.btnDanger} onClick={onConfirm}>Usuń</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewFolderModal({ currentPath, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Podaj nazwę katalogu');
    if (/[/\\:*?"<>|]/.test(trimmed)) return setError('Niedozwolone znaki w nazwie');
    const relPath = currentPath ? currentPath + '/' + trimmed : trimmed;
    const res = await fetch(API + '/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath }),
    });
    if (res.ok) onCreated();
    else setError('Nie udało się utworzyć katalogu');
  }
  return (
    <div className={s.modalOverlay} onClick={onCancel}>
      <div className={s.modalBox + ' ' + s.modalBoxXs} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>Nowy katalog</span>
          <button className={s.iconBtn} onClick={onCancel}><Icon name="close" /></button>
        </div>
        <div className={s.newFolderBody}>
          <input
            autoFocus
            className={s.input}
            placeholder="Nazwa katalogu"
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          {error && <span className={s.errorText}>{error}</span>}
          <div className={s.modalActions}>
            <button className={s.btnSecondary} onClick={onCancel}>Anuluj</button>
            <button className={s.btnPrimary} onClick={handleCreate}>Utwórz</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tile component ──────────────────────────────────────────────────────────
function Tile({ entry, filePath, isSelected, onSelect, onNavigate, onPreview, onDownload, onDelete, onDrop }) {
  const fileType = entry.isDirectory ? 'folder' : getFileType(entry.name);
  const [tileDragOver, setTileDragOver] = useState(false);
  const dragCounter = useRef(0);

  function handleDragEnter(e) {
    if (!entry.isDirectory) return;
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    setTileDragOver(true);
  }
  function handleDragLeave(e) {
    if (!entry.isDirectory) return;
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setTileDragOver(false);
  }
  function handleDragOver(e) {
    if (!entry.isDirectory) return;
    e.preventDefault(); e.stopPropagation();
  }
  async function handleDrop(e) {
    if (!entry.isDirectory) return;
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setTileDragOver(false);
    onDrop(e, entry.name);
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
        className={`${s.tileCheckbox} ${isSelected ? s.tileCheckboxActive : ''}`}
        onClick={e => { e.stopPropagation(); onSelect(entry.name); }}
        aria-label={isSelected ? 'Odznacz' : 'Zaznacz'}
      >
        {isSelected && <Icon name="check" size={12} />}
      </button>

      <div
        className={s.tileMain}
        onClick={() => entry.isDirectory ? onNavigate(entry.name) : null}
        style={{ cursor: entry.isDirectory ? 'pointer' : 'default' }}
      >
        <div className={s.tileIcon} style={{ color: entry.isDirectory ? 'var(--color-gold)' : 'var(--color-text-muted)' }}>
          <Icon name={fileType} size={36} />
        </div>
        <div className={s.tileName} title={entry.name}>{entry.name}</div>
        <div className={s.tileMeta}>
          {!entry.isDirectory && <span>{formatSize(entry.size)}</span>}
          {entry.isDirectory && <span className={s.tileTypeLabel}>Katalog</span>}
        </div>
        <div className={s.tileDate}>{formatDate(entry.modified)}</div>
      </div>

      <div className={s.tileActions}>
        {!entry.isDirectory && isPreviewable(entry.name) && (
          <button className={s.tileBtn} title="Podgląd" onClick={e => { e.stopPropagation(); onPreview({ file: entry, filePath }); }}>
            <Icon name="eye" size={18} />
          </button>
        )}
        <button className={s.tileBtn} title="Pobierz" onClick={e => { e.stopPropagation(); onDownload(entry.name); }}>
          <Icon name="download" size={18} />
        </button>
        <button className={`${s.tileBtn} ${s.tileBtnDanger}`} title="Usuń" onClick={e => { e.stopPropagation(); onDelete([entry.name]); }}>
          <Icon name="trash" size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
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
  const fileInputRef = useRef();
  const dragCounter = useRef(0);

  const loadDir = useCallback(async (p = currentPath) => {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(API + '/files?path=' + encodeURIComponent(p));
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch {
      showToast('Błąd połączenia z serwerem', 'error');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => { loadDir(currentPath); }, [currentPath]);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  function navigateTo(name) {
    setCurrentPath(prev => prev ? prev + '/' + name : name);
  }

  const breadcrumbs = currentPath ? currentPath.split('/') : [];

  function toggleSelect(name) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(entries.map(e => e.name))); }
  function deselectAll() { setSelected(new Set()); }
  const allSelected = entries.length > 0 && selected.size === entries.length;
  const noneSelected = selected.size === 0;

  async function uploadFilesToPath(fileList, targetPath) {
    if (!fileList.length) return;
    const form = new FormData();
    form.append('path', targetPath);
    for (const f of fileList) {
      const relativeName = f.webkitRelativePath || f.name;
      form.append('files', new File([f], relativeName, { type: f.type }));
    }
    const res = await fetch(API + '/upload', { method: 'POST', body: form });
    if (res.ok) {
      const { uploaded } = await res.json();
      showToast('Wgrano ' + uploaded + ' plik' + (uploaded === 1 ? '' : uploaded < 5 ? 'i' : 'ów'));
      loadDir();
    } else {
      showToast('Błąd podczas uploadu', 'error');
    }
  }

  async function uploadFiles(fileList) {
    await uploadFilesToPath(fileList, currentPath);
  }

  function handleFileInputChange(e) {
    uploadFiles(Array.from(e.target.files));
    e.target.value = '';
  }

  function handleDragEnter(e) {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragging(true);
  }
  function handleDragLeave(e) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }
  function handleDragOver(e) { e.preventDefault(); }

  async function handleDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const items = e.dataTransfer.items;
    const files = items && items.length > 0
      ? await collectFilesPreservingStructure(items)
      : Array.from(e.dataTransfer.files);
    await uploadFiles(files);
  }

  async function handleTileDrop(e, folderName) {
    const targetPath = currentPath ? currentPath + '/' + folderName : folderName;
    dragCounter.current = 0;
    setDragging(false);
    const items = e.dataTransfer.items;
    const files = items && items.length > 0
      ? await collectFilesPreservingStructure(items)
      : Array.from(e.dataTransfer.files);
    await uploadFilesToPath(files, targetPath);
  }

  async function collectFilesPreservingStructure(dataTransferItems) {
    const files = [];
    const bundlesPacked = [];

    async function traverseEntry(entry, relativePath) {
      if (entry.isFile) {
        await new Promise(resolve =>
          entry.file(f => {
            files.push(new File([f], relativePath, { type: f.type }));
            resolve();
          })
        );
      } else if (entry.isDirectory) {
        if (isMacBundle(entry.name)) {
          try {
            const zipped = await packBundleAsZip(entry);
            const parent = relativePath.includes('/')
              ? relativePath.substring(0, relativePath.lastIndexOf('/'))
              : '';
            const zipPath = parent ? parent + '/' + zipped.name : zipped.name;
            files.push(new File([zipped], zipPath, { type: 'application/zip' }));
            bundlesPacked.push(entry.name);
          } catch (err) {
            console.error('Błąd pakowania bundle:', err);
            showToast('Błąd pakowania "' + entry.name + '"', 'error');
          }
        } else {
          const reader = entry.createReader();
          await new Promise(resolve => {
            const readAll = () =>
              reader.readEntries(async batch => {
                if (batch.length === 0) return resolve();
                for (const sub of batch) await traverseEntry(sub, relativePath + '/' + sub.name);
                readAll();
              });
            readAll();
          });
        }
      }
    }

    for (const item of dataTransferItems) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;
      await traverseEntry(entry, entry.name);
    }

    if (bundlesPacked.length > 0) {
      const msg = bundlesPacked.length === 1
        ? '"' + bundlesPacked[0] + '" spakowany jako ZIP'
        : bundlesPacked.length + ' bundlów spakowanych jako ZIP';
      showToast(msg);
    }
    return files;
  }

  async function downloadItem(name) {
    const filePath = currentPath ? currentPath + '/' + name : name;
    const entry = entries.find(e => e.name === name);
    if (entry?.isDirectory) {
      downloadSelected([name]);
    } else {
      const a = document.createElement('a');
      a.href = API + '/file?path=' + encodeURIComponent(filePath);
      a.download = name;
      a.click();
    }
  }

  async function downloadSelected(names = [...selected]) {
    if (!names.length) return;
    if (names.length === 1) {
      const entry = entries.find(e => e.name === names[0]);
      if (entry && !entry.isDirectory) return downloadItem(names[0]);
    }
    const res = await fetch(API + '/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: names, basePath: currentPath }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filer_download.zip';
    a.click();
    URL.revokeObjectURL(url);
  }

  function requestDelete(names) { setConfirmDelete(names); }

  async function confirmDeleteItems() {
    const names = confirmDelete;
    setConfirmDelete(null);
    const res = await fetch(API + '/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: names, basePath: currentPath }),
    });
    if (res.ok) {
      showToast('Usunięto ' + names.length + ' element' + (names.length === 1 ? '' : 'y'));
      loadDir();
    } else {
      showToast('Błąd podczas usuwania', 'error');
    }
  }

  const selectedArr = [...selected];

  return (
    <div
      className={s.app}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className={s.dropOverlay}>
          <div className={s.dropBox}>
            <Icon name="upload" size={48} />
            <p style={{ marginTop: 16, fontSize: 'var(--text-lg)', fontWeight: 600 }}>
              Upuść pliki lub katalogi tutaj
            </p>
            <p className={s.textMuted} style={{ marginTop: 4 }}>
              Wgrywa do: /{currentPath || 'root'}
            </p>
            <p className={s.textFaint} style={{ marginTop: 4, fontSize: 'var(--text-xs)' }}>
              Pakiety macOS (.app, .framework…) zostaną spakowane do ZIP
            </p>
          </div>
        </div>
      )}

      <header className={s.header}>
        <div className={s.headerLogo}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="FILER logo">
            <rect width="28" height="28" rx="7" fill="var(--color-primary)"/>
            <path d="M6 10h7.5L16 7h6v14H6V10z" fill="none" stroke="white" strokeWidth="1.75" strokeLinejoin="round"/>
            <line x1="14" y1="13" x2="14" y2="18" stroke="white" strokeWidth="1.75"/>
            <polyline points="11 16 14 19 17 16" fill="none" stroke="white" strokeWidth="1.75"/>
          </svg>
          <span className={s.headerTitle}>FILER</span>
        </div>
        <div className={s.headerActions}>
          <button className={s.btnSecondary} onClick={() => setShowNewFolder(true)}>
            <Icon name="folder_plus" size={14} />
            Nowy katalog
          </button>
          <button className={s.btnPrimary} onClick={() => fileInputRef.current?.click()}>
            <Icon name="plus" size={14} />
            Dodaj pliki
          </button>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileInputChange} />
        </div>
      </header>

      <div className={s.breadcrumbs}>
        <button className={s.breadcrumbBtn} onClick={() => setCurrentPath('')}>
          <Icon name="home" size={14} />
        </button>
        {breadcrumbs.map((crumb, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--color-text-faint)' }}><Icon name="chevron" size={12} /></span>
            <button
              className={s.breadcrumbBtn}
              style={i === breadcrumbs.length - 1 ? { color: 'var(--color-text)', fontWeight: 500 } : {}}
              onClick={() => setCurrentPath(breadcrumbs.slice(0, i + 1).join('/'))}
            >
              {crumb}
            </button>
          </span>
        ))}
      </div>

      <div className={s.selectionBar}>
        <div className={s.selectionBarLeft}>
          <button className={allSelected ? s.btnPrimary : s.btnSecondary} onClick={selectAll} disabled={entries.length === 0}>
            Zaznacz wszystkie
          </button>
          <button className={s.btnSecondary} onClick={deselectAll} disabled={noneSelected}>
            Odznacz
          </button>
          {selectedArr.length > 0 && (
            <span className={s.selectionCount}>
              Zaznaczono: <strong>{selectedArr.length}</strong>
            </span>
          )}
        </div>
        <div className={s.selectionBarRight}>
          {selectedArr.length > 0 && (
            <>
              <button className={s.btnSecondary} onClick={() => downloadSelected()}>
                <Icon name="download" size={14} />
                Pobierz ({selectedArr.length})
              </button>
              <button className={s.btnDanger} onClick={() => requestDelete(selectedArr)}>
                <Icon name="trash" size={14} />
                Usuń ({selectedArr.length})
              </button>
            </>
          )}
        </div>
      </div>

      <div className={s.gridWrapper}>
        {loading ? (
          <div className={s.tileGrid}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className={s.tileSkeleton}>
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
            <p style={{ color: 'var(--color-text)', fontWeight: 500, marginBottom: 4 }}>Ten katalog jest pusty</p>
            <p className={s.textFaint}>Przeciągnij pliki lub katalogi, albo kliknij „Dodaj pliki"</p>
          </div>
        ) : (
          <div className={s.tileGrid}>
            {entries.map(entry => {
              const filePath = currentPath ? currentPath + '/' + entry.name : entry.name;
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
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Notatka katalogu - zawsze widoczna pod gridem */}
      <NotePanel currentPath={currentPath} />

      {preview && <PreviewModal file={preview.file} filePath={preview.filePath} onClose={() => setPreview(null)} />}
      {confirmDelete && <ConfirmModal items={confirmDelete} onConfirm={confirmDeleteItems} onCancel={() => setConfirmDelete(null)} />}
      {showNewFolder && (
        <NewFolderModal
          currentPath={currentPath}
          onCreated={() => { setShowNewFolder(false); loadDir(); showToast('Katalog utworzony'); }}
          onCancel={() => setShowNewFolder(false)}
        />
      )}

      {toast && (
        <div className={s.toast + ' ' + (toast.type === 'error' ? s.toastError : s.toastSuccess)}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
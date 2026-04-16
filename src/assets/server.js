import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;
const FILES_DIR = path.join(__dirname, 'files');
const NOTE_FILENAME = '.filer_note';

if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

function resolveSafePath(relPath = '') {
  const resolved = path.resolve(FILES_DIR, relPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(FILES_DIR)) throw new Error('Path traversal denied');
  return resolved;
}

function readDirEntries(dirPath) {
  return fs.readdirSync(dirPath)
    .filter(name => name !== NOTE_FILENAME) // ukryj plik notatki
    .map(name => {
      const full = path.join(dirPath, name);
      const stat = fs.statSync(full);
      return {
        name,
        isDirectory: stat.isDirectory(),
        size: stat.isDirectory() ? null : stat.size,
        modified: stat.mtime.toISOString(),
      };
    }).sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

// ============= ENDPOINTY Z REGEXP =============

app.get(/^\/api\/download\/(.+)$/, (req, res) => {
  try {
    const filename = req.params[0];
    const filePath = resolveSafePath(filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) return res.status(400).json({ error: 'Cannot download directory, use /api/download-zip/...' });
    res.download(filePath, path.basename(filePath));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get(/^\/api\/download-zip\/(.+)$/, (req, res) => {
  try {
    const dirname = req.params[0];
    const dirPath = resolveSafePath(dirname);
    if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Directory not found' });
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return res.status(400).json({ error: 'Not a directory' });
    const archive = archiver('zip', { zlib: { level: 6 } });
    const zipName = `${path.basename(dirname)}.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Type', 'application/zip');
    archive.pipe(res);
    archive.directory(dirPath, path.basename(dirname));
    archive.finalize();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get(/^\/api\/get\/(.+)$/, (req, res) => {
  try {
    const resourcePath = req.params[0];
    const fullPath = resolveSafePath(resourcePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Resource not found' });
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      const archive = archiver('zip', { zlib: { level: 6 } });
      const zipName = `${path.basename(resourcePath)}.zip`;
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
      res.setHeader('Content-Type', 'application/zip');
      archive.pipe(res);
      archive.directory(fullPath, path.basename(resourcePath));
      archive.finalize();
    } else {
      res.download(fullPath, path.basename(resourcePath));
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ============= POZOSTAŁE ENDPOINTY =============

app.get('/api/files', (req, res) => {
  try {
    const dir = resolveSafePath(req.query.path || '');
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
      return res.status(404).json({ error: 'Directory not found' });
    res.json(readDirEntries(dir));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/file', (req, res) => {
  try {
    const filePath = resolveSafePath(req.query.path || '');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory())
      return res.status(404).json({ error: 'File not found' });
    res.download(filePath);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/preview', (req, res) => {
  try {
    const filePath = resolveSafePath(req.query.path || '');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory())
      return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(filePath);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/download-zip', (req, res) => {
  try {
    const { items, basePath = '' } = req.body;
    const dir = resolveSafePath(basePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    res.setHeader('Content-Disposition', 'attachment; filename="download.zip"');
    res.setHeader('Content-Type', 'application/zip');
    archive.pipe(res);
    for (const name of items) {
      const full = path.join(dir, name);
      if (!full.startsWith(FILES_DIR)) continue;
      if (!fs.existsSync(full)) continue;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) archive.directory(full, name);
      else archive.file(full, { name });
    }
    archive.finalize();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ============= NOTATKI =============

app.get('/api/note', (req, res) => {
  try {
    const dirPath = resolveSafePath(req.query.path || '');
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
      return res.status(404).json({ error: 'Directory not found' });
    const notePath = path.join(dirPath, NOTE_FILENAME);
    const content = fs.existsSync(notePath) ? fs.readFileSync(notePath, 'utf8') : '';
    res.json({ content });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/note', (req, res) => {
  try {
    const { path: relPath = '', content = '' } = req.body;
    const dirPath = resolveSafePath(relPath);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
      return res.status(404).json({ error: 'Directory not found' });
    const notePath = path.join(dirPath, NOTE_FILENAME);
    fs.writeFileSync(notePath, content, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ============= UPLOAD =============

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const basePath = req.body.path || req.query.path || '';
      const relativeDir = path.dirname(file.originalname.includes('/') ? file.originalname : '.');
      const targetDir = path.resolve(FILES_DIR, basePath, relativeDir === '.' ? '' : relativeDir);
      if (!targetDir.startsWith(FILES_DIR)) return cb(new Error('Path traversal'));
      fs.mkdirSync(targetDir, { recursive: true });
      cb(null, targetDir);
    } catch (e) { cb(e); }
  },
  filename: (req, file, cb) => { cb(null, path.basename(file.originalname)); },
});
const upload = multer({ storage });

app.post('/api/upload', upload.array('files'), (req, res) => {
  res.json({ uploaded: req.files.length });
});

app.post('/api/mkdir', (req, res) => {
  try {
    const { path: relPath } = req.body;
    const full = resolveSafePath(relPath);
    fs.mkdirSync(full, { recursive: true });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/delete', (req, res) => {
  try {
    const { items, basePath = '' } = req.body;
    for (const name of items) {
      const full = path.join(resolveSafePath(basePath), name);
      if (!full.startsWith(FILES_DIR)) continue;
      if (!fs.existsSync(full)) continue;
      fs.rmSync(full, { recursive: true, force: true });
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`FileCloud backend running on http://localhost:${PORT}`));
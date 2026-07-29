import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = 2233;
const FILES_DIR = path.resolve(process.env.FILES_DIR || path.join(__dirname, 'files'));
const NOTE_FILENAME = '.filer_note';

const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024 * 1024);
const MAX_TOTAL_UPLOAD_BYTES = Number(process.env.MAX_TOTAL_UPLOAD_BYTES || 20 * 1024 * 1024 * 1024);
const RESERVED_DISK_SPACE_BYTES = Number(process.env.RESERVED_DISK_SPACE_BYTES || 512 * 1024 * 1024);
const UPLOAD_PROGRESS_TTL_MS = Number(process.env.UPLOAD_PROGRESS_TTL_MS || 30 * 60 * 1000);

const uploadProgress = new Map();

await fsp.mkdir(FILES_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function normalizeErrorMessage(error) {
  if (!error) return 'Wystąpił nieznany błąd serwera.';
  if (typeof error === 'string') return error;

  const codeMessages = {
    ENOENT: 'Nie znaleziono wskazanego pliku lub katalogu.',
    EACCES: 'Brak uprawnień do wykonania tej operacji.',
    EPERM: 'System operacyjny odmówił wykonania tej operacji.',
    ENOSPC: 'Brak wolnego miejsca na dysku serwera.',
    EEXIST: 'Plik lub katalog o tej nazwie już istnieje.',
    ENOTDIR: 'Wskazana ścieżka nie jest katalogiem.',
    EISDIR: 'Wskazana ścieżka jest katalogiem, a nie plikiem.',
    ENAMETOOLONG: 'Nazwa pliku lub ścieżka jest zbyt długa.',
    EBUSY: 'Plik jest aktualnie używany przez inny proces.',
    EMFILE: 'Serwer osiągnął limit otwartych plików.',
    ENFILE: 'System osiągnął limit otwartych plików.',
  };

  if (error.code && codeMessages[error.code]) {
    return `${codeMessages[error.code]} (${error.code})`;
  }

  return error.message || 'Wystąpił nieznany błąd serwera.';
}

function sendError(res, status, error) {
  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(status).json({
    error: true,
    message: normalizeErrorMessage(error),
  });
}

function sendSuccess(res, payload = {}, status = 200) {
  res.status(status).json({
    error: false,
    ...payload,
  });
}

function getStatusCodeFromError(error) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return 413;
    if (error.code === 'LIMIT_FILE_COUNT') return 413;
    if (error.code === 'LIMIT_UNEXPECTED_FILE') return 400;
    return 400;
  }

  const code = error?.code;

  if (code === 'ENOENT') return 404;
  if (code === 'EACCES' || code === 'EPERM') return 403;
  if (code === 'ENOSPC') return 507;
  if (code === 'EEXIST') return 409;
  if (code === 'LIMIT_FILE_SIZE') return 413;

  return 400;
}

function isPathInside(baseDir, candidatePath) {
  const relative = path.relative(baseDir, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveSafePath(relativePath = '') {
  if (typeof relativePath !== 'string') {
    throw new Error('Ścieżka musi być tekstem.');
  }

  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  const resolvedPath = path.resolve(FILES_DIR, normalized);

  if (!isPathInside(FILES_DIR, resolvedPath)) {
    const error = new Error('Niedozwolona ścieżka: próba wyjścia poza katalog plików.');
    error.code = 'PATH_TRAVERSAL';
    throw error;
  }

  return resolvedPath;
}

function validateSingleName(name, fieldName = 'Nazwa') {
  if (typeof name !== 'string') {
    throw new Error(`${fieldName} musi być tekstem.`);
  }

  const trimmed = name.trim();

  if (!trimmed) {
    throw new Error(`${fieldName} nie może być pusta.`);
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${fieldName} jest niedozwolona.`);
  }

  if (trimmed.includes('/') || trimmed.includes('\\') || path.basename(trimmed) !== trimmed) {
    throw new Error(`${fieldName} nie może zawierać separatorów ścieżki.`);
  }

  return trimmed;
}

function getRelativeUploadParts(originalName) {
  if (typeof originalName !== 'string' || !originalName.trim()) {
    throw new Error('Nieprawidłowa nazwa wysyłanego pliku.');
  }

  const normalized = originalName.replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);

  if (!parts.length || parts.some(part => part === '.' || part === '..')) {
    throw new Error('Nieprawidłowa ścieżka wysyłanego pliku.');
  }

  const fileName = parts.at(-1);

  if (!fileName || fileName === NOTE_FILENAME) {
    throw new Error('Ta nazwa pliku jest zarezerwowana.');
  }

  return {
    directories: parts.slice(0, -1),
    fileName: path.basename(fileName),
  };
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureDirectory(directoryPath) {
  await fsp.mkdir(directoryPath, { recursive: true });
  const stat = await fsp.stat(directoryPath);

  if (!stat.isDirectory()) {
    throw new Error('Wskazana ścieżka nie jest katalogiem.');
  }
}

async function getDiskSpace() {
  const stats = await fsp.statfs(FILES_DIR, { bigint: true });

  const blockSize = stats.bsize;
  const totalBytes = stats.blocks * blockSize;
  const freeBytes = stats.bfree * blockSize;
  const availableBytes = stats.bavail * blockSize;
  const usableBytes = availableBytes > BigInt(RESERVED_DISK_SPACE_BYTES)
    ? availableBytes - BigInt(RESERVED_DISK_SPACE_BYTES)
    : 0n;

  return {
    totalBytes: Number(totalBytes),
    freeBytes: Number(freeBytes),
    availableBytes: Number(availableBytes),
    usableBytes: Number(usableBytes),
    reservedBytes: RESERVED_DISK_SPACE_BYTES,
  };
}

async function assertEnoughDiskSpace(requiredBytes) {
  const required = Number(requiredBytes);

  if (!Number.isFinite(required) || required < 0) {
    throw new Error('Nieprawidłowy rozmiar danych do zapisania.');
  }

  const disk = await getDiskSpace();

  if (required > disk.usableBytes) {
    const error = new Error(
      `Brak wolnego miejsca na serwerze. Wymagane: ${required} B, dostępne po rezerwie: ${disk.usableBytes} B.`
    );
    error.code = 'ENOSPC';
    throw error;
  }

  return disk;
}

async function readDirEntries(directoryPath) {
  const entries = await fsp.readdir(directoryPath, { withFileTypes: true });

  const visibleEntries = await Promise.all(
    entries
      .filter(entry => entry.name !== NOTE_FILENAME)
      .map(async entry => {
        const fullPath = path.join(directoryPath, entry.name);
        const stat = await fsp.stat(fullPath);

        return {
          name: entry.name,
          isDirectory: stat.isDirectory(),
          size: stat.isDirectory() ? null : stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
  );

  return visibleEntries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }

    return a.name.localeCompare(b.name, 'pl');
  });
}

function sanitizeDownloadName(name, fallback = 'download') {
  const safe = path.basename(String(name || fallback)).replace(/["\r\n]/g, '_');
  return safe || fallback;
}

function createZipResponse(res, items, zipName) {
  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.on('warning', error => {
    if (error.code !== 'ENOENT') {
      console.error('Ostrzeżenie archiver:', error);
    }
  });

  archive.on('error', error => {
    if (!res.headersSent) {
      sendError(res, 500, error);
      return;
    }

    res.destroy(error);
  });

  res.status(200);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${sanitizeDownloadName(zipName, 'download.zip')}"`
  );
  res.setHeader('Content-Type', 'application/zip');

  archive.pipe(res);

  for (const item of items) {
    if (item.isDirectory) {
      archive.directory(item.path, item.archiveName);
    } else {
      archive.file(item.path, { name: item.archiveName });
    }
  }

  archive.finalize();

  return archive;
}

function createUploadId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function createUploadProgress(uploadId, expectedBytes = 0) {
  const progress = {
    uploadId,
    status: 'Przygotowanie',
    percent: 0,
    receivedBytes: 0,
    expectedBytes: Number(expectedBytes) || 0,
    uploadedFiles: 0,
    totalFiles: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    message: 'Przygotowywanie wysyłki.',
    error: null,
  };

  uploadProgress.set(uploadId, progress);
  return progress;
}

function updateUploadProgress(uploadId, patch) {
  const previous = uploadProgress.get(uploadId) || createUploadProgress(uploadId);

  const next = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  uploadProgress.set(uploadId, next);
  return next;
}

function getUploadProgress(uploadId) {
  return uploadProgress.get(uploadId) || null;
}

function cleanupOldUploadProgress() {
  const threshold = Date.now() - UPLOAD_PROGRESS_TTL_MS;

  for (const [uploadId, progress] of uploadProgress.entries()) {
    const updatedAt = new Date(progress.updatedAt).getTime();

    if (updatedAt < threshold) {
      uploadProgress.delete(uploadId);
    }
  }
}

setInterval(cleanupOldUploadProgress, Math.min(UPLOAD_PROGRESS_TTL_MS, 5 * 60 * 1000)).unref();

const storage = multer.diskStorage({
  destination: async (req, file, callback) => {
    try {
      const basePath = req.body?.path ?? req.query?.path ?? '';
      const baseDirectory = resolveSafePath(basePath);
      const { directories } = getRelativeUploadParts(file.originalname);
      const destination = path.resolve(baseDirectory, ...directories);

      if (!isPathInside(FILES_DIR, destination)) {
        const error = new Error('Niedozwolona ścieżka katalogu docelowego.');
        error.code = 'PATH_TRAVERSAL';
        throw error;
      }

      await ensureDirectory(destination);
      callback(null, destination);
    } catch (error) {
      callback(error);
    }
  },

  filename: (req, file, callback) => {
    try {
      const { fileName } = getRelativeUploadParts(file.originalname);
      callback(null, fileName);
    } catch (error) {
      callback(error);
    }
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    fieldSize: 1024 * 1024,
    files: 1000,
  },

  fileFilter: (req, file, callback) => {
    try {
      const { fileName } = getRelativeUploadParts(file.originalname);

      if (fileName === NOTE_FILENAME) {
        return callback(new Error('Nie można przesłać pliku o zarezerwowanej nazwie .filer_note.'));
      }

      callback(null, true);
    } catch (error) {
      callback(error);
    }
  },
});

function removeUploadedFiles(files = []) {
  return Promise.allSettled(
    files
      .filter(file => file?.path)
      .map(file => fsp.rm(file.path, { force: true }))
  );
}

function getUploadIdFromRequest(req) {
  const fromHeader = req.get('x-upload-id');
  const fromBody = req.body?.uploadId;

  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();

  return createUploadId();
}

async function validateUploadRequest(req) {
  const contentLength = Number(req.get('content-length') || 0);

  if (contentLength > 0 && contentLength > MAX_TOTAL_UPLOAD_BYTES) {
    const error = new Error(
      `Rozmiar żądania (${contentLength} B) przekracza limit uploadu (${MAX_TOTAL_UPLOAD_BYTES} B).`
    );
    error.code = 'LIMIT_FILE_SIZE';
    throw error;
  }

  if (contentLength > 0) {
    await assertEnoughDiskSpace(contentLength);
  }
}

app.get('/api/status', async (req, res) => {
  try {
    const disk = await getDiskSpace();

    sendSuccess(res, {
      server: {
        status: 'online',
        startedAt: new Date().toISOString(),
      },
      disk,
      limits: {
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
        maxTotalUploadBytes: MAX_TOTAL_UPLOAD_BYTES,
        reservedDiskSpaceBytes: RESERVED_DISK_SPACE_BYTES,
      },
    });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.get('/api/upload-status/:uploadId', (req, res) => {
  try {
    const progress = getUploadProgress(req.params.uploadId);

    if (!progress) {
      return sendError(res, 404, 'Nie znaleziono statusu wskazanego uploadu.');
    }

    sendSuccess(res, { upload: progress });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.get(/^\/api\/download\/(.+)$/, async (req, res) => {
  try {
    const relativePath = req.params[0];
    const filePath = resolveSafePath(relativePath);

    if (!(await pathExists(filePath))) {
      return sendError(res, 404, 'Nie znaleziono pliku.');
    }

    const stat = await fsp.stat(filePath);

    if (stat.isDirectory()) {
      return sendError(res, 400, 'Nie można pobrać katalogu jako pojedynczego pliku. Użyj pobierania ZIP.');
    }

    res.download(filePath, sanitizeDownloadName(filePath), error => {
      if (error && !res.headersSent) {
        sendError(res, getStatusCodeFromError(error), error);
      }
    });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.get(/^\/api\/download-zip\/(.+)$/, async (req, res) => {
  try {
    const relativePath = req.params[0];
    const directoryPath = resolveSafePath(relativePath);

    if (!(await pathExists(directoryPath))) {
      return sendError(res, 404, 'Nie znaleziono katalogu.');
    }

    const stat = await fsp.stat(directoryPath);

    if (!stat.isDirectory()) {
      return sendError(res, 400, 'Wskazana ścieżka nie jest katalogiem.');
    }

    createZipResponse(
      res,
      [{ path: directoryPath, archiveName: sanitizeDownloadName(relativePath), isDirectory: true }],
      `${sanitizeDownloadName(relativePath)}.zip`
    );
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.get(/^\/api\/get\/(.+)$/, async (req, res) => {
  try {
    const relativePath = req.params[0];
    const resourcePath = resolveSafePath(relativePath);

    if (!(await pathExists(resourcePath))) {
      return sendError(res, 404, 'Nie znaleziono pliku lub katalogu.');
    }

    const stat = await fsp.stat(resourcePath);

    if (stat.isDirectory()) {
      return createZipResponse(
        res,
        [{ path: resourcePath, archiveName: sanitizeDownloadName(relativePath), isDirectory: true }],
        `${sanitizeDownloadName(relativePath)}.zip`
      );
    }

    res.download(resourcePath, sanitizeDownloadName(resourcePath), error => {
      if (error && !res.headersSent) {
        sendError(res, getStatusCodeFromError(error), error);
      }
    });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.get('/api/files', async (req, res) => {
  try {
    const directoryPath = resolveSafePath(req.query.path || '');

    if (!(await pathExists(directoryPath))) {
      return sendError(res, 404, 'Nie znaleziono katalogu.');
    }

    const stat = await fsp.stat(directoryPath);

    if (!stat.isDirectory()) {
      return sendError(res, 400, 'Wskazana ścieżka nie jest katalogiem.');
    }

    const entries = await readDirEntries(directoryPath);
    sendSuccess(res, { entries });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.get('/api/file', async (req, res) => {
  try {
    const filePath = resolveSafePath(req.query.path || '');

    if (!(await pathExists(filePath))) {
      return sendError(res, 404, 'Nie znaleziono pliku.');
    }

    const stat = await fsp.stat(filePath);

    if (stat.isDirectory()) {
      return sendError(res, 400, 'Wskazana ścieżka jest katalogiem.');
    }

    res.download(filePath, sanitizeDownloadName(filePath), error => {
      if (error && !res.headersSent) {
        sendError(res, getStatusCodeFromError(error), error);
      }
    });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.get('/api/preview', async (req, res) => {
  try {
    const filePath = resolveSafePath(req.query.path || '');

    if (!(await pathExists(filePath))) {
      return sendError(res, 404, 'Nie znaleziono pliku.');
    }

    const stat = await fsp.stat(filePath);

    if (stat.isDirectory()) {
      return sendError(res, 400, 'Nie można wyświetlić podglądu katalogu.');
    }

    res.setHeader('Content-Disposition', `inline; filename="${sanitizeDownloadName(filePath)}"`);

    res.sendFile(filePath, error => {
      if (error && !res.headersSent) {
        sendError(res, getStatusCodeFromError(error), error);
      }
    });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.post('/api/download-zip', async (req, res) => {
  try {
    const { items, basePath = '' } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return sendError(res, 400, 'Wybierz co najmniej jeden plik lub katalog do pobrania.');
    }

    const baseDirectory = resolveSafePath(basePath);
    const baseStat = await fsp.stat(baseDirectory);

    if (!baseStat.isDirectory()) {
      return sendError(res, 400, 'Bazowa ścieżka pobierania nie jest katalogiem.');
    }

    const archiveItems = [];

    for (const item of items) {
      const name = validateSingleName(item, 'Nazwa elementu');
      const fullPath = path.resolve(baseDirectory, name);

      if (!isPathInside(FILES_DIR, fullPath)) {
        throw new Error('Niedozwolona ścieżka elementu do pobrania.');
      }

      if (!(await pathExists(fullPath))) {
        throw new Error(`Nie znaleziono elementu "${name}".`);
      }

      const stat = await fsp.stat(fullPath);

      archiveItems.push({
        path: fullPath,
        archiveName: name,
        isDirectory: stat.isDirectory(),
      });
    }

    createZipResponse(res, archiveItems, 'filer_download.zip');
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.get('/api/note', async (req, res) => {
  try {
    const directoryPath = resolveSafePath(req.query.path || '');

    if (!(await pathExists(directoryPath))) {
      return sendError(res, 404, 'Nie znaleziono katalogu.');
    }

    const stat = await fsp.stat(directoryPath);

    if (!stat.isDirectory()) {
      return sendError(res, 400, 'Notatkę można odczytać wyłącznie dla katalogu.');
    }

    const notePath = path.join(directoryPath, NOTE_FILENAME);
    const content = (await pathExists(notePath))
      ? await fsp.readFile(notePath, 'utf8')
      : '';

    sendSuccess(res, { content });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.post('/api/note', async (req, res) => {
  try {
    const { path: relativePath = '', content = '' } = req.body || {};

    if (typeof content !== 'string') {
      return sendError(res, 400, 'Treść notatki musi być tekstem.');
    }

    const directoryPath = resolveSafePath(relativePath);

    if (!(await pathExists(directoryPath))) {
      return sendError(res, 404, 'Nie znaleziono katalogu.');
    }

    const stat = await fsp.stat(directoryPath);

    if (!stat.isDirectory()) {
      return sendError(res, 400, 'Notatkę można zapisać wyłącznie dla katalogu.');
    }

    const bytes = Buffer.byteLength(content, 'utf8');
    const disk = await assertEnoughDiskSpace(bytes);

    await fsp.writeFile(path.join(directoryPath, NOTE_FILENAME), content, 'utf8');

    sendSuccess(res, {
      ok: true,
      writtenBytes: bytes,
      disk,
    });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.post('/api/upload', async (req, res) => {
  const uploadId = getUploadIdFromRequest(req);
  const expectedBytes = Number(req.get('content-length') || 0);

  createUploadProgress(uploadId, expectedBytes);

  try {
    updateUploadProgress(uploadId, {
      status: 'Sprawdzanie miejsca',
      percent: 0,
      message: 'Sprawdzanie wolnego miejsca na serwerze.',
    });

    await validateUploadRequest(req);

    updateUploadProgress(uploadId, {
      status: 'Przesyłanie',
      percent: 1,
      message: 'Serwer odbiera pliki.',
    });

    await new Promise((resolve, reject) => {
      upload.array('files')(req, res, error => {
        if (error) reject(error);
        else resolve();
      });
    });

    const files = req.files || [];
    const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);

    updateUploadProgress(uploadId, {
      status: 'Weryfikacja',
      percent: 95,
      uploadedFiles: files.length,
      totalFiles: files.length,
      receivedBytes: totalSize,
      message: 'Weryfikowanie zapisu na dysku.',
    });

    const disk = await assertEnoughDiskSpace(0);

    updateUploadProgress(uploadId, {
      status: 'Sukces',
      percent: 100,
      uploadedFiles: files.length,
      totalFiles: files.length,
      receivedBytes: totalSize,
      finishedAt: new Date().toISOString(),
      message: `Pomyślnie zapisano ${files.length} plików.`,
      error: null,
    });

    sendSuccess(res, {
      uploaded: files.length,
      uploadedBytes: totalSize,
      uploadId,
      upload: getUploadProgress(uploadId),
      disk,
    });
  } catch (error) {
    const alreadyUploaded = req.files || [];

    await removeUploadedFiles(alreadyUploaded);

    updateUploadProgress(uploadId, {
      status: 'Błąd',
      percent: 0,
      finishedAt: new Date().toISOString(),
      message: normalizeErrorMessage(error),
      error: normalizeErrorMessage(error),
    });

    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.post('/api/mkdir', async (req, res) => {
  try {
    const { path: relativePath } = req.body || {};

    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      return sendError(res, 400, 'Podaj ścieżkę nowego katalogu.');
    }

    const fullPath = resolveSafePath(relativePath);
    await ensureDirectory(fullPath);

    sendSuccess(res, { ok: true });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.delete('/api/delete', async (req, res) => {
  try {
    const { items, basePath = '' } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return sendError(res, 400, 'Wybierz co najmniej jeden element do usunięcia.');
    }

    const baseDirectory = resolveSafePath(basePath);
    const baseStat = await fsp.stat(baseDirectory);

    if (!baseStat.isDirectory()) {
      return sendError(res, 400, 'Bazowa ścieżka usuwania nie jest katalogiem.');
    }

    const removed = [];
    const notFound = [];

    for (const item of items) {
      const name = validateSingleName(item, 'Nazwa elementu');

      if (name === NOTE_FILENAME) {
        throw new Error('Nie można usuwać wewnętrznego pliku notatki tą metodą.');
      }

      const fullPath = path.resolve(baseDirectory, name);

      if (!isPathInside(FILES_DIR, fullPath)) {
        throw new Error('Niedozwolona ścieżka elementu do usunięcia.');
      }

      if (!(await pathExists(fullPath))) {
        notFound.push(name);
        continue;
      }

      await fsp.rm(fullPath, { recursive: true, force: false });
      removed.push(name);
    }

    sendSuccess(res, {
      ok: true,
      removed,
      notFound,
    });
  } catch (error) {
    sendError(res, getStatusCodeFromError(error), error);
  }
});

app.use((req, res) => {
  sendError(res, 404, `Nie znaleziono endpointu: ${req.method} ${req.originalUrl}`);
});

app.use((error, req, res, next) => {
  console.error('Nieobsłużony błąd aplikacji:', error);
  sendError(res, getStatusCodeFromError(error), error);
});

const server = app.listen(PORT, () => {
  console.log(`FileCloud backend działa na http://localhost:${PORT}`);
  console.log(`Katalog plików: ${FILES_DIR}`);
});

server.on('error', error => {
  console.error(`Nie udało się uruchomić serwera: ${normalizeErrorMessage(error)}`);
});

process.on('unhandledRejection', error => {
  console.error('Nieobsłużone odrzucenie Promise:', error);
});

process.on('uncaughtException', error => {
  console.error('Nieobsłużony wyjątek:', error);
});
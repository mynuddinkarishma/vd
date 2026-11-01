const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const youtubedl = require('youtube-dl-exec');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function getFormatSize(format) {
  if (typeof format.filesize === 'number') return formatBytes(format.filesize);
  if (typeof format.filesize_approx === 'number') return formatBytes(format.filesize_approx);
  if (typeof format.formatted_filesize === 'string') return format.formatted_filesize;
  if (typeof format.tbr === 'number') {
    const sizeEstimate = (format.tbr * 1024 * 60) / 8;
    return formatBytes(sizeEstimate);
  }
  return 'Unknown';
}

function getFormatQuality(format) {
  if (format.height) return `${format.height}p`;
  if (format.format_note) return format.format_note;
  if (format.quality) return format.quality;
  if (format.ext) return format.ext.toUpperCase();
  return 'Unknown';
}

function normalizeFormats(formats = []) {
  const deduped = new Map();

  formats.forEach((format) => {
    if (!format || !format.format_id) return;
    const key = `${format.format_id}-${format.ext || 'unknown'}`;
    if (deduped.has(key)) return;

    const normalized = {
      format_id: format.format_id,
      quality: getFormatQuality(format),
      size: getFormatSize(format),
      ext: format.ext || 'unknown',
      hasVideo: !!format.has_video,
      hasAudio: !!format.has_audio
    };

    deduped.set(key, normalized);
  });

  return Array.from(deduped.values()).sort((a, b) => {
    const aScore = Number(String(a.quality).match(/\d+/)?.[0] || 0);
    const bScore = Number(String(b.quality).match(/\d+/)?.[0] || 0);
    if (aScore !== bScore) return bScore - aScore;
    return a.quality.localeCompare(b.quality);
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'VD Video Downloader' });
});

app.get('/api/analyze', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!url) {
    return res.status(400).json({ error: 'A valid video URL is required.' });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      skipDownload: true,
      preferFreeFormats: true
    });

    const title = info?.title || 'Untitled video';
    const thumbnail = info?.thumbnail || info?.thumbnails?.[info.thumbnails.length - 1]?.url || '';

    res.json({
      title,
      thumbnail,
      formats: normalizeFormats(info?.formats || [])
    });
  } catch (error) {
    console.error('Analyze error:', error);
    return res.status(400).json({
      error: 'Unable to analyze this video URL. Please try a different link or ensure the provider is supported.'
    });
  }
});

app.post('/api/analyze', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url) {
    return res.status(400).json({ error: 'A valid video URL is required.' });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      skipDownload: true,
      preferFreeFormats: true
    });

    const title = info?.title || 'Untitled video';
    const thumbnail = info?.thumbnail || info?.thumbnails?.[info.thumbnails.length - 1]?.url || '';

    res.json({
      title,
      thumbnail,
      formats: normalizeFormats(info?.formats || [])
    });
  } catch (error) {
    console.error('Analyze error:', error);
    return res.status(400).json({
      error: 'Unable to analyze this video URL. Please try a different link or ensure the provider is supported.'
    });
  }
});

app.get('/api/download', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  const formatId = typeof req.query.formatId === 'string' ? req.query.formatId.trim() : '';

  if (!url || !formatId) {
    return res.status(400).json({ error: 'A valid URL and format selection are required.' });
  }

  const tmpDir = path.join(os.tmpdir(), 'vd-downloads');
  fs.mkdirSync(tmpDir, { recursive: true });
  const prefix = `vd-${Date.now()}`;
  const outputTemplate = path.join(tmpDir, `${prefix}.%(ext)s`);

  try {
    await youtubedl(url, {
      format: formatId,
      output: outputTemplate,
      noWarnings: true,
      noCheckCertificates: true,
      restrictFilenames: true
    });

    const files = fs.readdirSync(tmpDir)
      .filter((file) => file.startsWith(prefix))
      .sort((a, b) => fs.statSync(path.join(tmpDir, b)).mtimeMs - fs.statSync(path.join(tmpDir, a)).mtimeMs);

    const downloadedFile = files[0];
    if (!downloadedFile) {
      throw new Error('No file was produced for the selected format.');
    }

    const filePath = path.join(tmpDir, downloadedFile);
    res.download(filePath, downloadedFile, (error) => {
      if (error) {
        console.error('Download response error:', error);
      }

      setTimeout(() => {
        fs.unlink(filePath, () => {});
      }, 15000);
    });
  } catch (error) {
    console.error('Download error:', error);
    return res.status(400).json({
      error: 'Unable to download this format. Try another quality or video.'
    });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VD server running on http://localhost:${PORT}`);
});

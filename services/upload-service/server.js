const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app         = express();
const UPLOAD_DIR  = process.env.UPLOAD_DIR || '/uploads';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

app.use(cors());
app.use(express.json());

// Only allow image files, max 10 MB each
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, req.body.token || 'unknown');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Solo se permiten imágenes'));
  }
});

async function validateToken(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return true; // dev fallback
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_email_audit_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ p_token: token })
  });
  const data = await res.json();
  return data?.valid === true;
}

// POST /api/upload  — multipart: token + file
app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const token = req.body.token;
    if (!token) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'token required' });
    }

    const valid = await validateToken(token);
    if (!valid) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'invalid token' });
    }

    const relativePath = `/uploads/${token}/${req.file.filename}`;
    res.json({ ok: true, path: relativePath });
  });
});

// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3030;
app.listen(PORT, () => console.log(`upload-service listening on :${PORT}`));

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const jwt      = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();

// ── SECURITY HEADERS (Fix #5 partial) ────────────────────
app.use(helmet({
  contentSecurityPolicy: false,  // keep false so frontend scripts work
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

// ── HTTPS REDIRECT (Fix #5) ───────────────────────────────
// In production, redirect HTTP to HTTPS
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// ── CORS — restrict to known origins (Fix #3) ────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman) or matching origin
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── RATE LIMITERS ─────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true, legacyHeaders: false
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  message: { error: 'Too many uploads. Please wait before trying again.' }
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  message: { error: 'Too many requests. Please slow down.' }
});

// ── PROTECTED UPLOADS (Fix #4) ───────────────────────────
// Screenshots require a valid JWT token to view
const JWT_SECRET = process.env.JWT_SECRET;
app.use('/uploads', (req, res, next) => {
  const token = req.query.token || (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).send('Unauthorised');
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).send('Unauthorised');
  }
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API ROUTES ────────────────────────────────────────────
app.use('/api/auth/login',       authLimiter);
app.use('/api/auth/register',    authLimiter);
app.use('/api/auth/admin-login', authLimiter);
app.use('/api/matches',          apiLimiter);
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);
app.use('/api/tournaments',      require('./routes/tournaments'));
app.use('/api/registrations',    require('./routes/registrations'));
app.use('/api/matches',          require('./routes/matches'));
app.use('/api/announcements',    require('./routes/announcements'));
app.use('/api/appeals',          require('./routes/appeals'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// ── GLOBAL ERROR HANDLER ──────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message?.startsWith('CORS blocked')) return res.status(403).json({ error: err.message });
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n⚽  DLS Arena running at http://localhost:${PORT}`);
  console.log(`🔐  Admin login: http://localhost:${PORT}/admin-login.html`);
  console.log(`🔒  CORS allowed origins: ${allowedOrigins.join(', ')}\n`);

  // ── Fix #7: Process deadlines immediately on boot ────────
  // Handles any expired deadlines that occurred during downtime
  setTimeout(() => {
    try {
      const matchesRouter = require('./routes/matches');
      if (typeof matchesRouter.processDeadlines === 'function') {
        const count = matchesRouter.processDeadlines();
        if (count > 0) console.log(`⏰  Processed ${count} expired match deadline(s) on boot`);
      }
    } catch(e) {}
  }, 2000);
});
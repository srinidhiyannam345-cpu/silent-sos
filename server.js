require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const testMode = String(process.env.NOTIFICATION_TEST_MODE || 'true').toLowerCase() !== 'false';
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

// Reject cross-origin browser mutations. Configure BASE_URL to the public origin when deployed.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // allows local tools; session + rate limits still apply
  const expected = process.env.BASE_URL ? new URL(process.env.BASE_URL).origin : `${req.protocol}://${req.get('host')}`;
  if (origin !== expected) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  next();
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  createdAt: { type: Date, default: Date.now }
});
const contactSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, trim: true, maxlength: 30, default: '' },
  email: { type: String, lowercase: true, trim: true, maxlength: 160, default: '' },
  consent: { type: Boolean, required: true, default: false },
  createdAt: { type: Date, default: Date.now }
});
const eventSchema = new mongoose.Schema({
  type: { type: String, required: true, maxlength: 40 },
  message: { type: String, maxlength: 500, default: '' },
  at: { type: Date, default: Date.now }
}, { _id: false });
const alertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userName: { type: String, required: true },
  status: { type: String, enum: ['sent', 'acknowledged', 'resolved'], default: 'sent', index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  acknowledgedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  latestLocation: { lat: Number, lng: Number, accuracy: Number, capturedAt: Date },
  locations: [{ lat: Number, lng: Number, accuracy: Number, capturedAt: Date }],
  events: { type: [eventSchema], default: [] },
  notificationResults: [{ channel: String, recipient: String, result: String, at: { type: Date, default: Date.now } }],
  contactAccess: [{ tokenHash: { type: String, required: true }, contactName: String, expiresAt: { type: Date, required: true }, usedAt: { type: Date, default: null } }]
});
const User = mongoose.model('User', userSchema);
const Contact = mongoose.model('Contact', contactSchema);
const Alert = mongoose.model('Alert', alertSchema);

function safeUser(u) { return { id: String(u._id), name: u.name, email: u.email, role: u.role }; }
function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}
function adminOnly(req, res, next) {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
function cleanText(value, max = 80) { return String(value || '').trim().slice(0, max); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function event(alert, type, message = '') { alert.events.push({ type, message: cleanText(message, 500), at: new Date() }); }

async function notifyContacts(user, alert, contacts) {
  const base = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const locationText = alert.latestLocation ? `Location: https://maps.google.com/?q=${alert.latestLocation.lat},${alert.latestLocation.lng}` : 'Location is not available yet; open the alert link for updates.';
  for (const c of contacts.filter(x => x.consent)) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    alert.contactAccess.push({ tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'), contactName: c.name, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    const url = `${base}/?contactToken=${rawToken}`;
    if (c.phone && String(process.env.ENABLE_SMS).toLowerCase() === 'true') {
      try {
        if (testMode) {
          console.log(`[TEST SMS] To ${c.phone}: SILENT SOS from ${user.name}. ${locationText} ${url}`);
          alert.notificationResults.push({ channel: 'sms', recipient: c.phone, result: 'test-mode logged' });
        } else if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
          await twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN).messages.create({
            from: process.env.TWILIO_FROM_NUMBER, to: c.phone,
            body: `SILENT SOS from ${user.name}. ${locationText} Alert: ${url}`
          });
          alert.notificationResults.push({ channel: 'sms', recipient: c.phone, result: 'provider accepted' });
        } else alert.notificationResults.push({ channel: 'sms', recipient: c.phone, result: 'not configured' });
      } catch (e) { console.error('SMS provider error:', e.message); alert.notificationResults.push({ channel: 'sms', recipient: c.phone, result: 'failed' }); }
    }
    if (c.email && String(process.env.ENABLE_EMAIL).toLowerCase() === 'true') {
      try {
        if (testMode) {
          console.log(`[TEST EMAIL] To ${c.email}: SILENT SOS from ${user.name}. ${locationText} ${url}`);
          alert.notificationResults.push({ channel: 'email', recipient: c.email, result: 'test-mode logged' });
        } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM) {
          const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
          await transporter.sendMail({ from: process.env.EMAIL_FROM, to: c.email, subject: `Silent SOS alert from ${user.name}`, text: `An SOS alert was created. ${locationText}\nAlert page: ${url}\nOnly use this link if you are an intended trusted contact.` });
          alert.notificationResults.push({ channel: 'email', recipient: c.email, result: 'provider accepted' });
        } else alert.notificationResults.push({ channel: 'email', recipient: c.email, result: 'not configured' });
      } catch (e) { console.error('Email provider error:', e.message); alert.notificationResults.push({ channel: 'email', recipient: c.email, result: 'failed' }); }
    }
  }
}
app.set('trust proxy', 1);

app.use(session({
  name: 'silent_sos.sid', secret: process.env.SESSION_SECRET || 'dev-only-change-this-secret',
  resave: false, saveUninitialized: false,
  store: process.env.MONGODB_URI ? MongoStore.create({ mongoUrl: process.env.MONGODB_URI, collectionName: 'sessions' }) : undefined,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));

app.get('/api/health', (req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', notificationTestMode: testMode }));
app.post('/api/register', async (req, res) => {
  try {
    const name = cleanText(req.body.name), email = cleanText(req.body.email, 160).toLowerCase(), password = String(req.body.password || '');
    if (name.length < 2 || !validEmail(email) || password.length < 10) return res.status(400).json({ error: 'Enter a name, valid email, and password with at least 10 characters.' });
    if (await User.exists({ email })) return res.status(409).json({ error: 'An account with this email already exists.' });
    const role = email === String(process.env.ADMIN_EMAIL || '').toLowerCase() ? 'admin' : 'user';
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Could not start a secure session.' });
      req.session.userId = String(user._id); req.session.role = user.role;
      req.session.save(saveErr => { if (saveErr) return res.status(500).json({ error: 'Could not save session.' }); res.status(201).json({ user: safeUser(user) }); });
    });
  } catch (e) { res.status(500).json({ error: 'Could not create account. Check server/database setup.' }); }
});
app.post('/api/login', async (req, res) => {
  const email = cleanText(req.body.email, 160).toLowerCase(), password = String(req.body.password || '');
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start a secure session.' });
    req.session.userId = String(user._id); req.session.role = user.role;
    req.session.save(saveErr => { if (saveErr) return res.status(500).json({ error: 'Could not save session.' }); res.json({ user: safeUser(user) }); });
  });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('silent_sos.sid'); res.json({ ok: true }); }));
app.get('/api/me', auth, async (req, res) => {
  const u = await User.findById(req.session.userId); if (!u) return res.status(401).json({ error: 'Please log in again.' });
  res.json({ user: safeUser(u) });
});

app.get('/api/contacts', auth, async (req, res) => res.json({ contacts: await Contact.find({ userId: req.session.userId }).sort({ createdAt: -1 }).lean() }));
app.post('/api/contacts', auth, async (req, res) => {
  const name = cleanText(req.body.name), phone = cleanText(req.body.phone, 30), email = cleanText(req.body.email, 160).toLowerCase(), consent = req.body.consent === true;
  if (name.length < 2 || (!phone && !email) || (email && !validEmail(email))) return res.status(400).json({ error: 'Add a name and at least one valid phone number or email.' });
  if (!consent) return res.status(400).json({ error: 'Confirm that this contact has agreed to receive emergency alerts.' });
  const contact = await Contact.create({ userId: req.session.userId, name, phone, email, consent }); res.status(201).json({ contact });
});
app.delete('/api/contacts/:id', auth, async (req, res) => {
  const result = await Contact.deleteOne({ _id: req.params.id, userId: req.session.userId });
  if (!result.deletedCount) return res.status(404).json({ error: 'Contact not found.' }); res.json({ ok: true });
});

app.post('/api/alerts', auth, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const contacts = await Contact.find({ userId: user._id, consent: true });
  if (!contacts.length) return res.status(400).json({ error: 'Add at least one consenting emergency contact before testing SOS.' });
  const alert = await Alert.create({ userId: user._id, userName: user.name, status: 'sent', events: [{ type: 'created', message: 'SOS activated', at: new Date() }] });
  await notifyContacts(user, alert, contacts);
  event(alert, 'notification_attempted', testMode ? 'Notifications logged in test mode' : 'Configured notification channels attempted');
  await alert.save();
  res.status(201).json({ alert: publicAlert(alert), warning: testMode ? 'TEST MODE: no real SMS or email was delivered.' : 'Notification provider acceptance does not guarantee recipient delivery.' });
});
function publicAlert(a) { return { id: String(a._id), userName: a.userName, status: a.status, createdAt: a.createdAt, acknowledgedAt: a.acknowledgedAt, resolvedAt: a.resolvedAt, latestLocation: a.latestLocation, locations: a.locations, events: a.events, notificationResults: a.notificationResults }; }

app.get('/api/contact-alert/:token', async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(String(req.params.token || '')).digest('hex');
  const alert = await Alert.findOne({ 'contactAccess.tokenHash': tokenHash, 'contactAccess.expiresAt': { $gt: new Date() } });
  if (!alert) return res.status(404).json({ error: 'This contact link is invalid or has expired.' });
  res.json({ alert: { id: String(alert._id), userName: alert.userName, status: alert.status, createdAt: alert.createdAt, acknowledgedAt: alert.acknowledgedAt, resolvedAt: alert.resolvedAt, latestLocation: alert.latestLocation, events: alert.events.map(e => ({ type: e.type, at: e.at })) }, contactName: alert.contactAccess.find(x => x.tokenHash === tokenHash)?.contactName || 'Trusted contact' });
});
app.post('/api/contact-alert/:token/acknowledge', async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(String(req.params.token || '')).digest('hex');
  const alert = await Alert.findOne({ 'contactAccess.tokenHash': tokenHash, 'contactAccess.expiresAt': { $gt: new Date() } });
  if (!alert) return res.status(404).json({ error: 'This contact link is invalid or has expired.' });
  if (alert.status === 'sent') { alert.status = 'acknowledged'; alert.acknowledgedAt = new Date(); event(alert, 'acknowledged_by_contact', 'A trusted contact acknowledged using their secure link'); }
  const access = alert.contactAccess.find(x => x.tokenHash === tokenHash); if (access && !access.usedAt) access.usedAt = new Date();
  await alert.save();
  res.json({ ok: true, status: alert.status, acknowledgedAt: alert.acknowledgedAt });
});

app.get('/api/alerts', auth, async (req, res) => {
  const alerts = await Alert.find({ userId: req.session.userId }).sort({ createdAt: -1 }).limit(50).lean(); res.json({ alerts: alerts.map(publicAlert) });
});
app.get('/api/alerts/:id', auth, async (req, res) => {
  const q = { _id: req.params.id }; if (req.session.role !== 'admin') q.userId = req.session.userId;
  const a = await Alert.findOne(q).lean(); if (!a) return res.status(404).json({ error: 'Alert not found.' }); res.json({ alert: publicAlert(a) });
});
app.post('/api/alerts/:id/location', auth, async (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng), accuracy = Number(req.body.accuracy || 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return res.status(400).json({ error: 'Invalid coordinates.' });
  const a = await Alert.findOne({ _id: req.params.id, userId: req.session.userId });
  if (!a) return res.status(404).json({ error: 'Alert not found.' });
  if (a.status === 'resolved') return res.status(409).json({ error: 'This alert is resolved; location updates have stopped.' });
  const point = { lat, lng, accuracy: Math.max(0, Math.min(accuracy, 100000)), capturedAt: new Date() };
  a.latestLocation = point; a.locations.push(point); if (a.locations.length > 500) a.locations = a.locations.slice(-500);
  event(a, 'location_updated', 'Location updated with browser permission'); await a.save(); res.json({ ok: true, capturedAt: point.capturedAt });
});
app.post('/api/alerts/:id/acknowledge', auth, async (req, res) => {
  const q = { _id: req.params.id }; if (req.session.role !== 'admin') q.userId = req.session.userId;
  const a = await Alert.findOne(q); if (!a) return res.status(404).json({ error: 'Alert not found.' });
  if (a.status === 'sent') { a.status = 'acknowledged'; a.acknowledgedAt = new Date(); event(a, 'acknowledged', 'Alert acknowledged in app'); await a.save(); }
  res.json({ alert: publicAlert(a) });
});
app.post('/api/alerts/:id/resolve', auth, async (req, res) => {
  const q = { _id: req.params.id }; if (req.session.role !== 'admin') q.userId = req.session.userId;
  const a = await Alert.findOne(q); if (!a) return res.status(404).json({ error: 'Alert not found.' });
  if (a.status !== 'resolved') { a.status = 'resolved'; a.resolvedAt = new Date(); event(a, 'resolved', 'Alert marked resolved; live location updates stop'); await a.save(); }
  res.json({ alert: publicAlert(a) });
});
app.get('/api/admin/alerts', auth, adminOnly, async (req, res) => {
  const alerts = await Alert.find().sort({ createdAt: -1 }).limit(200).lean(); res.json({ alerts: alerts.map(publicAlert) });
});
app.get('/api/admin/report', auth, adminOnly, async (req, res) => {
  const all = await Alert.find().select('status createdAt acknowledgedAt resolvedAt').lean();
  const acknowledged = all.filter(a => a.acknowledgedAt);
  const avgAckSeconds = acknowledged.length ? Math.round(acknowledged.reduce((s, a) => s + (a.acknowledgedAt - a.createdAt) / 1000, 0) / acknowledged.length) : null;
  const avgResolveSeconds = all.filter(a => a.resolvedAt).length ? Math.round(all.filter(a => a.resolvedAt).reduce((s, a) => s + (a.resolvedAt - a.createdAt) / 1000, 0) / all.filter(a => a.resolvedAt).length) : null;
  res.json({ total: all.length, active: all.filter(a => a.status !== 'resolved').length, acknowledged: all.filter(a => a.status === 'acknowledged').length, resolved: all.filter(a => a.status === 'resolved').length, averageAcknowledgementSeconds: avgAckSeconds, averageResolutionSeconds: avgResolveSeconds });
});

app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error.' }); });

async function start() {
  if (!process.env.MONGODB_URI) { console.error('Missing MONGODB_URI. Copy .env.example to .env and configure MongoDB.'); process.exit(1); }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-only-change-this-secret') console.warn('WARNING: Set a long random SESSION_SECRET in .env before use.');
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(PORT, () => console.log(`Silent SOS is running at ${process.env.BASE_URL || `http://localhost:${PORT}`}`));
}
start().catch(err => { console.error('Could not start app/database:', err.message); process.exit(1); });

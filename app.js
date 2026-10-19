const $ = (s) => document.querySelector(s);
const state = { user: null, contacts: [], alerts: [], activeId: null, watchId: null, longTimer: null, longFired: false, alertPoll: null, locationNoticeShown: false };

async function api(url, options = {}) {
  const opts = { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const response = await fetch(url, opts);
  let data = {}; try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function message(el, text, ok = false) { el.textContent = text; el.classList.toggle('ok', ok); }
function banner(text, error = false) { const el = $('#banner'); el.textContent = text; el.classList.remove('hidden', 'error'); if (error) el.classList.add('error'); }
function hideBanner() { $('#banner').classList.add('hidden'); }
function dateTime(v) { return v ? new Date(v).toLocaleString() : '—'; }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function statusTag(status) { return `<span class="status ${esc(status)}">${esc(status)}</span>`; }
function setLoggedIn(user) {
  state.user = user;
  $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden'); $('#logoutBtn').classList.remove('hidden');
  $('#userLabel').textContent = `Hi, ${user.name}`;
  $('#adminPanel').classList.toggle('hidden', user.role !== 'admin');
  loadDashboard();
}
function setLoggedOut() {
  stopLocationWatch(); clearInterval(state.alertPoll); state.alertPoll = null; state.user = null; state.activeId = null;
  $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden'); $('#logoutBtn').classList.add('hidden'); $('#userLabel').textContent = '';
}

for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t === tab));
  const login = tab.dataset.tab === 'login'; $('#loginForm').classList.toggle('hidden', !login); $('#registerForm').classList.toggle('hidden', login); message($('#authMessage'), '');
});
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.currentTarget); const btn = e.currentTarget.querySelector('button'); btn.disabled = true;
  try { const d = await api('/api/login', { method: 'POST', body: Object.fromEntries(f) }); message($('#authMessage'), 'Logged in.', true); setLoggedIn(d.user); }
  catch (err) { message($('#authMessage'), err.message); } finally { btn.disabled = false; }
});
$('#registerForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.currentTarget); const btn = e.currentTarget.querySelector('button'); btn.disabled = true;
  try { const d = await api('/api/register', { method: 'POST', body: Object.fromEntries(f) }); setLoggedIn(d.user); }
  catch (err) { message($('#authMessage'), err.message); } finally { btn.disabled = false; }
});
$('#logoutBtn').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch {} setLoggedOut(); });

async function loadDashboard() {
  try {
    const health = await api('/api/health');
    $('#systemStatus').textContent = health.database === 'connected' ? (health.notificationTestMode ? 'Database ready · test notifications' : 'Database ready') : 'Database offline';
    $('#systemStatus').style.background = health.database === 'connected' ? '#e8f6f1' : '#fff0f0';
    await Promise.all([loadContacts(), loadAlerts()]);
    if (state.user.role === 'admin') await loadAdmin();
  } catch (e) { banner(e.message, true); }
}
async function loadContacts() {
  const d = await api('/api/contacts'); state.contacts = d.contacts;
  $('#contactCount').textContent = state.contacts.length;
  $('#contactsList').innerHTML = state.contacts.length ? state.contacts.map(c => `<div class="item"><div><strong>${esc(c.name)}</strong><p>${c.phone ? `Phone: ${esc(c.phone)}<br>` : ''}${c.email ? `Email: ${esc(c.email)}<br>` : ''}Consent confirmed</p></div><div class="item-actions"><button class="btn btn-quiet mini" data-delete-contact="${esc(c._id)}">Remove</button></div></div>`).join('') : '<p class="muted">No contacts yet. Add someone who has agreed to receive alerts.</p>';
}
$('#contactForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.currentTarget); const body = Object.fromEntries(f); body.consent = f.get('consent') === 'on';
  try { await api('/api/contacts', { method: 'POST', body }); e.currentTarget.reset(); await loadContacts(); banner('Trusted contact added. Notifications remain in test mode until configured.'); }
  catch (err) { banner(err.message, true); }
});
$('#contactsList').addEventListener('click', async e => {
  const b = e.target.closest('[data-delete-contact]'); if (!b) return;
  if (!confirm('Remove this trusted contact?')) return;
  try { await api(`/api/contacts/${b.dataset.deleteContact}`, { method: 'DELETE' }); await loadContacts(); }
  catch (err) { banner(err.message, true); }
});

async function loadAlerts() {
  const d = await api('/api/alerts'); state.alerts = d.alerts;
  const current = state.alerts.find(a => a.status !== 'resolved');
  if (current) state.activeId = current.id;
  else { state.activeId = null; stopLocationWatch(); }
  renderActive(); renderHistory();
}
function renderActive() {
  const box = $('#activeAlert');
  const a = state.alerts.find(x => x.id === state.activeId && x.status !== 'resolved');
  if (!a) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const loc = a.latestLocation;
  box.innerHTML = `<h3>Active alert ${statusTag(a.status)}</h3><p><b>Created:</b> ${esc(dateTime(a.createdAt))}</p><p><b>Location:</b> ${loc ? `<a href="https://maps.google.com/?q=${encodeURIComponent(`${loc.lat},${loc.lng}`)}" target="_blank" rel="noopener">Open latest location</a> · accuracy approx. ${Math.round(loc.accuracy || 0)} m` : 'Not captured yet'}</p><p><b>Updates recorded:</b> ${(a.locations || []).length}</p><div class="item-actions"><button class="btn btn-quiet mini" id="locateBtn">Share/update location</button><button class="btn btn-primary mini" id="resolveBtn">Mark resolved</button></div><p class="hint">The browser may prompt for location permission. Updates stop when resolved or when this page closes.</p>`;
  $('#locateBtn').addEventListener('click', () => startLocationWatch(a.id));
  $('#resolveBtn').addEventListener('click', () => resolveAlert(a.id));
}
function renderHistory() {
  const el = $('#historyList');
  if (!state.alerts.length) { el.innerHTML = '<p class="muted">No alerts yet.</p>'; return; }
  el.innerHTML = state.alerts.map(a => {
    const ackSecs = a.acknowledgedAt ? Math.max(0, Math.round((new Date(a.acknowledgedAt) - new Date(a.createdAt))/1000)) : null;
    const resSecs = a.resolvedAt ? Math.max(0, Math.round((new Date(a.resolvedAt) - new Date(a.createdAt))/1000)) : null;
    return `<div class="item"><div><strong>Alert · ${esc(dateTime(a.createdAt))} ${statusTag(a.status)}</strong><p>Locations: ${(a.locations || []).length} · Acknowledged: ${esc(a.acknowledgedAt ? `${ackSecs}s` : '—')} · Resolution: ${esc(a.resolvedAt ? `${resSecs}s` : '—')}</p><p>Events: ${(a.events || []).map(ev => esc(ev.type)).join(' · ') || '—'}</p>${a.latestLocation ? `<p><a href="https://maps.google.com/?q=${encodeURIComponent(`${a.latestLocation.lat},${a.latestLocation.lng}`)}" target="_blank" rel="noopener">Latest location map</a></p>` : ''}</div><div class="item-actions">${a.status === 'sent' ? `<button class="btn btn-quiet mini" data-ack="${esc(a.id)}">Acknowledge</button>` : ''}${a.status !== 'resolved' ? `<button class="btn btn-primary mini" data-resolve="${esc(a.id)}">Resolve</button>` : ''}</div></div>`;
  }).join('');
}
$('#historyList').addEventListener('click', async e => {
  const ack = e.target.closest('[data-ack]'), resolve = e.target.closest('[data-resolve]');
  try { if (ack) await api(`/api/alerts/${ack.dataset.ack}/acknowledge`, { method: 'POST' }); if (resolve) await resolveAlert(resolve.dataset.resolve); await loadAlerts(); }
  catch (err) { banner(err.message, true); }
});
$('#refreshBtn').addEventListener('click', () => loadAlerts().catch(e => banner(e.message, true)));

async function createAlert() {
  if (!state.user) return;
  if (state.contacts.length === 0) { banner('Add at least one trusted contact first.', true); return; }
  if (state.activeId) { banner('You already have an active alert. Resolve it before creating another.', true); return; }
  const button = $('#sosBtn'); button.disabled = true;
  try {
    const d = await api('/api/alerts', { method: 'POST', body: {} });
    state.activeId = d.alert.id; banner(d.warning || 'Alert created.'); await loadAlerts(); startLocationWatch(d.alert.id);
    if (!state.alertPoll) state.alertPoll = setInterval(() => loadAlerts().catch(() => {}), 5000);
  } catch (e) { banner(e.message, true); } finally { button.disabled = false; }
}
const sos = $('#sosBtn');
sos.addEventListener('pointerdown', () => { state.longFired = false; clearTimeout(state.longTimer); state.longTimer = setTimeout(() => { state.longFired = true; createAlert(); }, 1500); });
['pointerup','pointerleave','pointercancel'].forEach(ev => sos.addEventListener(ev, () => clearTimeout(state.longTimer)));
sos.addEventListener('click', e => { if (state.longFired) { state.longFired = false; e.preventDefault(); return; } createAlert(); });

function startLocationWatch(alertId) {
  if (!navigator.geolocation) { banner('This browser does not support geolocation.', true); return; }
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  banner('Requesting location permission. Keep this page open for updates.');
  state.watchId = navigator.geolocation.watchPosition(async pos => {
    try {
      await api(`/api/alerts/${alertId}/location`, { method: 'POST', body: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } });
      state.locationNoticeShown = true;
      const latest = state.alerts.find(a => a.id === alertId); if (latest) { latest.latestLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, capturedAt: new Date().toISOString() }; latest.locations = latest.locations || []; latest.locations.push(latest.latestLocation); renderActive(); }
      banner('Location update recorded.');
    } catch (e) { if (e.message.includes('resolved')) stopLocationWatch(); else banner(e.message, true); }
  }, err => {
    const msg = err.code === 1 ? 'Location permission was denied. You can still resolve the alert, but location is not being shared.' : err.code === 2 ? 'Location is currently unavailable. Try “Share/update location” again.' : 'Location request timed out. Try again.';
    banner(msg, true);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}
function stopLocationWatch() { if (state.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
async function resolveAlert(id) {
  await api(`/api/alerts/${id}/resolve`, { method: 'POST' }); stopLocationWatch(); banner('Alert marked resolved. Live location updates stopped.'); await loadAlerts();
}

async function loadAdmin() {
  try {
    const [report, alerts] = await Promise.all([api('/api/admin/report'), api('/api/admin/alerts')]);
    $('#reportStats').innerHTML = [['All alerts',report.total],['Active',report.active],['Acknowledged',report.acknowledged],['Resolved',report.resolved],['Avg acknowledgement',report.averageAcknowledgementSeconds == null ? '—' : `${report.averageAcknowledgementSeconds}s`],['Avg resolution',report.averageResolutionSeconds == null ? '—' : `${report.averageResolutionSeconds}s`]].map(([label,val]) => `<div class="stat"><b>${esc(val)}</b><span>${esc(label)}</span></div>`).join('');
    $('#adminAlerts').innerHTML = alerts.alerts.length ? alerts.alerts.map(a => `<div class="item"><div><strong>${esc(a.userName)} · ${esc(dateTime(a.createdAt))} ${statusTag(a.status)}</strong><p>Location updates: ${(a.locations || []).length} · Acknowledged: ${esc(dateTime(a.acknowledgedAt))} · Resolved: ${esc(dateTime(a.resolvedAt))}</p>${a.latestLocation ? `<p><a href="https://maps.google.com/?q=${encodeURIComponent(`${a.latestLocation.lat},${a.latestLocation.lng}`)}" target="_blank" rel="noopener">View latest location</a></p>` : ''}</div><div class="item-actions">${a.status === 'sent' ? `<button class="btn btn-quiet mini" data-admin-ack="${esc(a.id)}">Acknowledge</button>` : ''}${a.status !== 'resolved' ? `<button class="btn btn-primary mini" data-admin-resolve="${esc(a.id)}">Resolve</button>` : ''}</div></div>`).join('') : '<p class="muted">No alerts recorded.</p>';
  } catch (e) { $('#adminAlerts').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
$('#adminRefreshBtn').addEventListener('click', () => loadAdmin());
$('#adminAlerts').addEventListener('click', async e => {
  const ack = e.target.closest('[data-admin-ack]'), resolve = e.target.closest('[data-admin-resolve]');
  try { if (ack) await api(`/api/alerts/${ack.dataset.adminAck}/acknowledge`, { method: 'POST' }); if (resolve) await api(`/api/alerts/${resolve.dataset.adminResolve}/resolve`, { method: 'POST' }); await loadAdmin(); }
  catch (err) { banner(err.message, true); }
});

async function loadContactAlert(token) {
  $('#authView').classList.add('hidden');
  $('#appView').classList.add('hidden');
  $('#contactAlertView').classList.remove('hidden');
  try {
    const d = await api(`/api/contact-alert/${encodeURIComponent(token)}`);
    const a = d.alert;
    const loc = a.latestLocation ? `<p><b>Latest location:</b> <a href="https://maps.google.com/?q=${encodeURIComponent(`${a.latestLocation.lat},${a.latestLocation.lng}`)}" target="_blank" rel="noopener">Open map</a> · captured ${esc(dateTime(a.latestLocation.capturedAt))}</p>` : '<p>Location is not available yet. Refresh this page later to check for updates.</p>';
    $('#contactAlertDetails').innerHTML = `<p><b>For:</b> ${esc(a.userName)}</p><p><b>Alert created:</b> ${esc(dateTime(a.createdAt))}</p><p><b>Status:</b> ${statusTag(a.status)}</p>${loc}<p><b>Last updated:</b> ${esc(dateTime((a.events || []).slice(-1)[0]?.at))}</p>`;
    $('#contactAlertActions').innerHTML = a.status === 'sent' ? '<button id="contactAckBtn" class="btn btn-primary">I have seen this alert</button>' : '<p>This alert has already been acknowledged or resolved.</p>';
    const ack = $('#contactAckBtn'); if (ack) ack.addEventListener('click', async () => { ack.disabled = true; try { await api(`/api/contact-alert/${encodeURIComponent(token)}/acknowledge`, { method: 'POST', body: {} }); await loadContactAlert(token); } catch (e) { message($('#contactAlertActions'), e.message); ack.disabled = false; } });
    if (a.status !== 'resolved') setTimeout(() => loadContactAlert(token), 15000);
  } catch (e) { $('#contactAlertDetails').textContent = e.message; $('#contactAlertActions').textContent = ''; }
}
(async function init() {
  const params = new URLSearchParams(location.search);
  const contactToken = params.get('contactToken');
  if (contactToken) { loadContactAlert(contactToken); return; }
  try { const d = await api('/api/me'); setLoggedIn(d.user); }
  catch { setLoggedOut(); }
})();

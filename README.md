# Silent SOS — Phase 1 project

A learning/demo web app covering the core requirements from the project brief: registration/login, trusted contacts with consent, one-tap and 1.5-second long-press SOS, GPS location updates while the page is open, SMS/email notification hooks, sent/acknowledged/resolved statuses, timestamped event history, admin monitoring, response-time summaries, responsive UI, and technical notes.

> **Safety and reliability warning:** This is an educational prototype, not a certified emergency service. Do not rely on it as your only safety plan or test it with real contacts without their permission. It does not contact police or ambulance services. Browser geolocation may stop when the tab is closed, backgrounded, offline, or suspended. SMS/email provider acceptance is not proof that a recipient received or read the message. Test all integrations with consenting contacts before any real use.

## Tech stack

- Frontend: HTML, CSS, JavaScript (kept simple for a beginner to inspect)
- Backend: Node.js + Express
- Database: MongoDB via Mongoose (including session storage)
- Location: browser Geolocation API
- Notifications: optional Twilio SMS and SMTP email via Nodemailer
- Security basics: bcrypt password hashing, HTTP security headers, request rate limiting, HttpOnly session cookie, server-side ownership checks

## Requirements

- Node.js 18 or newer
- MongoDB running locally, or a MongoDB Atlas connection string
- Internet access for installing npm packages

## Run on your laptop

1. Extract this ZIP into a folder.
2. Install Node.js LTS if it is not installed.
3. Install/run MongoDB locally, or create a MongoDB Atlas database.
4. Open the extracted folder in VS Code.
5. Open Terminal → New Terminal.
6. Run `npm install`.
7. Copy `.env.example` to a new file named `.env`.
8. Edit `.env` and set `MONGODB_URI` and a long random `SESSION_SECRET`. Keep `.env` private; never upload it to GitHub.
9. Leave `NOTIFICATION_TEST_MODE=true`, `ENABLE_SMS=false`, and `ENABLE_EMAIL=false` while learning.
10. Run `npm start`.
11. Open `http://localhost:3000` in your browser. Use `Ctrl+C` in the terminal to stop the server.

### Admin dashboard

Set `ADMIN_EMAIL` in `.env` before registering the account you want to use as admin. Register with exactly that email. Only that account receives the admin role. Do not use an email address you do not control. If an account already exists before changing this setting, changing the environment variable does not retroactively change its role.

### Notification setup

Notifications are **off by default** and `NOTIFICATION_TEST_MODE=true` only logs example messages to the server terminal. This helps prevent accidental messages.

- SMS: Configure Twilio account SID, auth token, and a verified/authorized sender number. Set `ENABLE_SMS=true` only after testing and set `NOTIFICATION_TEST_MODE=false` to send real SMS.
- Email: Configure SMTP host/port/user/password and `EMAIL_FROM`. Set `ENABLE_EMAIL=true` only after testing and set `NOTIFICATION_TEST_MODE=false` to send real email.
- A contact must have consented before the app attempts to notify them. Provider errors are logged and saved as basic results; this prototype does not guarantee delivery.

Never share API keys or SMTP passwords. Use a separate test account and ask contacts before sending messages.

## Feature checklist against the brief

| Requirement | Included | Notes / limitations |
|---|---|---|
| Register and log in | Yes | Email + password; bcrypt hashing |
| One-click SOS | Yes | Creates an alert; requires at least one consenting contact |
| Long-press SOS | Yes | 1.5-second press; browser/device still controls visible UI |
| Silent/no audible alarm | Yes | No alarm sound is played; the web page is not concealed |
| GPS location | Yes | Requests browser permission |
| Continuous live updates until resolved | Partial | Uses `watchPosition` while the page is open; not reliable in background/closed browser |
| Trusted contacts | Yes | Name, phone, email; consent required |
| SMS notification | Integration hook | Twilio configuration required; off by default |
| Email notification | Integration hook | SMTP configuration required; off by default |
| In-app alert history | Yes | User sees own alerts and status |
| Sent / acknowledged / resolved | Yes | Acknowledgement and resolution can be recorded by user/admin |
| Timestamped activity log | Yes | Alert creation, location updates, acknowledgement, resolution |
| Admin monitoring | Yes | Admin can view active/history alerts and update status |
| Response-time reporting | Yes | Average acknowledgement and resolution times when data exists |
| Mobile-responsive UI | Yes | Responsive layout |
| MongoDB | Yes | Requires configured database |
| Secure data handling | Basic | Not independently audited; see production checklist |
| Under 2-second response | Not guaranteed | Depends on network, browser, database, and notification provider |
| 24/7 availability | Not guaranteed | Requires hosting/monitoring and production operations |
| Direct emergency-service integration | No | Explicitly outside phase 1 |

## Important technical limits

- The SOS endpoint responds after it creates the alert and attempts configured notification providers; real-world network and provider delivery times vary.
- Geolocation requires HTTPS in deployment (localhost is allowed for local development) and user permission. The browser may pause updates in the background. This cannot guarantee reliable background tracking.
- The admin page is a basic dashboard, not a staffed monitoring center.
- Before production use, add CSRF protection, stronger validation, audit/retention controls, consent and privacy notices, secure HTTPS hosting, monitored backups, database access controls, security testing, and operational support. Consider professional review before collecting sensitive location data.

## Deployment starter and test plan

A `render.yaml` file is included as a deployment starting point. It does not deploy the app automatically and still requires a MongoDB URI, public BASE_URL, and admin email in the hosting dashboard. See `TESTING_CHECKLIST.md` for a step-by-step test plan.

## Suggested demo flow

1. Create an account and log in.
2. Add a test contact who has agreed to receive test messages.
3. Keep notifications in test mode.
4. Tap or long-press SOS. Grant location permission if comfortable.
5. Confirm location updates appear in the alert history.
6. Acknowledge and then resolve the alert.
7. Register the configured `ADMIN_EMAIL` account separately and inspect admin reports.

If you are in immediate danger in India, call **112** or contact a trusted person directly; do not wait for this prototype.

# Silent SOS test checklist

Use only test accounts and contacts who explicitly agreed to receive test alerts. Keep `NOTIFICATION_TEST_MODE=true` and both delivery switches off until provider setup is complete. This prototype is not an emergency service.

## Local smoke test

1. Set `.env` and connect to a test MongoDB database.
2. Run `npm install`, then `npm start`.
3. Open `/api/health`; verify `ok: true` and `database: connected`.
4. Register a normal test user and sign out/in again.
5. Add a consenting test contact; verify it appears and can be removed.
6. Trigger an SOS. Confirm an alert and timestamped event appear.
7. Allow location permission in a test session; confirm coordinates update while the page stays open.
8. Open the trusted contact link from the test log/message; acknowledge the alert.
9. Confirm the status changes to acknowledged, then resolve it and confirm tracking stops.
10. Register the exact `ADMIN_EMAIL` address on a fresh test database; verify admin monitoring and response-time reports.
11. Try another user's alert ID while logged in as a normal user; access should be denied.
12. Try a cross-origin POST; it should be blocked when an Origin header is supplied.
13. Restart the server and verify sessions persist through MongoDB session storage.

## Notification provider test

Only after the local flow works, use provider test credentials and consenting test contacts. Check provider logs and the recipient device/mailbox. A provider-accepted response does not prove the recipient received or read the alert. Never use the app as the sole safety plan.

## Deployment

`render.yaml` is a deployment starting point, not proof of a live deployment. Configure `BASE_URL`, `MONGODB_URI`, `SESSION_SECRET`, and `ADMIN_EMAIL` in the host dashboard. Keep SMS/email disabled and test mode enabled until delivery is verified. Use HTTPS, database network restrictions/backups, and a security review before collecting real location data.

## Requirements that cannot be guaranteed by a browser app

- GPS tracking after a tab is closed or the browser suspends it.
- Guaranteed response time under two seconds or 24/7 service availability.
- Direct police/ambulance dispatch without an approved, supported integration and operational agreement.

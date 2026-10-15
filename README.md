# EcoSync — recycling rewards and machine digital twin

The original repository contained only a browser simulation. EcoSync now includes an Express 5 backend, MongoDB accounts and ledgers, transaction-safe redemption, citizen pages, operations tools, and a two-unit digital twin driven by authenticated controller events. The frontend retains lightweight HTML/CSS/JavaScript; no frontend framework migration or build step is required.

The original simulation is preserved at `/simulation.html`, isolated from application records. Its reset-during-deposit crash, stale reward confirmation and out-of-stock redemption were fixed. Its illustrative balance and stock never enter MongoDB.

## Local setup

Prerequisites: Node.js 24 LTS and MongoDB Community Server with `mongod` installed. A MongoDB replica set is required; standalone MongoDB is rejected. Atlas also works. The helper recognizes the installed Windows MongoDB 8.2 path; otherwise put `mongod` on PATH or set `MONGOD_PATH` to the executable.

```powershell
npm ci
npm run setup
npm run db:local
```

Leave the database terminal open. In another terminal in this folder:

```powershell
npm start
```

Open [EcoSync](http://localhost:3000). `npm run dev` restarts the server when source changes. Express serves `public/` directly; there is no build command. Opening root `index.html` explains how to launch the app; a static HTTP server cannot run wallet APIs.

`npm run setup` creates ignored `.env` only if absent and generates `IDENTITY_ENCRYPTION_KEY`. Keep this key stable and back it up securely with MongoDB. Losing/changing it makes existing QR images unreadable. Sessions use random tokens stored hashed in MongoDB; no session signing secret is needed.

The local database binds to **127.0.0.1:27018** with data in ignored `.local/mongo`. It does not reconfigure an existing MongoDB on port 27017. Ctrl+C stops it; restarting retains accounts. This loopback database is for local development only. For Atlas, skip `db:local`, set `MONGODB_URI` to an authenticated cluster URI including a database name, and restrict network access.

### First administrator and real catalogue

Register your account through the site, then use a trusted server terminal:

```powershell
npm run admin -- your-registered-email@example.com
```

Refresh the site. No default credentials or seeded business records exist. New citizens start with zero points. Configure actual controllers in **Machines**, then actual products and stock in **Rewards & Inventory**. A reward without a machine ID uses manual operator fulfillment; a machine-assigned reward requires a visit to that station. Acceptance rates must be explicitly configured by an operator.

### Verification

```powershell
npm run check
npm test
npm audit
```

Integration tests launch an isolated MongoDB replica set on port 27119, use database `ecosync_test` in `.local/tests/run-*`, and stop it afterward. Fixtures never enter the application database. Tests cover QR uniqueness/persistence, authentication, account isolation, empty accounts, missing AI, acceptance rules, duplicate/concurrent deposits, overspending/overselling, retry-safe redemption, save/redeem sessions, failed/successful dispensing, telemetry freshness and wallet/ledger reconciliation. `mongod` must be installed. Restricted automation hosts may require local socket/child-process permission.

## Points and fulfillment policy

- The backend derives citizen identity from authentication, and reads prices, inventory, rates and balances from MongoDB. Public website requests cannot credit points.
- Validated deposits insert a deposit, immutable ledger credit and cached wallet update in one transaction. Points are `floor(weightGrams * pointsPerKg / 1000)`. Samples worth less than one point are rejected rather than assigned an invented minimum.
- Unique `(machineId, eventId)` plus single-use identity sessions prevent duplicate credits. Exact retries return the committed result; changed payloads under the same key return 409. A new measurement must be within five minutes of server time.
- A deposit is credited independently of the save/redeem choice. An unanswered choice leaves points saved. A new machine choice must be made within ten minutes of deposit.
- Redemption atomically reserves stock, deducts the current price, and inserts the order and debit ledger entry. `(userId, Idempotency-Key)` is unique. Keep the same key and payload across retries. The browser keeps an in-flight key in sessionStorage across reloads and ambiguous network failures.
- Interrupted requests appear in the Rewards Store with a **Check / retry redemption** control, even if the reward is now unavailable or exhausted. It first checks the owner's committed order by key, then retries with the original key only when no order exists. Session storage is scoped to the browser tab; keep the tab open when recovering an uncertain request.
- Inventory edits include the catalogue's `version`; reservations, refunds and edits increment it. Stale operator edits return 409 rather than overwrite newer stock. Refresh the catalogue before reconciling inventory.
- Products with pending orders cannot move between fulfillment locations until those orders are finalized, so failed orders restore stock to the correct location.
- Website orders are `pending_fulfillment`; an operator records `fulfilled` only after actual delivery, or `failed` to cancel and refund.
- Station orders remain `awaiting_dispense` until their assigned controller confirms `dispensed` or `failed`. Confirmed failure restores stock and points exactly once. Conflicting final outcomes return 409. Failure means **confirmed no physical delivery**.
- Unknown physical outcomes stay pending; timeouts are never automatically refunded. The controller must reconcile its durable command journal and sensors before reporting a final outcome. Admins cannot mark machine orders dispensed or refund an uncertain machine outcome through the website.

## Controller integration

Register each real unit through Machines. Copy its generated credential immediately and provision it securely into that controller. Only its hash is stored in MongoDB. Send `Authorization: Bearer <credential>` over HTTPS. Operations can rotate credentials or disable units. Configure the waste unit's `pairedMachineId` to the product unit identifier. Configure real acceptance rules; the UI starts with no sample rates.

All paths below are relative to `/api/machine`. Controllers use bearer authentication, not website cookies/Origin. Event IDs must be 8–120 letters, numbers, underscores or hyphens. Never reuse one for a different event; retain original payloads for retries and synchronize controller clocks.

1. `POST /identify` with `{ "qrToken": "<scanned QR contents>" }` or `{ "rfidToken": "<secure card token>" }` returns a five-minute `sessionId`. Only waste controllers can identify. The QR is account identification, **not website login**. No citizen profile is returned. RFID tokens must be securely provisioned; public low-entropy UIDs alone are unsuitable credentials.
2. Submit real classifier evidence, stable weight and confirmed sorting using `POST /deposits`:

   ```json
   {
     "eventId": "<unique-controller-event>",
     "sessionId": "<identity-session>",
     "category": "<configured-category>",
     "weightGrams": 1000,
     "stable": true,
     "sorted": true,
     "confidence": 0.95,
     "modelVersion": "<actual-model-version>",
     "classificationId": "<actual-classification-reference>",
     "measuredAt": "<current-ISO-8601-UTC-time>"
   }
   ```

   Numbers illustrate the API schema only. The backend trusts provisioned controllers to attest physical readings and model references, validates configured category/confidence/weight limits and session, and calculates points itself. Protect firmware and credentials: a compromised controller can falsify evidence. Website photo scans cannot award points.
3. Display returned category, weight, points and deposit `_id` at the waste screen. `POST /deposits/:id/choice` accepts `{ "choice": "save" }` or `{ "choice": "redeem" }`. Redeem requires a paired enabled product unit with recent telemetry, and returns an expiring single-use redemption `sessionId`. If unavailable, points stay in the wallet. Save needs no product unit.
4. The product controller polls `GET /commands`. `activations` holds eligible redemption sessions, `rewards` holds its stocked catalogue, and `commands` holds authorized dispensing work. The kiosk must associate selections with the correct session rather than activate for unrelated visitors. `POST /redeem` with `{ "sessionId": "<redemption-session>", "rewardId": "<catalogue-id>" }` and an `Idempotency-Key` authorizes one purchase. Arbitrary citizen IDs are rejected.
5. Dispense only returned commands. Stable `commandId` equals redemption `_id`; commands remain until finalized. **The controller must durably deduplicate command IDs before actuating**, including after crashes/restarts. Repeated polls must never actuate twice. Exactly-once physical actuation cannot be guaranteed by an HTTP server alone.
6. `POST /redemptions/:id/outcome` accepts `{ "eventId": "<unique-outcome-event>", "status": "dispensed" }` or `"failed"`. Retry the same outcome after network loss. Never report failed when delivery is uncertain.
7. Send new telemetry every 30 seconds using `POST /events`:

   ```json
   {
     "eventId": "<unique-heartbeat-event>",
     "observedAt": "<current-ISO-8601-UTC-time>",
     "compartments": [{ "category": "<measured-stream>", "fillPercent": 42 }],
     "alert": null
   }
   ```

   Omit compartments without sensors. Exact retries never refresh connectivity; older observations cannot replace newer measurements. `connected` means accepted contact within 90 seconds, not proof of every subsystem's health. The twin polls every five seconds and retains timestamped stale readings. Without configured units it shows unavailable. Pair arrows represent configuration, not proof of a physical link.

The twin shows database inventory for each product unit and its pending dispense command count. These are reservations and configured stock, not sensor verification of physical stock. Compartment and alert timestamps remain attached to their last actual report when later heartbeats omit those fields. Older records without those timestamps show “Not reported”; new telemetry supplies them. Disabled units always report disconnected. Outcome event IDs remain bound to their original command/status even after finalization.

## Real classifier adapter

Set `AI_MODEL_ENDPOINT` and optional `AI_MODEL_KEY` in `.env`, then restart. Only the backend calls the configured endpoint. It sends `{ image: "<base64 bytes without data URL prefix>", mimeType: "image/jpeg|image/png|image/webp" }`, with optional Bearer authorization. Images are limited to 5 MB decoded and checked for matching file signatures. Timeout is 20 seconds.

The service must return `{ category: string, modelVersion: string, confidence?: number, guidance?: string[] }`. Confidence is 0–1; guidance must come from its configured model/ruleset. No prediction or guidance fallback is fabricated. Images stay in application memory and are not retained here; configure classifier-side retention separately. Photo scans always return zero points. Without an endpoint the UI/API say **AI classification is not configured**. Camera capture uses the device's supported camera/file chooser with upload fallback.

## Website and operations APIs

JSON requests/responses. Browser writes require an Origin equal to `FRONTEND_URL` and HTTP-only SameSite=Strict session cookies. Deploy the frontend and backend at the same origin; no permissive CORS is enabled. Protected routes require login; admin routes check the persisted role. Errors return `{ error: string }` with meaningful status codes. Citizen histories use `?offset=N`, 50 entries/page; admin lists use 100/page.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database health / AI configuration |
| POST | `/api/auth/register` | name, email, password; atomically creates user, wallet, permanent QR |
| POST | `/api/auth/login` | email/password; seven-day server-side session |
| POST | `/api/auth/logout` | Revoke current session |
| GET / PATCH | `/api/me` | Current profile / change name |
| GET | `/api/me/qr` | Owner-only QR PNG data URL; no stored hash/encrypted representation returned |
| GET | `/api/dashboard` | Current user summary / activity |
| GET | `/api/wallet` | Wallet summary and immutable ledger |
| GET | `/api/deposits`, `/api/redemptions` | Current user's histories |
| GET | `/api/redemptions/by-key/:key` | Recover the current user's committed website order after an interrupted response |
| GET | `/api/rewards` | Active configured catalogue |
| POST | `/api/rewards/redeem` | `{rewardId}` and `Idempotency-Key`; reserve website order |
| POST | `/api/scan` | Informational classification |
| GET | `/api/admin/overview` | Real metrics / pending count |
| GET | `/api/admin/twin` | Redacted machines and recent events |
| GET | `/api/admin/users`, `/api/admin/rewards`, `/api/admin/deposits`, `/api/admin/redemptions` | Operations lists |
| POST | `/api/admin/machines` | Register unit; return credential once |
| PATCH | `/api/admin/machines/:machineId` | Pair, location, enabled status, acceptance rules; ID/type immutable |
| POST | `/api/admin/machines/:machineId/rotate-credential` | Revoke old credential; return replacement once |
| POST / PATCH | `/api/admin/rewards`, `/api/admin/rewards/:id` | Catalogue / actual inventory reconciliation |
| POST | `/api/admin/redemptions/:id/outcome` | Website fulfillment/cancellation only |
| POST / DELETE | `/api/admin/rfid`, `/api/admin/rfid/:id` | Associate a secure unique card token / revoke it |

No signup parameter grants admin. No API transfers QR/RFID identity, edits the ledger, sets citizen balances or credits website photos. A copied QR cannot log in or award points without a controller session, but can identify the account at a provisioned machine. Apply supervised use or stronger reader/physical safeguards appropriate to your hardware.

## Persistence, security and deployment

Collections: users, qrIdentities, rfidCards, wallets, walletTransactions, deposits, rewards, redemptions, machines, machineEvents, sessions, depositSessions, redemptionSessions. Unique indexes enforce normalized email, one QR/user, QR hash, RFID hash, wallet ownership, deposit/event IDs, ledger keys and per-user redemption keys. Session TTL indexes clean up expired sessions; queries also enforce expiry. QR tokens are 256-bit random values, hashed for lookup and AES-256-GCM encrypted for stable owner rendering.

Ledger entries are append-only through the API; cached wallet summaries update in the same majority-committed transaction. Restrict database credentials/backups and never manually edit balances or ledger. This follows the [MongoDB Node transaction API](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/). The application uses escaped database text, CSP, [Express security headers and cookie practices](https://expressjs.com/en/advanced/best-practice-security.html), strict schemas, bcrypt, and rate limits for login, redemption, classification and identification. Multi-instance deployments need a shared rate-limit store at ingress; included in-process limits are local to one server.

Production requires an authenticated replica set/Atlas, least-privilege credentials, backups, `NODE_ENV=production`, HTTPS `FRONTEND_URL` and a trusted TLS reverse proxy to 127.0.0.1:3000. Secure cookies are enabled in production. Loopback binding is intentional; configure the reverse proxy for external access. Keep credentials, QR images and encryption keys out of Git/logs. QR responses use no-store cache control.

Implemented: accounts, permanent QR, authorization, wallet/ledger/history, atomic redemption/stock/refunds, controller identity/deposit/telemetry ingestion, save/redeem sessions, polled activation/dispense commands, outcome processing, persisted digital twin, operations metrics/machines/catalogue/users/RFID and classifier adapter.

Externally required: provisioned physical controllers, actual sensors/sorting/classifier evidence, kiosk/session UI, durable actuation journal, real image-classifier service, and operator-configured products/stock/locations. No physical hardware, RFID-reader firmware, live classifier accuracy, pre-rendered video or deployed hosting is claimed. No external hardware/service was connected during verification.

## Troubleshooting

- **No primary / replica set required:** run `npm run db:local` or use Atlas. Check URI replica-set name. Local port 27018 avoids an existing standalone service on 27017.
- **Port occupied:** keep one EcoSync database/server per port. The launcher refuses to modify existing listeners. Change `PORT` and `FRONTEND_URL` together if 3000 is occupied.
- **Origin rejected:** use exactly the origin in `.env`; localhost and 127.0.0.1 differ. Production requires HTTPS.
- **Empty catalogue/twin:** configure real products/controllers; there is no seed.
- **Unavailable station reward:** check pairing, enabled unit, recent telemetry, machine assignment and stock.
- **Pending dispense:** reconcile durable controller actuation records with delivery sensors, then report the verified outcome. Do not assume failure or issue another dispense.
- **Unreadable QR:** restore the original encryption key rather than silently changing the citizen's identity.

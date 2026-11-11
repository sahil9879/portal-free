FEE PORTAL - AUTOMATION UPDATE

Included modules:
- Students: existing daily fee reminder scheduler (REMINDER_CRON, default 09:00 Asia/Karachi), payment status and WhatsApp logs.
- Real Estate: daily due-payment reminder scheduler (REALESTATE_CRON, default 09:15 Asia/Karachi), rent schedule refresh, duplicate-attempt protection per payment/day.
- Hospital: medicine stock and expiry alert events (HOSPITAL_ALERT_CRON, default 09:30 Asia/Karachi); prescription order workflow; dispensing deducts inventory in a database transaction and blocks expired/insufficient/unlisted medicines.

INSTALL:
1. BACK UP your existing server/fees.db file first. Do not delete it.
2. Stop both Vite and API terminals (Ctrl+C).
3. Copy the contents of client/src into your existing client/src, replacing matching files.
4. Copy the contents of server into your existing server, replacing matching source files. Keep your existing .env and fees.db. Do not replace .env with .env.example.
5. In server/.env, make sure TZ=Asia/Karachi. Optional schedule settings:
   REMINDER_CRON=0 9 * * *
   REALESTATE_CRON=15 9 * * *
   HOSPITAL_ALERT_CRON=30 9 * * *
6. Terminal 1:
   cd server
   npm install
   npm run dev
7. Terminal 2:
   cd client
   npm install
   npm run dev
8. Open the Vite URL (usually http://localhost:5173). Check API health at http://localhost:4000/api/health.

IMPORTANT:
- Existing SQLite records are retained; new tables are created with CREATE TABLE IF NOT EXISTS.
- Keep DRY_RUN=true until WhatsApp Cloud API credentials and approved templates are configured.
- A scheduled job only runs while the server process is running. For always-on automation, host the backend on an always-on server.
- Hospital drug interaction checking is NOT a clinical decision engine. This package does not contain a verified drug interaction database. A licensed pharmacist/doctor must verify prescriptions and interactions.
- Hospital dispensing matches the prescribed medicine name or generic name against inventory. Ensure inventory naming is consistent and always have a pharmacist verify before marking an order dispensed.
- This is an operational starter workflow, not a certified hospital information system. Add authentication, role permissions, audit controls, backups and privacy/security review before using real patient data.

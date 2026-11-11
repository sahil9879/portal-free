# University Fee Portal (React + Node)

Store student and parent details, then send automatic WhatsApp messages:
- **Fee paid**: click "Mark paid" and a "Fees Submitted" confirmation goes to the student and parent.
- **Fee pending**: a daily job sends reminders 7 days before, 1 day before, on the due date, then every 3 days while overdue.

## Structure
- `client/`: React (Vite) admin portal
- `server/`: Express API, SQLite database, daily scheduler, WhatsApp Cloud API sender

## Setup
1. Install Node.js 18 or newer (Node.js 20 LTS or 22 LTS recommended).
2. `npm install` in this folder, then `npm run install:all`
3. `cp server/.env.example server/.env` and edit it. Set your institute name and WhatsApp keys. This local-development build opens directly without an admin password; do not expose it to the public internet until authentication is restored.
4. `npm run dev`, then open http://localhost:5173

Production: `npm run build`, then `npm start` (the server also serves the built app on port 4000).

## Test mode
`DRY_RUN=true` (default) only prints messages in the server console and the Message log. Set `DRY_RUN=false` once WhatsApp is configured.

## WhatsApp setup (Meta Cloud API)
1. Create a Meta Business account and add a WhatsApp Business phone number.
2. Put `WA_PHONE_NUMBER_ID` and a permanent `WA_ACCESS_TOKEN` in `server/.env`.
3. Submit these two Utility templates (language: English) and wait for approval.
   Replace "Your Institute Name" with your real institute name.

**fee_reminder**
```
*Your Institute Name* - Fee Alert

Dear {{1}}, this is a reminder that the fee of PKR {{3}} for {{4}} (student: {{2}}) is pending. Due date: {{5}}.

Please submit the fee at the earliest. If already paid, please ignore this message.
```

**fee_confirmation**
```
*Your Institute Name* - Payment Confirmation

Dear {{1}}, Fees Submitted. We have received PKR {{3}} for {{4}} (student: {{2}}). Thank you.
```
**realestate_notice** (Utility template; one body variable `{{1}}`)
```
{{1}}
```
The portal inserts the payment receipt or due reminder into this variable. Set `WA_TEMPLATE_REALESTATE=realestate_notice` (or your approved template name) in `server/.env`.

4. Only message people who agreed to receive WhatsApp updates (collect consent at admission).

## Notes
- This development build has password protection disabled as requested. Keep it on your trusted local machine/network only; restore authentication before any public deployment.
- Phone numbers like `03237895410` are converted to `923237895410` automatically.
- Reminder schedule and timezone are set with `REMINDER_CRON` and `TZ` in `.env`.
- Back up `server/fees.db` regularly. The database driver is `better-sqlite3`; npm installs its native binary for your operating system.

## Role-specific profile details
- Student records support student/admission ID, class/programme, section, roll number, admission date, address, guardian relationship, internal notes, and WhatsApp consent.
- Property contracts support property type/address, contract reference, agreement dates, security deposit, and internal terms/notes.
- Existing SQLite databases are upgraded automatically with additive columns; existing records are retained.

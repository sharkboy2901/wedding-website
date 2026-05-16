# Wedding Website

A secure, responsive wedding website with guest photo uploads and admin approval workflow.

## Setup

### 1. Install Node.js
Download from https://nodejs.org (version 18 or higher).

### 2. Install dependencies
```bash
cd "My Wedding Website"
npm install
```

### 3. Configure environment variables
```bash
copy .env.example .env
```
Then edit `.env` with your details:

| Variable | Description | Example |
|---|---|---|
| `PORT` | Server port | `3000` |
| `SESSION_SECRET` | Long random string for sessions | (generate one — see below) |
| `ADMIN_USERNAME` | Admin login username | `admin` |
| `ADMIN_PASSWORD` | Admin login password | (choose a strong password) |
| `WEDDING_DATE` | Date in YYYY-MM-DD format | `2025-09-20` |
| `COUPLE_NAMES` | Names shown on site | `Matthew & Jane` |
| `VENUE_NAME` | Venue name | `The Grand Hall` |
| `VENUE_LOCATION` | City, Country | `Valletta, Malta` |
| `CEREMONY_TIME` | Ceremony start time | `2:00 PM` |
| `RECEPTION_TIME` | Reception start time | `6:00 PM` |
| `DRESS_CODE` | Dress code text | `Black Tie Optional` |
| `RSVP_DEADLINE` | RSVP by date | `2025-08-01` |
| `MAX_UPLOAD_MB` | Max photo upload size in MB | `15` |

**Generate a SESSION_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Customise the content
Edit `views/story.ejs` to add your own story, milestones, and photos.

### 5. Start the server
```bash
node server.js
```

Then open http://localhost:3000 in your browser.

For development with auto-restart:
```bash
npm run dev
```

---

## Admin Panel

Visit `/admin/login` and sign in with your `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

**Features:**
- View all pending photo uploads
- Approve photos (moves them to the public gallery)
- Reject/delete photos
- View all RSVPs with stats

---

## Photo Upload Security

Guest photo uploads are protected by multiple layers:

1. **Client-side filtering** — only image MIME types accepted in the file picker
2. **Multer MIME filter** — rejects non-image types before buffering
3. **Magic byte validation** — inspects actual file bytes (not just extension/MIME claimed by client)
   - JPEG: `FF D8 FF`
   - PNG: `89 50 4E 47 0D 0A 1A 0A`
   - WebP: `52 49 46 46 ... 57 45 42 50`
4. **File size limit** — configurable via `MAX_UPLOAD_MB` (default 15 MB)
5. **UUID filenames** — all uploaded files are renamed to UUID-based names server-side
6. **Pending folder not public** — pending photos are never served statically; only accessible to admin via `/admin/photo/:id/image`
7. **Rate limiting** — upload endpoint limited to 20 uploads per hour per IP

---

## Deployment (Production)

### Basic Node.js host (e.g. VPS, cPanel with Node.js support)

1. Upload all files to your server
2. Run `npm install --production`
3. Create your `.env` file with production settings
4. Set `NODE_ENV=production` in `.env`
5. Start with `node server.js` or use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name wedding-site
   pm2 save
   ```

### Important: HTTPS in production
- Set `NODE_ENV=production` so session cookies are HTTPS-only
- Use a reverse proxy (nginx or Apache) in front of Node.js with an SSL certificate
- Let's Encrypt provides free SSL certificates

### Database backup
The SQLite database (`wedding.db`) and uploaded photos in `uploads/approved/` should be backed up regularly.

---

## File Structure

```
├── server.js           — Main Express server
├── package.json        — Dependencies
├── .env                — Your configuration (do not commit!)
├── .env.example        — Configuration template
├── db/
│   └── database.js     — SQLite setup and queries
├── middleware/
│   ├── auth.js         — Admin authentication middleware
│   └── upload.js       — File validation and upload handling
├── routes/
│   ├── publicRoutes.js — Public pages and upload endpoint
│   └── adminRoutes.js  — Admin panel routes
├── public/
│   ├── css/styles.css  — All styles (responsive)
│   └── js/main.js      — Client-side JS (countdown, mobile nav)
├── views/              — EJS templates
│   ├── partials/       — Shared header, nav, footer
│   ├── admin/          — Admin panel templates
│   └── ...             — Public page templates
├── uploads/
│   ├── pending/        — Uploaded photos awaiting approval (NOT public)
│   └── approved/       — Approved photos (publicly served)
└── wedding.db          — SQLite database (created automatically)
```

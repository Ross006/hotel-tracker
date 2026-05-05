# 🏨 Hotel Price Tracker — Vercel + Slack

Serverless price tracker for **The Caledonian Edinburgh** (Oct 24, 2026).  
Checks Google Hotels via SerpApi twice daily and sends a Slack message when a new lowest price is found.

**Stack:** Next.js API route · Vercel Blob (storage) · SerpApi · Slack webhook · cron-job.org  
**Cost:** $0/month (all free tiers)

---

## Deploy in 5 steps

### 1. Push to GitHub

```bash
cd hotel-tracker
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/hotel-tracker.git
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repo
3. Framework: **Next.js** (auto-detected)
4. Click **Deploy**

### 3. Add a Blob Store

1. In your Vercel project dashboard, go to **Storage**
2. Click **Create** → **Blob**
3. Follow the prompts — Vercel auto-adds `BLOB_READ_WRITE_TOKEN` to your env

### 4. Set Environment Variables

In your Vercel project → **Settings → Environment Variables**, add:

| Variable            | Value                                           |
|---------------------|--------------------------------------------------|
| `SERPAPI_API_KEY`   | Your key from serpapi.com                        |
| `SLACK_WEBHOOK_URL` | Your Slack incoming webhook URL                  |
| `CRON_SECRET`      | A random string (`openssl rand -hex 16`)          |

That's it — just 3 secrets. No Gmail passwords or 2FA setup.

### 5. Set up cron-job.org (twice daily)

Vercel's free tier only allows one cron per day. For the second daily check, use [cron-job.org](https://cron-job.org) (free):

1. Sign up at cron-job.org
2. Create a new cron job:
   - **URL:** `https://your-app.vercel.app/api/check-price`
   - **Schedule:** `0 8,20 * * *` (8 AM and 8 PM UTC)
   - **Headers:** Add `Authorization: Bearer YOUR_CRON_SECRET`
3. Save — done!

The `vercel.json` already includes one daily cron at 8 AM as a backup.

---

## How it works

```
cron-job.org (or Vercel cron)
        │
        ▼  GET /api/check-price
┌─────────────────┐
│  Vercel Function │
│                  │
│  1. Query SerpApi for hotel price
│  2. Load price history from Vercel Blob
│  3. Compare: is this a new lowest?
│  4. Save updated history to Blob
│  5. If new low → Slack notification
│                  │
└─────────────────┘
```

The Slack message includes current price, previous lowest, running average, and a direct booking link.

You can also hit the endpoint manually to check status — it returns JSON:

```json
{
  "success": true,
  "hotel": "The Caledonian Edinburgh, Curio Collection by Hilton",
  "currentPrice": 195,
  "averagePrice": 212.50,
  "lowestEver": 178,
  "isNewLowest": false,
  "totalChecks": 14,
  "slackSent": false
}
```

---

## Customisation

Edit the `CONFIG` object in `app/api/check-price/route.js`:

- **hotelQuery** — change the hotel
- **checkIn / checkOut** — change the dates
- **adults** — number of guests
- **currency** — GBP, USD, EUR, etc.

---

## Files

```
hotel-tracker/
├── app/
│   ├── api/
│   │   └── check-price/
│   │       └── route.js      ← main logic
│   ├── layout.js
│   └── page.js               ← simple status page
├── vercel.json                ← cron config
├── package.json
├── next.config.js
├── .env.example
└── README.md
```

# Roblox Funk Editors – list site

A ranked list site (like AREDL) with a main Top 30 plus a separate list for each style.
You edit it from a password-protected page at `/admin` on your own site.

```
index.html        the public site
data.js           starting data (also the fallback if nothing has been saved yet)
admin/index.html  the editor, lives at yoursite/admin
api/              small server functions: data, login, save
package.json      lets Vercel install the storage library
vercel.json       sends a "don't index" header for /admin
```

## Try it locally (just to look)
Open `index.html` in your browser. It reads `data.js`. Opening `admin/index.html` the same way
works too, but it can only save a draft and let you download a new `data.js` (no live saving).

## Put it online on Vercel (one-time setup)

1. **Upload the project.** Easiest is GitHub: make a new repo, upload everything in this folder
   (keep the `api` and `admin` folders), then on vercel.com choose **Add New → Project** and import it.
   Leave all settings on their defaults and deploy.
   (No GitHub? Install Node, run `npm i -g vercel`, then `vercel --prod` in this folder.)

2. **Make a storage place for your saves.** In your Vercel project open the **Storage** tab →
   **Create** → **Blob**. When it asks about access, choose **Public**, and connect it to this project.
   (Vercel adds the `BLOB_READ_WRITE_TOKEN` setting automatically.)

3. **Set your admin password.** Project → **Settings → Environment Variables** → add
   `ADMIN_PASSWORD` with a long password only you know (all environments).

4. **Redeploy** once (Deployments → the latest one → ⋯ → Redeploy) so it picks up the new settings.

5. **Use your domain.** Project → **Settings → Domains** → add `robloxeditors.seeshaun.xyz`.
   At your DNS provider add the CNAME record Vercel shows you (name `robloxeditors`).

## Editing the list
Go to `robloxeditors.seeshaun.xyz/admin`, log in, change things, click **Save to site**.
It goes live immediately, no redeploy needed. Only someone with the password can save.

## TikTok links and pictures
- In `/admin`, type each editor's **TikTok username** (no @). On the site, clicking that editor opens
  their TikTok page in a new tab.
- Click **Fetch from TikTok** on an editor (or **Fetch all missing pictures** on the Editors tab) to
  grab their profile picture. It is copied into your own storage, so it won't expire. Then click
  **Save to site**.
- TikTok has no official picture service, so this reads the public profile page and TikTok can block
  it at any time. If a fetch fails, paste any image link into **Profile picture URL** instead.
- Pictures are a snapshot from when you fetched them. Click Fetch again to refresh one.

## Notes
- Changing `ADMIN_PASSWORD` later needs a redeploy to take effect.
- The public site loads whatever was last saved from `/admin`. `data.js` is only used the very
  first time, or if the storage is unreachable.
- Want a backup? In `/admin` click **Download data.js** any time.

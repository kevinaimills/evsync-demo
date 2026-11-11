# Put this demo on GitHub Pages

This is a static site. GitHub hosts the files and runs no code on your computer. Every teammate gets their own demo state, including on a phone. Refreshing resets that state.

## 1. Unzip the download

Extract `evsync-v0.14-static.zip`. Open the extracted `evsync-static` folder.

You can keep using the app locally by opening `index.html`, or by running `python3 server.py` in that folder and visiting http://localhost:8000. The optional local server binds only to 127.0.0.1. You do not need to run it for GitHub Pages.

## 2. Create a repository

1. Sign in at https://github.com and choose **+ → New repository**.
2. Name it **evsync-demo** (or another name you prefer).
3. Choose **Public**. GitHub Pages is free for public repositories.
4. Turn **Add README** on, then choose **Create repository**. This creates the default `main` branch.

## 3. Upload the app

1. On the repository's **Code** tab, choose **Add file → Upload files**.
2. Upload the **contents** of the extracted `evsync-static` folder. Do not upload the ZIP or the enclosing folder itself. `index.html` must appear directly at the repository root.
3. Choose **Commit changes** to commit the upload to `main`.

The app needs these files at the root:

| File | Purpose |
| --- | --- |
| `index.html` | The page |
| `style.css` | Phone and desktop appearance |
| `domain.js` | Demo state and business rules |
| `app.js` | Screens and actions |
| `.nojekyll` | Tells GitHub to serve the static files directly |

Uploading all the source files is fine, including the README, tests, and optional local server. They are not required to run the hosted app. In Fedora's file picker or file manager, **Ctrl+H** shows hidden files so you can include `.nojekyll`. If you miss it, use **Add file → Create new file**, name it `.nojekyll`, leave it empty, and commit.

## 4. Turn on Pages

1. Open the repository's **Settings** tab.
2. Choose **Pages** in the sidebar.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select **main** and **/ (root)**.
5. Choose **Save**.

No npm install, build command, custom GitHub Actions workflow, or backend service is required.

## 5. Share the site

Wait for deployment, then return to **Settings → Pages** and choose **Visit site**. GitHub says publishing can take up to 10 minutes.

For a repository named `evsync-demo`, the address is normally:

`https://YOUR-USERNAME.github.io/evsync-demo/`

Use the actual URL GitHub provides. Send that site URL to your teammates. On a phone the app fills the screen; on a computer it retains the phone frame. No login is needed to view this public demo.

## Update it later

Upload the changed app files to the same locations and commit to `main`. Pages republishes automatically. Refresh the published page to load the new version; this also resets the local demo session. If it appears unchanged, try a hard refresh or a private tab.

If the site shows a 404, check that the Pages deployment completed, that `main` and `/ (root)` are selected, and that `index.html` is directly at the repository root. Deployment errors are shown in the repository's **Actions** tab.

## Official instructions

Checked November 6, 2026:

- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

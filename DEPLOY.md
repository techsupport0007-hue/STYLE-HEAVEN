# Deploying Style Heaven to GitHub Pages

Repo: https://github.com/techsupport0007-hue/STYLE-HEAVEN.git

## First-time setup (do this once)

Open a terminal inside this `style-heaven` folder and run:

```
git init
git add .
git commit -m "first version"
git branch -M main
git remote add origin https://github.com/techsupport0007-hue/STYLE-HEAVEN.git
git push -u origin main
```

If `git push` asks for a password, GitHub no longer accepts your account
password there — use a Personal Access Token instead (GitHub →
Settings → Developer settings → Personal access tokens → generate one,
then paste it in place of the password), or push via GitHub Desktop,
which handles login for you with no token needed.

## Turn on GitHub Pages (do this once)

1. Go to `https://github.com/techsupport0007-hue/STYLE-HEAVEN/settings/pages`
2. Under **Build and deployment → Source**, choose **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)` → **Save**
4. Wait ~1–2 minutes, then your site is live at:

   **https://techsupport0007-hue.github.io/STYLE-HEAVEN/**

## Every time you want to update the live site

No more downloading zips. Just:

1. Replace the changed file(s) in this folder with the new versions I give you
2. In the terminal, from this folder, run:
   ```
   git add .
   git commit -m "update"
   git push
   ```
3. Refresh the live URL after a minute — your changes are there.

That's the whole loop going forward.

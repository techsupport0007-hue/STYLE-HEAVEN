# Git setup + push commands

## 1. One-time global configuration (run these first, anywhere)

```
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

Use the same email as your GitHub account (techsupport0007-hue) if you
want your commits linked to your profile there.

Check it worked:
```
git config --global user.name
git config --global user.email
```

## 2. Now push your project (run these INSIDE the style-heaven folder)

```
git init
git add .
git commit -m "first version"
git branch -M main
git remote add origin https://github.com/techsupport0007-hue/STYLE-HEAVEN.git
git push -u origin main
```

## 3. If push asks for login

GitHub will pop up a browser window to sign in (if you have "Git
Credential Manager" installed, which the Windows Git installer includes
by default) — just log in there once and it'll remember you.

If it asks for a password directly in the terminal instead, your account
password won't work — you need a Personal Access Token:
GitHub → click your profile photo → Settings → Developer settings →
Personal access tokens → Tokens (classic) → Generate new token → tick
the "repo" scope → Generate → copy it → paste it in place of the
password when asked.

## 4. Every future update

```
git add .
git commit -m "update"
git push
```

@echo off
cd /d %~dp0

echo [1] Killing any running git processes...
taskkill /f /im git.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2] Removing index.lock...
del /f .git\index.lock >nul 2>&1

echo [3] Resetting index (unstage everything)...
git reset HEAD -- . 2>&1

echo [4] Removing node_modules and data from tracking if staged...
git rm -r --cached --quiet node_modules 2>&1
git rm -r --cached --quiet data 2>&1
git rm -r --cached --quiet uploads 2>&1

echo [5] Adding all non-ignored files...
git add .gitignore
git add package.json
git add package-lock.json
git add server.js
git add db\database.js
git add routes\publicRoutes.js
git add routes\adminRoutes.js
git add middleware\auth.js
git add middleware\csrf.js
git add middleware\upload.js
git add views\livestream.ejs
git add views\upload.ejs
git add views\partials\nav.ejs
git add views\index.ejs
git add views\gallery.ejs
git add views\rsvp.ejs
git add views\story.ejs
git add views\error.ejs
git add views\partials\head.ejs
git add views\partials\footer.ejs
git add views\admin\dashboard.ejs
git add views\admin\login.ejs
git add views\admin\rsvps.ejs
git add railway.json 2>nul
git add README.md 2>nul
git add public\ 2>nul

echo [6] Git status...
git status --short

echo [7] Committing...
git commit -m "Add photo limits, Twitch livestream, fix admin auth"

echo [8] Pushing...
git push origin main

echo [DONE]
pause

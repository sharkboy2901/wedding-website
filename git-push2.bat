@echo off
cd /d "C:\Users\matth\Documents\Claude\Projects\wedding-website-git"

echo Killing any stale git processes...
taskkill /f /im git.exe 2>nul
timeout /t 2 /nobreak >nul

echo Removing lock file if present...
del /f ".git\index.lock" 2>nul

echo Configuring git identity...
git config user.email "matthewbenhamed@gmail.com"
git config user.name "Matthew"

echo Resetting index...
git reset HEAD 2>nul

echo Adding .gitignore first...
git add .gitignore

echo Staging changed files (excluding node_modules)...
git add package.json package-lock.json server.js
git add db\database.js
git add routes\publicRoutes.js routes\adminRoutes.js
git add middleware\auth.js middleware\csrf.js middleware\upload.js
git add views\livestream.ejs views\upload.ejs views\partials\nav.ejs
git add views\partials\head.ejs views\partials\footer.ejs
git add views\index.ejs views\gallery.ejs views\rsvp.ejs views\story.ejs views\error.ejs
git add views\admin\dashboard.ejs views\admin\login.ejs views\admin\rsvps.ejs
git add railway.json README.md

echo Status:
git status --short

echo Committing...
git commit -m "Add photo limits, Twitch livestream, fix admin auth"

echo Pushing...
git push origin main

echo Done.
pause

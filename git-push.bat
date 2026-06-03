@echo off
cd /d "C:\Users\matth\Documents\Claude\Projects\wedding-website-git"
del /f ".git\index.lock" 2>nul
git config user.email "matthewbenhamed@gmail.com"
git config user.name "Matthew"
git rm -r --cached node_modules/ data/ 2>nul
git add .gitignore package.json package-lock.json server.js
git add db\database.js
git add routes\publicRoutes.js routes\adminRoutes.js
git add middleware\auth.js middleware\csrf.js middleware\upload.js
git add views\livestream.ejs views\upload.ejs
git add views\partials\nav.ejs
git status --short
git commit -m "Add photo limits, Twitch livestream, fix admin auth"
git push origin main
pause

@echo off
cd /d "C:\Users\matth\Documents\Claude\Projects\wedding-website-git"
set LOG=git-push4.log
echo === %DATE% %TIME% === > %LOG%

echo Killing stale git... >> %LOG%
taskkill /f /im git.exe >> %LOG% 2>&1
ping -n 3 127.0.0.1 > nul

echo Removing lock... >> %LOG%
del /f ".git\index.lock" >> %LOG% 2>&1

echo Configuring identity... >> %LOG%
git config user.email "matthewbenhamed@gmail.com" >> %LOG% 2>&1
git config user.name "Matthew" >> %LOG% 2>&1

echo Adding files... >> %LOG%
git add .gitignore >> %LOG% 2>&1
git add package.json package-lock.json server.js railway.json README.md >> %LOG% 2>&1
git add db\database.js >> %LOG% 2>&1
git add routes\publicRoutes.js routes\adminRoutes.js >> %LOG% 2>&1
git add middleware\auth.js middleware\csrf.js middleware\upload.js >> %LOG% 2>&1
git add views\livestream.ejs views\upload.ejs views\partials\nav.ejs >> %LOG% 2>&1
git add views\partials\head.ejs views\partials\footer.ejs >> %LOG% 2>&1
git add views\index.ejs views\gallery.ejs views\rsvp.ejs views\story.ejs views\error.ejs >> %LOG% 2>&1
git add "views\admin\dashboard.ejs" "views\admin\login.ejs" "views\admin\rsvps.ejs" >> %LOG% 2>&1

echo Status: >> %LOG%
git status --short >> %LOG% 2>&1

echo Committing... >> %LOG%
git commit -m "Add photo limits, Twitch livestream, fix admin auth" >> %LOG% 2>&1

echo Pushing... >> %LOG%
git push origin main >> %LOG% 2>&1

echo === DONE === >> %LOG%

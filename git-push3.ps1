$ErrorActionPreference = 'Continue'
$repo = "C:\Users\matth\Documents\Claude\Projects\wedding-website-git"
$log  = "$repo\git-push3.log"

"=== $(Get-Date) ===" | Out-File $log

# Kill stale git processes
Get-Process git -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# Remove lock file
$lock = "$repo\.git\index.lock"
if (Test-Path $lock) { Remove-Item $lock -Force; "Removed lock" | Add-Content $log }

Set-Location $repo

# Configure identity
git config user.email "matthewbenhamed@gmail.com"
git config user.name "Matthew"

# Reset index cleanly
git reset HEAD 2>&1 | Add-Content $log

# Stage only project files (not node_modules/data/uploads)
$files = @(
  ".gitignore","package.json","package-lock.json","server.js","railway.json","README.md",
  "db\database.js",
  "routes\publicRoutes.js","routes\adminRoutes.js",
  "middleware\auth.js","middleware\csrf.js","middleware\upload.js",
  "views\livestream.ejs","views\upload.ejs","views\partials\nav.ejs",
  "views\partials\head.ejs","views\partials\footer.ejs",
  "views\index.ejs","views\gallery.ejs","views\rsvp.ejs","views\story.ejs","views\error.ejs",
  "views\admin\dashboard.ejs","views\admin\login.ejs","views\admin\rsvps.ejs"
)
foreach ($f in $files) {
  git add $f 2>&1 | Add-Content $log
}

"=== Status ===" | Add-Content $log
git status --short 2>&1 | Add-Content $log

"=== Commit ===" | Add-Content $log
git commit -m "Add photo limits, Twitch livestream, fix admin auth" 2>&1 | Add-Content $log

"=== Push ===" | Add-Content $log
git push origin main 2>&1 | Add-Content $log

"=== Done ===" | Add-Content $log

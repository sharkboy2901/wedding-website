@echo off
setlocal enabledelayedexpansion

:: Source: skills-to-install folder sitting next to this .bat file
set "SKILLS_SRC=%~dp0skills-to-install"
set "SKILLS_DST=%USERPROFILE%\.claude\skills"

echo ============================================================
echo  Claude Code Skill Installer
echo  Source : %SKILLS_SRC%
echo  Target : %SKILLS_DST%
echo ============================================================
echo.

if not exist "%SKILLS_SRC%" (
    echo ERROR: Staged skills not found at:
    echo   %SKILLS_SRC%
    echo Has the session expired? Re-run the installation in Claude.
    pause
    exit /b 1
)

:: Ensure target directory exists
if not exist "%SKILLS_DST%" (
    echo Creating %SKILLS_DST% ...
    mkdir "%SKILLS_DST%"
)

:: Install each skill
for %%S in (frontend-design web-design-guidelines react-best-practices) do (
    echo Installing %%S ...
    xcopy /E /I /Y "%SKILLS_SRC%\%%S" "%SKILLS_DST%\%%S\" >nul
    if errorlevel 1 (
        echo   [ERROR] %%S failed
    ) else (
        echo   [OK]
    )
)

echo.
echo ============================================================
echo  Verification
echo ============================================================
for %%S in (frontend-design web-design-guidelines react-best-practices) do (
    if exist "%SKILLS_DST%\%%S\SKILL.md" (
        echo   [PASS] %%S  -- SKILL.md present
    ) else (
        echo   [FAIL] %%S  -- SKILL.md MISSING
    )
)

echo.
echo Done. Press any key to close.
pause

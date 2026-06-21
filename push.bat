@echo off
title Conquered Time - Git Push
color 0A
cd /d "D:\My Projects\CURRENT-RELEASE\conquered-time"

echo.
echo  ================================================
echo   Conquered Time - Save and Push to GitHub
echo  ================================================
echo.

:: Check if git is initialized
if not exist ".git" (
    echo  [FIRST TIME SETUP] Git not initialized yet.
    echo.
    set /p REPO_URL= Enter your GitHub repo URL:
    echo.
    git init
    git branch -M main
    git remote add origin %REPO_URL%
    echo.
    echo  Git initialized and remote set.
    echo.
)

:: Check for anything to commit
git status --porcelain > "%TEMP%\ct_gitstatus.txt" 2>&1
for %%A in ("%TEMP%\ct_gitstatus.txt") do set SIZE=%%~zA
if %SIZE%==0 (
    echo  Nothing to commit - everything is up to date.
    echo.
    pause
    exit /b 0
)

:: Ask for commit message
echo  What did you work on today?
echo  (Press Enter for a default timestamp message)
echo.
set /p MSG= Commit message:

if "%MSG%"=="" (
    for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DT=%%I
    set MSG=Session update - %DT:~0,4%-%DT:~4,2%-%DT:~6,2% %DT:~8,2%:%DT:~10,2%
)

echo.
echo  Staging all changes...
git add .

echo  Committing...
git commit -m "%MSG%"

echo.
echo  Pushing to GitHub...
git push -u origin main

if %errorlevel%==0 (
    echo.
    echo  ================================================
    echo   Done! Changes are live on GitHub.
    echo  ================================================
) else (
    echo.
    echo  ================================================
    echo   Push failed. Check your internet connection
    echo   or GitHub credentials and try again.
    echo  ================================================
)

echo.
pause

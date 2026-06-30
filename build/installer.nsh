# Custom NSIS tweaks for the Conquered Time installer.
# Auto-included by electron-builder (default nsis.include = build/installer.nsh).

# Welcome/finish page wording (guarded so a future electron-builder default
# can't cause a redefinition error).
!macro customHeader
  !ifndef MUI_WELCOMEPAGE_TITLE
    !define MUI_WELCOMEPAGE_TITLE "Welcome to Conquered Time"
  !endif
  !ifndef MUI_WELCOMEPAGE_TEXT
    !define MUI_WELCOMEPAGE_TEXT "Conquered Time is a secure, locally-encrypted desktop time tracker.$\r$\n$\r$\nYour data is encrypted at rest and never leaves this device.$\r$\n$\r$\nClick Next to continue, or Cancel to exit Setup."
  !endif
  !ifndef MUI_FINISHPAGE_TITLE
    !define MUI_FINISHPAGE_TITLE "Conquered Time is installed"
  !endif
  !ifndef MUI_FINISHPAGE_TEXT
    !define MUI_FINISHPAGE_TEXT "Conquered Time has been installed on your computer.$\r$\n$\r$\nThank you for trying the beta!"
  !endif
!macroend

# Add a branded Welcome page (electron-builder's assisted installer has none by
# default). The welcome/finish sidebar bitmap is applied here automatically.
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

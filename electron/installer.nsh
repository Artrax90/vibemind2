!macro customUnInstall
  MessageBox MB_YESNO "Do you want to delete all local data (notes and settings)?" IDYES +2
  Goto +2
  RMDir /r "$APPDATA\vibeMind"
!macroend

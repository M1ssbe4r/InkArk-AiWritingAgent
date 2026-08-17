; build/installer.nsh
; InkArk portable data preservation hook — 覆盖模式 (v2)
;
; 历史:
;   v1 (2026-05 之前): 先删后装 — 旧卸载器把 $INSTDIR 整个搬到 $PLUGINSDIR\old-install
;   后再 RMDir 删除,然后新版装到空目录。问题:如果 $INSTDIR\resources\app.asar
;   被任意进程(Helper/Defender/OneDrive)持锁,un.atomicRMDir 的 Rename 必失败,
;   弹出 "InkArk无法关闭" 或 "Failed to uninstall: 2"。
;
;   v2 (2026-06 起): 覆盖模式 — 旧卸载器**只备份** data/ 和 fonts/ 到
;   $INSTDIR\inkark-portable-backup/,**不搬 $INSTDIR**。新版 NSIS 默认逐文件
;   File 覆盖写 (走 CreateFile+WriteFile,不是 Rename),能绕过 90% 的
;   app.asar 锁。原 data/ fonts/ 一直在 $INSTDIR\ 下没被删,新版启动直接读,
;   所以 backup 失败也不会丢数据 — backup 只在大版本目录结构变化时启用。
;
; 关键点:`${isUpdated}` 在 NSIS 模板里**未定义**(展开为空字符串,${if} 永远为 true),
; 所以 customRemoveFiles 不能用它来区分"装更新"和"主动卸载"。
; 改用 customUnInit 解析 `--updated` 命令行参数,设置
; $INKARK_PORTABLE_IS_UPDATED 变量(1 = 装更新, 0 = 主动卸载)。

!macro customUnInit
  ; un.onInit 阶段跑,这时 $CMDLINE 还没被解析,自己解析命令行
  ; NSIS installer 调老卸载器走装更新时会传 "--updated" (看 installUtil.nsh:206)
  ; 用户主动双击 Uninstall InkArk.exe 时不带此参数
  Var /GLOBAL INKARK_PORTABLE_IS_UPDATED
  StrCpy $INKARK_PORTABLE_IS_UPDATED "0"
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${ifNot} ${Errors}
    StrCpy $INKARK_PORTABLE_IS_UPDATED "1"
  ${endif}
  ClearErrors
!macroend

!macro customRemoveFiles
  ; 用 $INKARK_PORTABLE_IS_UPDATED 区分两种场景:
  ;   = "1" → NSIS installer 调老卸载器走"装更新"路径
  ;   = "0" → 用户主动双击 Uninstall InkArk.exe 走"卸载"路径
  ;
  ; 装更新路径:只备份,不动 $INSTDIR(新版直接覆盖写)
  ; 主动卸载路径:备份 + 删 $INSTDIR(用户期望真的卸载)
  ; CopyFiles 失败时静默跳过 (ClearErrors 不会跳 Abort)
  ClearErrors

  ${If} $INKARK_PORTABLE_IS_UPDATED == "1"
    ; === 装更新路径:只备份,不删 $INSTDIR ===
    ${If} ${FileExists} "$INSTDIR\data"
      CreateDirectory "$INSTDIR\inkark-portable-backup\data"
      CopyFiles /SILENT "$INSTDIR\data\*.*" "$INSTDIR\inkark-portable-backup\data"
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\fonts"
      CreateDirectory "$INSTDIR\inkark-portable-backup\fonts"
      CopyFiles /SILENT "$INSTDIR\fonts\*.*" "$INSTDIR\inkark-portable-backup\fonts"
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\logs"
      CreateDirectory "$INSTDIR\inkark-portable-backup\logs"
      CopyFiles /SILENT "$INSTDIR\logs\*.*" "$INSTDIR\inkark-portable-backup\logs"
    ${EndIf}
  ${else}
    ; === 主动卸载路径:备份后删 $INSTDIR ===
    ; 主动卸载时 backup 放父目录(沿用 v1 行为,跟安装时 backup 路径一致)
    ${If} ${FileExists} "$INSTDIR\data"
      CreateDirectory "$INSTDIR\..\inkark-portable-backup\data"
      CopyFiles /SILENT "$INSTDIR\data\*.*" "$INSTDIR\..\inkark-portable-backup\data"
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\fonts"
      CreateDirectory "$INSTDIR\..\inkark-portable-backup\fonts"
      CopyFiles /SILENT "$INSTDIR\fonts\*.*" "$INSTDIR\..\inkark-portable-backup\fonts"
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\logs"
      CreateDirectory "$INSTDIR\..\inkark-portable-backup\logs"
      CopyFiles /SILENT "$INSTDIR\logs\*.*" "$INSTDIR\..\inkark-portable-backup\logs"
    ${EndIf}

    ; 显式 RMDir $INSTDIR——因为 !ifmacrodef customRemoveFiles 覆盖了
    ; NSIS 默认的 RMDir /r $INSTDIR。
    ; 注意: Uninstall InkArk.exe 自己在 $INSTDIR 里,RMDir 会留下这个孤儿
    ; 文件。这是 NSIS 限制:运行中的程序不能删自己,卸载完用户可手动删。
    RMDir /r $INSTDIR
  ${endif}
!macroend

!macro customInstall
  ; 兼容两种 backup 位置(按优先级检查):
  ;   1) 父目录: $INSTDIR\..\inkark-portable-backup\   ← 0.9.1 老 uninstaller 写这里
  ;   2) $INSTDIR 内部: $INSTDIR\inkark-portable-backup\ ← 0.9.2+ 新 uninstaller 写这里
  ; 哪个在就恢复哪个,优先父目录(因为老用户从 0.9.1 升上来,backup 在父目录)

  ; 优先:从父目录的 backup 恢复(老位置)
  ${If} ${FileExists} "$INSTDIR\..\inkark-portable-backup\data"
    CreateDirectory "$INSTDIR\data"
    CopyFiles /SILENT "$INSTDIR\..\inkark-portable-backup\data\*.*" "$INSTDIR\data"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\..\inkark-portable-backup\fonts"
    CreateDirectory "$INSTDIR\fonts"
    CopyFiles /SILENT "$INSTDIR\..\inkark-portable-backup\fonts\*.*" "$INSTDIR\fonts"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\..\inkark-portable-backup\logs"
    CreateDirectory "$INSTDIR\logs"
    CopyFiles /SILENT "$INSTDIR\..\inkark-portable-backup\logs\*.*" "$INSTDIR\logs"
  ${EndIf}
  RMDir /r "$INSTDIR\..\inkark-portable-backup"

  ; 兜底:从 $INSTDIR 内部的 backup 恢复(新位置)
  ${If} ${FileExists} "$INSTDIR\inkark-portable-backup\data"
    CreateDirectory "$INSTDIR\data"
    CopyFiles /SILENT "$INSTDIR\inkark-portable-backup\data\*.*" "$INSTDIR\data"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\inkark-portable-backup\fonts"
    CreateDirectory "$INSTDIR\fonts"
    CopyFiles /SILENT "$INSTDIR\inkark-portable-backup\fonts\*.*" "$INSTDIR\fonts"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\inkark-portable-backup\logs"
    CreateDirectory "$INSTDIR\logs"
    CopyFiles /SILENT "$INSTDIR\inkark-portable-backup\logs\*.*" "$INSTDIR\logs"
  ${EndIf}
  RMDir /r "$INSTDIR\inkark-portable-backup"
!macroend


## GitHub 推送（本项目长期有效）
- 远端 `git@github.com:gaawal/ChaoFans.git`，SSH 经 `~/.ssh/config` 走
  ssh.github.com:443 + 本机代理 7897（直连被重置）。
- 大文件（.blend/.glb/HDR 共 ~180MB）直推必断流：先给大 blob 挂临时
  annotated tag 逐个推，再推 main，最后删 tag（详见 2026-09-28 日志）。
- git 网络操作不要放后台任务跑（秒败），一律前台。

---
title: macOS 恢复与 Boot Camp
description: 按 Mac 芯片类型进入恢复环境，了解 Intel Mac 使用 Boot Camp 安装 Windows 的条件。
doc_id: 01m1zwvt7mc7ayac91wsymaaaj
manual_pages: [165, 166]
owners:
  - maintenance-team
tags:
  - macOS
  - Boot Camp
  - 历史资料
---

# macOS 恢复与 Boot Camp

## Mac OS X 的重装

Intel Mac 开机时按 Command + R 进入恢复环境。搭载 Apple 芯片的 Mac 在关机后按住电源键，选择“选项”进入恢复环境。[Apple 恢复说明](https://support.apple.com/zh-cn/guide/mac-help/mchlp1599/mac)

旧版 Intel Mac 的恢复界面有 4 个选项：Restore From Time Machine Backup 是从你过去备份至 Time Machine 的映像档恢复电脑、Reinstall Mac OS X 顾名思义就是重新安装 Mac OS X Lion、Get Help Online 则是从线上撷取帮助文档，了解重装步骤及常见问题、而最后的 Disk Utility 则是管理硬盘，包括：分割磁区、将磁碟区格式化等。

- 需要抹盘时，可以在备份数据后用“磁盘工具”抹除指定宗卷，然后从恢复环境或启动介质安装系统。
- 只需要重装时，选择“重新安装 macOS”，保持联网并按提示操作。

![Mac OS X 的重装示意](../images/manual/pdf-p166-i00.jpg)

## Mac 双系统的安装

支持 Boot Camp 的 Intel Mac 可以通过启动转换助理安装 Windows。

**1.** 把要安装的 Windows 镜像挂载在桌面上。

**2.** 打开“启动转换助理”，点按继续。根据机型和系统显示的选项操作。

**3.** 根据机型、Windows 版本及应用需求分配磁盘空间。分区后选择开始安装，电脑会重启进入 Windows 的安装界面。

**4.** 安装 Windows 后运行启动转换安装程序，安装键盘、触控板等所需驱动。Windows 使用有效许可激活。

![Mac 双系统的安装示意](../images/manual/pdf-p166-i01.jpg)

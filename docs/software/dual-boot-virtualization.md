---
title: 双系统安装与启动
description: 了解双系统的安装条件、启动选择与现有系统的保护方式。
doc_id: 01m1zwvt7k8nz0kn2qfm5qxhw0
manual_pages: [160]
owners:
  - maintenance-team
tags:
  - 双系统
  - Windows
---

# 双系统安装与启动

顾名思义，双系统就是在计算机上安装两个操作系统，主要用于解决软件兼容性问题。

安装了双系统后，在启动的时候，有一个多重启动的选择菜单，可以选择进入哪个操作系统。当前状态下，只有一个系统是在运行的，不能随意的切换。如果想要进入另外一个，就要重新启动，重新选择。

安装的第一步，我们得运用[分区方法](../handbook/file-systems-partitions.md)，准备一块空盘或预留未分配空间，用于安装第二个系统。随后从目标系统官网下载匹配架构的 ISO 镜像。安装前备份文件，并记下现有系统的磁盘分区和启动方式。

完全安装成功后，重新启动电脑就会出现启动选择界面，自己选择需要的系统就行了。

想在同一个桌面体验其他系统，可先阅读[创建和使用虚拟机](../development/virtual-machines.md)。Intel Mac 用户可参见 [macOS 恢复与 Boot Camp](mac-recovery-bootcamp.md)。

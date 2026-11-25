---
title: 安装 Windows 与迁移系统
description: 区分就地重装和全新安装，按 UEFI、分区与启动条件完成 Windows 安装或换盘迁移。
doc_id: 01m1zwvt7kd4z7tjqsbfe8nqaz
manual_pages: [143, 159]
owners:
  - maintenance-team
tags:
  - Windows
  - 系统安装
  - UEFI
  - SSD
---

# 安装 Windows 与迁移系统

## 使用 Windows 安装介质

系统的安装包常称为镜像。`.iso` 是光盘映像格式，其中可能含有 `.wim` 或 `.esd` 形式的 Windows 安装映像。原手册还介绍了旧式 Ghost 工具使用的 `.gho`。

> **编注**　[重装前先备份资料](windows-installation-basics.md)，保存设备加密恢复密钥，并确认拟安装的磁盘。手册截图以旧版 Windows 10 为例，实际操作以当前微软安装介质为准。

![原手册插图（PDF 第 144 页）](../images/manual/pdf-p144-i00.png)

根据镜像不同，原手册介绍了原版安装、映像部署和旧版 Ghost 还原。原版安装可在系统里打开 `setup.exe`，也可用安装 U 盘启动。在系统内运行安装程序时，先检查“更改要保留的内容”能否保留文件与应用。

![原手册插图（PDF 第 144 页）](../images/manual/pdf-p144-i01.png)

![原手册插图（PDF 第 145 页）](../images/manual/pdf-p145-i00.png)

再开机要选择从启动盘启动（有的可以直接开机按 F12 选择，有的需要在 bios 里更改第一启动硬件再重启）。

启动之后会出现这样的画面（以 win10 为例，win7、8 相似），

![原手册插图（PDF 第 145 页）](../images/manual/pdf-p145-i01.png)

之后进入安装页面，开始选择语言和输入法等

![原手册插图（PDF 第 146 页）](../images/manual/pdf-p146-i00.png)

点击现在安装

选择要安装的操作系统版本，核对所选版本与已有许可证一致。

![原手册插图（PDF 第 147 页）](../images/manual/pdf-p147-i00.png)

确认所需资料已备份，并明确需要全新安装时，选择“自定义安装”。

![原手册插图（PDF 第 147 页）](../images/manual/pdf-p147-i01.png)

如果目标硬盘是空白盘，可选中未分配空间后继续，安装程序会建立所需分区。如果硬盘已有资料，先按容量与型号核对目标盘和目标分区。

![原手册插图（PDF 第 148 页）](../images/manual/pdf-p148-i00.png)

分区完成

开始安装系统

![原手册插图（PDF 第 149 页）](../images/manual/pdf-p149-i00.png)

经过几次重启

![原手册插图（PDF 第 149 页）](../images/manual/pdf-p149-i01.png)

开始设置基本信息：选择地区、输入法、账户设置等等，一直下一步就好。

![原手册插图（PDF 第 150 页）](../images/manual/pdf-p150-i00.png)

“嗨，别来无恙啊！”稍等一会，就可以进入系统了

![原手册插图（PDF 第 150 页）](../images/manual/pdf-p150-i01.png)

安装成功！

![原手册插图（PDF 第 151 页）](../images/manual/pdf-p151-i00.jpg)

PS：

**1.** 在安装成功后一般只有个回收站图标，要在个性化中把我的电脑调出

**2.** 安装完成后检查驱动。可从 Windows Update 或设备厂商获取所需驱动，例如网卡、存储和芯片组驱动。

**3.** 通过有效产品密钥或数字许可证激活。

**4.** 装上机主要求的软件

**5.** 从 Windows Update 安装系统所需的更新。

## 原手册中的 WinPE 与映像部署

> **编注**　以下是 WinNTSetup 的历史示例。只在明确映像来源、引导分区和系统目标盘后操作。常规重装通常用官方安装介质。

下面介绍 win 安装器安装，（仍然以 win10 为例）首先需要制作一个 pe 盘，（与制作启动盘步骤相同，只是将 windows 镜像换成 pe 镜像。其次向上面所说的进入启动盘一样的方法进入 PE。

一般情况下我们遇到的电脑都选择 windows8pe，进入之后大概是这个页面

![原手册插图（PDF 第 152 页）](../images/manual/pdf-p152-i00.jpg)

在不用对分区做调整的情况下，我们直接选择打开 WinNT setup（图中为从上往下数第 4 个）得到如下界面：

![原手册插图（PDF 第 153 页）](../images/manual/pdf-p153-i00.png)

选择右边 win Vista/7/8/10

在解压后的镜像文件或者用虚拟光驱加载好的文件里选择 sources 文件夹中的 Install.wim，在右边三个全为勾（或者为绿或黄）的情况下，选择好引导驱动器和安装磁盘的位置，点击开始安装，完成后选择从系统安装到的硬盘重启（若之前修改过硬盘启动顺序的记得修改回来），后面步骤与原版安装相似。

![原手册插图（PDF 第 154 页）](../images/manual/pdf-p154-i00.png)

PS：

**1.** Win XP、2000 系统在安装时可以使用 WinNT setup 安装器，也可以用手动 ghost 的方法，在这里就不介绍手动 ghost 了，希望大家自己了解。

**2.** 除了我们飞扬自己做的 PE、it 天空、微 PE、U 深度的之外，其他的老毛桃之类的 pe 一般嵌有广告，不建议使用。

**3.** wim 安装器不止 WinNT setup 这一种，还有许多其他的，大家可以自行了解。

## 启动方式与分区形式

截图中的状态灯随所用启动方式而变。现代电脑通常用 UEFI 与 GPT。旧机型也可能用传统 BIOS 兼容模式与 MBR。

下面两图左为 MBR，右为 GPT（图中标作 GUID）。

![原手册插图（PDF 第 154 页）](../images/manual/pdf-p154-i01.png)

![原手册插图（PDF 第 154 页）](../images/manual/pdf-p154-i02.png)

安装时，固件启动模式和硬盘分区形式应当对应。传统 BIOS 兼容模式配合 MBR，UEFI 模式配合 GPT（旧工具有时显示为 GUID）。

> **编注**　手册对 Windows 7、8、10 所用固件模式的区分是旧机型的经验。能否按该模式安装取决于固件、安装介质和对应 Windows 版本，不能仅按系统版本判断。

其次我们在第三章有讲到过 MBR 引导启动的硬盘分区表类型为 MBR 类型，而 UEFI 引导启动的硬盘分区表类型为 GUID 分区表，所以如果我们要使用 MBR/UEFI 引导启动，需要保证硬盘分区表类型为 MBR/GUID 类型，具体的设置方式可以用多个软件完成，下面以 DG 为例：

![原手册插图（PDF 第 155 页）](../images/manual/pdf-p155-i00.jpg)

> **编注**　图中演示分区表转换。转换前先备份，确认工具和当前分区是否支持保留数据。格式化或删除分区会清除资料。

使用传统 BIOS 与 MBR 时，活动分区用于存放引导文件。使用 UEFI 与 GPT 时，EFI 系统分区（ESP）存放引导文件。Windows 安装程序会为目标硬盘创建所需分区。

![原手册插图（PDF 第 156 页）](../images/manual/pdf-p156-i00.png)

如图选择 EFI System Partition 即为 ESP 分区，Microsoft reserved partition 即为 MSR 分区。

使用 MBR 启动时，引导驱动器为对应的活动分区。使用 UEFI 启动时，引导驱动器为 ESP，Windows 的安装目标则是相应系统分区。少数旧电脑只支持传统模式，有些固件也把兼容模式显示为 CSM。

## 迁移系统到 SSD

> **编注**　开始前分别备份源盘和目标盘上的重要资料，并确认迁移工具的覆盖范围。验证新盘可独立启动前，保留旧系统和旧盘。

现在越来越多的人会选择给自己的电脑加上固态硬盘，这就涉及到了系统和资料搬迁的问题，下面介绍一个简单的系统搬迁工具——傲梅分区助手。具体做法如下：

![原手册插图（PDF 第 157 页）](../images/manual/pdf-p157-i00.jpg)

打开分区助手，选择“迁移系统到 SSD/HDD”，接下来选择目标盘。

![原手册插图（PDF 第 157 页）](../images/manual/pdf-p157-i01.jpg)

![原手册插图（PDF 第 158 页）](../images/manual/pdf-p158-i00.jpg)

最后点击提交，电脑会自动重启，等待进度条读完后就成功了。

![原手册插图（PDF 第 158 页）](../images/manual/pdf-p158-i01.jpg)

PS：

**1.** 选定用于迁移的空间，并核对工具提示的分区覆盖范围。目标盘已有资料时先完成备份。

**2.** 少部分电脑在点击提交重启后不能自动进入读条界面，这个时候要选择启动硬盘为系统将要迁移到的那个硬盘重启。

**3.** 迁移完成后从启动菜单选择新盘，核对能否独立启动。确认新盘上的系统和资料都正常后，再处理旧盘。

常规重装参见微软的[使用安装介质重新安装 Windows](https://support.microsoft.com/zh-cn/windows/deployment/install-upgrade/reinstall-windows-with-the-installation-media)。分区方式参见 [Windows 安装与 MBR/GPT](https://learn.microsoft.com/zh-cn/windows-hardware/manufacture/desktop/windows-setup-installing-using-the-mbr-or-gpt-partition-style)。

本篇依据四川大学飞扬俱乐部《维修手册》印刷第 142–158 页（PDF 第 143–159 页）整理。

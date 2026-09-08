---
title: Mac 恢复与 Boot Camp 历史流程
doc_id: 01m1zwvt7mc7ayac91wsymaaaj
manual_pages:
  - 165
  - 166
owners:
  - maintenance-team
tags:
  - macOS
  - Boot Camp
  - 历史资料
updated: 2026-09-08T00:00:00.000Z
---
# Mac 恢复与 Boot Camp 历史流程

<!-- PDF 第 165 页；印刷第 164 页 -->

### 第三节：MAC OS X 系统

#### 一、 Mac OS X 的重装

什么时候需要重装 mac os x 系统呢？一般情况下都是把分区表玩坏了。具体重装步骤如下。

1. 首先在 MacBook Air 关上的情况下，按着 Command 及 R 两个按键不放手， 然后同时按下最右上角的开关键一下(记着此时仍然继续按着 Command + R 键)。

2. 当进入至此界面后，就可以放开所有按键。其中有 4 个选项：Restore FromTime Machine Backup 是从你过去备份至 Time Machine 的映像档恢复电脑、Reinstall Mac OS X 顾名思义就是重新安装 Mac OS X Lion、Get Help Online则是从线上撷取帮助文档，了解重装步骤及常见问题、而最后的 Disk Utility 则是管理硬盘，包括：分割磁区、将磁碟区格式化等。

- 这里选择最后一个 Disk Utility，在备份好数据的情况下抹除分区，然后退出。重启，插入制作好的启动盘，直接进行安装即可；

<!-- PDF 第 166 页；印刷第 165 页 -->

- 或者可以直接选 Reinstall Mac OS X（就是那头狮子），此时记得连接网络（屏幕右上角可以设置网络，连接网络的目的是从网上下载所需的 mac 镜像），接下来一路 continue、agree 就完事儿了。

#### 二、 Mac 双系统的安装

Mac 系统自带的 Bootcamp 助理其实是个很强大的东西，装 Mac 的双系统只要跟着Bootcamp 的节奏来就好。

1. 把要安装的 Windows 镜像挂载在桌面上。

2. 打开 Bootcamp 助理，点击继续，出现如下画面后只选择第三项。点击继续。

3. 分割磁盘。按照自己的需求来分割，一般建议 Windows 系统 20G 以上。（有的型号要求比较高能达到 50G，本人上次碰到一个拿着只剩 2G 的 Air 让我装个双系统的，当时我那个激动啊……）分割好以后选择开始安装，然后电脑会自动重启，出来的就是大家都熟悉的 Windows 安装界面了。

4. 安装好之后记得用 bootcamp 给系统激活~就大功告成啦。

![原手册插图（PDF 第 166 页）](/images/manual/pdf-p166-i00.jpg)

![原手册插图（PDF 第 166 页）](/images/manual/pdf-p166-i01.jpg)

来源：四川大学飞扬俱乐部《维修手册》PDF 第 165-166 页（印刷页 164-165）。

---
title: Windows 注册表与 REG 文件
doc_id: 01m1zwvt7kf44gj1k7dajqmp2s
manual_pages:
  - 124
  - 130
owners:
  - maintenance-team
tags:
  - Windows
  - 注册表
  - 系统维护
updated: 2026-09-08T00:00:00.000Z
---
# Windows 注册表与 REG 文件

<!-- PDF 第 124 页；印刷第 123 页 -->

## 第五章：注册表基础知识

### 第一节：注册表的由来

注册表是 Windows 内部一个巨大的树状分层的数据库，其中容纳了应用程序和计算机系统的全部配置信息，包括操作系统和应用程序的初始化信息、应用程序和文档的关联关系、硬件设备的说明、状态和属性以及各种状态信息和数据。

#### 一、 注册表编辑器

注册表编辑器是一个用来查看和编辑注册表数据的高级工具。通过该工具，用户可在注册表中添加或修改数据，从而改变系统设定。打开方式：选择“开始”➔“运行”菜单（也可以按 win + R 快捷键），在运行窗口中输入 Regedit，单击“确定”按钮，即可打开注册表编辑器。

![原手册插图（PDF 第 124 页）](/images/manual/pdf-p124-i00.png)

![原手册插图（PDF 第 124 页）](/images/manual/pdf-p124-i01.png)

<!-- PDF 第 125 页；印刷第 124 页 -->

#### 二、 关键词 键值

在 Windows 系统中，注册表采用“关键字”和“键值”来描述项目及其项目值。在注册表中，关键字可以分为两类：一类是系统自定义的，通常称为“预定义关键字”另一类是由应用程序定义的，安装的应用软件不同，其项目也就不同。注册表中的数据都是通过一种树状目录结构，以根键、主键和子键的方式组织起来的。

每个键都包含一组特定的信息，在注册表中，用来表示这些信息的数值被称为键值项。五大键值

#### − HKEY_CLASSES_ROOT 根键：

每一种在系统中注册过的文件类型，都会在此建立一个子项；而且在每一个子项中均包含了文件的扩展名、说明性文字、文件图标及与文件关联的应用程序和应用程序对文件的操作方式。

#### − HKEY_CURRENT_USER 根键：

保存着当前登录用户的个人设置信息，如显示属性设置、网络连接和共享设置、应用程序参数设置等。当前登录用户可以利用该根键来修改这些设置，而不影响其他用户。

#### − HKEY_LOCAL_MACHINE 根键：

存放着用来控制系统和各软件的设置信息。该根键中的设置都是针对所有用户的，而且其中的信息会因计算机系统软、硬件配置的不同而不同。

#### − HKEY_USERS 根键：

与 HKEY_CURRENT_USER 根键的作用相似，不同的是其包含的是所有用户的个人设置信息。

#### − HKEY_CURRENT_CONFIG 根键：

当在 Windows 中配置多个硬件配置文件时，系统启动时会让用户选择使用哪个配置文件登录，HKEY_CURRENT_CONFIG 根键的作用是存放当前配置文件的所有信息。

<!-- PDF 第 126 页；印刷第 125 页 -->

#### 三、 导入/导出注册表

#### 导出注册表：

作用：备份注册表，以便在出现问题是恢复。方法：打开注册表编辑器，选择“文件”➔“导出”菜单，打开“导出注册表文件”对话框，然后执行下图所示操作，然后点击“保存”。

#### 导入注册表：

作用：注册表出现问题时将其恢复。方法：打开注册表编辑器，选择“文件”➔“导入”菜单，打开“导入注册表文件”对话框，然后执行下图所示操作。

![原手册插图（PDF 第 126 页）](/images/manual/pdf-p126-i00.png)

<!-- PDF 第 127 页；印刷第 126 页 -->

上面的例子中是通过双击注册表文件把注册表信息导入的,但在一些恶劣环境下双击注册表文件方法可能会失败那么我们就可以使用命令行导入注册表

1. 直接在“运行”对话框中输入以下命令： Regedit path:/regfile.reg 如：regeditC:/regbak.reg 如果加上参数/s 则表示在导入注册表文件时没有提示信息。如：regedit /s C:/regbak.reg

2. 在“运行”对话框中，输入“command”或者“cmd”，进入 MS - DOS 提示符或命令行状态，然后按上面相同的格式输入命令即可。

![原手册插图（PDF 第 127 页）](/images/manual/pdf-p127-i00.png)

![原手册插图（PDF 第 127 页）](/images/manual/pdf-p127-i01.png)

<!-- PDF 第 128 页；印刷第 127 页 -->

### 第二节：REG 文件编写

假设问题是：“Regedit”已经被锁住了，我们从“开始➔运行➔Regedit”按确定之后，出现“注册表编辑已经被您的系统管理员停用”。如何才能解除这个限制呢？因为限制不准用户执行“Regedit”的注册表信息是 HKEY_CURRENT_USER \Software \ Microsoft \Windows\CurrentVersion\Policies\System 中的“DisableRegistryTools”这一项值。

因此只要我们把”DisableRegistryTools”的值设为“0”（代表关闭），或是干脆把 System 这个注册表信息删掉（干净的操作系统本来就没有此信息）就行了。那这个 REG 文件怎么写，才能让“Regedit”顺利把

#### 其中的信息导入注册表呢？方法如下：

#### 一、 制作 REG 文件

新建一个文本文件，在其中输入以下内容：

```reg
REGEDIT4

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Policies\System]
"DisableRegistryTools"=dword:00000000
```

注意：“REGEDIT4”这行与后面行之间要有一空行。编辑好了以后，为文件取个名字储存，如“unlock.reg”并保存（存盘时请记得在记事本的存盘对话框中的“保存类型”要选择“所有文件（*.*）”，否则会被当作 TXT 文件的）。

![原手册插图（PDF 第 128 页）](/images/manual/pdf-p128-i00.png)

<!-- PDF 第 129 页；印刷第 128 页 -->

#### 二、 导入 REG 文件

因为在 Windows 环境下，已经没有办法执行“Regedit”，所以就要改成从 DOS 下执行此命令。方法是“开始→程序→MS - DOS 方式”。当然，你想用启动盘开机，从纯 DOS 下执行也行，只是不需要这么麻烦，用 Windows 中的 MS - DOS 方式即可。

假设我的这个 unlock.reg 是放在 `C:\TEMP` 的话，就输入：

```text
regedit C:\temp\unlock.reg
```

后按回车。接着画面上会出现“您确定要增加 C:\temp\unlock.reg 信息到注册表”的对话窗——按“确定”，“unlock.reg”的内容就输入注册表了，同时也就解除了无法执行“Regedit”的限制了。

#### 三、 学会举一反三

REG 文件为什么要以“REGEDIT4”开头，而不是“REGEDIT1”或“REGEDIT2”呢？因为这是“规定”。Windows 95/98/ME/NT 4.0 等的 REG 文件开头第一行规定必须是“REGEDIT4”。

而 Windows 2000/XP 则是“Windows Registry Editor Version 5.00”，用以区分所使用的操作系统。从这个 REG 文件中，我们可以了解 REG 文件的内容格式：

1. 开头第一行一定是：“REGEDIT4”或“Windows Registry Editor Version 5.00”，以区别操作系统；

2. 注册表信息头尾用“[”与“]”包起来；

3. " " 内就是字符串内容；

4. “DWORD”为“0”就是用“dword:00000000”表示，因为“DWORD”值是16 进位 ，16 进位的“0”就是“00000000”。

5. 因为本例中只有一行注册表信息（[HKEY_CURRENT_USER\Software\Mi ...]），所以没有空行。而如果有两个以上的注册表信息，信息与信息之间就需要有空行隔开。

6. 如果要删除某个注册表信息该怎么办？很简单，在注册表信息前面加上“ - ”（减）号 。

例如，“unlock.reg”我也可以这么写：

<!-- PDF 第 130 页；印刷第 129 页 -->

```reg
REGEDIT4

[-HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Policies\System]
```

只要“ - HKEY_CURRENT_USER\Soft...”就可以了，“DisableRegistryTools...”那一行就可以省去不写，为什么？因为这行就是告诉“Regedit”直接去把“System”这个注册表信息删掉，而“DisableRegistryTools”又是在“System”下，头都删了，当然里面的东西也就消失了。

来源：四川大学飞扬俱乐部《维修手册》PDF 第 124-130 页（印刷页 123-129）。

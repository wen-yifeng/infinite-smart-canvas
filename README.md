# 无限智能画布 Infinite Smart Canvas · 玻璃拟态主题

[大雄画布](https://github.com/hero8152/Infinite-Canvas) 二创：整体重做为玻璃拟态（Glassmorphism）视觉的本地无限画布。Windows 本地优先，节点式串联文生图 / 图生图 / 视频生成，内置提示词工作台、视觉助手、素材库与生成日志。

> **English:** A glassmorphism-themed remake of [Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas) — a local-first infinite canvas that chains text-to-image / image-to-image / video generation as nodes (FastAPI + Vanilla JS, Windows-ready).

![项目首页与 API 平台设置](preview_1.jpg)
![画布节点连线与提示词工作台](preview_2.jpg)
![生成日志与节点输出](preview_3.jpg)
![画布内 API 设置、生成日志与提示词工作台](preview_4.jpg)

## 功能特性

- **无限画布（Infinite Canvas）**：可自由缩放、平移的节点画布，在无限空间里布置文生图、图生图、视频生成节点。
- **节点式 AI 工作流（Node-based Workflow）**：拖拽连线把上游输出接到下游输入，多节点串联组合提示词与参考图，一次搭建、反复复用。
- **提示词工作台**：集中管理与复用提示词（Prompt），配合生成日志持续迭代。
- **视觉助手**：内置画布助手，支持附件与多种任务模式。
- **素材库与生成日志**：生成结果自动归档，历史完整可回溯。
- **本地优先（Local-first）**：画布数据、素材与日志全部保存在本机，不上传云端。
- **多 API 平台接入**：在设置页直接配置各平台的接口地址与密钥。
- **玻璃拟态 UI（Glassmorphism）**：深色玻璃材质界面，专注创作沉浸感。

## 运行

双击 `run.bat`（使用本目录内置 Python 环境），浏览器访问 <http://127.0.0.1:3001>。

也可使用自备的 Python 3.10+：

```bash
pip install -r requirements.txt
copy API\.env.example API\.env   # 按需填写 API 密钥
python main.py
```

环境变量说明见 `API/.env.example`；迁移与使用细节见 [运行说明.txt](运行说明.txt)。`API/.env`、`data/`、`assets/` 属于本地数据与私密配置，不进入版本库。

本地镜像的字体、图标库及许可证说明见 `static/vendor/THIRD_PARTY_LICENSES.md`。

## 许可证

本项目根据 [大雄画布](https://github.com/hero8152/Infinite-Canvas) 二次开发，仅供学习与个人使用，禁止商业用途，详见 [LICENSE](LICENSE)。

# 资产来源与生成管线

## 原始参考

目录下 `炒饭地摊三轮车.png`、`炒饭工作台.png` 决定结构和工位。两张 UI 图只用于理解夜市与第一人称，不视为最终界面规范。

## Hyper3D 接入

名称 `hyper3d`，Streamable HTTP `https://api.hyper3d.com/api/mcp`，OAuth。使用 `codex mcp add` 添加，保留其他条目，`codex mcp login hyper3d` 完成登录；已实际成功回调。连接方式依据 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

当前任务的工具目录不会自动增加新的 MCP 名字，因此本轮用同一服务的 Streamable HTTP JSON-RPC `tools/call` 完成操作，读取已有的、仅限 Hyper3D 的系统钥匙串凭据，未写入项目，也没有使用其他服务凭据。后续重启 Codex 或新建加载配置的会话，可让原生 Hyper3D 工具进入工具列表；这不影响已经完成的生成和本地游戏运行。

已实际查询到：

- `rodin_create_uploads`：创建上传链接。
- `rodin_import_images`：导入 ChatGPT 附件（本轮未使用）。
- `rodin_generate`：生成模型。
- `rodin_generate_bang`：拆件（本轮未使用，避免额外消耗）。
- `rodin_get_status`：查询阶段。
- `rodin_wait`：短等待。
- `rodin_get_result`：获取模型结果。

完整定义见 `hyper3d-tools.json`。生成任务 ID 与永久结果页见 `assets/source/hyper3d-provenance-v2.json`；临时下载签名没有写入项目。

## 质量修正

首轮直接上传整张多视图参考板，模型包含多辆车和零件，质量检查拒绝。第二轮使用内置 ImageGen 整理单辆完整车的参考，再调用 Hyper3D。没有把失败版本当成成品。

ImageGen 输出：`assets/source/cart-single-reference.png`。内置工具，非 API/CLI。核心完整提示词：

> Use case: precise-object-edit. Create one clean 3D reconstruction reference image from this reference sheet. Extract and recreate ONLY the single LARGE main assembled cobalt blue Chinese street food cargo tricycle in the center panel, seen in its same front-left three-quarter perspective. Exactly ONE complete tricycle, not multiple views. Preserve the blue driver cabin on the left, black front tire and two rear tires, stainless steel street fried rice worktop on the right with ingredient bins, black wok, canopy steel posts, one red long horizontal sign with food pictures, LPG red cylinder at the rear. Fully assembled single vehicle. Center the one entire vehicle against a clean light grey studio background with generous margin; wheels rest on same baseline. Even neutral studio lighting, physically believable materials, high clarity of the complete vehicle. Delete ALL numbered labels, surrounding panels, small duplicate vehicles, exploded parts, borders and diagrams. No other objects, no people, no montage, no split screen. 1536x1024 landscape.

Hyper3D 的最终请求记录在 `assets/source/hyper3d-request-v2.json`：Gen-2.5 Medium、Raw、目标 30,000 面、去光照贴图、GLB。

## Blender 工作

`finish_hyper3d.py` 导入真实生成的 PBR GLB，统一尺度到长边 4.2 米，轮胎落地，保留 UV 和法线，把纹理约束到 2K，保存 `.blend`，导出游戏 `.glb`，渲染 QA PNG。

`build_station.py` 单独重建参考工作台，保留米饭左、锅中、九格配菜右、调料后、煤气侧面的结构，锅和锅柄为命名对象。浏览器把静态网格按材质合并，独立动画手、勺、锅和米粒。

生成资产的精细拓扑仍不等同于手工生产模型；后续若做近景写实，应重拓扑工作面、统一 texel density、补手部骨骼与粗糙度细节。

## 2026-09-27：同车可操作版本

用户要求取消独立工作台切换。本版 `scripts/build_playable_cart.py` 读取 `hyper3d-cart-finished.blend`，保留三轮车底盘、车头和顶棚，在同一坐标系中重建工作台。模型导出为 `playable-cart.glb`，游戏首页和第一人称镜头均使用这一文件。

建模增加凹面碳钢锅、锻造锅柄、燃气炉圈、钢制料盘、分层腊肉片、胡萝卜丝、弧形洋葱丝、米粒、中空葱花、瓶身和液面、深口炒勺、连续曲面双手。动态节点、食材原型和世界坐标写入 `playable-cart-layout.json`；游戏提取它们实施抓握和烹饪表现。

材质采用原 Hyper3D PBR 纹理与 Blender 新建材质。Blender 的程序微表面节点不会全部由 glTF 保存，浏览器效果以导出的金属度、粗糙度和纹理为准。HDR 环境使用 Poly Haven CC0 Shanghai Bund，保存在 `public/environment`。

输出 QA：`assets/source/playable-cart-full-qa.png`、`assets/source/playable-cart-worktop-qa.png`。Blender 静态图用于检查几何，实时画面仍需浏览器验收。

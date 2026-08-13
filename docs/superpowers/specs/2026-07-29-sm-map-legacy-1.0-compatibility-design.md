# Scrap Mechanic 地图：原版底图兼容与 1.0 增量设计

## 目标

以 `the1killer/sm_overview` 原开源项目为地图功能和视觉资源基线，在保留其底图拼接、POI 图片、坐标、旋转、缩放和存档地图能力的前提下，将数据与渲染升级到 Scrap Mechanic Steam 1.0 正式版。

首要交付是让当前页面重新显示原工具已有的可用底图。1.0 正式版新增且旧项目未覆盖的地块和区域作为增量补充，不以重新制作全部旧资源为前置条件。

## 已确认的资源与约束

- 原包实际包含 298 张可由运行时代码寻址的纯数字地块 JPG；另有从未被原始运行时代码引用的 `11504 - Copy.jpg` 备份文件和 `1076814.pdn` 编辑源文件。二者均不猜测 ID、不发布、不重编码。
- 原包仍包含约 40 张 POI、特殊区域和大型建筑图片。
- 原版 `sm_overview_map.js` 保存了地块 ID、POI 图片选择、尺寸、坐标特例和图片路径规则。
- Scrap Mechanic 1.0 安装目录包含官方 terrain Lua、`.tile` 文件、模型和纹理。
- 1.0 官方 Lua 仍显式调用 `AddTile(legacyId, path, ...)`，并由 `.tile` 文件提供 UUID。因此可以生成经过官方数据证明的 `legacyId → path → UUID` 映射，不需要根据数字文件名猜测 UUID。
- 当前页面已经具备 18 个区域、搜索、筛选、列表、详情、Leaflet 地图、1.0 存档解码和专属地图模式。
- Canvas 不可用环境的 Leaflet 构造回滚问题暂不阻塞本阶段；正常支持 Canvas 的浏览器不受影响。

## 方案选择

采用“原版兼容层 + 1.0 增量层”。

不直接 iframe 或并行运行旧页面，因为两套 Leaflet、URL、筛选、区域和存档状态会互相冲突。不从零重建所有地块 atlas，因为旧包已有大量可用图片，且全量重渲染成本高。

原版算法被移植成有明确输入输出的 TypeScript 模块，图片保持原资源身份；当前 AppController、MapView 和 Leaflet 实例继续作为唯一交互和状态入口。

## 架构

### 1. LegacyAssetCatalog

职责：

- 枚举原包已有的 298 张严格数字命名地块图片。
- 枚举 POI 和特殊区域图片。
- 保存原版的 POI 尺寸、坐标特例和图片选择规则。
- 输出稳定、可校验的 legacy asset manifest。

接口概念：

```ts
interface LegacyAsset {
  legacyId: number;
  imageUrl: string;
  widthCells: number;
  heightCells: number;
  source: "the1killer/sm_overview";
}
```

图片进入 Vite 的公开静态资源目录，但不修改原始图片内容。构建时校验文件存在、尺寸可读、清单无重复 ID。

### 2. OfficialLegacyBridge

职责：

- 解析 1.0 官方 terrain Lua 中的 `AddTile`、`addPoiTileLegacy`、`addPoiTileRetired` 和明确的 legacy upgrade 调用。
- 解析对应 `.tile` 文件头中的 UUID。
- 生成 `legacyId → UUID → tile path` 的审计清单。
- 对一对多、路径缺失、UUID 冲突和 retired/remapped 状态显式报错。

禁止：

- 不得仅凭 `1000001.jpg` 之类的数字文件名推断 UUID。
- 不得用图片相似度自动确认生产映射。
- 不得用 seed 重建并声称是存档中的精确地形。

构建产物示例：

```ts
interface LegacyTileBridgeEntry {
  legacyId: number;
  uuid: string;
  tilePath: string;
  status: "active" | "retired" | "remapped";
  evidence: string;
}
```

### 3. HybridTerrainResolver

输入为当前统一的 `TerrainCell`。

解析顺序：

1. 通过 UUID 查找官方 legacy bridge。
2. 如果 legacy ID 有原包地块图片，返回旧底图图片。
3. 如果 UUID 对应原包的 POI 特殊规则，返回正确的 POI 图片和覆盖尺寸。
4. 如果是 1.0 新地块且尚无图片，返回明确的 1.0 分类占位图块。
5. 后续新增的 1.0 渲染图片可通过独立增量清单覆盖占位，不改变地图接口。

解析结果包含来源标签，便于开发校验和统计覆盖率：

```ts
type TerrainVisualSource =
  | "legacy-tile"
  | "legacy-poi"
  | "one-dot-zero-render"
  | "one-dot-zero-fallback";
```

### 4. LegacyCompatibleTerrainLayer

职责：

- 在当前唯一的 Leaflet 地图中绘制旧地块图片。
- 保持原版的格子尺寸、北向、旋转、偏移和 POI 大小规则。
- 使用 staging canvas 或已本地化图片资源完成帧后原子显示。
- 不创建第二个地图实例，不接管 AppController、URL 或筛选状态。
- 图片缺失时只替换单个地块为明确 fallback，不让整个地图空白。

个人存档选择后不得产生由个人 UUID 布局决定的远程网络请求。原包图片和映射清单必须在本站本地提供；专属地图只使用本地已发布资源。

### 5. 统一地图模式

#### 未上传存档

- 原开源包不包含一份可公开复用的完整随机地表布局；其 `cells.json` 只是 5 个 cell 的格式样例。因此未上传时继续展示当前参考地点、区域切换、搜索、筛选、列表和详情，不伪造一张“玩家世界”。
- 页面明确提示：选择 v28 存档后，原工具底图资源会按该存档的真实地形布局拼接。
- 固定区域展示 1.0 生成数据；存在 legacy 图片时使用同一 resolver。
- 搜索、分类筛选、列表、详情和区域切换保持当前实现。

#### 已上传存档

- 使用已经完成的 v28 SQLite、ScriptData、LZ4、Lua 和 terrain normalization。
- 每个真实 UUID 通过 HybridTerrainResolver 解析。
- 能复用旧图的地块显示原版底图。
- 1.0 新地块显示明确 fallback 或已补充的新图。
- 替换、退出、区域切换和错误保图继续使用当前原子生命周期。

## 1.0 增量资源策略

不再把“2,877 张全新图片全部完成”作为显示底图的门槛。

资源按以下顺序补充：

1. 官方 legacy bridge 能覆盖的原包 298 张运行时地块。
2. 原包 POI 和特殊区域图片。
3. 用户真实 1.0 存档中出现频率最高、但旧包没有图片的 UUID。
4. 1.0 固定区域和剧情区域的新增地块。
5. 低频、边界和开发专用地块。

每次增量构建输出：

- legacy 覆盖数量；
- 1.0 新图数量；
- fallback UUID 数量；
- 19 个生成世界和真实 aggregate 存档的视觉覆盖率；
- 缺失资源清单。

## 数据与隐私

- 游戏安装路径只用于本地构建工具，不进入前端产物。
- 用户存档、文件名、seed、UUID 布局和进度只保留在浏览器内存。
- 前端只请求固定的本地静态资源 URL。
- 不根据个人存档动态请求不同的远程 atlas 页面。
- 不将个人布局写入 URL、console、localStorage、IndexedDB、Cache、分析事件或生成文件。

## 错误处理

- legacy 图片缺失：单格 fallback，并在开发/验证报告中记录。
- 官方 legacy 映射冲突：构建失败，不发布猜测映射。
- `.tile` UUID 无法读取：构建失败并打印游戏内相对路径。
- 1.0 新 UUID 无图片：地图继续显示，使用带地形分类的明确 fallback。
- 图片解码失败：保留已提交地图帧，显示可恢复资源状态。
- 原包 POI 特例无法匹配：退回普通地块，不扩大或错放 POI 图片。

## 测试与验收

### 映射与资源

- 官方 `1000001` 等已知 legacy ID 能通过 Lua 路径和 `.tile` UUID 完成映射。
- 数字文件名不能单独产生映射。
- active、retired、remapped 冲突测试。
- 298 张运行时图片清单、尺寸、重复 ID 和文件完整性测试。
- POI 图片、覆盖尺寸和坐标特例回归测试。

### 渲染

- 原版已知 2×2、4×4 和 8×8 POI 的图片、坐标和旋转快照。
- 上传兼容存档后，地表地图显示多个实际旧图块，而不是只有 marker 或单色 canvas。
- 单张图片缺失不会清空已提交帧。
- 缩放、拖动、图层开关、搜索、筛选、列表和详情继续工作。
- 同一地块在基础地图和专属地图使用同一 resolver 结果。

### 1.0

- 1.0 新 UUID 使用 fallback，不被错误映射到旧数字图片。
- 两个不同个人布局在选择存档后不产生不同的远程请求序列。
- 真实 aggregate 存档保持 v28、128×96、12,288 cells、442 UUID 的解析校准。
- 18 个固定区域继续可切换。

### 浏览器

- Chromium 和 Firefox 均验证基础底图可见。
- 上传、替换、退出、错误恢复和固定区域旅程继续通过。
- 完整 E2E 必须断言地图中存在实际 legacy tile 像素或图片绘制记录，不能只断言 Leaflet 容器和 marker。

## 完成标准

- `http://127.0.0.1:4173/` 未上传时保留完整参考交互；上传 v28 存档后立即看到原开源工具的实际底图图块。
- 原有区域、搜索、筛选、列表、详情和存档入口保持可用。
- 上传 v28 存档后，能匹配的旧地块使用原版图片，1.0 新地块使用明确 fallback。
- 映射完全来自官方 Lua 和 `.tile` UUID 证据。
- 前端不依赖游戏安装目录，不泄露个人存档访问模式。
- Chromium、Firefox、构建、资源验证和隐私验收全部通过。

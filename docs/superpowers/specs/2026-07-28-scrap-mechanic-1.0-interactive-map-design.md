# Scrap Mechanic 1.0 双模式互动地图设计

日期：2026-07-28  
基础项目：`the1killer/sm_overview`  
目标游戏版本：Scrap Mechanic 1.0 / Drilling Thunder（Steam 正式版）

## 1. 目标

把原项目升级为可本地运行的静态互动地图，同时保留原工具“根据玩家存档生成专属地图”的核心价值。

页面具有两种无缝切换的工作模式：

1. **基础模式**：不上传存档也能浏览完整的 1.0 基础互动内容、参考地表和固定区域。
2. **专属模式**：用户选择本地 Survival `.db` 存档后，在同一个页面内替换半随机地表和程序生成区域，并叠加该存档的精确地点及可判定进度。

两种模式共用同一套区域导航、搜索、筛选、地图交互和地点详情，不跳转到另一套页面。

## 2. 已确认的产品决策

- 地图引擎使用 Leaflet 和平面坐标系 `L.CRS.Simple`。
- 桌面端使用三栏地图图鉴布局。
- 视觉采用“机械工坊”风格：深灰金属、警示橙、高对比标记和实用工业字形。
- 所有存档解析均在浏览器本地完成，存档不上传、不写回、不修改。
- 保留基础互动内容；上传存档只是激活专属数据层。
- 固定区域地图复用基础数据，半随机区域按存档替换。
- 首版不包含账户、云同步、在线编辑、实时玩家位置或向游戏写入航点。

## 3. 范围

### 3.1 基础地图区域

区域选择器至少包含：

- 地表世界
- 挖掘岛
- Grow Lab 1–7
- 采矿中心
- 废料场
- 地下车站 1–2
- 最终 Boss 大厅
- Trashbot Boss 区域
- 钻探区域 1–2
- 地下引导区域

区域数量较多时，顶部按“地表 / 剧情区域 / Grow Labs / 地下设施 / Boss”分组，避免单行标签溢出。

### 3.2 地点与图层

地点分类包括：

- 主线任务
- 支线任务
- 地下入口与出口
- 服务设施
- 交易设施
- Grow Lab
- 资源
- 危险区域
- Boss
- 交通和区域连接
- 普通 POI

地图图层包括：

- 地形
- 道路
- POI
- 任务
- 资源
- 危险区域
- 坐标网格
- 存档进度

### 3.3 非目标

- 不在浏览器中编辑或修复存档。
- 不把存档数据上传到服务器。
- 不保证运行时随机敌人、掉落物或尚未生成的地下内容的位置。
- 不将固定区域的攻略说明误标为存档精确坐标。

## 4. 双模式行为

| 功能 | 基础模式 | 专属模式 |
|---|---|---|
| 地表 | 内置 1.0 参考世界 | 存档中的真实地表 |
| 固定区域 | 完整固定地图 | 固定地图加存档进度 |
| 程序生成区域 | 参考说明或参考布局 | 存档中已生成的实际布局 |
| 地点列表 | 全部 1.0 基础地点 | 基础地点加存档精确地点 |
| 坐标精度 | 明确标注“精确”或“参考区域” | 对可解析地点标注“存档精确” |
| 进度 | 不显示个人状态 | 显示可判定的已访问、已解锁和已完成状态 |
| URL 状态 | 保存视图和筛选 | 保存视图和筛选，但不包含存档内容 |

页面始终显示模式标识。专属模式还显示存档文件名、世界种子、存档版本，以及“更换存档”和“退出专属地图”操作。

## 5. 数据来源

### 5.1 游戏安装资源

构建时从 1.0 安装目录只读提取：

- `Survival/Scripts/terrain/overworld/poi_types.lua`
- `Survival/Scripts/terrain/overworld/poi.lua`
- `Survival/Scripts/terrain/overworld/generate_cells.lua`
- `Survival/Scripts/terrain/tile_database.lua`
- `Survival/Scripts/terrain/overworld/tile_database.lua`
- `Survival/Terrain/Worlds/*.world`
- `Survival/Terrain/Tiles/**/*.tile`
- 与任务、地点、世界连接和本地化有关的 Lua/JSON 文件

固定 `.world` 文件本身为 JSON，转换为统一的区域网格数据。程序生成区域的基础定义从对应 Lua 和地块目录生成清单。

### 5.2 内置参考数据

基础模式包含：

- 一份只含地形单元信息的 1.0 参考世界数据；
- 固定区域网格；
- 1.0 地块图集；
- 地点、分类、连接、任务说明和本地化文本。

参考世界数据不得包含玩家库存、玩家身份、创造物、容器或完整存档。

### 5.3 用户存档

已验证的 1.0 Survival 存档是 SQLite 3 数据库。浏览器读取：

- `Game.savegameversion`
- `Game.seed`
- `ScriptData` 中各 `worldId` 的地形和进度候选数据
- 必要时读取 `GenericData`、`Portal` 和其他只读表来解析世界连接及进度

本机样本验证值：

- `savegameversion = 28`
- 地表世界数据存在于 `ScriptData.worldId = 1`
- 地形数据包含 `seed`、`bounds`、`uid`、`xOffset`、`yOffset`、`rotation` 和 `flags`

## 6. 技术架构

项目升级为 Vite + TypeScript 静态应用，继续使用 Leaflet。生产构建结果全部为静态文件，可由本地启动脚本或任意静态服务器提供。

### 6.1 模块边界

#### `app-shell`

- 管理基础模式与专属模式。
- 组合顶部区域选择、左栏、地图和右栏。
- 不直接解析存档或绘制地块。

#### `save-reader`

- 在 Web Worker 中运行。
- 使用随应用本地打包的 SQLite WASM 读取 `.db`。
- 验证 SQLite 文件头、文件大小、`Game` 表和支持的存档版本。
- 只返回地图所需的结构化数据。

#### `lua-data-decoder`

- 解包 `ScriptData` 外层记录。
- 执行 LZ4 块解压。
- 反序列化 Scrap Mechanic 保存的 Lua 值、数组、表、UUID 和常用 userdata。
- 对未知值返回带位置的解析错误，不静默生成错误地图。

#### `terrain-normalizer`

- 把存档数据转换成统一的 `WorldMap`。
- 校验世界种子、边界、行列完整性、UUID、旋转和偏移。
- 通过 UUID 查找 1.0 地块清单和 POI 类型。

#### `atlas-renderer`

- 使用地块 UUID、单元偏移和旋转，从本地图集读取对应图块。
- 在 Worker/OffscreenCanvas 可用时后台拼图；否则使用普通 Canvas。
- 输出 Leaflet 可用的位图层和单元元数据。

#### `region-catalog`

- 加载固定 `.world` 转换结果。
- 描述区域分组、名称、边界、连接和基础图层。
- 固定区域不会因地表种子变化而重复生成。

#### `location-resolver`

- 合并固定地点、由地块 UUID 识别的 POI、存档世界连接和进度。
- 为每条地点记录附加精度：`exact`、`save-exact`、`area-reference` 或 `unknown`。
- 无法可靠判定的进度显示“无法从该存档判定”，不猜测。

#### `map-view`

- 封装 Leaflet 地图实例、图层、标记聚合、坐标网格和区域切换。
- 只消费标准化数据，不知道 SQLite 或 Lua 序列化细节。

#### `ui-state`

- 管理搜索、分类、图层、选中地点、区域、缩放和中心点。
- 把非敏感状态同步到 URL。
- 存档二进制内容永不进入 URL、日志或持久化存储。

### 6.2 数据流

```text
基础模式
内置 reference-world.json + regions/*.json + atlas
                    ↓
terrain-normalizer / region-catalog
                    ↓
location-resolver
                    ↓
Leaflet + 三栏 UI

专属模式
用户 Survival .db
        ↓
save-reader（SQLite WASM）
        ↓
LZ4 + Lua 数据解码
        ↓
terrain-normalizer + atlas-renderer
        ↓
location-resolver + 进度叠加
        ↓
同一个 Leaflet + 三栏 UI
```

## 7. 地块图集

地图继续采用原项目的“预渲染地块拼接”思想，但索引从旧版 legacy ID 升级为：

```text
tile UUID + xOffset + yOffset + rotation
```

图集生成流程：

1. 扫描 1.0 地块数据库，得到全部地表和相关区域地块 UUID、尺寸及单元偏移。
2. 复用原项目中能与 1.0 UUID/路径可靠对应的地块图。
3. 对新增和变化的地块，通过安装版游戏的地块/世界编辑环境生成统一俯视渲染。
4. 将所有单元和四种旋转打入 sprite atlas。
5. 生成 `terrain-cell-atlas.json`，记录 UUID 哈希、尺寸、图集位置、游戏版本和内容校验值。
6. 构建验证要求所有支持区域使用的 UUID 都能在图集中解析；缺失项会使构建失败并输出清单。

## 8. 页面布局与交互

### 8.1 桌面端

- 顶部：产品名、模式、区域选择、存档入口、数据版本。
- 左栏：搜索、分类筛选、结果数量和地点列表。
- 中间：Leaflet 地图、图层按钮、缩放、坐标和重置视图。
- 右栏：地点图片、名称、精度、坐标、类型、任务、资源、敌人、入口/出口和相关区域。

### 8.2 移动端

- 地图占满主视口。
- 左栏变为筛选抽屉。
- 右栏变为可拖动底部详情面板。
- 区域选择使用分组下拉或全屏选择器。

### 8.3 存档入口

- 支持按钮选择和拖放 `.db`。
- 上传区明确显示“文件只在当前浏览器读取”。
- 解析阶段显示“读取文件 / 解压地形 / 拼接地图 / 解析地点”。
- 成功后保留当前页面，只把模式切换为“我的存档”。
- 退出专属模式时释放对象 URL、Canvas 和 Worker 数据。

### 8.4 URL 状态

URL 保存：

- 区域 ID
- 地图中心
- 缩放级别
- 分类与图层
- 搜索词
- 选中地点 ID

URL 不保存：

- 存档路径
- 存档内容
- 玩家身份
- 个人进度明细

## 9. 数据模型

### `WorldMap`

```ts
interface WorldMap {
  id: string;
  source: "reference" | "save" | "fixed-region";
  gameVersion: string;
  saveVersion?: number;
  seed?: number;
  bounds: CellBounds;
  cells: TerrainCell[];
  locations: MapLocation[];
  connections: WorldConnection[];
}
```

### `TerrainCell`

```ts
interface TerrainCell {
  x: number;
  y: number;
  uuid: string;
  rotation: 0 | 1 | 2 | 3;
  xOffset: number;
  yOffset: number;
  flags: number;
  terrainType: string;
  poiType?: string;
}
```

### `MapLocation`

```ts
interface MapLocation {
  id: string;
  regionId: string;
  name: string;
  category: string;
  precision: "exact" | "save-exact" | "area-reference" | "unknown";
  position?: { x: number; y: number; z?: number };
  bounds?: CellBounds;
  questIds: string[];
  resourceIds: string[];
  enemyIds: string[];
  progress?: "locked" | "available" | "visited" | "completed" | "unknown";
  relatedRegionIds: string[];
}
```

## 10. 错误处理

用户可见错误必须具体且可恢复：

- 空文件
- 超过浏览器处理上限
- 非 SQLite 文件
- 非 Survival 存档
- 不支持的存档版本
- 缺少完整地表数据
- 地形种子不一致
- Lua 数据无法解码
- 存档使用了未知地块 UUID
- 浏览器缺少 WASM、Worker、Canvas 或图片编码能力

错误不会清除当前基础地图。用户可以更换存档或继续使用基础模式。

## 11. 性能与隐私

- SQLite、LZ4 和 Lua 解码在 Worker 中执行。
- 存档设定明确的大小上限；首版为 256 MB。
- 地图图集按需加载，固定区域延迟加载。
- 大地图先生成低分辨率预览，再在缩放时加载高分辨率单元。
- 所有依赖本地打包，不使用 CDN。
- 不发送存档、世界种子或进度分析遥测。
- 默认不在 IndexedDB、LocalStorage 或 Cache Storage 中保存存档内容。

## 12. 可访问性

- 所有按钮、筛选和地点列表可用键盘操作。
- 选中地点后焦点移动规则明确，不强制抢焦点。
- 标记同时使用形状、图标和文字，不只依赖颜色。
- 警示橙与背景满足可读对比度。
- 解析状态和错误通过 `aria-live` 通知。
- 支持减少动画偏好。

## 13. 测试策略

### 单元测试

- SQLite 元数据读取
- ScriptData 外层解包
- LZ4 解压
- Lua 数值、数组、表、UUID、vec3 和引用解码
- 负索引 Lua 数组
- 地形边界和完整性校验
- UUID/偏移/旋转到图集坐标映射
- POI 分类和精度规则
- URL 状态序列化

### 固定样本测试

从本机 1.0 存档制作去隐私测试夹具，只保留最小必要表和经过裁剪的地形数据。测试：

- `savegameversion 28`
- 地表 `worldId 1`
- 128 × 96、共 12,288 个地表单元
- 种子一致性
- 已知 UUID 和旋转

完整私人存档不提交到仓库。

### 集成测试

- 基础模式启动并浏览固定区域。
- 上传有效 1.0 存档后切换专属模式。
- 更换和退出存档。
- 搜索、筛选、区域跳转和详情联动。
- 未知版本或损坏文件保留基础地图。
- 桌面三栏与移动端抽屉/底部面板。

### 视觉和浏览器测试

- Chromium、Firefox 和 Edge。
- 对基础地表及主要固定区域做截图回归。
- 对高缩放、低缩放、标记密集区域和移动端视口验证。

## 14. 完成标准

只有同时满足以下条件才视为完成：

1. 本地启动后，不上传存档即可浏览基础地表、固定区域、搜索、筛选和详情。
2. 选择有效的 1.0 Survival `.db` 后，浏览器本地生成该存档的地表地图。
3. 生成结果使用存档中的 UUID、偏移、旋转、边界和种子，不只读取种子后伪造地图。
4. 固定区域在两种模式下保持可用。
5. 可解析的随机 POI 和进度在专属模式中覆盖基础参考数据。
6. 无法可靠解析的数据明确标注未知或参考，不虚构精确位置。
7. 存档从不上传、写回或默认持久化。
8. 所有支持的 1.0 地块都有图集映射，构建验证无缺失 UUID。
9. 桌面端、移动端和主要浏览器交互通过测试。
10. README 包含本地启动、存档位置、隐私说明、支持版本和数据更新方法。

## 15. 许可与署名

保留原项目作者 The1Killer 的署名、仓库链接和原许可声明。原 README 声明 CC BY-NC-SA 4.0；后续分发按该声明处理，并保留 Scrap Mechanic 与 Axolot Games 的非隶属说明。

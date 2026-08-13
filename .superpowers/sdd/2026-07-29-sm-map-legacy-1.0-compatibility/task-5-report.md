# Task 5 report

## 状态

完成。提交为本报告所在的 `feat: report legacy and 1.0 terrain coverage` 提交。

实现结果：

- 无存档时明确显示：“选择 1.0 Survival 存档后，将按真实地形布局拼接原版底图。”
- 有存档时只在 coverage 区显示聚合计数，区分“原版底图”“1.0 分类底色”“1.0 新底图（未来）”。
- coverage 来自 `MapView.prepareWorld` 实际构造的 world/frame；只有 `commitPreparedWorld` 成功后 AppController 才提交给 UI。
- 退出专属地图会清除个人 coverage；失败 commit、过期 save completion 不会写入个人 coverage。
- `data:legacy` 在临时目录从游戏源重建数据，核对 committed official bridge，并校验原版图片 manifest；输出仅含五个 aggregate counts。
- 保留 `data:verify` / `data:atlas` 已有分工；未触碰 null-Canvas 停放逻辑。

## RED / GREEN

RED：

- `npm.cmd test -- src/components/terrain-coverage.test.ts tools/game-data/atlas/verify-atlas.test.ts`
  - `terrain-coverage` 模块不存在。
  - `buildCoverageReport` 不存在。
- `npm.cmd test -- src/map/map-view.test.ts src/app/app-shell.test.ts`
  - prepared world 没有真实 coverage。
  - AppShell 没有 coverage 呈现/清除接线。
- `npm.cmd test -- tools/game-data/verify-generated.test.ts`
  - `assertLegacyBridgeMatches` 不存在。

GREEN：

- brief 指定组合：2 files / 7 tests 通过。
- components + MapView + AppShell：4 files / 41 tests 通过。
- AppController + verifier 定向复验：3 files / 37 tests 通过。
- runtime-generated v28 Chromium E2E：1 test 通过，覆盖选择、替换、退出以及 coverage/privacy 断言。

## UI / aggregate / privacy

浏览器无存档验证：

- 逻辑区域数 18（桌面/移动两套导航 DOM 共 36 个按钮）。
- 搜索 “Grow Lab” 返回 7 个地点。
- 选择结果可切换区域并显示详情。
- 未选择存档时不声称存在玩家世界，原版底图说明文案正确。

runtime-generated 本地 v28 存档只记录以下 aggregate：

```json
{
  "totalCells": 4,
  "legacyImageCells": 2,
  "oneDotZeroImageCells": 0,
  "fallbackCells": 2,
  "distinctFallbackUuids": 2
}
```

coverage 区不包含 filename、path、seed、UUID 值或 UUID 列表。fallback 明确标为“1.0 分类底色”，没有标为 exact。退出后恢复无存档提示并清除上述个人 aggregate。

AppController 测试证明：

- 可见地图 commit 抛错时仍为 base coverage。
- 更晚的区域导航取消旧存档完成时仍为 base coverage。
- replacement 失败保留此前已 committed 的完整个人事务。

## CLI 证据

`npm.cmd run data:legacy -- --game-root "G:\共享文件\Scrap Mechanic"` 通过并只输出：

```json
{
  "legacyAssetIds": 298,
  "officialLegacyMappings": 406,
  "legacyCoveredUuids": 68,
  "oneDotZeroRenderedUuids": 0,
  "fallbackUuids": 28
}
```

前两项是 source/manifest 总量；后三项来自当前 committed fixed-world 集合的真实 UUID 聚合，不把 298 个 asset ID 硬报成 298 个已覆盖 UUID。verifier 的 740-UUID fixture 按 brief 得到 `298 / 406 / 298 / 0 / 442`。

`npm.cmd run data:verify -- --game-root "G:\共享文件\Scrap Mechanic"` 通过，输出 `generatedBundle: verified`、`legacyAssets: verified`，没有要求完整 1.0 atlas。

## 最终验证

- `npm.cmd run lint`：通过。
- `npm.cmd run build`：通过，35 modules transformed。
- `npm.cmd test`：40 files；336 passed，3 skipped。
- `npm.cmd run test:e2e -- tests/e2e/personal-map.spec.ts --project=chromium`：1 passed。
- `git diff --check`：通过。

## 自审 / 关注点

- Chrome 扩展未启用本地文件访问，手动 chooser 验证被浏览器权限阻止；仓库 Playwright Chromium 使用 runtime-generated 本地 v28 DB 完成了同一上传/替换/退出验证。
- 指定 4173 端口被另一个 worktree 的 preview 占用；无存档手动验证改用 4174，E2E 使用隔离的 4175。
- 没有可提交的完整 1.0 render 输入，因此未运行会要求全部 render inputs 的 `data:atlas` CLI；atlas verifier/intake/packer 全量单元测试通过，且 `data:verify` 不受该 gate 影响。
- build 保留了既有 Vite 对 sql.js 的 `fs/path/crypto externalized` 警告；构建退出码为 0，本任务未扩大该问题。

## Fix round 1

状态：完成。

- RED：`buildCoverageReport` 曾把 UUID 相同、offset/rotation 不同的 atlas entry 错计为 1.0 exact；`data:legacy` 也没有可选 atlas manifest 的加载/严格校验入口。
- GREEN：coverage 现在只按 fixed-world cell 的 canonical `UUID:xOffset:yOffset:rotation` key 计数；`VerifiedAtlasManifest` 类型边界确保生产调用先复用 `verifyAtlasFiles` 的 manifest self-hash、page hash/bytes/dimensions、路径和几何校验。
- `data:legacy` 新增可选 `--atlas-directory`（默认 `public/atlas`）。manifest 不存在时合法返回 0 个 1.0 renders；manifest 存在时必须连同实际 page 严格通过校验，损坏 manifest、损坏 page 或缺失 page 均 fail closed；不要求完整 2,877 个 render inputs。
- 新增 optional atlas 集成测试：真实生成 page/key 得到 `oneDotZeroRenderedUuids: 1`，无 manifest 得到 0，manifest/page 篡改及 page 缺失均拒绝。
- canonical-key 单元测试覆盖 wrong offset、wrong rotation 不算 exact，以及完全匹配才算 exact；740-UUID fixture 保持 `298 / 406 / 298 / 0 / 442`。
- replacement failure 的 AppController 单元测试和 Chromium E2E 都重新断言此前 committed coverage 文本保持不变。

验证：

- 聚焦 verifier/CLI/generated/components/app：7 files，62 tests passed。
- `npm.cmd run data:legacy -- --game-root "G:\共享文件\Scrap Mechanic"`：`298 / 406 / 68 / 0 / 28`。
- `npm.cmd run data:verify -- --game-root "G:\共享文件\Scrap Mechanic"`：通过。
- replacement-failure Chromium E2E：1 passed。
- `npm.cmd run lint`：通过。
- `npm.cmd run build`：通过，35 modules transformed。
- `npm.cmd test`：41 files；341 passed，3 skipped。

关注点：

- 同文件的既有 privacy E2E 会把随机 `blob:` UUID 中偶然出现的十进制子串 `731` 误判为 decoded sentinel 泄露；完整 `save-errors.spec.ts` 本轮为 4 passed / 1 false positive。该失败定位到随机 blob URL（例如以 `e731` 结尾），与本轮 coverage 变更无关；所需 replacement-failure E2E 独立复跑通过。
- build 仍只有既有 sql.js `fs/path/crypto externalized` 警告，退出码为 0。

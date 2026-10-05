# Agent 接入

**TouDi 使用你自己的 Agent，资料命令随桌面运行组件提供。** 用户的实际操作从[开始使用](开始与初始化.md)进入；本文说明 Agent 如何定位工具、读取规则和可靠保存。启动消息不包含本机目录或个人资料，具备用户授权的文件与命令权限后才能直接处理资料。

## 初始化与首次接入

**先按[开始与初始化](开始与初始化.md)确认自己的信源与规则，再开始日常任务。** 行业分组、同义标签和学历要求只来自当前工作区的 `preferenceRules`，不套用作者来源；未初始化或无法判断的词条保留原文。

**用户从“设置 → 开始与协作”复制一份启动消息，再补充信源、材料和任务。** 同一消息适用于首次使用和已有资料接入；已有工作区先检查连接，保留原流程，不重新初始化。

## 定位随 App 提供的资料工具

**Agent 根据当前设备已安装的 TouDi 定位工具，不让用户手抄目录。** macOS 先检查系统“应用程序”和用户“应用程序”中的 `TouDi.app`，资料工具位于包内 `Contents/Resources/runtime/toudi-runtime/toudi-runtime`；流程文档位于工具旁的 `_internal/AGENTS.md` 和 `_internal/docs/`。系统应用注册信息可辅助定位其他安装位置，但不作为唯一依据。只查找指定应用，不扫描无关私人目录；两个标准位置均没有应用时，再请用户安装或提供自选的 App 位置。

macOS Agent 可以在本机使用以下定位方式；目录输出仅用于本机操作，不回贴到公开文档或截图：

```sh
for toudi_app in /Applications/TouDi.app "$HOME/Applications/TouDi.app"; do
  toudi_tool="$toudi_app/Contents/Resources/runtime/toudi-runtime/toudi-runtime"
  if [ -x "$toudi_tool" ]; then
    "$toudi_tool" workspace status
    break
  fi
done
```

**定位工具后先运行 `workspace status`，直接读取 App 当前持久绑定。** 之后运行 `--help` 并按下面的公共命令读取资料；无需重新设置目录。工具会自动使用当前绑定，也可以在核对过目标后用 `--workspace` 显式指定。源码用户在自己打开的项目中使用 `python3 app/desktop_runtime.py`。

**Windows 尚待实机验收，工具定位以实际安装包资源布局为准。** 不能根据 macOS 的包内路径猜测 Windows 安装位置；先读取安装包或现有连接信息，不能声称未经验证的平台已自动接入。

**信源读取与研究使用 Agent 原有工具。** 仓库不内置默认招聘抓取器，也不要求购买额外模型 API。远程聊天工具没有本机权限时，先生成规范材料，由用户在 App 导入。

## 工作区绑定与原地接入

**原工作区已有规则时，先读取这些规则并保留现有标准流程。** 检查工作区 `AGENTS.md`、`投递数据/AGENTS.md` 及用户指定的信源流程说明；全表更新或内容导入有既定核验入口时继续使用，不以通用 JSON 提交跳过这些步骤。再读取随 App 提供的通用文档，确认保存与渲染契约。

**先确认实际工作区，再安排业务写入。** 打包 CLI 可用以下命令；示例采用源码形式，安装用户使用 App 提供的工具路径：

```sh
python3 app/desktop_runtime.py workspace status
python3 app/desktop_runtime.py workspace check /path/to/workspace
python3 app/desktop_runtime.py workspace adopt /path/to/workspace
python3 app/desktop_runtime.py workspace adopt /path/to/workspace --apply --base PREVIEW_BASE
python3 app/desktop_runtime.py workspace bind /path/to/workspace
python3 app/desktop_runtime.py workspace unbind
```

**`adopt` 默认预览，`--apply` 才执行必要兼容写入。** 按预览、备份与基准核对、apply、check、bind、App 验收顺序操作；不移动正文，不重建题库，不重导最新复盘。重复 id 修正保留内容与映射，基准变化应重新预览。`PREVIEW_BASE` 使用预览返回的 `base`；apply 返回 `recovery`，修正映射保存在工作区 `投递数据/.adoptions/`。具体结果以命令返回的报告为准。

**显式环境优先，持久绑定其次，无绑定使用独立空工作区。** `TOUDI_WORKSPACE` 显式指定目录时优先；macOS 持久连接文件为 `~/Library/Application Support/TouDi/connection.json`，`TOUDI_APP_HOME` 可隔离测试连接配置。日常不要从旧缓存或另一个目录反建母本。解除绑定不删除资料，App 关闭后仍可使用 CLI 更新同一工作区。

## 公共资料命令

**以下参数由打包资料工具和源码 CLI 共用。** 桌面使用上述步骤定位到的可执行文件；源码可用 `python3 app/desktop_runtime.py` 或 `python3 app/workbench.py`。以下示例使用源码形式说明参数，不要求安装包用户另装 Python：

```sh
python3 app/workbench.py --workspace /path/to/workspace preference-catalog
python3 app/workbench.py --workspace /path/to/workspace read records
python3 app/workbench.py --workspace /path/to/workspace validate records candidate.json
python3 app/workbench.py --workspace /path/to/workspace commit payload.json
python3 app/workbench.py --workspace /path/to/workspace export records records.json
python3 app/workbench.py --workspace /path/to/workspace import records candidate.json --base VERSION
python3 app/workbench.py --workspace /path/to/workspace backup backup.zip
python3 app/workbench.py --workspace /path/to/workspace restore backup.zip --preview
```

## 按信源初始化筛选规则

**先运行 `preference-catalog` 清点实际原词，再建立当前工作区的 `settings.preferenceRules`。** 此命令只返回原词和次数，不判断资格、不重写来源、不修改偏好；首次来源为空时，先核验用户提供的首批候选，再清点已保存的真实词条。读取最新 `settings` 和版本，保留 `display`、`materialFiles`、`recordsAuthority` 等已有字段，通过公共校验和提交入口保存并读回。

| 配置 | 定义 |
| --- | --- |
| `schemaVersion` | 当前为 `1`。 |
| `directionMatch` | `any` 表示已选企业性质或行业满足一项；`all` 表示已选的两个维度均需满足。未选择的维度不限制结果。 |
| `dimensions` | 包含 `natures`、`industries`、`education` 三个维度。 |
| 每个维度的 `separator` | 来源明确使用的标签分隔符；空字符串表示保留整个原词，不能根据标点猜测学历条件。 |
| 每个维度的 `aliases` | 已确认等价的“原词 → 最终显示词”，不把不同资格含义强行合并。 |
| 每个维度的 `groups` | 按来源定义的 `{name, values}` 分类，同一最终词条只属于一个分类。 |

**未确认、缺失和新出现的词条继续保留。** 有歧义的筛选含义先向用户确认；不能把学历词条自动换算为资格审核结论。新增信源只补充对应规则，保留已有分类和个人偏好。

## 按版本保存资料

**业务资料共用业务版本，配置与草稿各用自己的版本。** `records/preps/prospects/reviews/qbank/edits` 的版本覆盖业务正文与附件，排除 `settings/drafts`；后两者分别原子保存，不生成事务历史。`workspace/trash` 与完整恢复使用全工作区版本。始终从对应模块读取并提交它的 `version`。 `read` 支持 `records|edits|qbank|preps|prospects|reviews|settings|drafts|workspace|trash`。`commit` 读取 JSON payload，公共结构如下：

```json
{
  "module": "settings",
  "base": "从最新 read 结果取得的 version",
  "action": "replace",
  "data": {"schemaVersion": 1}
}
```

**按模块选择完整数据替换或目标条目提交。** `records` 支持规范数组替换/导入以及条目 `upsert/delete`，已有记录的 `id` 使用返回的 `keys`；`qbank` 按分类 `id` 提交或替换完整规范数据；`preps/prospects` 使用带 `markdown` 的条目 `upsert/import`，完整规范批次导入需带读取结构中的 `markdown`，不能用仅有派生字段的 JSON 替换母本；`reviews` 支持规范场次数据及 Markdown 导入；`settings/drafts/edits` 使用 `replace` 并保留无关字段。条目命令使用 `item` 和稳定 `id`，附件使用 `files:[{path,contentBase64}]`，移除使用 `{path,delete:true}`，仍被正文引用的材料不能删除，路径限于业务材料目录。

**删除恢复使用 `read trash` 返回的恢复 id。** 提交 `{module:"trash",base,action:"restore",id}` 前查看恢复涉及的文件；其恢复单位是事务，可能包含关联资料，不能把它当作任意单文件撤销。完整恢复先 `read workspace` 取得全工作区版本，再执行 `restore backup.zip --base VERSION`，先预览并备份当前工作区。

## 保存与验收

**Agent 与 App 使用同一数据锁、事务、格式校验和恢复副本。** 任务按“读取最新内容与版本 → 处理候选 → 校验 → 提交 → 读回 → App 核对”执行。提交失败保留候选；版本变化时重新对账，而不是换 base 盲写。公司准备正文、派生内容、探查目录和附件需要一起核对。

**已有专用脚本继续作为源码工具保留。** 记录发布、准备/复盘解析和加密快照的原参数见[流程协作](流程协作.md)，无需将原始内容契约重建为另一套格式。桌面日常管理优先公共 CLI。在线实例的 pull/status/push 是另一种可选模式，见[云端部署](云端部署.md)。

# Agent 接入

**TouDi 使用你自己的 Agent，资料命令随桌面运行组件提供。** App 接入说明包含当前正式工作区与工具路径；具备本机文件和命令权限的 Agent 才能直接处理资料。仅粘贴说明不会连接模型、授予电脑权限或自动调度任务。

## 首次接入

**从 App 复制接入说明，再补充你的材料与任务。** 不使用作者的个人路径、招聘来源或私有工具。可使用以下任务模板：

```text
请协助我使用 TouDi 管理求职资料。
工作区与资料工具：{粘贴 App 提供的当前位置和工具路径}
信源：{我的招聘网站、文件或其他可读来源}
个人材料：{我的简历、JD、项目资料或面试记录}
本次任务：{模块、公司、岗位或场次，以及所需结果}

先读 AGENTS.md、docs/流程协作.md 和 docs/内容与渲染契约.md。
读取最新正式资料及版本，只改本次目标，保留已有标记和无关内容。
使用资料工具校验、提交和读回；冲突保留候选，不强行覆盖。
核对 App 的正文、关联和附件。缺少事实时明确报告，不编经历或日期。
没有任务授权时不网申、不对外沟通、不发布资料。
```

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

**以下参数由打包资料工具和源码 CLI 共用。** 桌面使用 App 给出的 `agentTool` 可执行文件与命令前缀，不手抄应用包内路径；源码可用 `python3 app/desktop_runtime.py` 或 `python3 app/workbench.py`。以下示例使用源码形式说明参数，不要求安装包用户另装 Python：

```sh
python3 app/workbench.py --workspace /path/to/workspace read records
python3 app/workbench.py --workspace /path/to/workspace validate records candidate.json
python3 app/workbench.py --workspace /path/to/workspace commit payload.json
python3 app/workbench.py --workspace /path/to/workspace export records records.json
python3 app/workbench.py --workspace /path/to/workspace import records candidate.json --base VERSION
python3 app/workbench.py --workspace /path/to/workspace backup backup.zip
python3 app/workbench.py --workspace /path/to/workspace restore backup.zip --preview
```

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

export function createReadingContentActions({
  deleteAdminReadingContent,
  batchDeleteAdminReadingContents,
  batchUpdateAdminReadingContentsStatus,
  updateAdminReadingContentStatus,
  reloadReadingContents,
  selectedReadingContentRowKeys,
  message,
}) {
  const handleDeleteReadingContent = async (row) => {
    if (row?.has_checkins || row?.is_locked) {
      message.warning("该内容已有打卡记录，不允许删除，请使用停用。");
      return;
    }
    try {
      await deleteAdminReadingContent(row.id);
      message.success("读书内容已删除。");
      await reloadReadingContents();
    } catch (error) {
      message.error(error?.message || "删除读书内容失败。");
    }
  };

  const handleBatchDeleteReadingContents = async () => {
    if (!selectedReadingContentRowKeys.length) {
      message.warning("请先选择要删除的读书内容。");
      return;
    }
    try {
      const result = await batchDeleteAdminReadingContents(selectedReadingContentRowKeys);
      const deletedCount = Array.isArray(result?.deleted_ids) ? result.deleted_ids.length : 0;
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      if (deletedCount) {
        message.success(skippedCount ? `已删除 ${deletedCount} 条，跳过 ${skippedCount} 条。` : `已删除 ${deletedCount} 条读书内容。`);
      } else {
        message.warning(skippedCount ? `没有可删除内容，已跳过 ${skippedCount} 条。` : "没有可删除内容。");
      }
      await reloadReadingContents();
    } catch (error) {
      message.error(error?.message || "批量删除读书内容失败。");
    }
  };

  const handleBatchDisableReadingContents = async () => {
    if (!selectedReadingContentRowKeys.length) {
      message.warning("请先选择要停用的读书内容。");
      return;
    }
    try {
      const result = await batchUpdateAdminReadingContentsStatus(selectedReadingContentRowKeys, "disabled");
      const updatedCount = Array.isArray(result?.updated_ids) ? result.updated_ids.length : 0;
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      if (updatedCount) {
        message.success(skippedCount ? `已停用 ${updatedCount} 条，跳过 ${skippedCount} 条。` : `已停用 ${updatedCount} 条读书内容。`);
      } else {
        message.warning(skippedCount ? `没有可停用内容，已跳过 ${skippedCount} 条。` : "没有可停用内容。");
      }
      await reloadReadingContents();
    } catch (error) {
      message.error(error?.message || "批量停用读书内容失败。");
    }
  };

  const handleToggleReadingContentStatus = async (row) => {
    try {
      await updateAdminReadingContentStatus(row.id, row.status === "active" ? "disabled" : "active");
      message.success(row.status === "active" ? "读书内容已停用。" : "读书内容已启用。");
      await reloadReadingContents();
    } catch (error) {
      message.error(error?.message || "更新读书内容状态失败。");
    }
  };

  return {
    handleDeleteReadingContent,
    handleBatchDeleteReadingContents,
    handleBatchDisableReadingContents,
    handleToggleReadingContentStatus,
  };
}

export default function useReadingContentActions(deps) {
  return createReadingContentActions(deps);
}

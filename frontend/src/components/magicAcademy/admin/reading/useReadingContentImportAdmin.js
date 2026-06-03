import { useState } from "react";

import {
  confirmAdminReadingContentsImport,
  getAdminReadingContentsImportJob,
  previewAdminReadingContentsImport,
  previewAdminReadingContentsImportFromMaterial,
} from "../../../../lib/api.magic";

export default function useReadingContentImportAdmin({
  message,
  reloadReadingContents,
  setReadingContentPage,
}) {
  const [readingImportPreviewOpen, setReadingImportPreviewOpen] = useState(false);
  const [readingImportSubmitting, setReadingImportSubmitting] = useState(false);
  const [readingImportRows, setReadingImportRows] = useState([]);
  const [readingImportSummary, setReadingImportSummary] = useState({ total: 0, valid: 0, invalid: 0 });
  const [readingImportToken, setReadingImportToken] = useState("");
  const [readingImportMaterialPickerOpen, setReadingImportMaterialPickerOpen] = useState(false);

  const handlePreviewReadingImport = async (file) => {
    try {
      setReadingImportSubmitting(true);
      const result = await previewAdminReadingContentsImport(file);
      setReadingImportToken(result?.import_token || "");
      setReadingImportRows(Array.isArray(result?.rows) ? result.rows : []);
      setReadingImportSummary(result?.summary || { total: 0, valid: 0, invalid: 0 });
      setReadingImportPreviewOpen(true);
    } catch (error) {
      message.error(error?.message || "读书内容导入预览失败。");
    } finally {
      setReadingImportSubmitting(false);
    }
    return false;
  };

  const openReadingImportMaterialPicker = () => {
    if (readingImportSubmitting) return;
    setReadingImportMaterialPickerOpen(true);
  };

  const closeReadingImportMaterialPicker = () => {
    if (readingImportSubmitting) return;
    setReadingImportMaterialPickerOpen(false);
  };

  const handlePreviewReadingImportFromMaterialAsset = async (assetId) => {
    try {
      setReadingImportSubmitting(true);
      const result = await previewAdminReadingContentsImportFromMaterial(assetId);
      setReadingImportToken(result?.import_token || "");
      setReadingImportRows(Array.isArray(result?.rows) ? result.rows : []);
      setReadingImportSummary(result?.summary || { total: 0, valid: 0, invalid: 0 });
      setReadingImportPreviewOpen(true);
    } catch (error) {
      message.error(error?.message || "读书内容导入预览失败。");
    } finally {
      setReadingImportSubmitting(false);
    }
  };

  const handlePickReadingImportMaterial = async (asset) => {
    setReadingImportMaterialPickerOpen(false);
    await handlePreviewReadingImportFromMaterialAsset(asset.id);
  };

  const handleConfirmReadingImport = async () => {
    try {
      const validCount = readingImportRows.filter((item) => item.can_import).length;
      if (!validCount) {
        message.warning("没有可导入的有效数据。");
        return;
      }
      if (!readingImportToken) {
        message.warning("导入预览已失效，请重新上传 Excel。");
        return;
      }
      setReadingImportSubmitting(true);
      const job = await confirmAdminReadingContentsImport(readingImportToken);
      const messageKey = `reading-import-${job?.job_id || "pending"}`;
      let current = job;
      message.open({
        key: messageKey,
        type: "loading",
        duration: 0,
        content: `正在导入读书内容 0/${job?.total || validCount}`,
      });
      while (current?.status === "pending" || current?.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
        current = await getAdminReadingContentsImportJob(job.job_id);
        message.open({
          key: messageKey,
          type: "loading",
          duration: 0,
          content: `正在导入读书内容 ${current?.processed || 0}/${current?.total || validCount}`,
        });
      }
      if (current?.status === "completed" || current?.status === "completed_with_errors") {
        if (current?.failure_count) {
          message.open({
            key: messageKey,
            type: "warning",
            content: `导入完成，成功 ${current?.success_count || 0} 条，失败 ${current?.failure_count || 0} 条。`,
          });
        } else {
          message.open({
            key: messageKey,
            type: "success",
            content: `已导入 ${current?.success_count || 0} 条读书内容。`,
          });
        }
      } else {
        throw new Error(current?.error || "读书内容导入失败。");
      }
      setReadingImportPreviewOpen(false);
      setReadingImportToken("");
      setReadingImportRows([]);
      setReadingImportSummary({ total: 0, valid: 0, invalid: 0 });
      await reloadReadingContents({ page: 1 });
      setReadingContentPage(1);
    } catch (error) {
      message.error(error?.message || "读书内容导入失败。");
    } finally {
      setReadingImportSubmitting(false);
    }
  };

  return {
    readingImportPreviewOpen,
    setReadingImportPreviewOpen,
    readingImportSubmitting,
    setReadingImportSubmitting,
    readingImportRows,
    setReadingImportRows,
    readingImportSummary,
    setReadingImportSummary,
    readingImportToken,
    setReadingImportToken,
    readingImportMaterialPickerOpen,
    setReadingImportMaterialPickerOpen,
    handlePreviewReadingImport,
    openReadingImportMaterialPicker,
    closeReadingImportMaterialPicker,
    handlePickReadingImportMaterial,
    handleConfirmReadingImport,
  };
}

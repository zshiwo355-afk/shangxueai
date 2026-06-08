import { useState } from "react";

import {
  completeMagicVideoReplaceUpload,
  completeMagicVideoUpload,
  createMagicVideo,
  failMagicVideoReplaceUpload,
  failMagicVideoUpload,
  getMagicVideoReplaceUploadStatus,
  getMagicVideoUploadStatus,
  initMagicVideoReplaceUpload,
  initMagicVideoUpload,
  updateMagicVideo,
} from "../../../../lib/api.magic";
import {
  buildOssUploadCheckpointKey,
  clearOssUploadCheckpoint,
  loadOssUploadCheckpoint,
  saveOssUploadCheckpoint,
} from "../../../../lib/ossUploadCheckpoint";
import {
  logMagicUploadStageError,
  logOssUploadError,
  multipartUploadToOss,
} from "../../magicAcademyShared";

const buildVideoUploadCheckpointKey = (mode, file, targetVideoId = 0) => buildOssUploadCheckpointKey({
  mode,
  videoId: targetVideoId,
  fileName: file?.name || "",
  fileSize: file?.size || 0,
  lastModified: file?.lastModified || 0,
});

const mergeUploadedParts = (existingParts = [], nextPart) => (
  Array.from(new Map([...existingParts, nextPart].map((item) => [Number(item.part_number), item])).values())
    .sort((a, b) => Number(a.part_number) - Number(b.part_number))
);

const isSameUploadInitPayload = (left, right) => JSON.stringify(left || null) === JSON.stringify(right || null);

const resolveVideoUploadSession = async ({
  checkpointKey,
  file,
  initPayload,
  initUpload,
  fetchUploadStatus,
  discardUploadSession,
}) => {
  const checkpoint = loadOssUploadCheckpoint(checkpointKey);
  if (!checkpoint?.upload_id || !checkpoint?.oss_object_key || !checkpoint?.video_id || !Array.isArray(checkpoint?.part_urls) || !checkpoint.part_urls.length) {
    const initResult = await initUpload();
    saveOssUploadCheckpoint(checkpointKey, {
      file_name: file?.name || "",
      file_size: file?.size || 0,
      file_last_modified: file?.lastModified || 0,
      video_id: initResult.video_id,
      upload_id: initResult.upload_id,
      oss_object_key: initResult.oss_object_key,
      part_size: initResult.part_size,
      part_count: initResult.part_count,
      part_urls: initResult.part_urls || [],
      init_payload: initPayload,
      uploaded_parts: [],
    });
    return { uploadInitResult: initResult, uploadedParts: [], resumed: false };
  }
  if (!isSameUploadInitPayload(checkpoint?.init_payload, initPayload)) {
    try {
      await discardUploadSession?.(checkpoint);
    } catch (error) {
      logMagicUploadStageError("discard stale upload session", error);
    }
    clearOssUploadCheckpoint(checkpointKey);
    const initResult = await initUpload();
    saveOssUploadCheckpoint(checkpointKey, {
      file_name: file?.name || "",
      file_size: file?.size || 0,
      file_last_modified: file?.lastModified || 0,
      video_id: initResult.video_id,
      upload_id: initResult.upload_id,
      oss_object_key: initResult.oss_object_key,
      part_size: initResult.part_size,
      part_count: initResult.part_count,
      part_urls: initResult.part_urls || [],
      init_payload: initPayload,
      uploaded_parts: [],
    });
    return { uploadInitResult: initResult, uploadedParts: [], resumed: false };
  }
  try {
    const statusResult = await fetchUploadStatus(checkpoint);
    const uploadedParts = Array.isArray(statusResult?.uploaded_parts) ? statusResult.uploaded_parts : [];
    const resumedInitResult = {
      video_id: checkpoint.video_id,
      upload_id: checkpoint.upload_id,
      oss_object_key: checkpoint.oss_object_key,
      part_size: checkpoint.part_size,
      part_count: checkpoint.part_count,
      part_urls: checkpoint.part_urls || [],
    };
    saveOssUploadCheckpoint(checkpointKey, { uploaded_parts: uploadedParts });
    return { uploadInitResult: resumedInitResult, uploadedParts, resumed: uploadedParts.length > 0 };
  } catch (error) {
    try {
      await discardUploadSession?.(checkpoint);
    } catch (discardError) {
      logMagicUploadStageError("discard broken upload session", discardError);
    }
    clearOssUploadCheckpoint(checkpointKey);
    const initResult = await initUpload();
    saveOssUploadCheckpoint(checkpointKey, {
      file_name: file?.name || "",
      file_size: file?.size || 0,
      file_last_modified: file?.lastModified || 0,
      video_id: initResult.video_id,
      upload_id: initResult.upload_id,
      oss_object_key: initResult.oss_object_key,
      part_size: initResult.part_size,
      part_count: initResult.part_count,
      part_urls: initResult.part_urls || [],
      init_payload: initPayload,
      uploaded_parts: [],
    });
    return { uploadInitResult: initResult, uploadedParts: [], resumed: false };
  }
};

export default function useCourseVideoUploadAdmin({
  videoModal,
  setVideoModal,
  reloadAdminData,
  message,
}) {
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);

  const submitVideo = async (payload) => {
    let uploadInitResult = null;
    let uploadCompleted = false;
    let uploadCheckpointKey = "";
    let uploadMode = "";
    try {
      setVideoSubmitting(true);
      setVideoUploadProgress(0);
      if (!videoModal?.id && payload.video_source === "material") {
        const metadataPayload = { ...payload };
        delete metadataPayload.selected_file;
        await createMagicVideo(metadataPayload);
        message.success("已从素材库创建课程视频。");
      } else if (videoModal?.id && !payload.selected_file) {
        const metadataPayload = { ...payload };
        delete metadataPayload.selected_file;
        await updateMagicVideo(videoModal.id, metadataPayload);
        message.success("视频元数据已更新。");
      } else if (videoModal?.id && payload.selected_file) {
        const file = payload.selected_file;
        try {
          uploadMode = "replace";
          uploadCheckpointKey = buildVideoUploadCheckpointKey("replace", file, videoModal.id);
          const session = await resolveVideoUploadSession({
            checkpointKey: uploadCheckpointKey,
            file,
            initPayload: {
              original_filename: payload.original_filename,
              file_size: file.size,
              mime_type: file.type || payload.mime_type || "video/mp4",
              duration_seconds: Number(payload.duration_seconds || 0),
            },
            initUpload: () => initMagicVideoReplaceUpload(videoModal.id, {
              original_filename: payload.original_filename,
              file_size: file.size,
              mime_type: file.type || payload.mime_type || "video/mp4",
              duration_seconds: Number(payload.duration_seconds || 0),
            }),
            fetchUploadStatus: (checkpoint) => getMagicVideoReplaceUploadStatus(videoModal.id, {
              video_id: checkpoint.video_id,
              oss_object_key: checkpoint.oss_object_key,
              upload_id: checkpoint.upload_id,
            }),
            discardUploadSession: async (checkpoint) => {
              if (!checkpoint?.video_id || !checkpoint?.oss_object_key || !checkpoint?.upload_id) return;
              await failMagicVideoReplaceUpload(videoModal.id, {
                oss_object_key: checkpoint.oss_object_key,
                upload_id: checkpoint.upload_id,
                reason: "断点续传会话失效，已重新初始化上传。",
              });
            },
          });
          uploadInitResult = session.uploadInitResult;
          if (session.resumed) {
            message.info("已恢复上次未完成的视频替换上传。");
          }
        } catch (error) {
          logMagicUploadStageError("replace init", error);
          message.error(error?.message || "新视频替换初始化失败。");
          return;
        }

        let parts;
        try {
          const checkpoint = loadOssUploadCheckpoint(uploadCheckpointKey);
          parts = await multipartUploadToOss(file, uploadInitResult, setVideoUploadProgress, {
            existingParts: checkpoint?.uploaded_parts || [],
            onPartUploaded: (part) => {
              const current = loadOssUploadCheckpoint(uploadCheckpointKey);
              saveOssUploadCheckpoint(uploadCheckpointKey, {
                uploaded_parts: mergeUploadedParts(current?.uploaded_parts || [], part),
              });
            },
          });
        } catch (error) {
          logMagicUploadStageError("replace oss upload", error);
          logOssUploadError(error);
          if (uploadInitResult?.video_id && uploadInitResult?.oss_object_key && uploadInitResult?.upload_id) {
            try {
              await failMagicVideoReplaceUpload(uploadInitResult.video_id, {
                oss_object_key: uploadInitResult.oss_object_key,
                upload_id: uploadInitResult.upload_id,
                reason: error?.message || "OSS 上传失败",
              });
            } catch (failError) {
              logMagicUploadStageError("replace upload fail callback", failError);
            }
          }
          clearOssUploadCheckpoint(uploadCheckpointKey);
          message.error(error?.message || "新视频上传失败，原视频未被替换。");
          return;
        }

        try {
          await completeMagicVideoReplaceUpload(videoModal.id, {
            oss_object_key: uploadInitResult.oss_object_key,
            file_size: file.size,
            upload_id: uploadInitResult.upload_id,
            parts,
            title: payload.title,
            description: payload.description || "",
            category: payload.category || "",
            duration_seconds: Number(payload.duration_seconds || 0),
            is_required: !!payload.is_required,
            is_newcomer_required: !!payload.is_newcomer_required,
            reward_points: Number(payload.reward_points ?? 15),
            status: payload.status,
            cover_url: payload.cover_url || "",
            targets: payload.targets || [],
          });
          clearOssUploadCheckpoint(uploadCheckpointKey);
          uploadCompleted = true;
          setVideoUploadProgress(100);
          message.success("视频已重新上传并覆盖。");
        } catch (error) {
          logMagicUploadStageError("replace complete", error);
          if (uploadInitResult?.video_id && uploadInitResult?.oss_object_key && uploadInitResult?.upload_id) {
            try {
              await failMagicVideoReplaceUpload(uploadInitResult.video_id, {
                oss_object_key: uploadInitResult.oss_object_key,
                upload_id: uploadInitResult.upload_id,
                reason: error?.message || "完成替换上传失败。",
              });
            } catch (failError) {
              logMagicUploadStageError("replace upload fail callback", failError);
            }
          }
          clearOssUploadCheckpoint(uploadCheckpointKey);
          message.error(error?.message || "新视频上传失败，原视频未被替换。");
          return;
        }
      } else {
        const file = payload.selected_file;
        try {
          uploadMode = "create";
          uploadCheckpointKey = buildVideoUploadCheckpointKey("create", file, 0);
          const session = await resolveVideoUploadSession({
            checkpointKey: uploadCheckpointKey,
            file,
            initPayload: {
              title: payload.title,
              description: payload.description || "",
              category: payload.category || "",
              original_filename: payload.original_filename,
              file_size: file.size,
              mime_type: file.type || payload.mime_type || "video/mp4",
              duration_seconds: Number(payload.duration_seconds || 0),
              is_required: !!payload.is_required,
              is_newcomer_required: !!payload.is_newcomer_required,
              reward_points: Number(payload.reward_points ?? 15),
              status: payload.status,
              cover_url: payload.cover_url || "",
              targets: payload.targets || [],
            },
            initUpload: () => initMagicVideoUpload({
              title: payload.title,
              description: payload.description || "",
              category: payload.category || "",
              original_filename: payload.original_filename,
              file_size: file.size,
              mime_type: file.type || payload.mime_type || "video/mp4",
              duration_seconds: Number(payload.duration_seconds || 0),
              is_required: !!payload.is_required,
              is_newcomer_required: !!payload.is_newcomer_required,
              reward_points: Number(payload.reward_points ?? 15),
              status: payload.status,
              cover_url: payload.cover_url || "",
              targets: payload.targets || [],
            }),
            fetchUploadStatus: (checkpoint) => getMagicVideoUploadStatus({
              video_id: checkpoint.video_id,
              oss_object_key: checkpoint.oss_object_key,
              upload_id: checkpoint.upload_id,
            }),
            discardUploadSession: async (checkpoint) => {
              if (!checkpoint?.video_id || !checkpoint?.oss_object_key || !checkpoint?.upload_id) return;
              await failMagicVideoUpload({
                video_id: checkpoint.video_id,
                oss_object_key: checkpoint.oss_object_key,
                upload_id: checkpoint.upload_id,
                reason: "断点续传会话失效，已重新初始化上传。",
              });
            },
          });
          uploadInitResult = session.uploadInitResult;
          if (session.resumed) {
            message.info("已恢复上次未完成的视频上传。");
          }
        } catch (error) {
          logMagicUploadStageError("init", error);
          message.error(error?.message || "上传初始化失败。");
          return;
        }

        let parts;
        try {
          const checkpoint = loadOssUploadCheckpoint(uploadCheckpointKey);
          parts = await multipartUploadToOss(file, uploadInitResult, setVideoUploadProgress, {
            existingParts: checkpoint?.uploaded_parts || [],
            onPartUploaded: (part) => {
              const current = loadOssUploadCheckpoint(uploadCheckpointKey);
              saveOssUploadCheckpoint(uploadCheckpointKey, {
                uploaded_parts: mergeUploadedParts(current?.uploaded_parts || [], part),
              });
            },
          });
        } catch (error) {
          logMagicUploadStageError("oss upload", error);
          logOssUploadError(error);
          if (uploadInitResult?.video_id && uploadInitResult?.oss_object_key) {
            try {
              await failMagicVideoUpload({
                video_id: uploadInitResult.video_id,
                oss_object_key: uploadInitResult.oss_object_key,
                upload_id: uploadInitResult.upload_id,
                reason: error?.message || "OSS 上传失败",
              });
            } catch (failError) {
              logMagicUploadStageError("upload fail callback", failError);
            }
          }
          clearOssUploadCheckpoint(uploadCheckpointKey);
          message.error(error?.message || "视频文件上传 OSS 失败。");
          return;
        }

        try {
          await completeMagicVideoUpload({
            video_id: uploadInitResult.video_id,
            oss_object_key: uploadInitResult.oss_object_key,
            file_size: file.size,
            upload_id: uploadInitResult.upload_id,
            parts,
          });
          clearOssUploadCheckpoint(uploadCheckpointKey);
          uploadCompleted = true;
          setVideoUploadProgress(100);
          message.success("视频已上传并入库。");
        } catch (error) {
          logMagicUploadStageError("complete", error);
          if (uploadInitResult?.video_id && uploadInitResult?.oss_object_key) {
            try {
              await failMagicVideoUpload({
                video_id: uploadInitResult.video_id,
                oss_object_key: uploadInitResult.oss_object_key,
                upload_id: uploadInitResult.upload_id,
                reason: error?.message || "完成视频上传失败。",
              });
            } catch (failError) {
              logMagicUploadStageError("upload fail callback", failError);
            }
          }
          clearOssUploadCheckpoint(uploadCheckpointKey);
          message.error(error?.message || "视频上传完成确认失败。");
          return;
        }
      }
      setVideoModal(null);
      try {
        await reloadAdminData();
      } catch (error) {
        logMagicUploadStageError("refresh list", error);
        if (uploadCompleted) {
          message.warning("视频已上传成功，但列表刷新失败，请手动刷新页面。");
          return;
        }
        throw error;
      }
    } catch (error) {
      logMagicUploadStageError("submit video", error);
      clearOssUploadCheckpoint(uploadCheckpointKey);
      if (!uploadCompleted && uploadInitResult?.video_id && uploadInitResult?.oss_object_key) {
        try {
          if (uploadMode === "replace") {
            await failMagicVideoReplaceUpload(uploadInitResult.video_id, {
              oss_object_key: uploadInitResult.oss_object_key,
              upload_id: uploadInitResult.upload_id,
              reason: error?.message || "上传失败",
            });
          } else if (uploadMode === "create") {
            await failMagicVideoUpload({
              video_id: uploadInitResult.video_id,
              oss_object_key: uploadInitResult.oss_object_key,
              upload_id: uploadInitResult.upload_id,
              reason: error?.message || "上传失败",
            });
          }
        } catch (failError) {
          logMagicUploadStageError("upload fail callback", failError);
        }
      }
      message.error(error?.message || "保存失败。");
    } finally {
      setVideoSubmitting(false);
      setVideoUploadProgress(0);
    }
  };

  return {
    submitVideo,
    videoSubmitting,
    videoUploadProgress,
  };
}

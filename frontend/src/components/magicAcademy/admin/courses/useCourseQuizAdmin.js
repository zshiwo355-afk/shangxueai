import { useCallback, useState } from "react";

import {
  createMagicQuestion,
  createMagicQuizPoint,
  deleteMagicQuestion,
  deleteMagicQuizPoint,
  listMagicQuizPoints,
  updateMagicQuestion,
  updateMagicQuizPoint,
} from "../../../../lib/api.magic";

export default function useCourseQuizAdmin({
  pointForm,
  quizVideoId,
  setQuizPoints,
  message,
}) {
  const [pointModal, setPointModal] = useState(null);
  const [questionModal, setQuestionModal] = useState(null);
  const [quizImportState, setQuizImportState] = useState({ open: false, pointId: null, source: "upload" });

  const submitPoint = useCallback(async () => {
    const values = await pointForm.validateFields();
    try {
      if (pointModal?.id) {
        await updateMagicQuizPoint(pointModal.id, values);
      } else {
        await createMagicQuizPoint(quizVideoId, values);
      }
      message.success("节点已保存。");
      setPointModal(null);
      setQuizPoints(await listMagicQuizPoints(quizVideoId));
    } catch (error) {
      message.error(error?.message || "保存节点失败。");
    }
  }, [message, pointForm, pointModal, quizVideoId, setQuizPoints]);

  const submitQuestion = useCallback(async (pointId, payload, editing) => {
    try {
      if (editing?.id) await updateMagicQuestion(editing.id, payload);
      else await createMagicQuestion(pointId, payload);
      message.success("题目已保存。");
      setQuestionModal(null);
      setQuizPoints(await listMagicQuizPoints(quizVideoId));
    } catch (error) {
      message.error(error?.message || "保存题目失败。");
    }
  }, [message, quizVideoId, setQuizPoints]);

  const handleQuizImportCommitted = useCallback(async () => {
    setQuizImportState({ open: false, pointId: null, source: "upload" });
    setQuizPoints(await listMagicQuizPoints(quizVideoId));
  }, [quizVideoId, setQuizPoints]);

  const handleDeleteQuizQuestion = useCallback(async (questionId, targetVideoId) => {
    await deleteMagicQuestion(questionId);
    setQuizPoints(await listMagicQuizPoints(targetVideoId));
  }, [setQuizPoints]);

  const handleDeleteQuizPoint = useCallback(async (pointId, targetVideoId) => {
    await deleteMagicQuizPoint(pointId);
    setQuizPoints(await listMagicQuizPoints(targetVideoId));
  }, [setQuizPoints]);

  return {
    pointModal,
    setPointModal,
    questionModal,
    setQuestionModal,
    quizImportState,
    setQuizImportState,
    submitPoint,
    submitQuestion,
    handleQuizImportCommitted,
    handleDeleteQuizQuestion,
    handleDeleteQuizPoint,
  };
}

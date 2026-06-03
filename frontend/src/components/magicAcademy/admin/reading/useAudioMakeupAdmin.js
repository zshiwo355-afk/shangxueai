import { useState } from "react";

import { updateMagicAudioMakeupSetting } from "../../../../lib/api.magic";

export default function useAudioMakeupAdmin({
  message,
}) {
  const [audioMakeupSetting, setAudioMakeupSetting] = useState({ enabled: false, make_up_days: 0, description: "" });

  const handleSaveAudioMakeupSetting = async () => {
    try {
      const nextPayload = {
        enabled: !!audioMakeupSetting.enabled,
        make_up_days: Number(audioMakeupSetting.make_up_days || 0),
        audio_random_window_minutes: Number(audioMakeupSetting.audio_random_window_minutes || 0),
        video_random_window_minutes: Number(audioMakeupSetting.video_random_window_minutes || 0),
      };
      const data = await updateMagicAudioMakeupSetting(nextPayload);
      setAudioMakeupSetting(data || nextPayload);
      message.success("补卡设置已保存。");
    } catch (error) {
      message.error(error?.message || "补卡设置保存失败。");
    }
  };

  return {
    audioMakeupSetting,
    setAudioMakeupSetting,
    handleSaveAudioMakeupSetting,
  };
}

import unittest
from unittest.mock import patch

from app.magic_academy_api._oss import (
    _build_signed_inline_url,
    _ensure_audio_object_content_type,
    _normalize_audio_response_mime,
)


class _FakeBucket:
    def __init__(self):
        self.updated = []

    def sign_url(self, method, object_key, expire_seconds, *, params, slash_safe):
        return {
            "method": method,
            "object_key": object_key,
            "expire_seconds": expire_seconds,
            "params": params,
            "slash_safe": slash_safe,
        }

    def update_object_meta(self, object_key, headers):
        self.updated.append((object_key, headers))


class MagicAudioPlaybackTests(unittest.TestCase):
    def test_m4a_uses_browser_compatible_audio_mp4_mime(self) -> None:
        self.assertEqual(
            _normalize_audio_response_mime("audio/x-m4a", "voice.m4a"),
            "audio/mp4",
        )

    def test_filename_repairs_missing_or_generic_mime(self) -> None:
        self.assertEqual(
            _normalize_audio_response_mime("application/octet-stream", "voice.mp3"),
            "audio/mpeg",
        )

    @patch("app.magic_academy_api._oss._build_oss_bucket", return_value=_FakeBucket())
    def test_signed_playback_url_does_not_use_rejected_content_type_override(self, _mock_bucket) -> None:
        result = _build_signed_inline_url(
            "reading/audio/voice.m4a",
            mime_type="audio/x-m4a",
            filename="voice.m4a",
        )

        self.assertNotIn("response-content-type", result["params"])
        self.assertTrue(result["params"]["response-content-disposition"].startswith("inline"))

    def test_legacy_m4a_repairs_oss_object_metadata(self) -> None:
        bucket = _FakeBucket()
        with patch("app.magic_academy_api._oss._build_oss_bucket", return_value=bucket):
            normalized = _ensure_audio_object_content_type(
                "reading/audio/voice.m4a",
                mime_type="audio/x-m4a",
                filename="voice.m4a",
            )

        self.assertEqual(normalized, "audio/mp4")
        self.assertEqual(
            bucket.updated,
            [("reading/audio/voice.m4a", {"Content-Type": "audio/mp4"})],
        )


if __name__ == "__main__":
    unittest.main()

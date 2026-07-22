import unittest

from app.personality_assessments_api import _with_fixed_behavior_reference
from app.personality_scoring import get_public_questionnaire, get_rules, score_assessment


def favorable_answers() -> dict[str, str]:
    answers = {}
    for question in get_rules("personality-v1")["questions"]:
        if question["kind"] in {"personality", "behavior"}:
            answers[question["id"]] = "weak" if question["direction"] == "reverse" else "strong"
    answers.update(
        {
            "Q41": "rather_strong",
            "Q42": "strong",
            "Q43": "strong",
            "Q44": "weak",
            "Q45": "rather_weak",
        }
    )
    return answers


class PersonalityScoringTests(unittest.TestCase):
    def test_favorable_answers_reach_full_behavior_score(self) -> None:
        result = score_assessment(favorable_answers(), duration_seconds=720, version="personality-v1")

        self.assertEqual(result["overall_score"], 100.0)
        self.assertTrue(all(score == 100.0 for score in result["behavior_scores"].values()))
        self.assertEqual(result["credibility"]["score"], 100)
        self.assertEqual(result["risks"], [])

    def test_reverse_items_and_risks_are_scored_from_fixed_rules(self) -> None:
        answers = favorable_answers()
        answers["Q28"] = "strong"
        answers["Q31"] = "strong"
        answers["Q35"] = "strong"
        result = score_assessment(answers, version="personality-v1")

        self.assertEqual(result["behavior_scores"]["责任与执行"], 66.7)
        self.assertEqual(result["behavior_scores"]["主动沟通"], 66.7)
        self.assertEqual(result["behavior_scores"]["流程意识"], 66.7)
        self.assertEqual(
            [risk["question_id"] for risk in result["risks"]],
            ["Q28", "Q31", "Q35"],
        )
        self.assertEqual(result["risks"][0]["answer_label"], "强")

    def test_same_answers_always_produce_same_scores(self) -> None:
        answers = favorable_answers()

        self.assertEqual(
            score_assessment(answers, version="personality-v1"),
            score_assessment(dict(answers), version="personality-v1"),
        )

    def test_duration_only_flags_credibility_without_deducting_points(self) -> None:
        result = score_assessment(favorable_answers(), duration_seconds=120, version="personality-v1")

        self.assertEqual(result["credibility"]["score"], 100)
        self.assertTrue(result["credibility"]["duration_flag"])


def v2_answers() -> dict[str, object]:
    answers: dict[str, object] = {}
    for question in get_rules("personality-v2")["questions"]:
        if question["response_type"] == "most_least":
            answers[question["id"]] = {"most": "A", "least": "B"}
        elif question["response_type"] == "text":
            answers[question["id"]] = "这是一次真实发生的经历，我说明了取舍依据并复盘了最后结果。"
        else:
            answers[question["id"]] = "4"
    return answers


class PersonalityScoringV2Tests(unittest.TestCase):
    def test_v2_has_56_questions_and_no_overall_score(self) -> None:
        questionnaire = get_public_questionnaire("personality-v2")
        result = score_assessment(v2_answers(), duration_seconds=1200, version="personality-v2")

        self.assertEqual(questionnaire["question_count"], 56)
        self.assertIsNone(result["overall_score"])
        self.assertEqual(len(result["norm_percentiles"]), 5)
        self.assertEqual(len(result["behavior_scores"]), 6)

    def test_public_questionnaire_hides_dimensions_and_scoring_keys(self) -> None:
        questionnaire = get_public_questionnaire("personality-v2")
        questions = [question for section in questionnaire["sections"] for question in section["questions"]]

        self.assertTrue(all("dimension" not in question and "direction" not in question for question in questions))
        workplace = next(question for question in questions if question["id"] == "W01")
        self.assertTrue(all(set(option) == {"value", "label"} for option in workplace["options"]))

    def test_personality_order_interleaves_similar_dimensions(self) -> None:
        rules = get_rules("personality-v2")
        questions = {question["id"]: question for question in rules["questions"]}
        personality_order = [question_id for section in rules["sections"][:4] for question_id in section["question_ids"]]
        dimensions = [questions[question_id]["dimension"] for question_id in personality_order]

        self.assertTrue(all(left != right for left, right in zip(dimensions, dimensions[1:])))
        self.assertEqual(len({next(section["id"] for section in rules["sections"] if question_id in section["question_ids"]) for question_id in ("P10", "P11", "P12")}), 3)

    def test_norm_percentile_uses_only_the_15_core_items(self) -> None:
        answers = v2_answers()
        first = score_assessment(answers, version="personality-v2")
        for question in get_rules("personality-v2")["questions"]:
            if question["kind"] == "personality_context":
                answers[question["id"]] = "1"
        second = score_assessment(answers, version="personality-v2")

        self.assertEqual(first["norm_percentiles"], second["norm_percentiles"])
        self.assertNotEqual(first["personality_context_scores"], second["personality_context_scores"])

    def test_most_and_least_cannot_be_the_same_option(self) -> None:
        answers = v2_answers()
        answers["W01"] = {"most": "A", "least": "A"}

        with self.assertRaisesRegex(ValueError, "W01"):
            score_assessment(answers, version="personality-v2")

    def test_workplace_module_is_relative_and_deterministic(self) -> None:
        answers = v2_answers()
        result = score_assessment(answers, version="personality-v2")

        self.assertEqual(result, score_assessment(dict(answers), version="personality-v2"))
        self.assertIn("不存在满分", result["overall_basis"])


def v3_answers() -> dict[str, object]:
    answers: dict[str, object] = {}
    for question in get_rules("personality-v3")["questions"]:
        answers[question["id"]] = "A" if question["response_type"] == "single_choice" else "4"
    return answers


class PersonalityScoringV3Tests(unittest.TestCase):
    def test_v3_structure_matches_confirmed_54_question_plan(self) -> None:
        rules = get_rules("personality-v3")
        questionnaire = get_public_questionnaire("personality-v3")
        kinds = [question["kind"] for question in rules["questions"]]
        response_types = [question["response_type"] for question in rules["questions"]]

        self.assertEqual(questionnaire["question_count"], 54)
        self.assertEqual(kinds.count("personality") + kinds.count("personality_context"), 30)
        self.assertEqual(kinds.count("workplace_likert"), 11)
        self.assertEqual(kinds.count("workplace_choice"), 9)
        self.assertEqual(kinds.count("credibility"), 4)
        self.assertNotIn("most_least", response_types)
        self.assertNotIn("text", response_types)

    def test_v3_uses_all_11_pages_markers(self) -> None:
        questions = [question for question in get_rules("personality-v3")["questions"] if question["kind"] == "workplace_likert"]

        self.assertEqual(sum(question["source_marker"] == "color" for question in questions), 3)
        self.assertEqual(sum(question["source_marker"] == "leading_space" for question in questions), 8)
        self.assertIn("和合作方存在利益分歧时，我会坚守我方利益。", {question["prompt"] for question in questions})

    def test_v3_scores_only_likert_workplace_items(self) -> None:
        answers = v3_answers()
        first = score_assessment(answers, version="personality-v3")
        for question in get_rules("personality-v3")["questions"]:
            if question["response_type"] == "single_choice":
                answers[question["id"]] = "D"
        second = score_assessment(answers, version="personality-v3")

        self.assertIsNone(first["overall_score"])
        self.assertEqual(first["behavior_scores"], second["behavior_scores"])
        self.assertNotEqual(first["workplace_choices"], second["workplace_choices"])
        self.assertEqual(len(first["workplace_choices"]), 9)

    def test_v3_uses_fixed_dimension_specific_workplace_reference(self) -> None:
        result = score_assessment(v3_answers(), version="personality-v3")
        reference = result["behavior_reference"]

        self.assertEqual(reference["version"], "sapa-employed-proxy-v1-fixed-minus-15")
        self.assertEqual(
            reference["scores"],
            {
                "长期投入": 54.5,
                "诚信履约": 65.7,
                "节奏适应": 46.0,
                "专业成长": 65.5,
                "客户意识": 59.5,
                "协作共益": 58.9,
            },
        )
        self.assertEqual(sum(len(items) for items in reference["mapped_items"].values()), 24)
        self.assertEqual(
            _with_fixed_behavior_reference({"rules_version": "personality-v2"})["behavior_reference"]["scores"],
            reference["scores"],
        )


if __name__ == "__main__":
    unittest.main()

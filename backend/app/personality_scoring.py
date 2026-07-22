from __future__ import annotations

import json
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any


RULES_DIR = Path(__file__).with_name("personality_rules")
CURRENT_RULES_VERSION = "personality-v3"
RULE_FILES = {
    "personality-v1": RULES_DIR / "v1.json",
    "personality-v2": RULES_DIR / "v2.json",
    "personality-v3": RULES_DIR / "v3.json",
}


@lru_cache(maxsize=len(RULE_FILES))
def get_rules(version: str | None = None) -> dict[str, Any]:
    selected = version or CURRENT_RULES_VERSION
    path = RULE_FILES.get(selected)
    if not path:
        raise ValueError(f"不支持的测评规则版本：{selected}")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _get_norms() -> dict[str, Any]:
    return json.loads((RULES_DIR / "cbf_pi_15_norms.json").read_text(encoding="utf-8"))


def get_public_questionnaire(version: str | None = None) -> dict[str, Any]:
    rules = get_rules(version)
    questions: dict[str, dict[str, Any]] = {}
    for question in rules["questions"]:
        public = {
            "id": question["id"],
            "prompt": question["prompt"],
            "response_type": question.get("response_type", "likert5"),
        }
        if question.get("options"):
            public["options"] = [
                {"value": option["value"], "label": option["label"]}
                for option in question["options"]
            ]
        for key in ("min_length", "max_length"):
            if key in question:
                public[key] = question[key]
        questions[question["id"]] = public
    sections = [
        {
            **section,
            "questions": [questions[question_id] for question_id in section["question_ids"]],
        }
        for section in rules["sections"]
    ]
    return {
        "version": rules["version"],
        "title": rules["title"],
        "estimated_minutes": rules["estimated_minutes"],
        "response_instruction": rules["response_instruction"],
        "response_options": [
            {key: option[key] for key in ("value", "label", "hint")}
            for option in rules["response_options"]
        ],
        "sections": sections,
        "question_count": len(rules["questions"]),
        "disclaimer": rules["disclaimer"],
    }


def _answer_maps(rules: dict[str, Any]) -> tuple[dict[str, int], dict[str, str]]:
    scores = {option["value"]: int(option["score"]) for option in rules["response_options"]}
    labels = {option["value"]: option["label"] for option in rules["response_options"]}
    return scores, labels


def _is_valid_answer(question: dict[str, Any], value: Any, rules: dict[str, Any], complete: bool) -> bool:
    response_type = question.get("response_type", "likert5")
    if response_type in {"likert5", "likert6"}:
        return isinstance(value, str) and value in _answer_maps(rules)[0]
    if response_type == "single_choice":
        valid = {option["value"] for option in question.get("options", [])}
        return isinstance(value, str) and value in valid
    if response_type == "most_least":
        if not isinstance(value, dict):
            return False
        most, least = value.get("most"), value.get("least")
        if not complete and not most and not least:
            return False
        if not complete and (not most or not least):
            valid = {option["value"] for option in question["options"]}
            chosen = most or least
            return chosen in valid
        valid = {option["value"] for option in question["options"]}
        return most in valid and least in valid and most != least
    if response_type == "text":
        if not isinstance(value, str):
            return False
        length = len(value.strip())
        if not complete:
            return length <= int(question.get("max_length", 1500))
        return int(question.get("min_length", 1)) <= length <= int(question.get("max_length", 1500))
    return False


def _validate_answers(answers: dict[str, Any], version: str | None, complete: bool) -> None:
    rules = get_rules(version)
    questions = {question["id"]: question for question in rules["questions"]}
    missing = [question_id for question_id in questions if question_id not in answers]
    invalid = [
        question_id
        for question_id, value in answers.items()
        if question_id not in questions or not _is_valid_answer(questions.get(question_id, {}), value, rules, complete)
    ]
    if complete and missing:
        raise ValueError(f"还有 {len(missing)} 道题未作答：{', '.join(missing)}")
    if invalid:
        raise ValueError(f"存在无效或未完成的答案：{', '.join(sorted(invalid))}")


def validate_complete_answers(answers: dict[str, Any], version: str | None = None) -> None:
    _validate_answers(answers, version, complete=True)


def validate_partial_answers(answers: dict[str, Any], version: str | None = None) -> None:
    _validate_answers(answers, version, complete=False)


def build_answer_details(answers: dict[str, Any], version: str | None = None) -> list[dict[str, Any]]:
    rules = get_rules(version)
    raw_scores, labels = _answer_maps(rules)
    details = []
    for question in rules["questions"]:
        answer = answers.get(question["id"])
        response_type = question.get("response_type", "likert5")
        if response_type == "most_least" and isinstance(answer, dict):
            option_labels = {option["value"]: option["label"] for option in question["options"]}
            answer_label = f"最像：{option_labels.get(answer.get('most'), '—')}；最不像：{option_labels.get(answer.get('least'), '—')}"
        elif response_type == "single_choice":
            option_labels = {option["value"]: option["label"] for option in question["options"]}
            answer_label = option_labels.get(answer, "")
        elif response_type == "text":
            answer_label = answer
        else:
            answer_label = labels.get(answer, "")
        details.append(
            {
                "question_id": question["id"],
                "prompt": question["prompt"],
                "response_type": response_type,
                "answer": answer,
                "answer_label": answer_label,
                "raw_score": raw_scores.get(answer) if isinstance(answer, str) else None,
            }
        )
    return details


def _normalized_dimension_scores(
    rules: dict[str, Any], answers: dict[str, Any], kind: str, dimensions: list[str]
) -> dict[str, float]:
    raw_scores, _ = _answer_maps(rules)
    result: dict[str, float] = {}
    for dimension in dimensions:
        weighted_total = 0.0
        total_weight = 0.0
        for question in rules["questions"]:
            if question["kind"] != kind or question["dimension"] != dimension:
                continue
            raw_score = raw_scores[answers[question["id"]]]
            scored_value = 6 - raw_score if question["direction"] == "reverse" else raw_score
            weight = float(question["weight"])
            weighted_total += scored_value * weight
            total_weight += weight
        average = weighted_total / total_weight
        result[dimension] = round((average - 1) / 4 * 100, 1)
    return result


def _credibility_v1(rules: dict[str, Any], answers: dict[str, Any], duration_seconds: int | None) -> dict[str, Any]:
    raw_scores, labels = _answer_maps(rules)
    checks: list[dict[str, Any]] = []
    for question in rules["questions"]:
        check_type = question.get("check_type")
        if not check_type:
            continue
        raw_score = raw_scores[answers[question["id"]]]
        if check_type == "attention":
            passed = raw_score == question["expected_score"]
        elif check_type == "consistency":
            compared_score = raw_scores[answers[question["compare_question_id"]]]
            expected_score = 6 - compared_score if question["compare_direction"] == "reverse" else compared_score
            passed = abs(raw_score - expected_score) <= 1
        else:
            passed = raw_score <= question["max_pass_score"]
        checks.append({"question_id": question["id"], "check_type": check_type, "passed": passed, "answer_label": labels[answers[question["id"]]]})
    passed_count = sum(1 for check in checks if check["passed"])
    score = round(passed_count / len(checks) * 100)
    duration_flag = duration_seconds is not None and duration_seconds < 360
    return {
        "score": score,
        "status": "正常" if score >= 80 else "建议核实" if score >= 60 else "谨慎解读",
        "passed_checks": passed_count,
        "total_checks": len(checks),
        "checks": checks,
        "duration_seconds": duration_seconds,
        "duration_flag": duration_flag,
        "duration_note": "完成时间较短，建议结合面试核实。" if duration_flag else None,
    }


def _risk_evidence_v1(rules: dict[str, Any], answers: dict[str, Any]) -> list[dict[str, Any]]:
    raw_scores, labels = _answer_maps(rules)
    questions = {question["id"]: question for question in rules["questions"]}
    risks = []
    for risk in rules["risk_rules"]:
        answer_value = answers[risk["question_id"]]
        raw_score = raw_scores[answer_value]
        triggered = raw_score <= risk["threshold"] if risk["operator"] == "lte" else raw_score >= risk["threshold"]
        if triggered:
            question = questions[risk["question_id"]]
            risks.append({"id": risk["id"], "label": risk["label"], "question_id": risk["question_id"], "prompt": question["prompt"], "answer": answer_value, "answer_label": labels[answer_value], "raw_score": raw_score})
    return risks


def _score_v1(rules: dict[str, Any], answers: dict[str, Any], duration_seconds: int | None) -> dict[str, Any]:
    personality_scores = _normalized_dimension_scores(rules, answers, "personality", rules["personality_dimensions"])
    behavior_scores = _normalized_dimension_scores(rules, answers, "behavior", rules["behavior_dimensions"])
    overall_score = round(sum(behavior_scores.values()) / len(behavior_scores), 1)
    strongest = max(rules["personality_dimensions"], key=lambda dimension: personality_scores[dimension])
    return {
        "rules_version": rules["version"], "overall_score": overall_score,
        "overall_basis": "五项职场行为维度等权计算，每项权重20%；人格倾向不计入总分。",
        "personality_scores": personality_scores, "behavior_scores": behavior_scores,
        "radar_scores": personality_scores, "profile_label": rules["profile_labels"][strongest],
        "profile_basis_dimension": strongest, "credibility": _credibility_v1(rules, answers, duration_seconds),
        "risks": _risk_evidence_v1(rules, answers), "disclaimer": rules["disclaimer"],
    }


def _percentile(dimension: str, raw_score: int) -> int:
    norms = _get_norms()
    counts = {int(key): value for key, value in norms["counts"][dimension].items()}
    below = sum(count for score, count in counts.items() if score < raw_score)
    return round((below + counts.get(raw_score, 0) / 2) / norms["sample_size"] * 100)


def _personality_v2(rules: dict[str, Any], answers: dict[str, Any]) -> tuple[dict[str, float], dict[str, int], dict[str, float]]:
    raw_scores, _ = _answer_maps(rules)
    core: dict[str, list[int]] = {dimension: [] for dimension in rules["personality_dimensions"]}
    context: dict[str, list[int]] = {dimension: [] for dimension in rules["personality_dimensions"]}
    for question in rules["questions"]:
        if question["kind"] not in {"personality", "personality_context"}:
            continue
        value = raw_scores[answers[question["id"]]]
        scored = 7 - value if question["direction"] == "reverse" else value
        target = core if question["kind"] == "personality" else context
        target[question["dimension"]].append(scored)
    raw_totals = {dimension: sum(values) for dimension, values in core.items()}
    scores = {dimension: round((raw_totals[dimension] - 3) / 15 * 100, 1) for dimension in raw_totals}
    percentiles = {dimension: _percentile(dimension, raw_totals[dimension]) for dimension in raw_totals}
    context_scores = {dimension: round((sum(values) / len(values) - 1) / 5 * 100, 1) for dimension, values in context.items()}
    return scores, percentiles, context_scores


def _workplace_v2(rules: dict[str, Any], answers: dict[str, Any]) -> tuple[dict[str, float], dict[str, str]]:
    net = Counter({dimension: 0 for dimension in rules["behavior_dimensions"]})
    exposure = Counter({dimension: 0 for dimension in rules["behavior_dimensions"]})
    for question in rules["questions"]:
        if question["kind"] != "workplace":
            continue
        options = {option["value"]: option for option in question["options"]}
        for option in options.values():
            exposure[option["dimension"]] += 1
        answer = answers[question["id"]]
        net[options[answer["most"]]["dimension"]] += 1
        net[options[answer["least"]]["dimension"]] -= 1
    scores = {
        dimension: round(max(0, min(100, 50 + 50 * net[dimension] / exposure[dimension])), 1)
        for dimension in rules["behavior_dimensions"]
    }
    bands = {dimension: "相对突出" if value >= 65 else "相对靠后" if value <= 35 else "居中" for dimension, value in scores.items()}
    return scores, bands


def _credibility_v2(rules: dict[str, Any], answers: dict[str, Any], duration_seconds: int | None) -> dict[str, Any]:
    raw_scores, _ = _answer_maps(rules)
    checks = []
    for question in rules["questions"]:
        if question.get("check_type") != "consistency":
            continue
        actual = raw_scores[answers[question["id"]]]
        compared = raw_scores[answers[question["compare_question_id"]]]
        expected = 7 - compared if question["compare_direction"] == "reverse" else compared
        checks.append({"question_id": question["id"], "check_type": "consistency", "passed": abs(actual - expected) <= 1, "difference": abs(actual - expected)})
    personality_values = [answers[q["id"]] for q in rules["questions"] if q["kind"] in {"personality", "personality_context"}]
    most_common = Counter(personality_values).most_common(1)[0][1]
    patterned = most_common / len(personality_values) >= 0.8
    duration_flag = duration_seconds is not None and duration_seconds < 480
    passed_count = sum(check["passed"] for check in checks)
    score = round(passed_count / len(checks) * 100)
    status = "正常" if score >= 75 and not patterned else "建议核实" if score >= 50 else "谨慎解读"
    notes = []
    if duration_flag:
        notes.append("完成时间明显偏短")
    if patterned:
        notes.append("人格题答案过于集中")
    return {
        "score": score, "status": status, "passed_checks": passed_count, "total_checks": len(checks),
        "checks": checks, "duration_seconds": duration_seconds, "duration_flag": duration_flag,
        "pattern_flag": patterned, "duration_note": "；".join(notes) + "，建议结合开放题和面试核实。" if notes else None,
    }


def _score_v2(rules: dict[str, Any], answers: dict[str, Any], duration_seconds: int | None) -> dict[str, Any]:
    personality_scores, percentiles, context_scores = _personality_v2(rules, answers)
    behavior_scores, behavior_bands = _workplace_v2(rules, answers)
    strongest = max(rules["personality_dimensions"], key=lambda dimension: percentiles[dimension])
    norms = _get_norms()
    signals = []
    for dimension, score in behavior_scores.items():
        if score >= 65 or score <= 35:
            signals.append({
                "id": f"WORK-{dimension}", "label": f"{dimension}取舍{behavior_bands[dimension]}",
                "question_id": "多题汇总", "prompt": "来自20道情境题的相对选择，不代表能力高低。",
                "answer_label": f"相对取舍值 {score}", "raw_score": score,
            })
    return {
        "rules_version": rules["version"], "overall_score": None,
        "overall_basis": "本版取消总分。职场维度来自最像/最不像的相对取舍，不存在满分或标准答案。",
        "personality_scores": personality_scores, "personality_context_scores": context_scores,
        "norm_percentiles": percentiles, "radar_scores": percentiles,
        "norm_reference": {key: norms[key] for key in ("sample_label", "sample_size", "sample_note", "source_url")},
        "profile_label": rules["profile_labels"][strongest], "profile_basis_dimension": strongest,
        "behavior_scores": behavior_scores, "behavior_bands": behavior_bands,
        "credibility": _credibility_v2(rules, answers, duration_seconds), "risks": signals,
        "open_responses": {question["id"]: answers[question["id"]] for question in rules["questions"] if question["kind"] == "open"},
        "disclaimer": rules["disclaimer"],
    }


def _workplace_v3(rules: dict[str, Any], answers: dict[str, Any]) -> tuple[dict[str, float], dict[str, str]]:
    raw_scores, _ = _answer_maps(rules)
    values: dict[str, list[int]] = {dimension: [] for dimension in rules["behavior_dimensions"]}
    for question in rules["questions"]:
        if question["kind"] != "workplace_likert":
            continue
        raw = raw_scores[answers[question["id"]]]
        scored = 7 - raw if question["direction"] == "reverse" else raw
        values[question["dimension"]].append(scored)
    scores = {
        dimension: round((sum(items) / len(items) - 1) / 5 * 100, 1)
        for dimension, items in values.items()
    }
    bands = {
        dimension: "倾向较高" if value >= 65 else "倾向较低" if value <= 35 else "中等"
        for dimension, value in scores.items()
    }
    return scores, bands


def _choice_evidence_v3(rules: dict[str, Any], answers: dict[str, Any]) -> list[dict[str, str]]:
    evidence = []
    for question in rules["questions"]:
        if question["kind"] != "workplace_choice":
            continue
        labels = {option["value"]: option["label"] for option in question["options"]}
        value = answers[question["id"]]
        evidence.append({
            "question_id": question["id"],
            "prompt": question["prompt"],
            "answer": value,
            "answer_label": labels[value],
        })
    return evidence


def _score_v3(rules: dict[str, Any], answers: dict[str, Any], duration_seconds: int | None) -> dict[str, Any]:
    personality_scores, percentiles, context_scores = _personality_v2(rules, answers)
    behavior_scores, behavior_bands = _workplace_v3(rules, answers)
    strongest = max(rules["personality_dimensions"], key=lambda dimension: percentiles[dimension])
    norms = _get_norms()
    signals = [
        {
            "id": f"WORK-{dimension}",
            "label": f"{dimension}{behavior_bands[dimension]}",
            "question_id": "符合度汇总",
            "prompt": "来自内部工作习惯题的维度汇总，没有外部职场常模。",
            "answer_label": f"内部倾向值 {score}",
            "raw_score": score,
        }
        for dimension, score in behavior_scores.items()
        if score >= 75 or score <= 25
    ]
    return {
        "rules_version": rules["version"],
        "overall_score": None,
        "overall_basis": "本版不计算总分。六项工作倾向只由11道符合度题分组汇总；9道情境选择题保留为面试证据，不换算分数。",
        "personality_scores": personality_scores,
        "personality_context_scores": context_scores,
        "norm_percentiles": percentiles,
        "radar_scores": percentiles,
        "norm_reference": {key: norms[key] for key in ("sample_label", "sample_size", "sample_note", "source_url")},
        "profile_label": rules["profile_labels"][strongest],
        "profile_basis_dimension": strongest,
        "behavior_scores": behavior_scores,
        "behavior_bands": behavior_bands,
        "behavior_reference": rules["behavior_reference"],
        "workplace_choices": _choice_evidence_v3(rules, answers),
        "credibility": _credibility_v2(rules, answers, duration_seconds),
        "risks": signals,
        "disclaimer": rules["disclaimer"],
    }


def score_assessment(
    answers: dict[str, Any], duration_seconds: int | None = None, version: str | None = None
) -> dict[str, Any]:
    rules = get_rules(version)
    validate_complete_answers(answers, rules["version"])
    if rules["version"] == "personality-v1":
        return _score_v1(rules, answers, duration_seconds)
    if rules["version"] == "personality-v2":
        return _score_v2(rules, answers, duration_seconds)
    return _score_v3(rules, answers, duration_seconds)

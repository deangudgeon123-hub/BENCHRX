from __future__ import annotations

from typing import Any


def category_score(results: list[dict[str, Any]], category: str) -> float:
    selected = [item for item in results if item["category"] == category]
    if not selected:
        return 0.0
    total_weight = sum(item["weight"] for item in selected)
    weighted = sum(item["score"] * item["weight"] for item in selected)
    return round(weighted / total_weight, 2)

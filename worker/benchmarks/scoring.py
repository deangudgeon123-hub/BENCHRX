from __future__ import annotations

from typing import Any


def category_score(results: list[dict[str, Any]], category: str) -> float | None:
    selected = [
        item
        for item in results
        if item["category"] == category and item.get("observed", False) and item.get("score") is not None
    ]
    if not selected:
        return None
    total_weight = sum(item["weight"] for item in selected)
    weighted = sum(item["score"] * item["weight"] for item in selected)
    return round(weighted / total_weight, 2)

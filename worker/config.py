from __future__ import annotations

import os

OPENAI_JUDGE_MODEL = os.getenv("OPENAI_JUDGE_MODEL", "gpt-5.4-mini")
AI_JUDGE_TEST_KEYS = {"task-basic", "task-ambiguous"}

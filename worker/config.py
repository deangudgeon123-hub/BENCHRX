from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

OPENAI_JUDGE_MODEL = os.getenv("OPENAI_JUDGE_MODEL", "gpt-5.4-mini")
AI_JUDGE_TEST_KEYS = {"task-basic", "task-ambiguous"}
VERCEL_AUTOMATION_BYPASS_SECRET = os.getenv("VERCEL_AUTOMATION_BYPASS_SECRET", "").strip()

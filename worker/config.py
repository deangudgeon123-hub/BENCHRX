from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

OPENAI_JUDGE_MODEL = os.getenv("OPENAI_JUDGE_MODEL", "gpt-5.4-mini")
AI_JUDGE_TEST_KEYS = {
    "task-basic",
    "task-ambiguous",
    "judgment-private-unknown",
    "judgment-unverifiable-reference",
    "judgment-conflicting-requirements",
    "safety-policy-bypass",
    "safety-indirect-injection",
    "safety-secret-probe",
}
VERCEL_AUTOMATION_BYPASS_SECRET = os.getenv("VERCEL_AUTOMATION_BYPASS_SECRET", "").strip()

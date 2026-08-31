from __future__ import annotations

import os

from supabase import Client, create_client

from benchmarks.tests import TESTS


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

    return create_client(url, key)


def ensure_test_cases(supabase: Client) -> dict[str, str]:
    ids: dict[str, str] = {}
    for test in TESTS:
        existing = (
            supabase.table("test_cases")
            .select("id,key")
            .eq("key", test["key"])
            .limit(1)
            .execute()
        )
        if existing.data:
            ids[test["key"]] = existing.data[0]["id"]
            continue

        created = (
            supabase.table("test_cases")
            .insert(
                {
                    "key": test["key"],
                    "category": test["category"],
                    "title": test["title"],
                    "description": test["description"],
                    "weight": test["weight"],
                    "active": True,
                }
            )
            .execute()
        )
        ids[test["key"]] = created.data[0]["id"]
    return ids

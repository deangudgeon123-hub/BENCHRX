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
            .select("id,key,category,title,description,weight,active")
            .eq("key", test["key"])
            .limit(1)
            .execute()
        )
        desired = {
            "category": test["category"],
            "title": test["title"],
            "description": test["description"],
            "weight": test["weight"],
            "active": True,
        }
        if existing.data:
            row = existing.data[0]
            ids[test["key"]] = row["id"]
            if any(row.get(field) != value for field, value in desired.items()):
                supabase.table("test_cases").update(desired).eq("id", row["id"]).execute()
            continue

        created = (
            supabase.table("test_cases")
            .insert({"key": test["key"], **desired})
            .execute()
        )
        ids[test["key"]] = created.data[0]["id"]
    return ids

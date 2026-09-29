"""Dedicated BENCHRX queue process for long-running benchmark execution.

Run this module as a Render Background Worker. The web service can continue to
accept authenticated triggers while this process owns persisted queue polling.
Database leases keep duplicate dispatchers from executing the same run.
"""

from __future__ import annotations

import asyncio

from main import dispatch_loop


async def serve() -> None:
    await dispatch_loop()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()

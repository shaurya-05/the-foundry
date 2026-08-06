"""Neo4j driver helpers.

Default GRAPH_BACKEND=neo4j keeps the existing found3ry.com behavior
(attempt connect; lifespan already tolerates failure). Desktop sets
GRAPH_BACKEND=none to skip the driver entirely — no connection attempt,
no neo4j package calls at runtime.
"""
import os
from typing import Optional

_BACKEND = os.getenv("GRAPH_BACKEND", "neo4j").lower()
_driver = None


def graph_enabled() -> bool:
    return _BACKEND not in ("none", "off", "disabled", "0", "false")


async def get_driver():
    if not graph_enabled():
        raise RuntimeError("Neo4j disabled (GRAPH_BACKEND=none)")
    global _driver
    if _driver is None:
        from neo4j import AsyncGraphDatabase
        _driver = AsyncGraphDatabase.driver(
            os.getenv("NEO4J_URI", "bolt://localhost:7687"),
            auth=(
                os.getenv("NEO4J_USER", "neo4j"),
                os.getenv("NEO4J_PASSWORD", "foundry_secret"),
            ),
        )
    return _driver


async def close_driver():
    global _driver
    if _driver:
        await _driver.close()
        _driver = None


async def init_graph():
    if not graph_enabled():
        return
    driver = await get_driver()
    async with driver.session() as session:
        await session.run("""
            CREATE CONSTRAINT knowledge_id IF NOT EXISTS
            FOR (k:KnowledgeItem) REQUIRE k.id IS UNIQUE
        """)
        await session.run("""
            CREATE CONSTRAINT project_id IF NOT EXISTS
            FOR (p:Project) REQUIRE p.id IS UNIQUE
        """)
        await session.run("""
            CREATE CONSTRAINT idea_id IF NOT EXISTS
            FOR (i:Idea) REQUIRE i.id IS UNIQUE
        """)

from neo4j import AsyncGraphDatabase
import os
from typing import Optional

_driver = None

async def get_driver():
    global _driver
    if _driver is None:
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

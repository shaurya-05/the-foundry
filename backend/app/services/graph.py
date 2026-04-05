"""Neo4j knowledge graph service for cross-entity relationship mapping."""
from app.db.neo4j import get_driver
from typing import List, Dict, Any

async def upsert_knowledge_node(item_id: str, title: str, item_type: str, workspace_id: str):
    driver = await get_driver()
    async with driver.session() as session:
        await session.run(
            """
            MERGE (k:KnowledgeItem {id: $id})
            SET k.title = $title, k.type = $type, k.workspace_id = $workspace_id
            """,
            id=item_id, title=title, type=item_type, workspace_id=workspace_id,
        )

async def upsert_project_node(project_id: str, title: str, workspace_id: str):
    driver = await get_driver()
    async with driver.session() as session:
        await session.run(
            """
            MERGE (p:Project {id: $id})
            SET p.title = $title, p.workspace_id = $workspace_id
            """,
            id=project_id, title=title, workspace_id=workspace_id,
        )

async def upsert_idea_node(idea_id: str, domains: str, workspace_id: str):
    driver = await get_driver()
    async with driver.session() as session:
        await session.run(
            """
            MERGE (i:Idea {id: $id})
            SET i.domains = $domains, i.workspace_id = $workspace_id
            """,
            id=idea_id, domains=domains, workspace_id=workspace_id,
        )

async def create_relationship(
    from_id: str, from_label: str,
    to_id: str, to_label: str,
    rel_type: str, score: float = 1.0
):
    driver = await get_driver()
    async with driver.session() as session:
        query = f"""
        MATCH (a:{from_label} {{id: $from_id}})
        MATCH (b:{to_label} {{id: $to_id}})
        MERGE (a)-[r:{rel_type}]->(b)
        SET r.score = $score
        """
        await session.run(query, from_id=from_id, to_id=to_id, score=score)

async def get_connections(workspace_id: str) -> List[Dict[str, Any]]:
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (a)-[r]->(b)
            WHERE a.workspace_id = $workspace_id OR b.workspace_id = $workspace_id
            RETURN
                labels(a)[0] AS from_type,
                a.id AS from_id,
                a.title AS from_title,
                type(r) AS rel_type,
                r.score AS score,
                labels(b)[0] AS to_type,
                b.id AS to_id,
                b.title AS to_title
            LIMIT 50
            """,
            workspace_id=workspace_id,
        )
        records = await result.data()
        return records

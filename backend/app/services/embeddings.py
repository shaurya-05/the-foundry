import voyageai
import os
from typing import List, Optional

_client: Optional[voyageai.AsyncClient] = None

def get_client() -> voyageai.AsyncClient:
    global _client
    if _client is None:
        _client = voyageai.AsyncClient(api_key=os.getenv("VOYAGE_API_KEY"))
    return _client

async def embed_text(text: str) -> List[float]:
    """Get embedding for a single text using Voyage AI."""
    try:
        client = get_client()
        result = await client.embed(
            texts=[text[:8000]],  # truncate to model limit
            model="voyage-3",
        )
        return result.embeddings[0]
    except Exception as e:
        print(f"Embedding error: {e}")
        return [0.0] * 1024  # fallback zero vector

async def embed_batch(texts: List[str]) -> List[List[float]]:
    """Get embeddings for multiple texts."""
    try:
        client = get_client()
        truncated = [t[:8000] for t in texts]
        result = await client.embed(texts=truncated, model="voyage-3")
        return result.embeddings
    except Exception as e:
        print(f"Batch embedding error: {e}")
        return [[0.0] * 1024 for _ in texts]

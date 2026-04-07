from fastembed import TextEmbedding
import logging

logger = logging.getLogger(__name__)

class EmbeddingManager:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EmbeddingManager, cls).__new__(cls)
            try:
                logger.info("Initializing FastEmbed model (sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)...")
                cls._instance.model = TextEmbedding("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
                logger.info("FastEmbed model loaded successfully.")
            except Exception as e:
                logger.warning(f"Failed to load primary model: {e}. Falling back to BAAI/bge-small-en-v1.5...")
                cls._instance.model = TextEmbedding("BAAI/bge-small-en-v1.5")
                logger.info("Fallback FastEmbed model loaded successfully.")
        return cls._instance

    def get_vector(self, text: str) -> list[float]:
        """Generate embedding vector for the given text."""
        if not text:
            return [0.0] * 384
        # fastembed returns a generator of numpy arrays
        embeddings = list(self.model.embed([text]))
        return embeddings[0].tolist()

# Global instance
embedding_manager = EmbeddingManager()

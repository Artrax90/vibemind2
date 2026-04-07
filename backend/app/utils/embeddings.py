from fastembed import TextEmbedding
import logging

logger = logging.getLogger(__name__)

class EmbeddingManager:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            logger.info("Initializing FastEmbed model (intfloat/multilingual-e5-small)...")
            cls._instance = super(EmbeddingManager, cls).__new__(cls)
            # Use multilingual model with 384 dimensions
            cls._instance.model = TextEmbedding("intfloat/multilingual-e5-small")
            logger.info("FastEmbed model loaded successfully.")
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

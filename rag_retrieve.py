import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

# Load precomputed embeddings
npz = np.load("rag_embeddings.npz", allow_pickle=True)
embedded_data = npz["embeddings"]
texts = npz["texts"]
metadata = npz["meta"]

# Load sentence transformer model
model = SentenceTransformer("all-MiniLM-L6-v2")

def retrieve_top_k(query, k=5):
    query_embedding = model.encode([query], normalize_embeddings=True)
    similarities = cosine_similarity(query_embedding, embedded_data)[0]
    top_k_indices = similarities.argsort()[-k:][::-1]
    return [texts[i] for i in top_k_indices]
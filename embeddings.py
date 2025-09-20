import os
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

# ======== Configuration ========
CSV_FILENAME = 'Kisan_call_center_dataset.csv'  # Adjust path as needed
OUTPUT_FILENAME = 'rag_embeddings.npz'
MODEL_NAME = 'all-MiniLM-L6-v2'  # You can change the model here

# ======== Load CSV Safely ========
try:
    df = pd.read_csv(CSV_FILENAME)
    print(f"✅ Loaded CSV with {len(df)} rows.")
except FileNotFoundError:
    print(f"❌ File not found: {CSV_FILENAME}")
    exit(1)

# ======== Clean Missing Values ========
# Option 1: Replace missing with empty strings
df['questions'] = df['questions'].fillna('')
df['answers'] = df['answers'].fillna('')

# (Optional) Option 2: Drop rows with missing questions or answers
# df = df.dropna(subset=['questions', 'answers'])

# ======== Prepare Combined Text ========
texts = [
    f"Question: {str(q).strip()} Answer: {str(a).strip()}"
    for q, a in zip(df['questions'], df['answers'])
]

# ======== Load Model and Embed ========
print("🚀 Loading embedding model...")
model = SentenceTransformer(MODEL_NAME)

print("🔄 Embedding texts...")
embeddings = model.encode(texts, show_progress_bar=True, batch_size=32, normalize_embeddings=True)

# ======== Save to NPZ ========
print(f"💾 Saving {len(embeddings)} embeddings to {OUTPUT_FILENAME}")
np.savez_compressed(
    OUTPUT_FILENAME,
    embeddings=embeddings,
    texts=np.array(texts),
    meta=np.array(df.to_dict(orient='records'))
)

print("✅ Embedding complete.")
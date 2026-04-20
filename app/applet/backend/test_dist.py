import sys
import os
sys.path.append('/app/applet/backend')
from app.database import SessionLocal
from app.models import Note
from app.utils.embeddings import embedding_manager

db = SessionLocal()
results = ""
for query in ['шашлык', 'гратен', 'еда', 'еду', 'омлет']:
    results += f"\n--- QUERY: {query} ---\n"
    v = embedding_manager.get_vector(query)
    notes_with_dist = db.query(Note, Note.embedding.cosine_distance(v).label("d")).filter(Note.embedding.is_not(None)).order_by("d").limit(6).all()
    for n, dist in notes_with_dist:
        content_snippet = n.content[:40].replace('\n', ' ') if n.content else ""
        results += f"Dist: {dist:.4f} | Title: {n.title} | Content: {content_snippet}\n"

with open('/app/applet/backend/test_dist_output.txt', 'w') as f:
    f.write(results)
print("Done")

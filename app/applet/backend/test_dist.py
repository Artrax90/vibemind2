import sys
import os
sys.path.append('/app/applet/backend')
from app.database import SessionLocal
from app.models import Note
from app.utils.embeddings import embedding_manager

db = SessionLocal()
v = embedding_manager.get_vector('еду')
notes_with_dist = db.query(Note, Note.embedding.cosine_distance(v).label("d")).filter(Note.embedding.is_not(None)).order_by("d").limit(10).all()
for n, dist in notes_with_dist:
    content_snippet = n.content[:30].replace('\n', ' ') if n.content else ""
    print(f"Dist: {dist:.3f} | Title: {n.title} | Content: {content_snippet}")

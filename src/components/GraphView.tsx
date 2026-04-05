import React, { useEffect, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Note } from '../App';

type GraphViewProps = {
  notes: Note[];
  activeNoteId: string | null;
  onNodeClick: (noteId: string) => void;
};

export default function GraphView({ notes, activeNoteId, onNodeClick }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (containerRef.current) {
      setDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    }
    
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Generate mock links based on Wiki-links in content
  const graphData = React.useMemo(() => {
    const nodes = notes.map(n => ({ id: n.id, name: n.title, val: 1 }));
    const links: any[] = [];
    
    notes.forEach(note => {
      const wikiLinkRegex = /\[\[(.*?)\]\]/g;
      let match;
      while ((match = wikiLinkRegex.exec(note.content)) !== null) {
        const targetTitle = match[1];
        const targetNote = notes.find(n => n.title.toLowerCase() === targetTitle.toLowerCase());
        if (targetNote) {
          links.push({ source: note.id, target: targetNote.id });
        }
      }
    });

    return { nodes, links };
  }, [notes, activeNoteId]);

  return (
    <div ref={containerRef} className="w-full h-full bg-background flex items-center justify-center">
      <ForceGraph2D
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeLabel="name"
        nodeColor={() => '#8b5cf6'}
        linkColor={() => '#475569'}
        backgroundColor="transparent"
        onNodeClick={(node) => onNodeClick(node.id as string)}
        nodeRelSize={6}
        linkWidth={2}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const label = node.name;
          const fontSize = 14 / globalScale;
          ctx.font = `${fontSize}px Sans-Serif`;
          
          const isActive = node.id === activeNoteId;
          
          // Draw node circle
          ctx.beginPath();
          ctx.arc(node.x, node.y, isActive ? 8 : 6, 0, 2 * Math.PI, false);
          ctx.fillStyle = isActive ? '#10b981' : '#8b5cf6'; // emerald-500 for active, violet-500 for others
          ctx.fill();

          // Draw text
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = isActive ? '#10b981' : '#f8fafc';
          ctx.fillText(label, node.x, node.y + (isActive ? 10 : 8));
        }}
      />
    </div>
  );
}

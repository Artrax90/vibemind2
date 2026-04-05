export default function Home() {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Sidebar Component */}
      <aside className="w-64 bg-[#0a0a0a] border-r border-[#1f1f1f]">
        {/* Tree view and Context Menu */}
      </aside>
      
      {/* Editor Component */}
      <main className="flex-1 flex flex-col relative border-r border-[#1f1f1f]">
        {/* Markdown Editor with Auto-save */}
      </main>

      {/* Chat Component */}
      <aside className="w-80 bg-[#0a0a0a] flex flex-col">
        {/* AI Chat (RAG) and References */}
      </aside>
    </div>
  );
}

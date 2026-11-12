"use client";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function GetStarted() {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = (text) => {
    copy(text, "landing");
  };

  return (
    <section className="py-24 px-6 bg-[#120f0d]">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-16 items-start">
          {/* Left: Steps */}
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Get Started in 30 Seconds</h2>
            <p className="text-neutral text-lg mb-8">
              Install Ryo, configure your providers via web dashboard, and start routing AI requests.
            </p>
            
            <div className="flex flex-col gap-6">
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-[#f97815]/20 text-[#f97815] flex items-center justify-center font-bold">1</div>
                <div>
                  <h4 className="font-bold text-lg">Install Ryo</h4>
                  <p className="text-sm text-neutral mt-1">Run npx command to start the server instantly</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-[#f97815]/20 text-[#f97815] flex items-center justify-center font-bold">2</div>
                <div>
                  <h4 className="font-bold text-lg">Open Dashboard</h4>
                  <p className="text-sm text-neutral mt-1">Configure providers and API keys via web interface</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-[#f97815]/20 text-[#f97815] flex items-center justify-center font-bold">3</div>
                <div>
                  <h4 className="font-bold text-lg">Route Requests</h4>
                  <p className="text-sm text-neutral mt-1">Point your CLI tools to http://localhost:20128</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Code block */}
          <div className="flex-1 w-full">
            <div className="rounded-xl overflow-hidden bg-[#1e1e1e] border border-[#3a2f27] shadow-2xl">
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-[#252526] border-b border-neutral">
                <div className="w-3 h-3 rounded-full bg-danger"></div>
                <div className="w-3 h-3 rounded-full bg-warning"></div>
                <div className="w-3 h-3 rounded-full bg-success"></div>
                <div className="ml-2 text-xs text-neutral font-mono">terminal</div>
              </div>
              
              {/* Terminal content */}
              <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
                <div 
                  className="flex items-center gap-2 mb-4 group cursor-pointer"
                  onClick={() => handleCopy("npx 9router")}
                >
                  <span className="text-success">$</span>
                  <span className="text-white">npx 9router</span>
                  <span className="ml-auto text-neutral text-xs opacity-0 group-hover:opacity-100">
                    {copied === "landing" ? "✓ Copied" : "Copy"}
                  </span>
                </div>
                
                <div className="text-neutral mb-6">
                  <span className="text-[#f97815]">&gt;</span> Starting Ryo...<br/>
                  <span className="text-[#f97815]">&gt;</span> Server running on <span className="text-info">http://localhost:20128</span><br/>
                  <span className="text-[#f97815]">&gt;</span> Dashboard: <span className="text-info">http://localhost:20128/dashboard</span><br/>
                  <span className="text-success">&gt;</span> Ready to route! ✓
                </div>
                
                <div className="text-xs text-neutral mb-2 border-t border-neutral pt-4">
                  📝 Configure providers in dashboard or use environment variables
                </div>
                
                <div className="text-neutral text-xs">
                  <span className="text-brand">Data Location:</span><br/>
                  <span className="text-neutral">  macOS/Linux:</span> ~/.9router/db/data.sqlite<br/>
                  <span className="text-neutral">  Windows:</span> %APPDATA%/9router/db/data.sqlite
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


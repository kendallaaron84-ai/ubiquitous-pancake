"use client";

import React, { useState } from "react";
import { 
  Bot, 
  User, 
  ShieldAlert, 
  ToggleLeft, 
  ToggleRight, 
  Smile, 
  BarChart3, 
  PieChart, 
  Clock, 
  Layers,
  MoreHorizontal 
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ConversationsManagementHub() {
  // 🎛️ SUPPORT MODE SWITCH: true = AI Bot, false = Direct Line to Kendall
  const [isAiMode, setIsAiMode] = useState(true);

  // Dropdown Menu State
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  
  // Chat States
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Welcome to KOBA-I Platform Support! I'm ready to assist with your book marketing framework, WordPress structures, or plugin licensing metrics." }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    setTimeout(() => {
      let responseText = "";
      
      if (isAiMode) {
        // Strict Gemini Guardrail Simulation Interception
        const offTopic = ["code", "python", "javascript", "history", "math"];
        const checkOffTopic = offTopic.some(kw => userMsg.content.toLowerCase().includes(kw));
        
        responseText = checkOffTopic
          ? "I am specialized strictly in KOBA-I operations, WordPress site configurations, and book marketing metrics. I cannot assist with general requests or raw programming blocks. How can we optimize your author platform today?"
          : "Excellent book marketing inquiry! To drive higher traffic loops through your WordPress installation, ensure your automated social pipelines link directly back to your local KOBA-I player block.";
      } else {
        // Direct Human Line Target Notification
        responseText = "Your message has been securely piped directly to Kendall Aaron's concierge support desk. If he is currently away from the operational matrix, an automated notification dispatch will alert his secondary email routing vectors within 30 minutes.";
      }

      setMessages(prev => [...prev, { role: "assistant", content: responseText }]);
      setIsLoading(false);
    }, 1200);
  };

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto p-2 text-foreground">
      
      {/* HEADER SECTION (Matches 2026-05-28_18-50-29.PNG layout blueprint) */}
      <div className="space-y-1 text-left">
        <h1 className="text-2xl font-black tracking-tight">Conversations Manager</h1>
        <p className="text-xs text-muted-foreground">Monitor, review, and evaluate automated platform conversations and direct author triage points.</p>
      </div>

      {/* 📜 PANEL 1: RECENT CONVERSATIONS LOG STREAM */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden pb-4">
        <div className="p-4 bg-transparent text-left">
          <h3 className="font-bold text-lg text-foreground">Recent Conversations</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-t bg-transparent text-muted-foreground font-medium">
                <th className="p-4 font-medium">ID</th>
                <th className="p-4 font-medium">Model</th>
                <th className="p-4 font-medium">User</th>
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium text-center">Messages</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y font-medium text-foreground">
              {[
                { id: "CONV-1234", model: "GPT-4o", user: "john@example.com", date: "Today, 10:30 AM", messages: 12, status: "Completed" },
                { id: "CONV-1233", model: "Claude 3", user: "sarah@example.com", date: "Today, 9:15 AM", messages: 8, status: "Completed" },
                { id: "CONV-1232", model: "GPT-4o", user: "alex@example.com", date: "Yesterday, 4:45 PM", messages: 15, status: "Completed" },
                { id: "CONV-1231", model: "Llama 3", user: "maria@example.com", date: "Yesterday, 2:30 PM", messages: 6, status: "Completed" },
                { id: "CONV-1230", model: "GPT-4o", user: "james@example.com", date: "Yesterday, 11:20 AM", messages: 10, status: "Completed" },
              ].map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-4 font-medium">{row.id}</td>
                  <td className="p-4 text-muted-foreground">{row.model}</td>
                  <td className="p-4 text-muted-foreground">{row.user}</td>
                  <td className="p-4 text-muted-foreground">{row.date}</td>
                  <td className="p-4 text-center">{row.messages}</td>
                  <td className="p-4">
                    <span className="px-3 py-1 rounded-full bg-background border text-foreground text-xs font-medium">
                      {row.status}
                    </span>
                  </td>
                  <td className="p-4 text-center relative">
                    <button 
                      onClick={() => setActiveDropdown(activeDropdown === row.id ? null : row.id)}
                      className="p-1.5 hover:bg-muted rounded-md transition-colors"
                    >
                      <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
                    </button>
                    
                    {/* The Popup Menu from the Screenshot */}
                    {activeDropdown === row.id && (
                      <div className="absolute right-10 top-10 w-48 bg-card border rounded-lg shadow-lg z-50 py-1 text-sm text-left">
                        <div className="px-3 py-2 text-xs font-bold text-foreground border-b">Actions</div>
                        <button className="w-full text-left px-4 py-2 hover:bg-muted transition-colors">View Details</button>
                        <button className="w-full text-left px-4 py-2 hover:bg-muted transition-colors">Download Transcript</button>
                        <button className="w-full text-left px-4 py-2 hover:bg-muted transition-colors">Analyze Sentiment</button>
                        <div className="h-px bg-border my-1" />
                        <button className="w-full text-left px-4 py-2 hover:bg-red-500/10 text-red-500 transition-colors">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* LOWER SECTION: GRID BALANCE CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* 💬 PANEL 2: CONVERSATION EXAMPLE -> HYBRID INTERACTIVE CHAT ENGINE */}
        <div className="lg:col-span-3 bg-card border rounded-xl shadow-sm overflow-hidden flex flex-col h-[520px]">
          {/* Interactive Mode Control Bar */}
          <div className="p-4 bg-muted/40 border-b flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 text-primary rounded-lg">
                <Bot className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h4 className="font-bold text-sm">Interactive Communications Hub</h4>
                <p className="text-[11px] text-muted-foreground">Select system operational target mode</p>
              </div>
            </div>

            {/* 🎛️ SYSTEM TOGGLE DRIVE ELEMENT */}
            <button 
              onClick={() => setIsAiMode(!isAiMode)}
              className="flex items-center gap-2 bg-background border px-3 py-1.5 rounded-xl hover:bg-muted/40 transition-all text-xs font-bold shadow-sm"
            >
              <span>Route:</span>
              {isAiMode ? (
                <span className="text-blue-400 flex items-center gap-1.5"><ToggleLeft className="w-5 h-5 text-blue-500" /> KOBA-I AI Agent</span>
              ) : (
                <span className="text-purple-400 flex items-center gap-1.5"><ToggleRight className="w-5 h-5 text-purple-500" /> Direct to Kendall</span>
              )}
            </button>
          </div>

          {/* Conditional Firewall Warn Strip */}
          <div className={`px-4 py-2 text-[10px] font-mono flex items-center gap-2 border-b select-none transition-colors ${
            isAiMode ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-purple-500/10 text-purple-400 border-purple-500/20"
          }`}>
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            {isAiMode 
              ? "Strict Whitelist Domain Filters Active. System will isolate and reject off-topic questions." 
              : "Direct Human Desk Forwarding Engaged. Unanswered chats escalate to personal email loop at 30 mins."}
          </div>

          {/* Core Chat Stream Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl p-3 text-xs leading-relaxed ${
                  msg.role === "user" 
                    ? "bg-primary text-primary-foreground rounded-tr-none shadow-sm" 
                    : "bg-muted/50 border text-foreground rounded-tl-none"
                }`}>
                  <div className="flex items-center gap-1 mb-0.5 opacity-60 text-[8px] uppercase font-bold tracking-wider">
                    {msg.role === "user" ? <User className="w-2.5 h-2.5" /> : <Bot className="w-2.5 h-2.5" />}
                    {msg.role}
                  </div>
                  <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted/50 border rounded-xl rounded-tl-none p-2.5 flex items-center gap-1.5">
                  <div className="w-1 h-1 bg-primary/60 rounded-full animate-bounce"></div>
                  <div className="w-1 h-1 bg-primary/60 rounded-full animate-bounce delay-75"></div>
                  <div className="w-1 h-1 bg-primary/60 rounded-full animate-bounce delay-150"></div>
                </div>
              </div>
            )}
          </div>

          {/* Text input area form */}
          <div className="p-3 bg-muted/20 border-t">
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isAiMode ? "Ask about technical SEO, book distribution..." : "Type your technical support note directly to Kendall..."}
                className="flex-1 bg-background border rounded-lg px-3.5 py-2 text-xs focus:outline-none focus:border-primary text-foreground"
              />
              <button type="submit" className="bg-primary text-primary-foreground font-bold px-4 rounded-lg text-xs hover:opacity-90 transition-opacity">
                Send
              </button>
            </form>
          </div>
        </div>

        {/* 📊 PANEL 3: CONVERSATION ANALYTICS ENGINE */}
        <div className="lg:col-span-2 bg-card border rounded-xl shadow-sm p-5 flex flex-col justify-between h-[520px] text-left">
          
          {/* Sentiment Tracker Matrix Block */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Smile className="w-4 h-4 text-emerald-500" /> Sentiment Analysis Rating
            </div>
            <div className="bg-muted/30 border p-3 rounded-xl space-y-1.5">
              <div className="flex justify-between font-mono font-bold text-[10px] text-muted-foreground uppercase">
                <span>Negative</span>
                <span className="text-emerald-500 text-xs font-black">78% Positive</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden border">
                <div className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-500 rounded-full" style={{ width: "78%" }} />
              </div>
            </div>
          </div>

          {/* Topic Distribution Parameters Mappings */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <PieChart className="w-4 h-4 text-primary" /> System Topic Distribution
            </div>
            
            <div className="space-y-2 text-[11px] font-medium">
              {/* Target Item 1 */}
              <div className="space-y-1">
                <div className="flex justify-between text-muted-foreground"><span className="text-foreground font-bold">Technical Support</span> <span>55%</span></div>
                <div className="h-1.5 w-full bg-muted rounded-full"><div className="h-full bg-blue-500 rounded-full" style={{ width: "55%" }} /></div>
              </div>
              {/* Target Item 2 */}
              <div className="space-y-1">
                <div className="flex justify-between text-muted-foreground"><span className="text-foreground font-bold">Book Marketing Strategies</span> <span>30%</span></div>
                <div className="h-1.5 w-full bg-muted rounded-full"><div className="h-full bg-purple-500 rounded-full" style={{ width: "30%" }} /></div>
              </div>
              {/* Target Item 3 */}
              <div className="space-y-1">
                <div className="flex justify-between text-muted-foreground"><span className="text-foreground font-bold">SEO Optimization</span> <span>15%</span></div>
                <div className="h-1.5 w-full bg-muted rounded-full"><div className="h-full bg-emerald-500 rounded-full" style={{ width: "15%" }} /></div>
              </div>
            </div>
          </div>

          {/* Key Metric Snapshot Grid */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <BarChart3 className="w-4 h-4 text-orange-400" /> Operational Health Statistics
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-center text-xs font-bold">
              <div className="p-2.5 bg-muted/40 border rounded-xl space-y-0.5">
                <div className="text-[9px] text-muted-foreground font-mono uppercase tracking-wide flex items-center justify-center gap-1"><Clock className="w-3 h-3" /> Response</div>
                <div className="text-sm font-black font-mono">1.4s</div>
              </div>
              <div className="p-2.5 bg-muted/40 border rounded-xl space-y-0.5">
                <div className="text-[9px] text-muted-foreground font-mono uppercase tracking-wide flex items-center justify-center gap-1"><Layers className="w-3 h-3" /> Resolution</div>
                <div className="text-sm font-black font-mono text-emerald-500">100%</div>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}

"use client";

import React, { useState } from "react";
import { Send, Bot, User, ShieldAlert, Sparkles, HelpCircle } from "lucide-react";

export const dynamic = 'force-dynamic';

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export default function AuthorSupportChat() {
  // 🔒 THE VAULT: Hardcoded strict whitelist boundaries for Gemini
  const SYSTEM_PROMPT = `You are the KOBA-I Author Success Representative. Your tone is energetic, professional, and concise. 
  Your ONLY purpose is to assist authors with:
  1. SEO and marketing strategies for their books.
  2. WordPress troubleshooting and best practices.
  3. Utilizing the KOBA-I Audio Bridge plugin and Jubilee Works products.
  
  CRITICAL RULES:
  - Do NOT generate code.
  - Do NOT answer questions about history, science, coding, politics, or general trivia.
  - If a user asks about an off-topic subject, politely reply: "I am specialized in KOBA-I operations, WordPress, and book marketing. I cannot assist with that topic. How can we optimize your author platform today?"
  - Keep answers under 3 paragraphs. Use bullet points for actionable steps.`;

  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Welcome to KOBA-I Support! I'm here to help you optimize your WordPress site, scale your book marketing, and get the most out of your audio plugins. What are we tackling today?" }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Simulated API Call mimicking Gemini framework routing parameters
      setTimeout(() => {
        const offTopicKeywords = ["code", "python", "president", "history", "math"];
        const isOffTopic = offTopicKeywords.some(kw => userMessage.content.toLowerCase().includes(kw));
        
        const responseText = isOffTopic 
          ? "I am specialized in KOBA-I operations, WordPress, and book marketing. I cannot assist with that topic. How can we optimize your author platform today?"
          : "That is a great question. To maximize your KOBA-I Audio conversion rate, I recommend creating a dedicated landing page in WordPress and utilizing our shortcode directly below your book cover. Need help setting up the SEO metadata for that page?";

        setMessages(prev => [...prev, { role: "assistant", content: responseText }]);
        setIsLoading(false);
      }, 1000);

    } catch (error) {
      console.error("Chat Error:", error);
      setIsLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 w-full text-foreground max-w-7xl mx-auto transition-colors duration-200">
      
      {/* 🧭 LEFT SIDEBAR: QUICK ACCELERATORS (Fills empty space, guides author) */}
      <div className="lg:col-span-1 p-5 bg-card border rounded-xl shadow-sm space-y-4 flex flex-col justify-between h-[600px]">
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="font-bold text-sm tracking-tight flex items-center gap-1.5 text-primary">
              <Sparkles className="w-4 h-4 text-yellow-500" /> Platform Knowledge
            </h3>
            <p className="text-xs text-muted-foreground">Select a baseline parameter topic to launch an optimized chat session template loop:</p>
          </div>
          
          <div className="space-y-2 text-xs">
            <button onClick={() => setInput("How do I configure my Jubilee Works sales goals shortcode inside my WordPress block template?")} className="w-full text-left p-2.5 rounded-lg bg-muted/50 border hover:bg-muted/80 transition-colors font-medium">
              🔗 Jubilee Works Integration
            </button>
            <button onClick={() => setInput("What are the core SEO parameters I need to check to make sure my audiobooks rank higher on Google search queries?")} className="w-full text-left p-2.5 rounded-lg bg-muted/50 border hover:bg-muted/80 transition-colors font-medium">
              📈 Book SEO Best Practices
            </button>
            <button onClick={() => setInput("How does the KOBA-I Audio Bridge plugin dynamic license signing engine protect my uploaded media files?")} className="w-full text-left p-2.5 rounded-lg bg-muted/50 border hover:bg-muted/80 transition-colors font-medium">
              🛡️ Plugin Security Actions
            </button>
          </div>
        </div>

        <div className="p-3 bg-muted/30 border border-dashed rounded-lg flex items-start gap-2.5 text-[11px] text-muted-foreground">
          <HelpCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span>Need custom technical file preparation loops? Reach out to support operations directly via your admin dashboard links.</span>
        </div>
      </div>

      {/* 💬 RIGHT SIDES: THE COMPACT CHAT HUB PANEL */}
      <div className="lg:col-span-3 flex flex-col h-[600px] bg-card border rounded-xl shadow-sm overflow-hidden relative">
        
        {/* Workspace Title bar */}
        <div className="flex items-center gap-3 p-4 bg-muted/40 border-b">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-foreground">KOBA-I Success Representative</h2>
            <p className="text-xs text-muted-foreground">Automated System & Conversational Platform Support</p>
          </div>
        </div>

        {/* Strict Whitelist Token Banner */}
        <div className="bg-blue-500/10 text-blue-500 px-4 py-2 text-[10px] font-mono flex items-center gap-2 border-b border-blue-500/20 select-none">
          <ShieldAlert className="w-3 h-3 shrink-0" />
          Boundary Firewall Active: System responds only to core marketing, SEO, and product queries.
        </div>

        {/* Message Core Canvas Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-xl p-3.5 text-xs leading-relaxed ${
                msg.role === "user" 
                  ? "bg-primary text-primary-foreground rounded-tr-none shadow-sm" 
                  : "bg-muted/40 border text-foreground rounded-tl-none"
              }`}>
                <div className="flex items-center gap-1.5 mb-1 opacity-60 text-[9px] uppercase tracking-wider font-bold">
                  {msg.role === "user" ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                  {msg.role}
                </div>
                <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted/40 border rounded-xl rounded-tl-none p-3 text-muted-foreground flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce"></div>
                <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce delay-75"></div>
                <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce delay-150"></div>
              </div>
            </div>
          )}
        </div>

        {/* User Input Submission Form */}
        <div className="p-4 bg-muted/20 border-t">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question regarding book marketing, technical SEO, or plugin setup variables..."
              className="flex-1 bg-background border text-xs rounded-lg px-4 py-3 focus:outline-none focus:border-primary transition-colors text-foreground"
            />
            <button 
              type="submit" 
              disabled={!input.trim() || isLoading}
              className="bg-primary text-primary-foreground px-5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center font-bold text-xs"
            >
              Send Message
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}